import { create } from "zustand";
import { api, ApiError, forgetKey, needsServer, savedKey, savedServer, setUnauthorizedHandler, type Config } from "./api";
import { bridge, deviceId, noteTypeSpec, toWrite, writeToAnki, type AnkiStatus } from "./anki";
import { compressImage, makeThumb } from "./compress";
import { flushQueue, indexedDbStore, outcomeFor, type PendingCapture } from "./offline";
import { MODES, type CaptureView, type Mode } from "../shared/capture";
import { confirmable, type Filter } from "./filters";

export { confirmable, effectiveFilter, isTodo, type Filter } from "./filters";

// 全局状态：登录、列表、离线队列、AnkiDroid 状态、图片缓存、当前打开的详情。

const queue = indexedDbStore();
/** 这次启动是否已经同步过 AnkiDroid 里的卡片样式 */
let noteTypeChecked = false;

export type { Config };

const MODE_STORAGE = "ae-mode";

/** 上次拍照用的做法 */
export function lastMode(): Mode {
  const saved = localStorage.getItem(MODE_STORAGE);
  return MODES.includes(saved as Mode) ? (saved as Mode) : "language";
}

interface State {
  authed: boolean;
  captures: CaptureView[] | null;
  pending: PendingCapture[];
  config: Config | null;
  anki: AnkiStatus | null;
  ankiError: string | null;
  networkError: boolean;
  /** 首页筛选；null 表示还没选过，按有没有待办自动决定 */
  filter: Filter | null;
  /** 打开着的详情（叠在首页上面，首页不卸载，滚动位置自然保留） */
  openId: string | null;
  /** 拍完照、还没开始识别的图 */
  asking: string | null;
  /** 设置页开着 */
  settingsOpen: boolean;
  /** 图片缓存：`${id}:${kind}` → data URL */
  images: Record<string, string>;
  /** “全部做成卡片”的进度；null 表示没在做 */
  bulk: { done: number; total: number; failed: number } | null;

  login(): void;
  refresh(): Promise<{ captures: CaptureView[]; config: Config } | null>;
  sync(): Promise<void>;
  pick(file: File | Blob): Promise<void>;
  submit(mode: Mode, question: string | null): Promise<void>;
  cancelAsk(): void;
  open(id: string): void;
  close(): void;
  openSettings(): void;
  closeSettings(): void;
  setFilter(filter: Filter): void;
  grant(): Promise<void>;
  openAnki(): void;
  image(id: string, kind: "original" | "card" | "thumb"): Promise<string>;
  /** 详情页改了一条（确认、丢弃、重试、换句子）之后，更新列表里的那一条 */
  replace(capture: CaptureView): void;
  remove(id: string): void;
  /** 待确认的照片按 AI 推荐全部做成卡片，返回失败的张数 */
  confirmAll(): Promise<number>;
}

export const useStore = create<State>((set, get) => ({
  authed: Boolean(savedKey()) && (!needsServer || Boolean(savedServer())),
  captures: null,
  pending: [],
  config: null,
  anki: null,
  ankiError: null,
  networkError: false,
  filter: null,
  openId: null,
  asking: null,
  settingsOpen: false,
  images: {},
  bulk: null,

  login: () => set({ authed: true }),

  /** 上传排队的照片，刷新列表 */
  async refresh() {
    await flushQueue(queue, async (entry) => {
      try {
        await api.create({ id: entry.id, mode: entry.mode ?? "language", question: entry.question, image: entry.image, thumb: entry.thumb });
        return outcomeFor(202, "");
      } catch (error) {
        return outcomeFor(error instanceof ApiError ? error.status : null, String(error));
      }
    });
    const pending = await queue.all();
    try {
      const [captures, config] = await Promise.all([api.list(), get().config ?? api.config()]);
      set({ captures, config, pending, networkError: false });
      return { captures, config };
    } catch {
      set({ pending, networkError: true });
      return null;
    }
  },

  /** 刷新，然后把要写的卡写进这台手机的 AnkiDroid（打开、回到前台、恢复联网都会重试） */
  async sync() {
    const result = await get().refresh();
    if (!result) return;
    const device = deviceId();
    const work = toWrite(result.captures, device);
    const anki = await bridge.status();
    set({ anki });
    if (!anki.ok) return;
    // 每次启动先同步一次卡片样式：App 升级换了样式时，已有的卡马上换上，不用等下一张新卡
    if (!noteTypeChecked) {
      await bridge
        .ensureNoteType(noteTypeSpec(result.config.deckName))
        .then(() => (noteTypeChecked = true))
        .catch(() => {});
    }
    if (work.length === 0) return;
    for (const capture of work) {
      try {
        await writeToAnki(capture, {
          bridge,
          ...result.config,
          device,
          loadCardImage: (id) => get().image(id, "card"),
          markInAnki: async (id, noteId) => get().replace(await api.inAnki(id, noteId, device)),
        });
        set({ ankiError: null });
      } catch (error) {
        // 写到一半 AnkiDroid 被系统冻结：按“没在运行”提示，而不是显示原始报错
        const now = await bridge.status();
        if (!now.ok) set({ anki: now, ankiError: null });
        else set({ ankiError: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
  },

  async pick(file) {
    set({ asking: await compressImage(file instanceof File ? file : new File([file], "shared", { type: file.type })) });
  },

  async submit(mode, question) {
    const image = get().asking;
    if (!image) return;
    set({ asking: null });
    localStorage.setItem(MODE_STORAGE, mode);
    await queue.put({ id: crypto.randomUUID(), mode, question: mode === "manual" ? null : question, image, thumb: await makeThumb(image), queued_at: Date.now() });
    set({ pending: await queue.all(), filter: get().filter ?? "todo" });
    await get().refresh();
  },

  cancelAsk: () => set({ asking: null }),

  open: (id) => set({ openId: id }),
  close: () => set({ openId: null }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setFilter: (filter) => set({ filter }),

  async grant() {
    set({ anki: await bridge.requestPermission() });
  },

  /** 打开 AnkiDroid；回到这个 App 时会触发 sync，自动写入 */
  openAnki: () => void bridge.openAnkiDroid(),

  async image(id, kind) {
    const key = `${id}:${kind}`;
    const cached = get().images[key];
    if (cached) return cached;
    const url = await api.image(id, kind);
    // 确认（裁剪）之后上卡的图会变，不缓存 card
    if (kind !== "card") set((state) => ({ images: { ...state.images, [key]: url } }));
    return url;
  },

  replace: (capture) => set((state) => ({ captures: state.captures?.map((item) => (item.id === capture.id ? capture : item)) ?? null })),

  remove: (id) => set((state) => ({ captures: state.captures?.filter((item) => item.id !== id) ?? null, openId: null })),

  async confirmAll() {
    const work = confirmable(get().captures ?? []);
    if (work.length === 0 || get().bulk) return 0;
    let failed = 0;
    set({ bulk: { done: 0, total: work.length, failed: 0 } });
    for (const [index, capture] of work.entries()) {
      try {
        get().replace(await api.confirm(capture.id, capture.card!, null));
      } catch {
        // 一张失败（比如这期间在别处改了状态）不影响其他的，最后告诉你有几张没成功
        failed += 1;
      }
      set({ bulk: { done: index + 1, total: work.length, failed } });
    }
    set({ bulk: null });
    await get().sync();
    return failed;
  },
}));

setUnauthorizedHandler(() => {
  forgetKey();
  useStore.setState({ authed: false });
});
