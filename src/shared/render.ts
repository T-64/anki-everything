import { cardCopy } from "./cardCopy";
import { focusText, type CardData, type CardItem, type Mode, type NoteCard } from "./capture";
import { escapeHtml } from "./escape";
import { renderMarkdown } from "./markdown";

export { escapeHtml };

// Anki 卡片的唯一渲染函数。服务器只存结构化的 CardData，HTML 只在这里生成。
// 视觉方案：荧光笔划重点、逐行对照的构词，和 App 同一套颜色。

/**
 * 笔记类型。字段一次定死（AnkiDroid 接口不能给已有笔记类型加字段）；
 * 改样式时改模板和 CSS，并把 VERSION 加一，App 启动时会更新 AnkiDroid 里的模板。
 */
export const NOTETYPE = {
  name: "Anki Everything",
  version: 4,
  fields: ["Text", "Image", "Back", "Source", "AEID"] as const,
  cardName: "Card 1",
  front: `<div class="ae-image">{{Image}}</div>\n<div class="ae-text">{{Text}}</div>`,
  back: `{{FrontSide}}\n<hr id="answer">\n{{Back}}\n<div class="ae-source">{{Source}}</div>`,
  tag: "anki-everything",
};

/**
 * 卡片样式。App 里的卡片预览也用这一份（包在 .card 里），所以两边看到的一样。
 * v1 用过的 class（ae-row、ae-label 等）保留样式，旧卡升级后不会坏。
 */
const CSS = `.card {
  --paper: #ffffff; --ink: #141414; --mute: #73767a; --hairline: rgba(20, 20, 20, 0.08); --soft: #f3f4f2;
  --marker: #e9ff3b; --marker-soft: rgba(233, 255, 59, 0.38);
  font-family: system-ui, -apple-system, "Noto Sans CJK SC", "PingFang SC", sans-serif;
  font-size: 17px; line-height: 1.65; text-align: left;
  color: var(--ink); background: var(--paper);
  padding: 4px 6px 24px; max-width: 34em; margin: 0 auto;
}
.nightMode.card, .night_mode .card, .card.nightMode {
  --paper: #000000; --ink: #f2f2f0; --mute: #8e9196; --hairline: rgba(255, 255, 255, 0.1); --soft: #141414;
  --marker-soft: rgba(233, 255, 59, 0.16);
}
.ae-image img { display: block; max-width: 100%; max-height: 38vh; margin: 0 0 16px; border-radius: 14px; }
.ae-text, .ae-pair .de, .ae-head .de, .ae-de {
  font-family: "Archivo Variable", "Roboto Flex", "Roboto", system-ui, sans-serif; font-stretch: 86%;
}
.ae-text { font-size: 26px; line-height: 1.18; font-weight: 650; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.ae-text b { font-weight: inherit; background: var(--marker); color: #000; padding: 0 0.08em; border-radius: 3px; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
hr#answer { border: none; border-top: 1px solid var(--hairline); margin: 20px 0 16px; }
.ae-translation { font-size: 18px; line-height: 1.6; color: var(--mute); }
.ae-section { margin-top: 22px; }
.ae-label { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.ae-row { margin: 2px 0; }
.ae-gloss { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: flex-start; }
.ae-pair { display: inline-flex; flex-direction: column; }
.ae-pair .de { font-size: 17px; line-height: 1.3; }
.ae-pair .zh { font-size: 12.5px; line-height: 1.45; color: var(--mute); }
.ae-parts { display: inline-flex; flex-wrap: wrap; align-items: flex-start; margin: 6px 0 2px; padding: 7px 2px; border-radius: 12px; background: var(--soft); }
.ae-parts .ae-pair { padding: 0 9px; border-left: 1px solid var(--hairline); }
.ae-parts .ae-pair:first-child { border-left: none; }
.ae-parts .de { font-weight: 650; }
.ae-item { padding: 12px 0; border-top: 1px solid var(--hairline); }
.ae-item:first-of-type { border-top: none; padding-top: 2px; }
.ae-head { display: flex; flex-wrap: wrap; gap: 0 10px; align-items: baseline; }
.ae-head .de { font-size: 20px; }
.ae-head .de b { font-weight: 700; }
.ae-head .pl { color: var(--mute); font-size: 15px; }
.ae-head .zh { font-size: 16px; }
.ae-sub { font-size: 14px; color: var(--mute); }
.ae-sub .en { color: var(--ink); }
.ae-grammar { font-size: 15px; }
.ae-qa { margin-top: 20px; padding: 12px 14px; border-radius: 16px; background: var(--marker-soft); }
.ae-q { color: var(--mute); font-size: 13.5px; }
.ae-a { font-size: 16px; }
.ae-md { font-size: 16px; }
.ae-md p { margin: 0 0 10px; }
.ae-md ul, .ae-md ol { margin: 0 0 10px; padding-left: 1.3em; }
.ae-md li { margin: 2px 0; }
.ae-md .ae-h1, .ae-md .ae-h2, .ae-md .ae-h3 { font-weight: 700; margin: 16px 0 6px; }
.ae-md .ae-h1 { font-size: 20px; }
.ae-md .ae-h2 { font-size: 18px; }
.ae-md .ae-h3 { font-size: 16px; }
.ae-md code { font-family: ui-monospace, monospace; font-size: 0.92em; padding: 1px 4px; border-radius: 4px; background: var(--soft); }
.ae-source { margin-top: 20px; font-size: 13px; color: var(--mute); font-variant-numeric: tabular-nums; }`;

/** CSS 第一行带版本号，App 据此判断 AnkiDroid 里的模板要不要更新 */
export const notetypeCss = () => `/* anki-everything notetype v${NOTETYPE.version} */\n${CSS}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 在原文里找某个写法的位置：先区分大小写，找不到再忽略大小写。
 * 语言做法按整词匹配；通用做法不按（中文、日文没有词间空格，整词匹配会一个都找不到）。
 */
function findRanges(text: string, surface: string, wholeWord: boolean): [number, number][] {
  const escaped = escapeRegExp(surface);
  const source = wholeWord ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
  for (const flags of ["gu", "giu"]) {
    const pattern = new RegExp(source, flags);
    const ranges = [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as [number, number]);
    if (ranges.length > 0) return ranges;
  }
  return [];
}

/** 勾选的学习项在原文里的位置，重叠的合并 */
function markRanges(text: string, items: Pick<CardItem, "surface">[], wholeWord = true): [number, number][] {
  const ranges = items.flatMap((item) => item.surface.flatMap((surface) => findRanges(text, surface, wholeWord))).sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

/** 原文 HTML：勾选的学习项在原文中的写法用 <b> 标出（样式是荧光笔） */
export function highlight(text: string, items: Pick<CardItem, "surface">[], wholeWord = true): string {
  let html = "";
  let cursor = 0;
  for (const [start, end] of markRanges(text, items, wholeWord)) {
    html += escapeHtml(text.slice(cursor, start)) + `<b>${escapeHtml(text.slice(start, end))}</b>`;
    cursor = end;
  }
  return html + escapeHtml(text.slice(cursor));
}

/** 被划的字超过这个比例时，划线就不再是提示了（短句里学习项几乎盖满整句） */
const MAX_MARKED = 0.6;

/** 卡片正面的原文：划得太满就不划 */
export function cardText(text: string, items: Pick<CardItem, "surface">[]): string {
  const letters = text.replace(/\s/g, "").length;
  const marked = markRanges(text, items).reduce((sum, [start, end]) => sum + text.slice(start, end).replace(/\s/g, "").length, 0);
  return letters > 0 && marked / letters > MAX_MARKED ? escapeHtml(text) : highlight(text, items);
}

const tag = (name: string, className: string, html: string) => `<${name} class="${className}">${html}</${name}>`;
const div = (className: string, html: string) => tag("div", className, html);
const span = (className: string, html: string) => tag("span", className, html);

/** 逐行对照：上面德语，下面中文 */
const pair = (de: string, zh: string) => span("ae-pair", span("de", escapeHtml(de)) + span("zh", escapeHtml(zh)));

function renderItem(item: CardItem): string {
  const head = span("de", `<b>${escapeHtml(item.lemma)}</b>${item.plural ? span("pl", `, ${escapeHtml(item.plural)}`) : ""}`) + span("zh", escapeHtml(item.zh));
  const lines = [div("ae-head", head)];
  if (item.parts && item.parts.length > 1) lines.push(div("ae-parts", item.parts.map((part) => pair(part.de, part.zh)).join("")));
  if (item.en) lines.push(div("ae-sub", `${cardCopy.en} ${span("en", escapeHtml(item.en))}`));
  if (item.note) lines.push(div("ae-sub", escapeHtml(item.note)));
  return div("ae-item", lines.join(""));
}

const section = (label: string, body: string, className = "") => div(`ae-section${className ? ` ${className}` : ""}`, div("ae-label", label) + body);

/** 背面讲解，没有的部分不出现 */
export function renderBack(card: CardData, question: string | null): string {
  const selected = card.items.filter((item) => item.selected);
  const words = selected.filter((item) => item.kind === "word");
  const phrases = selected.filter((item) => item.kind === "phrase");
  const parts = [div("ae-translation", escapeHtml(card.translation))];
  if (card.chunks.length > 0) {
    parts.push(section(cardCopy.chunks, div("ae-gloss", card.chunks.map((chunk) => pair(chunk.de, chunk.zh)).join(""))));
  }
  if (words.length > 0) parts.push(section(cardCopy.words, words.map(renderItem).join("")));
  if (phrases.length > 0) parts.push(section(cardCopy.phrases, phrases.map(renderItem).join("")));
  if (card.grammar_note) parts.push(section(cardCopy.grammar, div("ae-grammar", escapeHtml(card.grammar_note))));
  if (question && card.answer) {
    parts.push(div("ae-qa", div("ae-q", `${cardCopy.question}：${escapeHtml(question)}`) + div("ae-a", escapeHtml(card.answer))));
  }
  return parts.join("\n");
}

/** 通用做法 / 不用 AI 的正面：划出 highlights，保留换行 */
export function noteFront(card: Pick<NoteCard, "front" | "highlights">): string {
  const marks = card.highlights.map((text) => ({ surface: [text] }));
  return highlight(card.front, marks, false).replace(/\n/g, "<br>");
}

/** 通用做法 / 不用 AI 的背面：Markdown + 问答 */
export function renderNoteBack(card: NoteCard, question: string | null): string {
  const parts = card.back.trim() ? [div("ae-md", renderMarkdown(card.back))] : [];
  if (question && card.answer) {
    parts.push(div("ae-qa", div("ae-q", `${cardCopy.question}：${escapeHtml(question)}`) + div("ae-a", escapeHtml(card.answer))));
  }
  return parts.join("\n");
}

type NoteInput = { id: string; question: string | null; imageFile: string; date: string } & ({ mode: "language"; card: CardData } | { mode: "general" | "manual"; card: NoteCard });

/** 笔记的 5 个字段，顺序和 NOTETYPE.fields 一致。图片字段由调用方放入媒体库后得到的文件名 */
export function noteFields(input: NoteInput): string[] {
  const image = `<img src="${escapeHtml(input.imageFile)}">`;
  const [text, back] =
    input.mode === "language"
      ? [
          cardText(
            focusText(input.card),
            input.card.items.filter((item) => item.selected),
          ),
          renderBack(input.card, input.question),
        ]
      : [noteFront(input.card), renderNoteBack(input.card, input.question)];
  return [text, image, back, escapeHtml(input.date), input.id];
}

/** 笔记的标签：所有卡一个总标签，再按做法分 */
export const noteTags = (mode: Mode) => [NOTETYPE.tag, `ae::${mode}`];
