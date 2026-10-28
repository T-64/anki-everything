-- 一次拍摄 = 一张卡
CREATE TABLE captures (
  id             TEXT PRIMARY KEY,               -- UUID，App 生成，天然幂等
  created_at     TEXT NOT NULL,                  -- ISO，UTC
  updated_at     TEXT NOT NULL,                  -- 识别超时判断用
  question       TEXT,                           -- 可选提问
  image_key      TEXT NOT NULL,                  -- R2：原图
  card_image_key TEXT,                           -- R2：裁剪后的图，null 表示用原图
  status         TEXT NOT NULL CHECK (status IN ('analyzing', 'draft', 'confirmed', 'in_anki', 'failed', 'discarded')),
  analysis       TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：每次 AI 调用的原始输出，只追加不改
  card           TEXT,                           -- JSON：当前卡片内容（CardData），确认后冻结
  error          TEXT,
  in_anki_at     TEXT,
  anki_note_id   INTEGER
);

CREATE INDEX captures_created ON captures (created_at DESC);
CREATE INDEX captures_status ON captures (status);
