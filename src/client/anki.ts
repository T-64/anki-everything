import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { CaptureView } from "../shared/capture";
import { NOTETYPE, noteFields, noteTags, notetypeCss } from "../shared/render";

// 写入 AnkiDroid。原生部分（android/…/AnkiBridgePlugin.java）只做转发，流程都在这里。

/**
 * not_running：AnkiDroid 被系统冻结或回收了，接口连不上。有的系统（如 vivo）不允许在后台唤醒别的 App，
 * 要用户把 AnkiDroid 打开一次（openAnkiDroid），回来后自动写入。
 */
export type AnkiStatus = { ok: true } | { ok: false; reason: "web" | "not_installed" | "no_permission" | "not_running" };

export interface NoteTypeSpec {
  name: string;
  fields: string[];
  cardName: string;
  front: string;
  back: string;
  css: string;
  deck: string;
}

/** 原生桥接暴露的方法 */
export interface AnkiBridge {
  status(): Promise<AnkiStatus>;
  requestPermission(): Promise<AnkiStatus>;
  /** 把 AnkiDroid 打开到前台 */
  openAnkiDroid(): Promise<void>;
  /** 没有就创建笔记类型和牌组；CSS 不一样（版本变了）就更新模板和 CSS */
  ensureNoteType(spec: NoteTypeSpec): Promise<{ modelId: number; deckId: number }>;
  /** 按 AEID 字段搜索已有笔记 */
  findByAeid(aeid: string): Promise<number | null>;
  /** 图片放进 AnkiDroid 媒体库，返回文件名 */
  addImage(dataUrl: string, name: string): Promise<string>;
  addNote(note: { modelId: number; deckId: number; fields: string[]; tags: string[] }): Promise<number>;
}

type NativeStatus = { installed: boolean; permission: boolean; reachable: boolean };

interface NativePlugin {
  status(): Promise<NativeStatus>;
  requestPermission(): Promise<NativeStatus>;
  openAnkiDroid(): Promise<void>;
  ensureNoteType(spec: NoteTypeSpec): Promise<{ modelId: number; deckId: number }>;
  findByAeid(options: { aeid: string }): Promise<{ noteId: number | null }>;
  addImage(options: { dataUrl: string; name: string }): Promise<{ file: string }>;
  addNote(note: { modelId: number; deckId: number; fields: string[]; tags: string[] }): Promise<{ noteId: number }>;
}

const toStatus = (result: NativeStatus): AnkiStatus =>
  !result.installed
    ? { ok: false, reason: "not_installed" }
    : !result.permission
      ? { ok: false, reason: "no_permission" }
      : !result.reachable
        ? { ok: false, reason: "not_running" }
        : { ok: true };

function nativeBridge(): AnkiBridge {
  const plugin = registerPlugin<NativePlugin>("AnkiBridge");
  return {
    status: async () => toStatus(await plugin.status()),
    requestPermission: async () => toStatus(await plugin.requestPermission()),
    openAnkiDroid: () => plugin.openAnkiDroid(),
    ensureNoteType: (spec) => plugin.ensureNoteType(spec),
    findByAeid: async (aeid) => (await plugin.findByAeid({ aeid })).noteId,
    addImage: async (dataUrl, name) => (await plugin.addImage({ dataUrl, name })).file,
    addNote: async (note) => (await plugin.addNote(note)).noteId,
  };
}

const unavailable = async (): Promise<never> => {
  throw new Error("web");
};

/** 网页版（电脑浏览器里看历史）：不能写 Anki */
const webBridge: AnkiBridge = {
  status: async () => ({ ok: false, reason: "web" }),
  requestPermission: async () => ({ ok: false, reason: "web" }),
  openAnkiDroid: unavailable,
  ensureNoteType: unavailable,
  findByAeid: unavailable,
  addImage: unavailable,
  addNote: unavailable,
};

export const bridge: AnkiBridge = Capacitor.isNativePlatform() ? nativeBridge() : webBridge;

export const noteTypeSpec = (deck: string): NoteTypeSpec => ({
  name: NOTETYPE.name,
  fields: [...NOTETYPE.fields],
  cardName: NOTETYPE.cardName,
  front: NOTETYPE.front,
  back: NOTETYPE.back,
  css: notetypeCss(),
  deck,
});

/** 拍摄日期按配置的时区写成 YYYY-MM-DD */
export const localDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export interface WriteDeps {
  bridge: AnkiBridge;
  deckName: string;
  timeZone: string;
  /** 这台手机的 id（App 安装时随机生成） */
  device: string;
  loadCardImage(id: string): Promise<string>;
  markInAnki(id: string, noteId: number): Promise<unknown>;
}

/**
 * 一张卡写进这台手机的 AnkiDroid。先按 AEID 查：已经在了（上次写进去但没来得及告诉服务器，
 * 或者别的手机写的、已经通过 AnkiWeb 同步过来）就不重复加，只把记录补上。
 */
export async function writeToAnki(capture: CaptureView, deps: WriteDeps): Promise<number> {
  if (!capture.card) throw new Error("没有卡片内容");
  const { modelId, deckId } = await deps.bridge.ensureNoteType(noteTypeSpec(deps.deckName));
  let noteId = await deps.bridge.findByAeid(capture.id);
  if (noteId === null) {
    const imageFile = await deps.bridge.addImage(await deps.loadCardImage(capture.id), `ae-${capture.id}`);
    const common = { id: capture.id, question: capture.question, imageFile, date: localDate(capture.created_at, deps.timeZone) };
    const fields =
      capture.mode === "language" ? noteFields({ ...common, mode: capture.mode, card: capture.card }) : noteFields({ ...common, mode: capture.mode, card: capture.card });
    noteId = await deps.bridge.addNote({ modelId, deckId, fields, tags: noteTags(capture.mode) });
  }
  await deps.markInAnki(capture.id, noteId);
  return noteId;
}

/**
 * 要在这台手机上写的卡：
 * - 已确认、还没进 Anki 的；
 * - 已进 Anki、但写的是别的手机（或者不知道是哪台）的：Anki 的卡库每台手机各一份，本机可能没有。
 * 本机写过的不再检查：你在 Anki 里删掉的卡不会被补回来。
 */
export const toWrite = (captures: CaptureView[], device: string) =>
  captures.filter((item) => item.card && (item.status === "confirmed" || (item.status === "in_anki" && item.anki_device !== device)));

const DEVICE_STORAGE = "ae-device";

/** 这台手机的 id：第一次用时随机生成，存在本机 */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_STORAGE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_STORAGE, id);
  }
  return id;
}

// 分享菜单收到的图片（android/…/ShareInboxPlugin.kt）

interface ShareInbox {
  take(): Promise<{ dataUrl: string | null }>;
  addListener(event: "shared", listener: () => void): Promise<PluginListenerHandle>;
}

const shareInbox = Capacitor.isNativePlatform() ? registerPlugin<ShareInbox>("ShareInbox") : null;

/** 取走一张分享进来的图片；有新分享时调用 onShared */
export function watchShares(onImage: (dataUrl: string) => Promise<void>): () => void {
  if (!shareInbox) return () => {};
  const take = () =>
    shareInbox
      .take()
      .then(({ dataUrl }) => (dataUrl ? onImage(dataUrl) : undefined))
      .catch((error) => console.error("读取分享的图片失败", error));
  void take();
  const handle = shareInbox.addListener("shared", () => void take());
  return () => void handle.then((listener) => listener.remove());
}
