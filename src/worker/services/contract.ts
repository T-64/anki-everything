import type { Analysis } from "../../shared/capture";
import type { Settings } from "./settings";

// 输出格式：字段、JSON 规则、“看不清别编”。这部分公开、写在代码里，
// 拼在用户自己写的 prompt 后面。“怎么讲”（角色、风格、示例）只在用户的 prompt 里。

const LANGUAGE_NAMES: Record<string, string> = {
  de: "德语",
  en: "英语",
  fr: "法语",
  es: "西班牙语",
  it: "意大利语",
  ja: "日语",
  ko: "韩语",
  "zh-CN": "简体中文",
};
export const languageName = (code: string) => LANGUAGE_NAMES[code] ?? code;

const JSON_ONLY = "只输出一个 JSON 对象，不要任何解释或 markdown 代码块。";
const HONESTY = "看不清就照实说，绝对不要猜、不要编造：原文必须是图里真实的文字，看不清的部分不要补全成你以为的词。";

const questionLine = (question: string | null) => (question ? `学生的提问：「${question}」` : "学生没有提问。");

/** 用户的 prompt + 背景 + 输出格式，各段之间空一行 */
const join = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

function languageContext(settings: Settings) {
  const source = languageName(settings.source_lang);
  const target = languageName(settings.target_lang);
  const level = settings.level ? `，水平 ${settings.level}` : "";
  return { source, target, line: `学生在学${source}${level}；所有讲解用${target}。${JSON_ONLY}` };
}

const itemSpec = (target: string) => `{
    "kind": "word"（单词）或 "phrase"（固定搭配、短语）,
    "surface": 这一项在重点句原文中出现的写法，原样照抄，数组；被拆开的词写成多段,
    "lemma": 词典形式,
    "plural": 名词复数的词典写法，非名词或不可数为 null,
    "zh": 在这句话里的${target}意思，简短,
    "parts": 构词拆解，每段 {"de": 原文片段, "zh": 片段的${target}含义}；拆不出意义时为 null,
    "en": 英语里对应的词（优先同源词），没有为 null,
    "note": 用法补充一句话，或 null
  }`;

const focusSpec = (target: string, hasQuestion: boolean) => `"focus_ids": 重点句的 id，1–3 个${hasQuestion ? "，选回答提问需要的句子" : ""},
  "translation": 重点句的${target}翻译，自然通顺；只写一个字符串，多句连成一段,
  "chunks": 重点句按意群切分，[{"de": 片段原文, "zh": 片段意思}]，按原文顺序,
  "grammar_note": 重点句里最值得一提的一个语法点，一两句话；没有就 null,
  "items": 3–8 个学习项，只从重点句里挑，按重要性排序${hasQuestion ? "，优先挑和提问有关的" : ""}：[${itemSpec(target)}],
  "answer": ${hasQuestion ? `对提问的简短回答（${target}），基于图里的内容` : "null"}`;

/** 语言做法：识别一张图（或一段文字）并讲解 */
export function analyzePrompt(prompt: string, settings: Settings, question: string | null, text?: string) {
  const { source, target, line } = languageContext(settings);
  const material = text ? `学生给的文字：\n"""\n${text}\n"""` : "";
  return join(
    prompt,
    line,
    questionLine(question),
    material,
    `字段：
{
  "language_ok": ${text ? "这段文字" : "图里"}有没有可读的${source}文字（true/false）；没有的话其余字段可以省略,
  "transcript": 全部${source}文字，按句切分照抄，[{"id": 从 1 开始的序号, "text": 句子原文}]；标题、标签上的短语也各算一句,
  ${focusSpec(target, Boolean(question))},
  "unreadable": 看不清或不确定的地方如实说明，否则 null
}`,
    HONESTY,
  );
}

/** 语言做法：换了重点句，只重新讲解 */
export function refocusPrompt(prompt: string, settings: Settings, transcript: Analysis["transcript"], focusIds: number[], question: string | null) {
  const { target, line } = languageContext(settings);
  return join(
    prompt,
    line,
    questionLine(question),
    `这是已经识别好的全文（按句编号）：\n${JSON.stringify(transcript)}`,
    `学生选定的重点句 id：${JSON.stringify(focusIds)}。"focus_ids" 原样返回这几个，只讲解这几句。`,
    `字段：\n{\n  ${focusSpec(target, Boolean(question))}\n}`,
    HONESTY,
  );
}

/** 语言做法：学生自己补的一个词或短语 */
export function itemPrompt(prompt: string, settings: Settings, sentence: string, text: string) {
  const { target, line } = languageContext(settings);
  return join(
    prompt,
    line,
    `重点句：「${sentence}」\n学生想学其中的：「${text}」。按这句里的意思讲解它，只输出一个对象：\n${itemSpec(target)}`,
    `如果它不在重点句里，"surface" 写成 [${JSON.stringify(text)}]。`,
  );
}

/** 通用做法：照片里是什么都行，prompt 决定正面和背面写什么 */
export function generalPrompt(prompt: string, settings: Settings, question: string | null) {
  const target = languageName(settings.target_lang);
  return join(
    prompt,
    `所有内容用${target}。${JSON_ONLY}`,
    questionLine(question),
    `字段：
{
  "ok": 图里有没有上面要求的东西（true/false）；没有的话其余字段可以省略,
  "front": 卡片正面：要记住的内容，简短,
  "highlights": 正面里最该记住的片段，从 front 里原样照抄，0–5 个,
  "back": 卡片背面的讲解，Markdown（可用 **粗体**、*斜体*、- 列表、# 标题；不要 HTML）,
  "answer": ${question ? `对提问的简短回答` : "null"},
  "unreadable": 看不清或不确定的地方如实说明，否则 null
}`,
    "看不清就照实说，不要猜、不要编造。",
  );
}
