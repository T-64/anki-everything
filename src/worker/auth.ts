import type { MiddlewareHandler } from "hono";
import type { Env } from "./env";

async function sameToken(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(left)), crypto.subtle.digest("SHA-256", encoder.encode(right))]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

/**
 * 单人使用的简单门禁：每个请求带 Authorization: Bearer <APP_KEY>。
 * 不用 cookie：App 里的界面从 https://localhost 加载，和 API 不同源，cookie 带不过去；Web 版也走同一套。
 */
export const requireKey: MiddlewareHandler<{ Bindings: Env }> = async (context, next) => {
  const expected = context.env.APP_KEY;
  const given = context.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !given || !(await sameToken(given, expected))) {
    return context.json({ error: "unauthorized" }, 401);
  }
  await next();
};

/** 登录页：POST {"key": "…"} 只用来验证密钥对不对，密钥由界面自己保存 */
export const checkKey: MiddlewareHandler<{ Bindings: Env }> = async (context) => {
  const expected = context.env.APP_KEY;
  const body = await context.req.json<{ key?: unknown }>().catch(() => null);
  const given = typeof body?.key === "string" ? body.key.trim() : "";
  if (!expected || !given || !(await sameToken(given, expected))) return context.json({ error: "unauthorized" }, 401);
  return context.body(null, 204);
};
