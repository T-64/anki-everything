import type { CaptureView } from "../shared/capture";

// 首页筛选和“全部做成卡片”的规则：纯函数，方便测试

export type Filter = "todo" | "all" | "done";

/**
 * 能一键做成卡片的待确认照片：
 * - 语言做法：至少勾着一个词（全取消了的要你自己打开看）；
 * - 通用做法：AI 写好了正面；
 * - 不用 AI：不算，内容要你自己写。
 */
export const confirmable = (captures: CaptureView[]) =>
  captures.filter((item) => {
    if (item.status !== "draft" || !item.card) return false;
    if (item.mode === "language") return item.card.language_ok && item.card.items.some((word) => word.selected);
    return item.mode === "general" && item.card.front.trim() !== "";
  });

/** 首页实际用的筛选：没选过时，有待确认的就先看待确认 */
export const effectiveFilter = (filter: Filter | null, captures: CaptureView[] | null): Filter =>
  filter ?? ((captures ?? []).some((item) => item.status === "draft") ? "todo" : "all");

/** 待办：识别好等你确认的、识别中的、失败要处理的 */
export const isTodo = (item: CaptureView) => item.status === "draft" || item.status === "analyzing" || item.status === "failed";
