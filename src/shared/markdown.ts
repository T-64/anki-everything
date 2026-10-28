import { escapeHtml } from "./escape";

// 卡片背面用的 Markdown 子集：# 标题、- / 1. 列表、**粗体**、*斜体*、`代码`、段落和换行。
// 先整体转义再加标签，所以模型或用户写的 HTML 和脚本只会原样显示成文字。

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<i>$2</i>");
}

type Block = { kind: "p" | "ul" | "ol"; lines: string[] } | { kind: "h"; level: number; text: string };

function blocks(source: string): Block[] {
  const result: Block[] = [];
  const push = (kind: "p" | "ul" | "ol", line: string) => {
    const last = result.at(-1);
    if (last && last.kind === kind) last.lines.push(line);
    else result.push({ kind, lines: [line] });
  };
  let blank = true;
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!line.trim()) blank = true;
    else if (heading) result.push({ kind: "h", level: heading[1].length, text: heading[2] });
    else if (bullet) push("ul", bullet[1]);
    else if (numbered) push("ol", numbered[1]);
    else if (blank || result.at(-1)?.kind !== "p") result.push({ kind: "p", lines: [line] });
    else push("p", line);
    if (line.trim()) blank = false;
  }
  return result;
}

export function renderMarkdown(source: string): string {
  return blocks(source)
    .map((block) => {
      if (block.kind === "h") return `<div class="ae-h${block.level}">${inline(block.text)}</div>`;
      if (block.kind === "p") return `<p>${block.lines.map(inline).join("<br>")}</p>`;
      return `<${block.kind}>${block.lines.map((line) => `<li>${inline(line)}</li>`).join("")}</${block.kind}>`;
    })
    .join("\n");
}
