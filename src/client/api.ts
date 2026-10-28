import { Capacitor } from "@capacitor/core";
import type { CaptureView, CardData, Mode, NoteCard } from "../shared/capture";

/**
 * 服务器地址。Web 版和 API 同源，不需要；App 里的界面从 https://localhost 加载，地址在登录页填。
 * VITE_API_BASE（.env.app.local，不进 git）只是登录页的预填值，方便自己打包。
 */
export const needsServer = Capacitor.isNativePlatform();
export const DEFAULT_SERVER: string = import.meta.env.VITE_API_BASE ?? "";

const KEY_STORAGE = "ae-key";
const SERVER_STORAGE = "ae-server";

export const savedKey = () => localStorage.getItem(KEY_STORAGE);
export const saveKey = (key: string) => localStorage.setItem(KEY_STORAGE, key);
export const forgetKey = () => localStorage.removeItem(KEY_STORAGE);

export const savedServer = () => (needsServer ? (localStorage.getItem(SERVER_STORAGE) ?? DEFAULT_SERVER) : "");
export const saveServer = (server: string) => localStorage.setItem(SERVER_STORAGE, server);

/** 用户填的地址：补上 https://，去掉末尾的 / */
export function normalizeServer(input: string) {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** 401 时通知界面回到登录页 */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (handler: () => void) => (onUnauthorized = handler);

export async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const key = savedKey();
  if (key) headers.set("Authorization", `Bearer ${key}`);
  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${savedServer()}/api${path}`, { ...init, headers, body });
  if (response.status === 401) onUnauthorized();
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, error.error ?? "unknown");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function checkKey(server: string, key: string): Promise<boolean> {
  const response = await fetch(`${server}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  return response.status === 204;
}

export interface Config {
  deckName: string;
  timeZone: string;
  /** 服务器有没有配模型 key；没有时只能“不用 AI” */
  ai: boolean;
}

export interface Settings {
  language_prompt: string;
  general_prompt: string;
  source_lang: string;
  target_lang: string;
  level: string;
  deck: string;
}

export interface SettingsView {
  settings: Settings;
  examples: { language: string; general: string };
}

export const api = {
  config: () => request<Config>("/config"),
  settings: () => request<SettingsView>("/settings"),
  saveSettings: (patch: Partial<Settings>) => request<SettingsView>("/settings", { method: "PUT", json: patch }),
  list: () => request<CaptureView[]>("/captures"),
  get: (id: string) => request<CaptureView>(`/captures/${id}`),
  create: (body: { id: string; mode: Mode; question: string | null; image: string; thumb?: string }) => request<CaptureView>("/captures", { method: "POST", json: body }),
  refocus: (id: string, card: CardData, focusIds: number[]) => request<CaptureView>(`/captures/${id}/refocus`, { method: "POST", json: { card, focus_ids: focusIds } }),
  addItem: (id: string, card: CardData, text: string) => request<CaptureView>(`/captures/${id}/items`, { method: "POST", json: { card, text } }),
  confirm: (id: string, card: CardData | NoteCard, cardImage: string | null) =>
    request<CaptureView>(`/captures/${id}/confirm`, { method: "POST", json: { card, card_image: cardImage } }),
  inAnki: (id: string, noteId: number, device: string) => request<CaptureView>(`/captures/${id}/in-anki`, { method: "POST", json: { anki_note_id: noteId, device } }),
  retry: (id: string) => request<CaptureView>(`/captures/${id}/retry`, { method: "POST" }),
  discard: (id: string) => request<void>(`/captures/${id}/discard`, { method: "POST" }),
  /** 图片要带密钥，不能直接放进 <img src>：取成 data URL */
  image: async (id: string, kind: "original" | "card" | "thumb"): Promise<string> => {
    const key = savedKey();
    const response = await fetch(`${savedServer()}/api/captures/${id}/image?kind=${kind}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (!response.ok) throw new ApiError(response.status, "image");
    return blobToDataUrl(await response.blob());
  },
};

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
