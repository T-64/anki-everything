import type { Mode } from "../shared/capture";

// 拍摄的离线队列：先存本地，联网后按顺序上传。服务端按拍摄 id 幂等，所以重发是安全的。

export interface PendingCapture {
  id: string;
  /** 老版本存的没有，按语言做法处理 */
  mode?: Mode;
  question: string | null;
  image: string;
  /** 照片墙用的小图 */
  thumb?: string;
  queued_at: number;
  last_error?: string;
}

export interface QueueStore {
  all(): Promise<PendingCapture[]>;
  put(entry: PendingCapture): Promise<void>;
  delete(id: string): Promise<void>;
}

/** 上传一条的结果：done 删掉；retry 保留并停止本轮（多半是没网）；reject 服务端明确拒绝，删掉并报告。 */
export type SendOutcome = { kind: "done" } | { kind: "retry"; error: string } | { kind: "reject"; error: string };

export async function flushQueue(store: QueueStore, send: (entry: PendingCapture) => Promise<SendOutcome>) {
  const entries = (await store.all()).sort((a, b) => a.queued_at - b.queued_at);
  const rejected: { entry: PendingCapture; error: string }[] = [];
  let sent = 0;
  for (const entry of entries) {
    const outcome = await send(entry);
    if (outcome.kind === "retry") {
      await store.put({ ...entry, last_error: outcome.error });
      break;
    }
    await store.delete(entry.id);
    if (outcome.kind === "reject") rejected.push({ entry, error: outcome.error });
    else sent += 1;
  }
  return { sent, rejected, remaining: (await store.all()).length };
}

/** 网络错误、5xx、401（登录后还能发）、429（明天还能发）都保留；其他 4xx 不会自己好，丢掉 */
export function outcomeFor(status: number | null, error: string): SendOutcome {
  if (status === null || status >= 500 || status === 401 || status === 429) return { kind: "retry", error };
  if (status >= 200 && status < 300) return { kind: "done" };
  return { kind: "reject", error };
}

export function memoryStore(): QueueStore & { entries: Map<string, PendingCapture> } {
  const entries = new Map<string, PendingCapture>();
  return {
    entries,
    all: async () => [...entries.values()],
    put: async (entry) => void entries.set(entry.id, entry),
    delete: async (id) => void entries.delete(id),
  };
}

/** IndexedDB：关掉 App、断网重启都不丢 */
export function indexedDbStore(name = "anki-everything"): QueueStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const request = action(db.transaction("pending", mode).objectStore("pending"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  };
  return {
    all: () => run<PendingCapture[]>("readonly", (store) => store.getAll() as IDBRequest<PendingCapture[]>),
    put: async (entry) => void (await run("readwrite", (store) => store.put(entry))),
    delete: async (id) => void (await run("readwrite", (store) => store.delete(id))),
  };
}
