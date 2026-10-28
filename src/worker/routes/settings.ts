import { Hono } from "hono";
import type { Env } from "../env";
import { EXAMPLE_PROMPTS, loadSettings, saveSettings, settingsSchema } from "../services/settings";

// 设置页：读的时候带上示例 prompt，设置页拿它当输入框里的灰字

export const settings = new Hono<{ Bindings: Env }>();

settings.get("/", async (context) => context.json({ settings: await loadSettings(context.env), examples: EXAMPLE_PROMPTS }));

settings.put("/", async (context) => {
  const body = settingsSchema
    .partial()
    .strict()
    .safeParse(await context.req.json().catch(() => null));
  if (!body.success) return context.json({ error: "invalid" }, 400);
  await saveSettings(context.env, body.data);
  return context.json({ settings: await loadSettings(context.env), examples: EXAMPLE_PROMPTS });
});
