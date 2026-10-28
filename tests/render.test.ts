import { describe, expect, it } from "vitest";
import { analysisSchema, draftFrom, focusText, withFocus, canMove } from "../src/shared/capture";
import { NOTETYPE, cardText, highlight, noteFields, notetypeCss, renderBack } from "../src/shared/render";
import { MEDICINE, STORAGE_FOCUS } from "./fixtures";

describe("highlight", () => {
  it("把勾选学习项在原文里的写法加粗，可分动词的两段都高亮", () => {
    const html = highlight("Nehmen Sie täglich eine Tablette nach dem Essen ein.", MEDICINE.items);
    expect(html).toBe("<b>Nehmen</b> Sie täglich eine <b>Tablette</b> <b>nach dem Essen</b> <b>ein</b>.");
  });

  it("只匹配整词：ein 不会把 eine 的前半截标出来", () => {
    expect(highlight("eine Tablette ein", [{ surface: ["ein"] }])).toBe("eine Tablette <b>ein</b>");
  });

  it("大小写不一致时也能找到", () => {
    expect(highlight("Tabletten: TABLETTE", [{ surface: ["Tablette"] }])).toBe("Tabletten: <b>TABLETTE</b>");
  });

  it("重叠的高亮合并，原文里的 HTML 字符会被转义", () => {
    expect(highlight("a <b> nach dem Essen", [{ surface: ["nach dem"] }, { surface: ["dem Essen"] }])).toBe("a &lt;b&gt; <b>nach dem Essen</b>");
  });
});

describe("renderBack", () => {
  it("按固定顺序：翻译、意群、单词（构词+英语）、搭配、语法、提问", () => {
    const html = renderBack(draftFrom(MEDICINE), "一天吃几次？");
    const order = [
      "每天饭后服一片",
      "意群",
      "单词",
      "die Tablette",
      '<span class="de">ein-</span><span class="zh">向内</span>',
      "take (medicine)",
      "搭配",
      "语法",
      "我的问题：一天吃几次？",
      "每天一片。",
    ];
    let last = -1;
    for (const text of order) {
      const index = html.indexOf(text);
      expect(index, text).toBeGreaterThan(last);
      last = index;
    }
    expect(html).toContain('<span class="de"><b>die Tablette</b><span class="pl">, -n</span></span><span class="zh">药片</span>');
    expect(html).not.toContain("→");
  });

  it("没勾选的学习项不上卡；没有提问就不显示问答", () => {
    const card = draftFrom(MEDICINE);
    card.items[0].selected = false;
    const html = renderBack(card, null);
    expect(html).not.toContain("die Tablette");
    expect(html).not.toContain("我的问题");
  });
});

describe("noteFields", () => {
  it("5 个字段，顺序和笔记类型一致；正面只高亮勾选的词", () => {
    const card = draftFrom(MEDICINE);
    card.items[0].selected = false;
    const fields = noteFields({ id: "abc", mode: "language", card, question: null, imageFile: "ae-abc.jpg", date: "2026-10-26" });
    expect(fields).toHaveLength(NOTETYPE.fields.length);
    expect(fields[0]).toBe("<b>Nehmen</b> Sie täglich eine Tablette <b>nach dem Essen</b> <b>ein</b>.");
    expect(fields[1]).toBe('<img src="ae-abc.jpg">');
    expect(fields[3]).toBe("2026-10-26");
    expect(fields[4]).toBe("abc");
  });

  it("CSS 第一行带笔记类型版本号", () => {
    expect(notetypeCss().split("\n")[0]).toBe(`/* anki-everything notetype v${NOTETYPE.version} */`);
  });
});

describe("卡片内容", () => {
  it("AI 推荐的学习项全部预先勾上", () => {
    expect(draftFrom(MEDICINE).items.every((item) => item.selected)).toBe(true);
  });

  it("换重点句：重点句部分整体替换，原文不变", () => {
    const card = withFocus(draftFrom(MEDICINE), STORAGE_FOCUS);
    expect(focusText(card)).toBe("Nicht über 25 °C lagern.");
    expect(card.items.map((item) => item.lemma)).toEqual(["lagern"]);
    expect(card.transcript).toEqual(MEDICINE.transcript);
  });

  it("状态只能单向前进", () => {
    expect(canMove("draft", "confirmed")).toBe(true);
    expect(canMove("confirmed", "draft")).toBe(false);
    expect(canMove("in_anki", "discarded")).toBe(false);
    expect(canMove("failed", "analyzing")).toBe(true);
  });
});

describe("重点句顺序", () => {
  it("模型乱序返回的重点句 id 按原文顺序排好", () => {
    expect(draftFrom({ ...MEDICINE, focus_ids: [3, 2] }).focus_ids).toEqual([2, 3]);
    expect(withFocus(draftFrom(MEDICINE), { ...STORAGE_FOCUS, focus_ids: [3, 1, 3] }).focus_ids).toEqual([1, 3]);
  });
});

describe("模型输出容错", () => {
  it("多句翻译写成数组或对象时拼成一段（真实照片里出现过的三种形状）", () => {
    const shapes = [
      ["当你到了餐厅后，请报上订单号。", "付款之后到柜台取餐。"],
      [
        { id: 2, text: "当你到了餐厅后，请报上订单号。" },
        { id: 3, text: "付款之后到柜台取餐。" },
      ],
      { "2": "当你到了餐厅后，请报上订单号。", "3": "付款之后到柜台取餐。" },
    ];
    for (const translation of shapes) {
      const parsed = analysisSchema.parse({ ...MEDICINE, translation, answer: ["一天", "一片"] });
      expect(parsed.translation).toBe("当你到了餐厅后，请报上订单号。 付款之后到柜台取餐。");
      expect(parsed.answer).toBe("一天 一片");
    }
  });

  it("其他乱七八糟的形状仍然报错", () => {
    expect(analysisSchema.safeParse({ ...MEDICINE, translation: [1, 2] }).success).toBe(false);
    expect(analysisSchema.safeParse({ ...MEDICINE, translation: null }).success).toBe(false);
  });
});

describe("cardText", () => {
  it("被划的字超过六成就不划（短句里学习项盖满整句时划线没有意义）", () => {
    const items = ["Hast", "du", "alle", "Artikel", "erfasst"].map((word) => ({ surface: [word] }));
    expect(cardText("Hast du alle Artikel erfasst?", items)).toBe("Hast du alle Artikel erfasst?");
    expect(cardText("Hast du alle Artikel erfasst?", [{ surface: ["erfasst"] }])).toBe("Hast du alle Artikel <b>erfasst</b>?");
  });

  it("只有一个词的构词拆解不显示（没有可对照的）", () => {
    const card = draftFrom({ ...MEDICINE, items: [{ ...MEDICINE.items[0], parts: [{ de: "Pfand", zh: "押金" }] }] });
    expect(renderBack(card, null)).not.toContain("ae-parts");
  });
});
