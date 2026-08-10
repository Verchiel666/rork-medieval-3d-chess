import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { useHasKeyboard } from "./inputMode";

export type TooltipSide = "bottom" | "top" | "left";

interface TooltipProps {
  /** 控件的简短名称——第一行，始终显示。 */
  label: string;
  /** 可选的第二行，解释控件的作用。 */
  hint?: string;
  /**
   * 可选的键盘快捷键，以键帽样式显示（如 "F"、"Space"）——且仅在有
   * 键盘的设备上显示。调用方无条件传入；键帽在此处被丢弃，这样任何
   * 控件都不必知道自己正被在什么设备上查看。
   */
  keys?: string;
  /** 气泡相对控件悬挂的位置。 */
  side?: TooltipSide;
  children: ReactNode;
}

/** 气泡出现前的悬停毫秒数。 */
const OPEN_DELAY = 110;

/**
 * 气泡关闭后的一段时间内，下一个气泡会立即打开，这样沿一排图标扫过时
 * 不会每次都卡在延迟上断断续续。
 */
const CHAIN_WINDOW = 500;

let lastClosedAt = 0;

/**
 * 为纯图标控件准备的主题化悬浮提示。气泡渲染在锚点内部（而非 body
 * 门户），因此全屏时也能存活；并对齐到能把它留在屏幕内的那一侧边缘。
 */
export function Tooltip({ label, hint, keys, side = "bottom", children }: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const hasKeyboard = useHasKeyboard();
  const [align, setAlign] = useState<"start" | "end">("end");
  const [open, setOpen] = useState(false);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reveal = useCallback((): void => {
    const node = anchorRef.current;
    if (node) {
      const rect = node.getBoundingClientRect();
      setAlign(rect.left + rect.width / 2 > window.innerWidth / 2 ? "end" : "start");
    }
    setOpen(true);
  }, []);

  const show = useCallback(
    (immediate: boolean): void => {
      clearTimer();
      if (immediate || Date.now() - lastClosedAt < CHAIN_WINDOW) {
        reveal();
        return;
      }
      timerRef.current = window.setTimeout(reveal, OPEN_DELAY);
    },
    [clearTimer, reveal],
  );

  const hide = useCallback((): void => {
    clearTimer();
    setOpen((wasOpen) => {
      if (wasOpen) lastClosedAt = Date.now();
      return false;
    });
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  // 悬浮提示绝不能比它的触发元素活得更久：在 Escape、滚动以及任何
  // 其他位置的点按时关闭，避免它悬在棋盘上方不走。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [open, hide]);

  const style: CSSProperties | undefined =
    side === "left" ? undefined : align === "end" ? { right: 0 } : { left: 0 };

  return (
    <span
      ref={anchorRef}
      className="mc-tip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType === "touch") return;
        show(false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        hide();
      }}
      onPointerDown={(event) => {
        // 触屏没有悬停：按下时闪现一下标签，让图标在手机或平板上也能
        // 自我说明。
        if (event.pointerType !== "touch") return;
        show(true);
        clearTimer();
        timerRef.current = window.setTimeout(hide, 1800);
      }}
      onFocus={() => show(true)}
      onBlur={hide}
    >
      {children}
      {open ? (
        <span className="mc-tip" role="tooltip" data-side={side} data-align={align} style={style}>
          <span className="mc-tip-label">{label}</span>
          {keys && hasKeyboard ? <span className="mc-tip-key">{keys}</span> : null}
          {hint ? <span className="mc-tip-hint">{hint}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
