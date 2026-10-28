import { vi } from "vitest";
import { app } from "../../src/worker/index";
import { runAnalysis } from "../../src/worker/routes/captures";
import type { Env } from "../../src/worker/env";
import { createTestD1 } from "./d1";

export const APP_KEY = "test-key-0123456789";

/** 内存版 R2，只实现用到的 put/get。 */
function createTestR2() {
  const objects = new Map<string, { value: Uint8Array; contentType?: string }>();
  return {
    objects,
    async put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { value, contentType: options?.httpMetadata?.contentType });
      return {};
    },
    async get(key: string) {
      const object = objects.get(key);
      if (!object) return null;
      return {
        body: new Response(object.value as Uint8Array<ArrayBuffer>).body,
        httpMetadata: { contentType: object.contentType },
        arrayBuffer: async () => object.value.slice().buffer,
      };
    },
  };
}

/** 假模型：按 prompt 里的特征返回预设的 JSON，并记录每次调用 */
export function fakeModel(replies: { analyze?: unknown; refocus?: unknown; item?: unknown; general?: unknown }) {
  const calls: { prompt: string; hasImage: boolean }[] = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const content = body.messages[0].content as { type: string; text?: string }[];
    const prompt = content.find((part) => part.type === "text")!.text!;
    calls.push({ prompt, hasImage: content.some((part) => part.type === "image_url") });
    const reply = prompt.includes("学生想学其中的")
      ? replies.item
      : prompt.includes("学生选定的重点句")
        ? replies.refocus
        : prompt.includes("卡片正面")
          ? replies.general
          : replies.analyze;
    if (reply instanceof Error) return new Response(reply.message, { status: 500 });
    return Response.json({ choices: [{ message: { content: JSON.stringify(reply) } }] });
  });
  return { fetcher, calls };
}

export function createTestEnv(overrides: Partial<Env> = {}) {
  const DB = createTestD1();
  const IMAGES = createTestR2();
  const background: Promise<unknown>[] = [];
  const env = {
    DB,
    IMAGES,
    // 假队列：消息立刻交给消费者，api() 会等它跑完
    ANALYZE: { send: async ({ id }: { id: string }) => void background.push(runAnalysis(env, id)) },
    ASSETS: { fetch: async () => new Response("<html>app</html>") },
    APP_KEY,
    LLM_ENDPOINT: "https://llm.test/chat/completions",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "llm-key",
    LLM_THINKING: "disabled",
    APP_TIME_ZONE: "Europe/Berlin",
    DAILY_CAPTURE_LIMIT: "50",
    ...overrides,
  } as unknown as Env;

  const ctx = { waitUntil: (promise: Promise<unknown>) => background.push(promise), passThroughOnException() {}, props: {} };

  /** 带密钥的 API 请求，等后台任务（waitUntil）全部跑完再返回。 */
  async function api(pathname: string, init: RequestInit & { json?: unknown; key?: string | null } = {}) {
    const headers = new Headers(init.headers);
    if (init.key !== null) headers.set("Authorization", `Bearer ${init.key ?? APP_KEY}`);
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers.set("Content-Type", "application/json");
    }
    const response = await app.request(pathname, { ...init, headers, body }, env, ctx as unknown as ExecutionContext);
    await Promise.all(background.splice(0));
    return response;
  }

  return { env, DB, IMAGES, api };
}

/** 1×1 的 JPEG，够测上传和存储 */
export const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";
