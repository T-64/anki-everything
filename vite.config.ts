import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// --mode app：打包进 APK 的界面，只要静态文件，不带 Worker（服务器地址在登录页填，见 src/client/api.ts）
export default defineConfig(({ mode }) => ({
  // WRANGLER_CONFIG：部署脚本（scripts/deploy.mjs）填好真实 D1 id 后的配置
  plugins: mode === "app" ? [react()] : [react(), cloudflare({ configPath: process.env.WRANGLER_CONFIG })],
  build: mode === "app" ? { outDir: "dist/app" } : undefined,
}));
