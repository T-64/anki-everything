import { afterEach, describe, expect, it, vi } from "vitest";
import { draftFrom, type NoteCapture } from "../src/shared/capture";
import { renderMarkdown } from "../src/shared/markdown";
import { noteFields, noteTags } from "../src/shared/render";
import { TINY_JPEG, createTestEnv, fakeModel } from "./support/env";
import { MEDICINE } from "./fixtures";

// v2：三种做法、存在数据库里的设置、没有 AI 时的兜底

const ID = "33333333-3333-4333-8333-333333333333";
const PLANT = { ok: true, front: "龟背竹 Monstera deliciosa", highlights: ["龟背竹"], back: "- 叶子有**裂口**和孔\n- 原产中美洲", answer: null, unreadable: null };

afterEach(() => vi.unstubAllGlobals());

const note = async (response: Response) => (await response.json()) as NoteCapture;
type SettingsBody = { settings: Record<string, string>; examples: Record<string, string> };
const json = async <T>(response: Response) => (await response.json()) as T;

function withModel(replies: Parameters<typeof fakeModel>[0], overrides = {}) {
  const model = fakeModel(replies);
  vi.stubGlobal("fetch", model.fetcher);
  return { ...createTestEnv(overrides), model };
}

const create = (api: ReturnType<typeof createTestEnv>["api"], mode: string, question: string | null = null) =>
  api("/api/captures", { method: "POST", json: { id: ID, mode, question, image: TINY_JPEG } });

describe("设置", () => {
  it("默认值和示例 prompt；只改传进来的键；不认识的键拒绝", async () => {
    const { api } = createTestEnv();
    const initial = await json<SettingsBody>(await api("/api/settings"));
    expect(initial.settings).toMatchObject({ language_prompt: "", source_lang: "de", deck: "Anki Everything" });
    expect(initial.examples.general.length).toBeGreaterThan(20);
    const saved = await json<SettingsBody>(await api("/api/settings", { method: "PUT", json: { deck: "Pflanzen", level: "B1" } }));
    expect(saved.settings).toMatchObject({ deck: "Pflanzen", level: "B1", source_lang: "de" });
    expect((await api("/api/settings", { method: "PUT", json: { secret: "x" } })).status).toBe(400);
    expect((await json<{ deckName: string }>(await api("/api/config"))).deckName).toBe("Pflanzen");
  });

  it("模型收到的是：自己的 prompt 在前，输出格式在后；没写就用示例", async () => {
    const { api, model } = withModel({ analyze: MEDICINE });
    await api("/api/settings", { method: "PUT", json: { language_prompt: "MEIN PROMPT", source_lang: "fr" } });
    await create(api, "language", "怎么吃？");
    const prompt = model.calls[0].prompt;
    expect(prompt.startsWith("MEIN PROMPT")).toBe(true);
    expect(prompt).toContain("学生在学法语");
    expect(prompt.indexOf("学生的提问：「怎么吃？」")).toBeLessThan(prompt.indexOf("字段："));
  });
});

describe("通用做法", () => {
  it("识别出正面、背面；不能换句子、补词；确认后进 Anki", async () => {
    const { api, model } = withModel({ general: PLANT });
    await api("/api/settings", { method: "PUT", json: { general_prompt: "记植物" } });
    expect((await create(api, "general")).status).toBe(202);
    expect(model.calls[0].prompt.startsWith("记植物")).toBe(true);
    const draft = await note(await api(`/api/captures/${ID}`));
    expect(draft).toMatchObject({ mode: "general", status: "draft", card: { front: PLANT.front, highlights: ["龟背竹"] } });
    const languageCard = draftFrom(MEDICINE);
    expect((await api(`/api/captures/${ID}/refocus`, { method: "POST", json: { card: languageCard, focus_ids: [1] } })).status).toBe(409);
    expect((await api(`/api/captures/${ID}/items`, { method: "POST", json: { card: languageCard, text: "x" } })).status).toBe(409);
    const edited = { ...draft.card!, back: "改过的" };
    const confirmed = await note(await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card: edited } }));
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.card!.back).toBe("改过的");
  });

  it("图里没有要的东西：失败并说明", async () => {
    const { api } = withModel({ general: { ok: false, unreadable: "一片空白" } });
    await create(api, "general");
    expect((await note(await api(`/api/captures/${ID}`))).error).toBe("nothing: 一片空白");
  });
});

describe("不用 AI", () => {
  it("不调模型，直接是空白草稿；全空也能确认；不算每日上限", async () => {
    const { api, model } = withModel({}, { DAILY_CAPTURE_LIMIT: "0" });
    const created = await note(await create(api, "manual", "会被忽略"));
    expect(created).toMatchObject({ mode: "manual", status: "draft", question: null, card: { front: "", back: "" } });
    expect(model.calls).toHaveLength(0);
    const confirmed = await note(await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card: created.card } }));
    expect(confirmed.status).toBe("confirmed");
  });

  it("服务器没配 key：config 说没有 AI，语言和通用做法被拒，不用 AI 照常", async () => {
    const { api } = createTestEnv({ LLM_API_KEY: "" });
    expect((await json<{ ai: boolean }>(await api("/api/config"))).ai).toBe(false);
    const refused = await create(api, "general");
    expect(refused.status).toBe(400);
    expect((await json<{ error: string }>(refused)).error).toBe("no_ai");
    expect((await create(api, "manual")).status).toBe(201);
  });

  it("老版本 App 不传 mode：按语言做法", async () => {
    const { api } = withModel({ analyze: MEDICINE });
    await api("/api/captures", { method: "POST", json: { id: ID, image: TINY_JPEG } });
    expect((await note(await api(`/api/captures/${ID}`))).mode).toBe("language");
  });
});

describe("通用 / 不用 AI 的卡片", () => {
  const base = { id: "n1", question: null, imageFile: "ae-n1.jpg", date: "2026-10-28" };

  it("正面划重点（中文也能划，不按整词）、保留换行；背面是 Markdown", () => {
    const [front, , back] = noteFields({ ...base, mode: "general", card: { ...PLANT, front: "龟背竹\nMonstera", highlights: ["龟背竹"] } });
    expect(front).toBe("<b>龟背竹</b><br>Monstera");
    expect(back).toContain("<ul><li>叶子有<b>裂口</b>和孔</li><li>原产中美洲</li></ul>");
  });

  it("全空的卡：只有图", () => {
    const fields = noteFields({ ...base, mode: "manual", card: { front: "", highlights: [], back: "", answer: null, unreadable: null } });
    expect(fields).toEqual(["", '<img src="ae-n1.jpg">', "", "2026-10-28", "n1"]);
  });

  it("按做法打标签", () => {
    expect(noteTags("manual")).toEqual(["anki-everything", "ae::manual"]);
  });
});

describe("Markdown", () => {
  it("HTML 和脚本只会原样显示", () => {
    const html = renderMarkdown("<script>alert(1)</script> **<img src=x onerror=alert(1)>**");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("标题、编号列表、段落、换行、斜体、代码", () => {
    expect(renderMarkdown("# 标题\n1. 一\n2. 二\n\n第一行\n第二行 *斜* `x`")).toBe(
      '<div class="ae-h1">标题</div>\n<ol><li>一</li><li>二</li></ol>\n<p>第一行<br>第二行 <i>斜</i> <code>x</code></p>',
    );
  });
});
