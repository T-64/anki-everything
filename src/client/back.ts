import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";

// 返回手势 / 返回键（Android）。不处理的话 Capacitor 默认直接关掉 App。
// 打开着的东西按出现顺序压栈：最上面的（弹层、裁剪、详情页）先处理；都不处理就把 App 退到后台，下次打开还在原处。

type Handler = () => boolean;
const stack: { current: Handler }[] = [];

/** 注册一个返回处理；handler 返回 true 表示已处理。active 为 false 时不参与 */
export function useBack(handler: Handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    stack.push(entry);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}

/** 按一次返回：从栈顶往下找第一个处理了的 */
export function handleBack(): boolean {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].current()) return true;
  }
  return false;
}

let listening = false;

/** App 启动时调用：接管系统返回（重复调用只注册一次） */
export function listenBackButton() {
  if (!Capacitor.isNativePlatform() || listening) return;
  listening = true;
  void App.addListener("backButton", () => {
    if (!handleBack()) void App.minimizeApp();
  });
}
