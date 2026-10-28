-- 卡片写进的是哪台手机的 AnkiDroid（App 安装时随机生成的 id）。
-- Anki 的卡库在每台手机上各有一份：换了手机或重装 App 后，用它判断哪些卡要在本机补写。
ALTER TABLE captures ADD COLUMN anki_device TEXT;
