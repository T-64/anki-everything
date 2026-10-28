import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AnalyzeMessage, Env } from "./env";
import { checkKey, requireKey } from "./auth";
import { captures, runAnalysis } from "./routes/captures";
import { settings } from "./routes/settings";
import { hasAi, loadSettings } from "./services/settings";

export const app = new Hono<{ Bindings: Env }>();

/** App（Capacitor）里的界面从这个地址加载，跨域调 API */
export const APP_ORIGINS = ["https://localhost"];

app.use("*", async (context, next) => {
  await next();
  context.header("X-Content-Type-Options", "nosniff");
  context.header("Referrer-Policy", "same-origin");
});

app.use("/api/*", cors({ origin: APP_ORIGINS, allowHeaders: ["Authorization", "Content-Type"], maxAge: 86400 }));
app.post("/api/login", checkKey);
app.use("/api/*", requireKey);
app.get("/api/config", async (context) => context.json({ deckName: (await loadSettings(context.env)).deck, timeZone: context.env.APP_TIME_ZONE, ai: hasAi(context.env) }));
app.route("/api/captures", captures);
app.route("/api/settings", settings);
app.all("/api/*", (context) => context.json({ error: "not found" }, 404));
app.all("*", (context) => context.env.ASSETS.fetch(context.req.raw));

export default {
  fetch: app.fetch,
  /** 识别队列的消费者：每条消息一张照片。runAnalysis 自己处理失败（标记 failed），所以总是 ack */
  async queue(batch, env) {
    for (const message of batch.messages) {
      await runAnalysis(env, message.body.id);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env, AnalyzeMessage>;
