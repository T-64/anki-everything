import type { Analysis, Focus } from "../src/shared/capture";

/** 药盒上的一句话 */
export const MEDICINE: Analysis = {
  language_ok: true,
  transcript: [
    { id: 1, text: "Ibuprofen 400 mg Filmtabletten" },
    { id: 2, text: "Nehmen Sie täglich eine Tablette nach dem Essen ein." },
    { id: 3, text: "Nicht über 25 °C lagern." },
  ],
  focus_ids: [2],
  translation: "每天饭后服一片。",
  chunks: [
    { de: "Nehmen Sie … ein", zh: "请服用" },
    { de: "täglich", zh: "每天" },
    { de: "eine Tablette", zh: "一片药" },
    { de: "nach dem Essen", zh: "饭后" },
  ],
  grammar_note: "einnehmen 是可分动词，Sie 祈使句里前缀 ein 放到句末。",
  items: [
    {
      kind: "word",
      surface: ["Tablette"],
      lemma: "die Tablette",
      plural: "-n",
      zh: "药片",
      parts: null,
      en: "tablet",
      note: null,
    },
    {
      kind: "word",
      surface: ["Nehmen", "ein"],
      lemma: "einnehmen",
      plural: null,
      zh: "服用",
      parts: [
        { de: "ein-", zh: "向内" },
        { de: "nehmen", zh: "拿" },
      ],
      en: "take (medicine)",
      note: "吃药用 einnehmen，不用 essen",
    },
    {
      kind: "phrase",
      surface: ["nach dem Essen"],
      lemma: "nach dem Essen",
      plural: null,
      zh: "饭后",
      parts: null,
      en: "after meals",
      note: null,
    },
  ],
  answer: "每天一片。",
  unreadable: null,
};

export const STORAGE_FOCUS: Focus = {
  focus_ids: [3],
  translation: "不要存放在 25 °C 以上。",
  chunks: [
    { de: "Nicht über 25 °C", zh: "不超过 25 度" },
    { de: "lagern", zh: "存放" },
  ],
  grammar_note: null,
  items: [
    {
      kind: "word",
      surface: ["lagern"],
      lemma: "lagern",
      plural: null,
      zh: "存放",
      parts: [
        { de: "Lager", zh: "仓库" },
        { de: "-n", zh: "动词词尾" },
      ],
      en: "to store (cf. lager)",
      note: null,
    },
  ],
  answer: null,
};
