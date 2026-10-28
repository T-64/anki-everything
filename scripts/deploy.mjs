// 部署：数据库迁移 → 构建 → 发布。
// wrangler.jsonc 里的 database_id 是占位符时，从环境变量 D1_DATABASE_ID 或 .d1-database-id（不进 git）读真实 id，
// 生成 wrangler.deploy.jsonc（不进 git）再用它部署。也可以直接把 id 写进 wrangler.jsonc。
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PLACEHOLDER = "REPLACE_WITH_YOUR_D1_DATABASE_ID";
const source = readFileSync("wrangler.jsonc", "utf8");
let config = "wrangler.jsonc";

if (source.includes(PLACEHOLDER)) {
  const id = (process.env.D1_DATABASE_ID ?? (existsSync(".d1-database-id") ? readFileSync(".d1-database-id", "utf8") : "")).trim();
  if (!id) {
    console.error("Set D1_DATABASE_ID, write it to .d1-database-id, or put it into wrangler.jsonc.");
    process.exit(1);
  }
  config = "wrangler.deploy.jsonc";
  writeFileSync(config, source.replace(PLACEHOLDER, id));
}

const run = (command, env = {}) => execSync(command, { stdio: "inherit", env: { ...process.env, ...env } });
run(`npx wrangler d1 migrations apply anki-everything --remote --config ${config}`);
run("npx vite build", { WRANGLER_CONFIG: config });
run("npx wrangler deploy");
