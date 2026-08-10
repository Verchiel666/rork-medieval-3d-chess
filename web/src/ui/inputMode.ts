import { useSyncExternalStore } from "react";

/**
 * 没有悬浮能力的粗糙指针——握在手里的手机或平板。这不是
 * user-agent 猜测：带触屏的笔记本仍会上报 `hover: hover`，
 * 因为它还有触控板，所以保留它的键帽提示。
 */
const TOUCH_ONLY = "(pointer: coarse) and (hover: none)";

let query: MediaQueryList | null = null;
/** 在真实按键到达时置位：证明接了键盘，无论媒体查询怎么说。 */
let keyboardSeen = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function onKeyDown(event: KeyboardEvent): void {
  // 屏幕键盘只会浮现在文本框上方，所以在文本框里敲的键无法证明任何硬件
  // 信息。仅按修饰键的按键也一并忽略。
  if (keyboardSeen || !event.isTrusted) return;
  const target = event.target as HTMLElement | null;
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true) return;
  keyboardSeen = true;
  window.removeEventListener("keydown", onKeyDown, true);
  announce();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    if (typeof window.matchMedia === "function") {
      query = window.matchMedia(TOUCH_ONLY);
      query.addEventListener("change", announce);
    }
    if (!keyboardSeen) window.addEventListener("keydown", onKeyDown, true);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      query?.removeEventListener("change", announce);
      query = null;
      window.removeEventListener("keydown", onKeyDown, true);
    }
  };
}

function readSnapshot(): boolean {
  if (keyboardSeen) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return !window.matchMedia(TOUCH_ONLY).matches;
}

/** 服务端渲染：假定有键盘，让标记与桌面端情况一致。 */
function readServerSnapshot(): boolean {
  return true;
}

/**
 * 这台设备是否可能有可按的键。
 *
 * 快捷键提示永远只是提示——在没有 `F` 键的手机上印出 `F`，是在最没
 * 有空间的地方制造噪音。所有调用方共享同一份订阅，而一旦有真实的
 * keydown 到达，答案立刻翻转为 `true`（配了键盘保护套的平板会重新
 * 赢回它的键帽提示）。
 */
export function useHasKeyboard(): boolean {
  return useSyncExternalStore(subscribe, readSnapshot, readServerSnapshot);
}
