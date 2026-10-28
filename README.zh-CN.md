# Anki Everything

[English](README.md)

拍一张照片，做成一张 Anki 卡，直接进手机上的 AnkiDroid。

药盒上看不懂的外语、路边认不出的植物、课上的一页课件：真正碰到过的东西最值得记，拍下它的那张照片就是最好的记忆线索。

## 三种做法

| 做法 | 要不要模型 key | 做出来的卡 |
| --- | --- | --- |
| **语言** | 要 | 从真实文字学语言：识别全文，挑 1–3 个重点句，讲翻译、意群、单词（构词逐段拆解、英语对应词）、语法。句子和词你来挑。 |
| **通用** | 要 | 植物、画、菜谱、课件、说明书，什么都行。正面、背面写什么由你的 prompt 决定，背面支持 Markdown。 |
| **不用 AI** | 不要 | 照片 + 你自己写的字，或者什么都不写。服务器没配 key 也能用。 |

## prompt 是你自己的

prompt 在 App 的**设置**页里写，存在你自己的数据库里，不在仓库里。空着就用 [`prompts/examples`](prompts/examples) 里的示例。

你的 prompt 只管“怎么讲”（角色、风格、重点、示例）。输出格式（字段、JSON、“看不清别编”）固定写在 [`src/worker/services/contract.ts`](src/worker/services/contract.ts)，拼在你的 prompt 后面，这样确认页和卡片渲染总能用。

设置里还有：学的语言、讲解用的语言、水平、Anki 牌组。

## 结构

```
手机 App（Capacitor 包的 React 界面）──► Cloudflare Worker（Hono）──► 识别队列 ──► 视觉模型（OpenAI 兼容）
        │                                   D1：拍摄、卡片、设置    R2：照片
        └──► AnkiDroid（官方 ContentProvider 接口，直接写卡）──► AnkiWeb ──► 电脑上的 Anki
```

卡片带标签 `ae::language` / `ae::general` / `ae::manual`，在 Anki 里可以按做法筛。

## 开发

需要 Node 24。

```bash
npm install
cp .dev.vars.example .dev.vars    # 填 APP_KEY；LLM_API_KEY 可不填
npx wrangler d1 migrations apply anki-everything --local
npm run dev                        # http://localhost:5173
npm test
npm run typecheck
npm run format
```

提 PR 前看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 部署

先建好 D1（`anki-everything`，把 `database_id` 填进 `wrangler.jsonc`）、R2（`anki-everything-images`）、Queue（`anki-everything-analyze`），用 `wrangler secret put` 设置 `APP_KEY` 和（可选的）`LLM_API_KEY`，然后：

```bash
npm run deploy
```

`wrangler.jsonc` 的 `vars` 里只有服务器级的配置：模型地址、模型名、要不要先思考、时区、每日上限。

## App

从 [Releases](https://github.com/T-64/anki-everything/releases) 下载 APK，或者自己打包（需要 JDK 21、Android SDK 36，设好 `JAVA_HOME`、`ANDROID_HOME`）：

```bash
npm run apk            # debug 包
npm run apk:release    # 正式版，输出 release/AnkiEverything-<版本>.apk
```

正式版用 `android/keystore.properties` 和 `android/release.jks` 签名，这两个文件不进 git。**签名文件丢了，以后的新版本就没法覆盖安装**，要另外备份。

手机上先装 AnkiDroid，再装这个 App；第一次打开时填服务器地址和访问密钥，并允许访问 AnkiDroid。自己打包时想预填地址，把 `.env.app.example` 复制成 `.env.app.local`。

## 许可

[AGPL-3.0](LICENSE)。修改后作为服务给别人用，要公开修改的代码。与 Anki、AnkiDroid 官方无关。
