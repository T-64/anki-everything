-- v2：三种做法 + 存在数据库里的设置（prompt 不进仓库）

-- 拍的时候用的是哪种做法。已有的拍摄都是语言做法
ALTER TABLE captures ADD COLUMN mode TEXT NOT NULL DEFAULT 'language' CHECK (mode IN ('language', 'general', 'manual'));

-- 键值设置：language_prompt、general_prompt、source_lang、target_lang、level、deck。没有的键用默认值
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
