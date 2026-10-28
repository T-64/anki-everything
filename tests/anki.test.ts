import { describe, expect, it, vi } from "vitest";
import { toWrite, writeToAnki, localDate, type AnkiBridge } from "../src/client/anki";
import { EMPTY_NOTE, draftFrom, type CaptureView, type LanguageCapture, type NoteCapture } from "../src/shared/capture";
import { NOTETYPE } from "../src/shared/render";
import { MEDICINE } from "./fixtures";

/** 假 AnkiDroid：内存里存笔记，可以让某一步出错 */
function fakeAnkiDroid() {
  const notes = new Map<number, string[]>();
  const media: string[] = [];
  let nextId = 100;
  const bridge: AnkiBridge = {
    status: async () => ({ ok: true }),
    requestPermission: async () => ({ ok: true }),
    openAnkiDroid: async () => {},
    ensureNoteType: vi.fn(async () => ({ modelId: 1, deckId: 2 })),
    findByAeid: async (aeid) => [...notes].find(([, fields]) => fields[4] === aeid)?.[0] ?? null,
    addImage: async (_dataUrl, name) => {
      media.push(`${name}.jpg`);
      return `${name}.jpg`;
    },
    addNote: vi.fn(async ({ fields }) => {
      nextId += 1;
      notes.set(nextId, fields);
      return nextId;
    }),
  };
  return { bridge, notes, media };
}

const capture: LanguageCapture = {
  id: "c1",
  mode: "language",
  created_at: "2026-10-26T23:30:00.000Z",
  question: "一天吃几次？",
  status: "confirmed",
  card: draftFrom(MEDICINE),
  error: null,
  has_card_image: false,
  anki_note_id: null,
  anki_device: null,
};

describe("writeToAnki", () => {
  it("建笔记类型、放图片、加笔记，再告诉服务器 note id", async () => {
    const anki = fakeAnkiDroid();
    const markInAnki = vi.fn(async () => {});
    const noteId = await writeToAnki(capture, {
      bridge: anki.bridge,
      deckName: "Anki Everything",
      timeZone: "Europe/Berlin",
      device: "phone-a",
      loadCardImage: async () => "data:image/jpeg;base64,AA",
      markInAnki,
    });
    expect(anki.bridge.ensureNoteType).toHaveBeenCalledWith(expect.objectContaining({ name: NOTETYPE.name, deck: "Anki Everything", fields: [...NOTETYPE.fields] }));
    const fields = anki.notes.get(noteId)!;
    expect(fields[1]).toBe('<img src="ae-c1.jpg">');
    expect(fields[2]).toContain("我的问题");
    expect(fields[3]).toBe("2026-10-27");
    expect(fields[4]).toBe("c1");
    expect(markInAnki).toHaveBeenCalledWith("c1", noteId);
  });

  it("上次写进去了但没通知到服务器：这次不重复加，只补通知", async () => {
    const anki = fakeAnkiDroid();
    const deps = { bridge: anki.bridge, deckName: "D", timeZone: "Europe/Berlin", device: "phone-a", loadCardImage: async () => "data:," };
    await expect(writeToAnki(capture, { ...deps, markInAnki: async () => Promise.reject(new Error("offline")) })).rejects.toThrow("offline");
    const markInAnki = vi.fn(async () => {});
    const noteId = await writeToAnki(capture, { ...deps, markInAnki });
    expect(anki.notes.size).toBe(1);
    expect(anki.media).toHaveLength(1);
    expect(markInAnki).toHaveBeenCalledWith("c1", noteId);
  });

  it("别的手机写过的卡，本机 AnkiDroid 里已经有（AnkiWeb 同步过来了）：不重复加，只记下本机", async () => {
    const anki = fakeAnkiDroid();
    const deps = { bridge: anki.bridge, deckName: "D", timeZone: "Europe/Berlin", device: "phone-b", loadCardImage: async () => "data:," };
    const first = await writeToAnki(capture, { ...deps, markInAnki: async () => {} });
    const markInAnki = vi.fn(async () => {});
    expect(await writeToAnki({ ...capture, status: "in_anki", anki_device: "phone-a" }, { ...deps, markInAnki })).toBe(first);
    expect(anki.notes.size).toBe(1);
    expect(markInAnki).toHaveBeenCalledWith("c1", first);
  });
});

describe("toWrite：这台手机要写哪些卡", () => {
  const make = (id: string, status: CaptureView["status"], anki_device: string | null) => ({ ...capture, id, status, anki_device });
  it("已确认的；别的手机写的或不知道哪台写的；本机写过的不再管（在 Anki 里删掉的卡不会被补回来）", () => {
    const list = [
      make("confirmed", "confirmed", null),
      make("other-phone", "in_anki", "phone-b"),
      make("unknown-phone", "in_anki", null),
      make("this-phone", "in_anki", "phone-a"),
      make("draft", "draft", null),
    ];
    expect(toWrite(list, "phone-a").map((item) => item.id)).toEqual(["confirmed", "other-phone", "unknown-phone"]);
  });
});

describe("localDate", () => {
  it("按柏林时间算日期", () => {
    expect(localDate("2026-10-26T23:30:00.000Z", "Europe/Berlin")).toBe("2026-10-27");
    expect(localDate("2026-10-26T21:30:00.000Z", "Europe/Berlin")).toBe("2026-10-26");
  });
});

describe("confirmable：能一键做成卡片的", () => {
  it("只要待确认、读出了德语、至少勾着一个词的", async () => {
    const { confirmable } = await import("../src/client/filters");
    const draft = (id: string, overrides: Partial<LanguageCapture> = {}): CaptureView => ({ ...capture, id, status: "draft" as const, ...overrides });
    const note = (id: string, mode: NoteCapture["mode"], front: string): CaptureView => ({ ...capture, id, status: "draft", mode, card: { ...EMPTY_NOTE, front } });
    const none = draftFrom(MEDICINE);
    none.items = none.items.map((item) => ({ ...item, selected: false }));
    const list = [
      draft("ok"),
      draft("no-words", { card: none }),
      draft("no-card", { card: null }),
      { ...capture, id: "confirmed" },
      draft("analyzing", { status: "analyzing" }),
      note("general", "general", "Monstera deliciosa"),
      note("general-empty", "general", " "),
      note("manual", "manual", "自己写的"),
    ];
    expect(confirmable(list).map((item) => item.id)).toEqual(["ok", "general"]);
  });
});
