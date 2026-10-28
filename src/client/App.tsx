import { useEffect } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig } from "motion/react";
import { watchShares } from "./anki";
import { listenBackButton } from "./back";
import { useStore } from "./store";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Detail } from "./pages/Detail";
import { AskSheet } from "./pages/AskSheet";
import { Settings } from "./pages/Settings";
import { AskHost } from "./ui";

export function App() {
  const authed = useStore((state) => state.authed);
  const openId = useStore((state) => state.openId);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const busy = useStore((state) => state.pending.length > 0 || (state.captures ?? []).some((item) => item.status === "analyzing"));

  useEffect(listenBackButton, []);

  // 打开、回到前台、恢复联网：刷新并写入 AnkiDroid；系统分享进来的图片直接进入“提问”
  useEffect(() => {
    if (!authed) return;
    const { sync, pick } = useStore.getState();
    void sync();
    const onVisible = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const stopShares = watchShares(async (dataUrl) => pick(await (await fetch(dataUrl)).blob()));
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      stopShares();
    };
  }, [authed]);

  // 有照片在上传或识别时，每 4 秒刷新一次
  useEffect(() => {
    if (!authed || !busy) return;
    const timer = window.setInterval(() => void useStore.getState().refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [authed, busy]);

  // 详情或设置打开时首页不滚动
  useEffect(() => {
    document.documentElement.classList.toggle("locked", openId !== null || settingsOpen);
  }, [openId, settingsOpen]);

  if (!authed) return <Login />;

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <Home />
        <AnimatePresence>{openId && <Detail key={openId} id={openId} />}</AnimatePresence>
      </LayoutGroup>
      <AnimatePresence>{settingsOpen && <Settings />}</AnimatePresence>
      <AskSheet />
      <AskHost />
    </MotionConfig>
  );
}
