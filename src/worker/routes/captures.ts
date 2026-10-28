import { Buffer } from "node:buffer";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "../env";
import { AiError, analyze, analyzeGeneral, explainItem, refocus } from "../services/ai";
import { hasAi, loadSettings } from "../services/settings";
import {
  EMPTY_NOTE,
  MAX_FOCUS,
  MODES,
  canMove,
  cardDataSchema,
  draftFrom,
  focusText,
  noteCardSchema,
  withFocus,
  type CaptureView,
  type CardData,
  type Mode,
  type NoteCard,
  type Status,
} from "../../shared/capture";

type AppContext = Context<{ Bindings: Env }>;

/** 识别超过这么久还没结果，就当作失败（消费者被中断时状态会卡在 analyzing）。消费者开始时会刷新 updated_at */
const STALE_MS = 15 * 60 * 1000;
/** 和 App 里压缩后的上限一致（3MB，base64 后约 4MB） */
const MAX_DATA_URL = 3 * 1024 * 1024 * 1.34;

interface Row {
  id: string;
  created_at: string;
  updated_at: string;
  question: string | null;
  mode: Mode;
  image_key: string;
  card_image_key: string | null;
  status: Status;
  analysis: string;
  card: string | null;
  error: string | null;
  anki_note_id: number | null;
  anki_device: string | null;
}

function toView(row: Row): CaptureView {
  const base = {
    id: row.id,
    created_at: row.created_at,
    question: row.question,
    status: row.status,
    error: row.error,
    has_card_image: row.card_image_key !== null,
    anki_note_id: row.anki_note_id,
    anki_device: row.anki_device,
  };
  const card: unknown = row.card ? JSON.parse(row.card) : null;
  return row.mode === "language" ? { ...base, mode: row.mode, card: card as CardData | null } : { ...base, mode: row.mode, card: card as NoteCard | null };
}

const now = () => new Date().toISOString();

const dataUrlSchema = z
  .string()
  .regex(/^data:image\/(jpeg|png|webp);base64,/)
  .max(MAX_DATA_URL);

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [header, base64] = dataUrl.split(",", 2);
  const contentType = header.slice(5, header.indexOf(";"));
  return { bytes: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)), contentType };
}

/** 原图转成 data URL 发给模型。用原生 Buffer 编码：在 JS 里逐段拼字符串太费 CPU（免费版每次执行的 CPU 时间很紧） */
async function readDataUrl(env: Env, key: string): Promise<string> {
  const object = await env.IMAGES.get(key);
  if (!object) throw new Error(`图片不见了: ${key}`);
  const base64 = Buffer.from(await object.arrayBuffer()).toString("base64");
  return `data:${object.httpMetadata?.contentType ?? "image/jpeg"};base64,${base64}`;
}

async function load(env: Env, id: string): Promise<Row | null> {
  return env.DB.prepare("SELECT * FROM captures WHERE id = ?").bind(id).first<Row>();
}

/** 只追加：每次 AI 调用的原始输出都留着，调 prompt 时可以回放 */
const appendLog = (kind: "analyze" | "refocus" | "item" | "failed") => `json_insert(analysis, '$[#]', json_object('kind', '${kind}', 'at', ?, 'raw', ?))`;

async function move(env: Env, id: string, from: Status, to: Status, set = "", values: unknown[] = []) {
  if (!canMove(from, to)) throw new Error(`状态不能从 ${from} 变成 ${to}`);
  const result = await env.DB.prepare(`UPDATE captures SET status = ?, updated_at = ?${set ? `, ${set}` : ""} WHERE id = ? AND status = ?`)
    .bind(to, now(), ...values, id, from)
    .run();
  return result.meta.changes > 0;
}

/**
 * 识别（队列消费者里跑，见 index.ts）：结果写回数据库，界面轮询。
 * 不用 waitUntil：免费版响应返回后它只有 30 秒，读图经常超过。
 */
export async function runAnalysis(env: Env, id: string) {
  const row = await load(env, id);
  if (!row || row.status !== "analyzing") return;
  await env.DB.prepare("UPDATE captures SET updated_at = ? WHERE id = ? AND status = 'analyzing'").bind(now(), id).run();
  const fail = (reason: string, unreadable: string | null | undefined, raw: string) =>
    env.DB.prepare(`UPDATE captures SET status = 'failed', updated_at = ?, error = ?, analysis = ${appendLog("analyze")} WHERE id = ? AND status = 'analyzing'`)
      .bind(now(), `${reason}${unreadable ? `: ${unreadable}` : ""}`, now(), raw, id)
      .run();
  const toDraft = (card: CardData | NoteCard, raw: string) =>
    env.DB.prepare(`UPDATE captures SET status = 'draft', updated_at = ?, error = NULL, card = ?, analysis = ${appendLog("analyze")} WHERE id = ? AND status = 'analyzing'`)
      .bind(now(), JSON.stringify(card), now(), raw, id)
      .run();
  try {
    const settings = await loadSettings(env);
    const image = await readDataUrl(env, row.image_key);
    if (row.mode === "general") {
      const { data, raw } = await analyzeGeneral(env, settings, image, row.question);
      if (data.ok === false) return void (await fail("nothing", data.unreadable, raw));
      const { front, highlights, back, answer, unreadable } = data;
      return void (await toDraft({ front, highlights, back, answer, unreadable }, raw));
    }
    const { data, raw } = await analyze(env, settings, { imageDataUrl: image }, row.question);
    if (data.language_ok === false) return void (await fail("no_language", data.unreadable, raw));
    await toDraft(draftFrom(data), raw);
  } catch (error) {
    // 失败那次的原始输出也追加进日志，方便对着改 prompt 或 schema
    const raw = error instanceof AiError ? error.raw : null;
    await env.DB.prepare(
      `UPDATE captures SET status = 'failed', updated_at = ?, error = ?, analysis = ${raw === null ? "analysis" : appendLog("failed")} WHERE id = ? AND status = 'analyzing'`,
    )
      .bind(now(), error instanceof Error ? error.message : String(error), ...(raw === null ? [] : [now(), raw]), id)
      .run();
  }
}

const enqueue = (context: AppContext, id: string) => context.env.ANALYZE.send({ id });

const notFound = (context: AppContext) => context.json({ error: "not found" }, 404);
const wrongState = (context: AppContext, status: Status) => context.json({ error: "wrong_state", status }, 409);
const wrongMode = (context: AppContext) => context.json({ error: "wrong_mode" }, 409);

export const captures = new Hono<{ Bindings: Env }>();

const createSchema = z.object({
  id: z.uuid(),
  /** 老版本 App 不传，按语言做法处理 */
  mode: z.enum(MODES).default("language"),
  question: z.string().trim().max(500).nullable().optional(),
  image: dataUrlSchema,
  /** 照片墙用的小图（App 拍照时一起生成），没有就用原图 */
  thumb: dataUrlSchema.optional(),
});

/** 新拍摄。按 id 幂等：离线队列重发同一张不会生成第二条 */
captures.post("/", async (context) => {
  const body = createSchema.safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid", issues: body.error.issues }, 400);
  const { id, image, mode } = body.data;
  const existing = await load(context.env, id);
  if (existing) return context.json(toView(existing), 200);

  const manual = mode === "manual";
  if (!manual && !hasAi(context.env)) return context.json({ error: "no_ai" }, 400);
  // 每日上限是为了模型账单，不用 AI 的不算
  if (!manual) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const count = await context.env.DB.prepare("SELECT COUNT(*) AS n FROM captures WHERE created_at > ? AND mode != 'manual'").bind(since).first<number>("n");
    if ((count ?? 0) >= Number(context.env.DAILY_CAPTURE_LIMIT)) return context.json({ error: "daily_limit" }, 429);
  }

  const { bytes, contentType } = decodeDataUrl(image);
  const key = `captures/${id}/original`;
  await context.env.IMAGES.put(key, bytes, { httpMetadata: { contentType } });
  if (body.data.thumb) {
    const thumb = decodeDataUrl(body.data.thumb);
    await context.env.IMAGES.put(`captures/${id}/thumb`, thumb.bytes, { httpMetadata: { contentType: thumb.contentType } });
  }
  const question = body.data.question || null;
  const at = now();
  // 不用 AI：不识别，直接是一张空白草稿
  await context.env.DB.prepare(
    "INSERT INTO captures (id, created_at, updated_at, question, mode, image_key, status, card) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING",
  )
    .bind(id, at, at, manual ? null : question, mode, key, manual ? "draft" : "analyzing", manual ? JSON.stringify(EMPTY_NOTE) : null)
    .run();
  if (manual) return context.json(toView((await load(context.env, id))!), 201);
  await enqueue(context, id);
  return context.json(toView((await load(context.env, id))!), 202);
});

captures.get("/", async (context) => {
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  await context.env.DB.prepare("UPDATE captures SET status = 'failed', error = 'timeout', updated_at = ? WHERE status = 'analyzing' AND updated_at < ?").bind(now(), stale).run();
  const status = context.req.query("status");
  const { results } = status
    ? await context.env.DB.prepare("SELECT * FROM captures WHERE status = ? ORDER BY created_at DESC LIMIT 200").bind(status).all<Row>()
    : await context.env.DB.prepare("SELECT * FROM captures WHERE status != 'discarded' ORDER BY created_at DESC LIMIT 200").all<Row>();
  return context.json(results.map(toView));
});

captures.get("/:id", async (context) => {
  const row = await load(context.env, context.req.param("id"));
  return row ? context.json(toView(row)) : notFound(context);
});

/** 编辑中的卡片随请求一起带上，服务器保存后再改，界面上的勾选不会丢 */
const draftCard = z.object({ card: cardDataSchema });

captures.post("/:id/refocus", async (context) => {
  const body = draftCard.extend({ focus_ids: z.array(z.number().int()).min(1).max(MAX_FOCUS) }).safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid" }, 400);
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  if (row.mode !== "language") return wrongMode(context);
  if (row.status !== "draft") return wrongState(context, row.status);
  const settings = await loadSettings(context.env);
  const { data, raw } = await refocus(context.env, settings, body.data.card.transcript, body.data.focus_ids, row.question);
  const card = withFocus(body.data.card, { ...data, focus_ids: body.data.focus_ids });
  await context.env.DB.prepare(`UPDATE captures SET card = ?, updated_at = ?, analysis = ${appendLog("refocus")} WHERE id = ? AND status = 'draft'`)
    .bind(JSON.stringify(card), now(), now(), raw, row.id)
    .run();
  return context.json(toView((await load(context.env, row.id))!));
});

captures.post("/:id/items", async (context) => {
  const body = draftCard.extend({ text: z.string().trim().min(1).max(100) }).safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid" }, 400);
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  if (row.mode !== "language") return wrongMode(context);
  if (row.status !== "draft") return wrongState(context, row.status);
  const settings = await loadSettings(context.env);
  const { data, raw } = await explainItem(context.env, settings, focusText(body.data.card), body.data.text);
  const card: CardData = { ...body.data.card, items: [...body.data.card.items, { ...data, selected: true }] };
  if (!cardDataSchema.safeParse(card).success) return context.json({ error: "too_many_items" }, 400);
  await context.env.DB.prepare(`UPDATE captures SET card = ?, updated_at = ?, analysis = ${appendLog("item")} WHERE id = ? AND status = 'draft'`)
    .bind(JSON.stringify(card), now(), now(), raw, row.id)
    .run();
  return context.json(toView((await load(context.env, row.id))!));
});

/** 确认时带上的卡片：语言做法是 CardData（至少勾一个词），其他做法是 NoteCard（可以全空） */
const confirmSchema = z.object({ card: z.unknown(), card_image: dataUrlSchema.nullable().optional() });

captures.post("/:id/confirm", async (context) => {
  const body = confirmSchema.safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid" }, 400);
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  const parsed = (row.mode === "language" ? cardDataSchema : noteCardSchema).safeParse(body.data.card);
  if (!parsed.success) return context.json({ error: "invalid" }, 400);
  const card = parsed.data;
  if ("items" in card && !card.items.some((item) => item.selected)) return context.json({ error: "no_items" }, 400);
  if (row.status === "confirmed" || row.status === "in_anki") return context.json(toView(row));
  if (row.status !== "draft") return wrongState(context, row.status);
  let cardImageKey: string | null = null;
  if (body.data.card_image) {
    const { bytes, contentType } = decodeDataUrl(body.data.card_image);
    cardImageKey = `captures/${row.id}/card`;
    await context.env.IMAGES.put(cardImageKey, bytes, { httpMetadata: { contentType } });
  }
  await move(context.env, row.id, "draft", "confirmed", "card = ?, card_image_key = ?", [JSON.stringify(card), cardImageKey]);
  return context.json(toView((await load(context.env, row.id))!));
});

/** 写进了某台手机的 AnkiDroid。已经是 in_anki 时（换了手机补写）只更新是哪台手机、哪个 note */
captures.post("/:id/in-anki", async (context) => {
  const body = z.object({ anki_note_id: z.number().int().positive(), device: z.string().min(8).max(64) }).safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid" }, 400);
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  if (row.status === "in_anki") {
    await context.env.DB.prepare("UPDATE captures SET anki_note_id = ?, anki_device = ?, updated_at = ? WHERE id = ?")
      .bind(body.data.anki_note_id, body.data.device, now(), row.id)
      .run();
    return context.json(toView((await load(context.env, row.id))!));
  }
  if (row.status !== "confirmed") return wrongState(context, row.status);
  await move(context.env, row.id, "confirmed", "in_anki", "anki_note_id = ?, anki_device = ?, in_anki_at = ?", [body.data.anki_note_id, body.data.device, now()]);
  return context.json(toView((await load(context.env, row.id))!));
});

captures.post("/:id/retry", async (context) => {
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  if (row.status !== "failed") return wrongState(context, row.status);
  await move(context.env, row.id, "failed", "analyzing", "error = NULL");
  await enqueue(context, row.id);
  return context.json(toView((await load(context.env, row.id))!), 202);
});

captures.post("/:id/discard", async (context) => {
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  if (row.status === "discarded") return context.body(null, 204);
  if (!canMove(row.status, "discarded")) return wrongState(context, row.status);
  await move(context.env, row.id, row.status, "discarded");
  return context.body(null, 204);
});

/** 图片：kind=card 返回裁剪后的图（没裁剪就是原图）；kind=thumb 返回小图（老照片没有小图，用原图） */
captures.get("/:id/image", async (context) => {
  const row = await load(context.env, context.req.param("id"));
  if (!row) return notFound(context);
  const kind = context.req.query("kind");
  const wantsCard = kind === "card";
  const object =
    (kind === "thumb" ? await context.env.IMAGES.get(`captures/${row.id}/thumb`) : null) ??
    (await context.env.IMAGES.get(wantsCard ? (row.card_image_key ?? row.image_key) : row.image_key));
  if (!object) return notFound(context);
  // 原图永远不变；上卡的图在确认前后会从原图变成裁剪图，不能长期缓存
  const cache = wantsCard ? "private, no-cache" : "private, max-age=31536000, immutable";
  return new Response(object.body as ReadableStream, {
    headers: { "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": cache },
  });
});
