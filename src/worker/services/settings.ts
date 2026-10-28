import { z } from "zod";
import type { Env } from "../env";
import languageExample from "../../../prompts/examples/language.md?raw";
import generalExample from "../../../prompts/examples/general.md?raw";

// 设置：prompt 和语言存在 D1，不进仓库。prompt 为空时用仓库里的示例。

export const EXAMPLE_PROMPTS = { language: languageExample.trim(), general: generalExample.trim() };

export const settingsSchema = z.object({
  language_prompt: z.string().max(20000),
  general_prompt: z.string().max(20000),
  source_lang: z.string().trim().min(1).max(40),
  target_lang: z.string().trim().min(1).max(40),
  level: z.string().trim().max(40),
  deck: z.string().trim().min(1).max(100),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  language_prompt: "",
  general_prompt: "",
  source_lang: "de",
  target_lang: "zh-CN",
  level: "A1-A2",
  deck: "Anki Everything",
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const stored = Object.fromEntries(results.filter((row) => (KEYS as string[]).includes(row.key)).map((row) => [row.key, row.value]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** 只写传进来的键 */
export async function saveSettings(env: Env, patch: Partial<Settings>) {
  const at = new Date().toISOString();
  const entries = Object.entries(patch).filter(([key]) => (KEYS as string[]).includes(key));
  if (entries.length === 0) return;
  await env.DB.batch(
    entries.map(([key, value]) =>
      env.DB.prepare(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      ).bind(key, value, at),
    ),
  );
}

/** 实际发给模型的 prompt：自己写的，没写就用示例 */
export const promptFor = (settings: Settings, mode: "language" | "general") =>
  (mode === "language" ? settings.language_prompt : settings.general_prompt).trim() || EXAMPLE_PROMPTS[mode];

/** 服务器有没有配模型 key：没有就只能“不用 AI” */
export const hasAi = (env: Env) => Boolean(env.LLM_API_KEY?.trim());
