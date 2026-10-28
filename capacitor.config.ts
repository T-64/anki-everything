import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.ankieverything",
  appName: "Anki Everything",
  // npm run build:app 的产物：只有界面，服务器地址在登录页填
  webDir: "dist/app",
};

export default config;
