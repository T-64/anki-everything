import { describe, expect, it } from "vitest";
import { flushQueue, memoryStore, outcomeFor, type PendingCapture } from "../src/client/offline";

const entry = (id: string, queued_at: number): PendingCapture => ({ id, question: null, image: "data:,", queued_at });

describe("离线队列", () => {
  it("按排队顺序上传；没网时保留剩下的，下次接着发", async () => {
    const store = memoryStore();
    await store.put(entry("b", 2));
    await store.put(entry("a", 1));
    const sent: string[] = [];
    const first = await flushQueue(store, async (item) => {
      if (item.id === "b") return outcomeFor(null, "offline");
      sent.push(item.id);
      return outcomeFor(202, "");
    });
    expect(sent).toEqual(["a"]);
    expect(first.remaining).toBe(1);
    expect(store.entries.get("b")!.last_error).toBe("offline");
    const second = await flushQueue(store, async () => outcomeFor(202, ""));
    expect(second).toMatchObject({ sent: 1, remaining: 0 });
  });

  it("401、429、5xx 保留重试；400 丢掉并报告", () => {
    expect(outcomeFor(401, "").kind).toBe("retry");
    expect(outcomeFor(429, "").kind).toBe("retry");
    expect(outcomeFor(503, "").kind).toBe("retry");
    expect(outcomeFor(400, "bad").kind).toBe("reject");
    expect(outcomeFor(200, "").kind).toBe("done");
  });
});
