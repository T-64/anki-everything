import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureView, LanguageCapture } from "../src/shared/capture";
import { TINY_JPEG, createTestEnv, fakeModel } from "./support/env";
import { MEDICINE, STORAGE_FOCUS } from "./fixtures";

const ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllGlobals());

async function captured(replies: Parameters<typeof fakeModel>[0], question: string | null = null) {
  const model = fakeModel(replies);
  vi.stubGlobal("fetch", model.fetcher);
  const test = createTestEnv();
  const response = await test.api("/api/captures", { method: "POST", json: { id: ID, question, image: TINY_JPEG } });
  return { ...test, model, response };
}

const view = async (response: Response) => (await response.json()) as LanguageCapture;

describe("鉴权", () => {
  it("没有密钥或密钥不对一律 401；登录接口只验证密钥", async () => {
    const { api } = createTestEnv();
    expect((await api("/api/captures", { key: null })).status).toBe(401);
    expect((await api("/api/captures", { key: "wrong" })).status).toBe(401);
    expect((await api("/api/login", { method: "POST", key: null, json: { key: "wrong" } })).status).toBe(401);
    expect((await api("/api/login", { method: "POST", key: null, json: { key: "test-key-0123456789" } })).status).toBe(204);
  });

  it("App 的来源 https://localhost 可以跨域调用", async () => {
    const { api } = createTestEnv();
    const response = await api("/api/captures", { method: "OPTIONS", key: null, headers: { Origin: "https://localhost", "Access-Control-Request-Method": "POST" } });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
  });
});

describe("拍摄 → 识别 → 草稿", () => {
  it("上传后后台识别，完成后变成草稿，学习项全部预先勾上", async () => {
    const { response, api, model, IMAGES } = await captured({ analyze: MEDICINE }, "一天吃几次？");
    expect(response.status).toBe(202);
    expect(IMAGES.objects.has(`captures/${ID}/original`)).toBe(true);
    expect(model.calls[0].hasImage).toBe(true);
    expect(model.calls[0].prompt).toContain("学生的提问：「一天吃几次？」");
    expect(model.calls[0].prompt).toContain("德语");
    const capture = await view(await api(`/api/captures/${ID}`));
    expect(capture.status).toBe("draft");
    expect(capture.question).toBe("一天吃几次？");
    expect(capture.card!.items.every((item) => item.selected)).toBe(true);
  });

  it("同一个 id 重复上传不会生成第二条，也不会再调模型", async () => {
    const { api, model, DB } = await captured({ analyze: MEDICINE });
    const again = await api("/api/captures", { method: "POST", json: { id: ID, image: TINY_JPEG } });
    expect(again.status).toBe(200);
    expect(model.calls).toHaveLength(1);
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM captures").first("n")).toBe(1);
  });

  it("图里没有德语：标记失败并说明原因，不出卡", async () => {
    const { api } = await captured({ analyze: { language_ok: false, unreadable: "只有图标" } });
    const capture = await view(await api(`/api/captures/${ID}`));
    expect(capture.status).toBe("failed");
    expect(capture.error).toBe("no_language: 只有图标");
    expect(capture.card).toBeNull();
  });

  it("模型一直出错：重试 3 次后标记失败；修好后可以重试", async () => {
    const { api, model } = await captured({ analyze: new Error("boom") });
    expect(model.calls).toHaveLength(3);
    expect((await view(await api(`/api/captures/${ID}`))).status).toBe("failed");
    vi.stubGlobal("fetch", fakeModel({ analyze: MEDICINE }).fetcher);
    expect((await api(`/api/captures/${ID}/retry`, { method: "POST" })).status).toBe(202);
    expect((await view(await api(`/api/captures/${ID}`))).status).toBe("draft");
  });

  it("识别卡住超过 5 分钟：列表接口把它标记为失败", async () => {
    const { api, DB } = createTestEnv();
    await DB.prepare("INSERT INTO captures (id, created_at, updated_at, image_key, status) VALUES (?, ?, ?, 'k', 'analyzing')")
      .bind(ID, "2026-10-26T10:00:00.000Z", "2026-10-26T10:00:00.000Z")
      .run();
    const list = (await (await api("/api/captures")).json()) as CaptureView[];
    expect(list[0].status).toBe("failed");
    expect(list[0].error).toBe("timeout");
  });

  it("AI 原始输出只追加：识别、换重点句、补词各留一条", async () => {
    const { api, DB } = await captured({ analyze: MEDICINE, refocus: STORAGE_FOCUS, item: MEDICINE.items[0] });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    const refocused = (await view(await api(`/api/captures/${ID}/refocus`, { method: "POST", json: { card, focus_ids: [3] } }))).card!;
    await api(`/api/captures/${ID}/items`, { method: "POST", json: { card: refocused, text: "Tablette" } });
    const log = JSON.parse((await DB.prepare("SELECT analysis FROM captures").first<string>("analysis"))!) as { kind: string }[];
    expect(log.map((entry) => entry.kind)).toEqual(["analyze", "refocus", "item"]);
  });
});

describe("编辑草稿", () => {
  it("换重点句只重新讲解，不再传图片；返回新的学习项", async () => {
    const { api, model } = await captured({ analyze: MEDICINE, refocus: STORAGE_FOCUS });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    const updated = await view(await api(`/api/captures/${ID}/refocus`, { method: "POST", json: { card, focus_ids: [3] } }));
    expect(model.calls[1].hasImage).toBe(false);
    expect(model.calls[1].prompt).toContain('"focus_ids" 原样返回这几个');
    expect(updated.card!.focus_ids).toEqual([3]);
    expect(updated.card!.items.map((item) => item.lemma)).toEqual(["lagern"]);
  });

  it("补一个词：追加到学习项并勾上，界面上之前的勾选一起保存", async () => {
    const extra = { ...MEDICINE.items[0], lemma: "das Essen", surface: ["Essen"], zh: "饭" };
    const { api } = await captured({ analyze: MEDICINE, item: extra });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    card.items[0].selected = false;
    const updated = await view(await api(`/api/captures/${ID}/items`, { method: "POST", json: { card, text: "Essen" } }));
    expect(updated.card!.items.map((item) => [item.lemma, item.selected])).toEqual([
      ["die Tablette", false],
      ["einnehmen", true],
      ["nach dem Essen", true],
      ["das Essen", true],
    ]);
  });
});

describe("确认 → 写入 Anki", () => {
  it("确认后保存裁剪图；写入 Anki 后记录 note id；重复调用安全", async () => {
    const { api, IMAGES } = await captured({ analyze: MEDICINE });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    const confirmed = await view(await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card, card_image: TINY_JPEG } }));
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.has_card_image).toBe(true);
    expect(IMAGES.objects.has(`captures/${ID}/card`)).toBe(true);
    expect((await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card } })).status).toBe(200);

    const done = await view(await api(`/api/captures/${ID}/in-anki`, { method: "POST", json: { anki_note_id: 42, device: "phone-a-123" } }));
    expect(done.status).toBe("in_anki");
    expect(done.anki_note_id).toBe(42);
    expect((await view(await api(`/api/captures/${ID}/in-anki`, { method: "POST", json: { anki_note_id: 42, device: "phone-a-123" } }))).anki_note_id).toBe(42);
  });

  it("一个学习项都没勾不能确认；已进 Anki 的不能再改", async () => {
    const { api } = await captured({ analyze: MEDICINE });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    const none = { ...card, items: card.items.map((item) => ({ ...item, selected: false })) };
    expect((await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card: none } })).status).toBe(400);
    await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card } });
    expect((await api(`/api/captures/${ID}/refocus`, { method: "POST", json: { card, focus_ids: [1] } })).status).toBe(409);
    expect((await api(`/api/captures/${ID}/discard`, { method: "POST" })).status).toBe(409);
  });

  it("图片接口：kind=card 没裁剪时返回原图", async () => {
    const { api } = await captured({ analyze: MEDICINE });
    const response = await api(`/api/captures/${ID}/image?kind=card`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("no-cache");
  });
});

describe("模型流式输出", () => {
  it("把 SSE 里每段 delta.content 拼起来，跳过推理过程，跨块断开的行也能拼上", async () => {
    const { readContent } = await import("../src/worker/services/ai");
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "先想想" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"a":' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " 1}" } }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const encoded = new TextEncoder().encode(lines);
    const body = new ReadableStream({
      start(controller) {
        // 故意在一行中间切开
        controller.enqueue(encoded.slice(0, 50));
        controller.enqueue(encoded.slice(50));
        controller.close();
      },
    });
    const response = new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    expect(await readContent(response)).toBe('{"a": 1}');
  });
});

describe("换手机补写", () => {
  it("已进 Anki 的卡在另一台手机上补写：更新是哪台手机、哪个 note；没有 device 不接受", async () => {
    const { api } = await captured({ analyze: MEDICINE });
    const card = (await view(await api(`/api/captures/${ID}`))).card!;
    await api(`/api/captures/${ID}/confirm`, { method: "POST", json: { card } });
    expect((await api(`/api/captures/${ID}/in-anki`, { method: "POST", json: { anki_note_id: 1 } })).status).toBe(400);
    expect((await view(await api(`/api/captures/${ID}/in-anki`, { method: "POST", json: { anki_note_id: 1, device: "phone-a-123" } }))).anki_device).toBe("phone-a-123");
    const moved = await view(await api(`/api/captures/${ID}/in-anki`, { method: "POST", json: { anki_note_id: 2, device: "phone-b-456" } }));
    expect([moved.status, moved.anki_note_id, moved.anki_device]).toEqual(["in_anki", 2, "phone-b-456"]);
  });
});

describe("照片墙小图", () => {
  it("上传时带了小图就存下来；kind=thumb 优先给小图，没有就给原图", async () => {
    const model = fakeModel({ analyze: MEDICINE });
    vi.stubGlobal("fetch", model.fetcher);
    const { api, IMAGES } = createTestEnv();
    await api("/api/captures", { method: "POST", json: { id: ID, image: TINY_JPEG, thumb: TINY_JPEG } });
    expect(IMAGES.objects.has(`captures/${ID}/thumb`)).toBe(true);
    expect((await api(`/api/captures/${ID}/image?kind=thumb`)).status).toBe(200);
    const other = "22222222-2222-4222-8222-222222222222";
    await api("/api/captures", { method: "POST", json: { id: other, image: TINY_JPEG } });
    expect((await api(`/api/captures/${other}/image?kind=thumb`)).status).toBe(200);
  });
});
