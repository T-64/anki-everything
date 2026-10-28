import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { useStore } from "./store";
import { useBack } from "./back";
import { copy } from "./i18n";
import { create } from "zustand";

// 共用部件：底部弹层、图片、触感反馈、逐行对照、深色模式

export const spring = { type: "spring", damping: 34, stiffness: 360, mass: 0.9 } as const;

/** 触感反馈：只在手机上有 */
export const haptic = {
  tap: () => Capacitor.isNativePlatform() && void Haptics.impact({ style: ImpactStyle.Light }),
  success: () => Capacitor.isNativePlatform() && void Haptics.notification({ type: NotificationType.Success }),
};

/** 带密钥取图（走缓存）。kind=thumb 是照片墙用的小图 */
export function useImage(id: string, kind: "original" | "card" | "thumb") {
  const cached = useStore((state) => state.images[`${id}:${kind}`]);
  const load = useStore((state) => state.image);
  const [url, setUrl] = useState<string | null>(cached ?? null);
  useEffect(() => {
    let alive = true;
    if (cached) setUrl(cached);
    else
      load(id, kind)
        .then((value) => alive && setUrl(value))
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, kind, cached, load]);
  return url;
}

/** 系统深色模式：卡片预览要加 nightMode，和 AnkiDroid 一致 */
export function useDark() {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const onChange = () => setDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/** 底部弹层：弹簧动画，可以往下拖（拖顶部的横条）关掉，返回键也关 */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const controls = useDragControls();
  useBack(() => {
    onClose();
    return true;
  }, open);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={spring}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.7 }}
            onDragEnd={(_, info) => (info.offset.y > 110 || info.velocity.y > 700) && onClose()}
          >
            <div className="sheet-grip" onPointerDown={(event) => controls.start(event)} aria-hidden="true">
              <span />
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** 逐行对照：上面德语，下面中文 */
export function Gloss({ pairs, className = "" }: { pairs: { de: string; zh: string }[]; className?: string }) {
  return (
    <div className={`gloss ${className}`}>
      {pairs.map((pair, index) => (
        <span className="gloss-pair" key={index}>
          <span className="de">{pair.de}</span>
          <span className="zh">{pair.zh}</span>
        </span>
      ))}
    </div>
  );
}

/** 页面里的一段：小标题 + 内容 */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

// —— 确认弹层：代替系统的 window.confirm（系统框是英文按钮、样式也对不上） ——

interface Ask {
  message: string;
  confirm: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useAsk = create<{ current: Ask | null }>(() => ({ current: null }));

/** 弹出确认，用户点确认返回 true，取消、点遮罩、返回键返回 false */
export const ask = (message: string, confirm: string, danger = false) => new Promise<boolean>((resolve) => useAsk.setState({ current: { message, confirm, danger, resolve } }));

/** 放在 App 里一次 */
export function AskHost() {
  const current = useAsk((state) => state.current);
  const answer = (ok: boolean) => {
    current?.resolve(ok);
    useAsk.setState({ current: null });
  };
  return (
    <Sheet open={current !== null} onClose={() => answer(false)} label={current?.message ?? ""}>
      <p className="ask-message">{current?.message}</p>
      <div className="ask-actions">
        <button className="ghost" onClick={() => answer(false)}>
          {copy.common.cancel}
        </button>
        <button className={`primary ${current?.danger ? "danger" : ""}`} onClick={() => answer(true)}>
          {current?.confirm}
        </button>
      </div>
    </Sheet>
  );
}
