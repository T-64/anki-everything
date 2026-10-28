import { z } from "zod";
import type { Env } from "../env";
import { analysisSchema, focusSchema, generalSchema, itemSchema, noLanguageSchema, nothingSchema, type Analysis, type Focus, type Item } from "../../shared/capture";
import { analyzePrompt, generalPrompt, itemPrompt, refocusPrompt } from "./contract";
import { promptFor, type Settings } from "./settings";

// 模型调用：一个 OpenAI 兼容的视觉模型。prompt = 用户在设置里写的 + 代码里的输出格式（contract.ts）。

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1),
});

/**
 * 读出模型的回答正文。流式（SSE）时把每段 delta.content 拼起来，推理过程（reasoning_content）不要；
 * 不是流式（比如测试里的假模型）就按普通 JSON 读。
 */
export async function readContent(response: Response): Promise<string> {
  if (!response.headers.get("Content-Type")?.includes("text/event-stream")) {
    return completionSchema.parse(await response.json()).choices[0].message.content ?? "";
  }
  let content = "";
  let buffer = "";
  // 开思考时绝大多数数据块是推理过程（reasoning_content），只解析带正文的块，省 CPU
  const take = (line: string) => {
    if (!line.startsWith("data:") || !line.includes('"content":"')) return;
    const chunk = JSON.parse(line.slice(5)) as { choices?: { delta?: { content?: unknown } }[] };
    const piece = chunk.choices?.[0]?.delta?.content;
    if (typeof piece === "string") content += piece;
  };
  const decoder = new TextDecoder();
  const reader = response.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(take);
  }
  take(buffer + decoder.decode());
  return content;
}

export interface AiResult<T> {
  data: T;
  raw: string;
}

/** 模型调用最终失败；raw 是最后一次的原始输出（有的话），存进日志方便排查 */
export class AiError extends Error {
  constructor(
    message: string,
    readonly raw: string | null,
  ) {
    super(message);
  }
}

/** 调一次模型，拿到 JSON 并按 schema 校验；网络错误、5xx、解析失败都重试，最多 3 次（校验失败重试 2 次） */
async function ask<T>(env: Env, prompt: string, schema: z.ZodType<T>, imageDataUrl?: string): Promise<AiResult<T>> {
  if (!env.LLM_API_KEY?.trim()) throw new AiError("no_ai", null);
  const thinking = env.LLM_THINKING === "enabled";
  let lastError = "";
  let lastRaw: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(env.LLM_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LLM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.LLM_MODEL,
          messages: [
            {
              role: "user",
              content: [...(imageDataUrl ? [{ type: "image_url", image_url: { url: imageDataUrl } }] : []), { type: "text", text: prompt }],
            },
          ],
          // 思考的 token 也算在输出里，开思考时给足
          max_tokens: thinking ? 16000 : 6000,
          // 流式：智谱接口前面的网关 100 秒没有数据就断开（524），读图加思考常常要两三分钟
          stream: true,
          temperature: 0.2,
          // 是否先推理再回答（LLM_THINKING）。GLM 用 thinking 参数；其他 OpenAI 兼容接口不认识这个参数，不传
          ...(env.LLM_ENDPOINT.includes("bigmodel.cn") ? { thinking: { type: thinking ? "enabled" : "disabled" } } : {}),
          response_format: { type: "json_object" },
        }),
      });
    } catch (error) {
      lastError = `模型请求失败: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (!response.ok) {
      lastError = `模型 ${response.status}: ${(await response.text()).slice(0, 300)}`;
      if (response.status === 401 || response.status === 403) break;
      continue;
    }
    let content: string;
    try {
      content = await readContent(response);
    } catch (error) {
      lastError = `读取模型输出失败: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    const match = content.match(/\{[\s\S]*\}/);
    lastRaw = content;
    let json: unknown;
    try {
      json = JSON.parse(match?.[0] ?? "");
    } catch {
      lastError = `模型输出不是 JSON: ${content.slice(0, 200)}`;
      continue;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return { data: parsed.data, raw: content };
    lastError = `模型输出格式不对: ${parsed.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")} ${issue.message}`)
      .join("; ")}`;
  }
  throw new AiError(lastError, lastRaw);
}

export type AnalyzeOutput = Analysis | z.infer<typeof noLanguageSchema>;

/** 语言做法：识别一张图（或一段文字）并讲解；图里没有要学的语言时返回 language_ok: false */
export function analyze(env: Env, settings: Settings, input: { imageDataUrl?: string; text?: string }, question: string | null): Promise<AiResult<AnalyzeOutput>> {
  const prompt = analyzePrompt(promptFor(settings, "language"), settings, question, input.text);
  return ask(env, prompt, z.union([analysisSchema, noLanguageSchema]), input.imageDataUrl);
}

/** 语言做法：换了重点句，只重新讲解，不重新识别图片 */
export function refocus(env: Env, settings: Settings, transcript: Analysis["transcript"], focusIds: number[], question: string | null): Promise<AiResult<Focus>> {
  return ask(env, refocusPrompt(promptFor(settings, "language"), settings, transcript, focusIds, question), focusSchema);
}

/** 语言做法：学生自己补的一个词或短语 */
export function explainItem(env: Env, settings: Settings, sentence: string, text: string): Promise<AiResult<Item>> {
  return ask(env, itemPrompt(promptFor(settings, "language"), settings, sentence, text), itemSchema);
}

export type GeneralOutput = z.infer<typeof generalSchema> | z.infer<typeof nothingSchema>;

/** 通用做法：正面、背面写什么由用户的 prompt 决定 */
export function analyzeGeneral(env: Env, settings: Settings, imageDataUrl: string, question: string | null): Promise<AiResult<GeneralOutput>> {
  return ask(env, generalPrompt(promptFor(settings, "general"), settings, question), z.union([generalSchema, nothingSchema]), imageDataUrl);
}
