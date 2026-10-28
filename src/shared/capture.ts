import { z } from "zod";

// AI 契约和卡片内容。App 和 Worker 共用这一份。

export const itemSchema = z.object({
  kind: z.enum(["word", "phrase"]),
  /** 在原文中的写法，用于高亮；可分动词可以是多段，如 ["Nehmen", "ein"] */
  surface: z.array(z.string().min(1)).min(1),
  /** 词典形式；名词带冠词 */
  lemma: z.string().min(1),
  plural: z.string().nullable(),
  zh: z.string().min(1),
  /** 构词拆解：复合词的组成词、派生词的词根和前后缀 */
  parts: z.array(z.object({ de: z.string().min(1), zh: z.string().min(1) })).nullable(),
  /** 英语对应词：优先同源词 */
  en: z.string().nullable(),
  note: z.string().nullable(),
});
export type Item = z.infer<typeof itemSchema>;

const chunkSchema = z.object({ de: z.string().min(1), zh: z.string().min(1) });

/**
 * 一段文字。模型在多个重点句时常把它写成每句一条：["…", "…"]、[{"id": 2, "text": "…"}]、{"11": "…"}，
 * 这些都按顺序拼成一段，不当成错误（真实照片测试里 5 张有 3 张这样）。
 */
export function joinText(value: unknown): unknown {
  const piece = (item: unknown): string | null =>
    typeof item === "string" ? item : item && typeof item === "object" && "text" in item && typeof item.text === "string" ? item.text : null;
  const pieces = Array.isArray(value) ? value.map(piece) : value && typeof value === "object" ? Object.values(value).map(piece) : null;
  if (!pieces || pieces.some((item) => item === null)) return value;
  return pieces.join(" ");
}
const text = z.preprocess(joinText, z.string());
const optionalText = z.preprocess(joinText, z.string().nullable());

/** 重点句部分：analyze 和 refocus 都返回它 */
export const focusSchema = z.object({
  focus_ids: z.array(z.number().int()).min(1).max(3),
  translation: text,
  chunks: z.array(chunkSchema),
  grammar_note: optionalText,
  items: z.array(itemSchema).max(8),
  answer: optionalText,
});
export type Focus = z.infer<typeof focusSchema>;

export const analysisSchema = focusSchema.extend({
  language_ok: z.boolean(),
  transcript: z.array(z.object({ id: z.number().int(), text: z.string() })),
  unreadable: optionalText,
});
export type Analysis = z.infer<typeof analysisSchema>;

/** 图里没有要学的语言时，模型只需要回这几个字段 */
export const noLanguageSchema = z.object({ language_ok: z.literal(false), unreadable: z.string().nullable().optional() });

/** 卡片内容 = AI 结果 + 用户的勾选。学习项带 selected，只有勾上的才上卡 */
export const cardItemSchema = itemSchema.extend({ selected: z.boolean() });
export type CardItem = z.infer<typeof cardItemSchema>;

export const cardDataSchema = analysisSchema.extend({
  items: z.array(cardItemSchema).max(12),
});
export type CardData = z.infer<typeof cardDataSchema>;

/** AI 刚给出的结果：推荐的学习项全部预先勾上 */
export function draftFrom(analysis: Analysis): CardData {
  return { ...analysis, focus_ids: sortedIds(analysis.focus_ids), items: analysis.items.map((item) => ({ ...item, selected: true })) };
}

// —— 通用做法和不用 AI ——

export const MODES = ["language", "general", "manual"] as const;
export type Mode = (typeof MODES)[number];

/** 通用做法的模型输出；ok: false 表示图里没有 prompt 要的东西 */
export const generalSchema = z.object({
  ok: z.literal(true),
  front: text,
  highlights: z.array(z.string().min(1)).max(5).catch([]),
  back: text,
  answer: optionalText.optional().transform((value) => value ?? null),
  unreadable: optionalText.optional().transform((value) => value ?? null),
});
export const nothingSchema = z.object({ ok: z.literal(false), unreadable: z.string().nullable().optional() });

/** 通用做法和不用 AI 的卡片：正面一段（可高亮），背面一段 Markdown。都可以为空 */
export const noteCardSchema = z.object({
  front: z.string().max(2000),
  highlights: z.array(z.string().min(1).max(200)).max(20),
  back: z.string().max(20000),
  answer: z.string().nullable(),
  unreadable: z.string().nullable(),
});
export type NoteCard = z.infer<typeof noteCardSchema>;

export const EMPTY_NOTE: NoteCard = { front: "", highlights: [], back: "", answer: null, unreadable: null };

/** 重点句 id 按原文顺序排，模型有时会乱序返回 */
const sortedIds = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** 换了重点句：重点句部分整体替换。之前的勾选和自己补的词讲的是旧句子，一起换掉 */
export function withFocus(card: CardData, focus: Focus): CardData {
  return { ...card, ...focus, focus_ids: sortedIds(focus.focus_ids), items: focus.items.map((item) => ({ ...item, selected: true })) };
}

export function focusText(card: Pick<CardData, "transcript" | "focus_ids">): string {
  return card.transcript
    .filter((sentence) => card.focus_ids.includes(sentence.id))
    .map((sentence) => sentence.text)
    .join(" ");
}

// 状态机：analyzing → draft → confirmed → in_anki；failed 可重试；discarded 是终点
export const STATUSES = ["analyzing", "draft", "confirmed", "in_anki", "failed", "discarded"] as const;
export type Status = (typeof STATUSES)[number];

const NEXT: Record<Status, readonly Status[]> = {
  analyzing: ["draft", "failed"],
  draft: ["confirmed", "discarded"],
  confirmed: ["in_anki"],
  in_anki: [],
  failed: ["analyzing", "discarded"],
  discarded: [],
};

export const canMove = (from: Status, to: Status) => NEXT[from].includes(to);

interface CaptureBase {
  id: string;
  created_at: string;
  question: string | null;
  status: Status;
  error: string | null;
  has_card_image: boolean;
  anki_note_id: number | null;
  /** 写进的是哪台手机的 AnkiDroid */
  anki_device: string | null;
}

/** 列表和详情接口返回的形状。卡片内容的格式由做法决定 */
export type CaptureView = CaptureBase & ({ mode: "language"; card: CardData | null } | { mode: "general" | "manual"; card: NoteCard | null });
export type LanguageCapture = Extract<CaptureView, { mode: "language" }>;
export type NoteCapture = Extract<CaptureView, { mode: "general" | "manual" }>;

export const MAX_FOCUS = 3;
