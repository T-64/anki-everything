import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/archivo/wdth.css";
import { App } from "./App";
import { notetypeCss } from "../shared/render";
import "./styles.css";

// 卡片样式也放进 App：预览用的是和 AnkiDroid 里同一套 ae-* 样式
const cardStyle = document.createElement("style");
cardStyle.textContent = notetypeCss();
document.head.insertBefore(cardStyle, document.head.firstChild);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
