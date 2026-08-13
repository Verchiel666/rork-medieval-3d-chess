import { useEffect, useRef, useState } from "react";
import { Check, Copy, Home, PauseCircle, RotateCw, Swords } from "lucide-react";

import { DEMO_REMATCH_DELAY_MS } from "../core/gameController";
import type { Difficulty, EndReason, Faction, GameResult } from "../core/types";
import { Crest } from "./Heraldry";

/**
 * AI 对战对局的额外框架。观看者是观众而非参战者：
 * 对话框会标明两位引擎，在排定循环时进行倒计时，
 * 并提供停驻棋盘的选项，以便仔细端详终局局面。
 */
export interface ShowcaseOutcome {
  /** 本次 AI 对战会话中的对局计数，从 1 开始。 */
  round: number;
  white: Difficulty;
  black: Difficulty;
  /** 循环已启动——新的一局会自动开始。 */
  autoRematch: boolean;
  /** 排队中的再战剩余毫秒数，无排队时为 null。 */
  getRematchRemaining: () => number | null;
  /** 解除循环，让棋盘停留在终局局面。 */
  onHold: () => void;
}

interface GameOverModalProps {
  result: GameResult;
  pgn: string;
  playerColor: Faction;
  versusComputer: boolean;
  moveCount: number;
  showcase?: ShowcaseOutcome | null;
  onRematch: () => void;
  onMenu: () => void;
}

const REASON_COPY: Record<EndReason, string> = {
  checkmate: "将杀",
  stalemate: "逼和 — 王无路可走",
  resignation: "一方降下了军旗",
  timeout: "沙漏已经流尽",
  threefold: "三次重复局面",
  insufficient: "子力不足",
  fiftymove: "五十回合规则",
  draw: "和棋局面",
};

const ENGINE_NAME: Record<Difficulty, string> = {
  easy: "侍从",
  medium: "骑士",
  hard: "战将",
};

export function GameOverModal({
  result,
  pgn,
  playerColor,
  versusComputer,
  moveCount,
  showcase,
  onRematch,
  onMenu,
}: GameOverModalProps) {
  const [copied, setCopied] = useState(false);

  const draw = result.winner === null;
  const playerWon = versusComputer && result.winner === playerColor;
  const headline = draw
    ? "和 局"
    : showcase
      ? result.winner === "w"
        ? "白曜凯旋"
        : "黑曜凯旋"
      : playerWon
        ? "胜 利"
        : versusComputer
          ? "败 北"
          : result.winner === "w"
            ? "白曜凯旋"
            : "黑曜凯旋";

  const copyPgn = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("[ui] clipboard unavailable", error);
    }
  };

  // AI 对战是用来观赏的，所以终局局面本身就是画面：
  // 此时背景保持轻薄、不加模糊，而不是把大厅藏在卡片之后。
  return (
    <div
      className={`mc-modal-pad pointer-events-auto absolute inset-0 z-30 flex items-center justify-center ${
        showcase ? "bg-black/35" : "bg-black/65 backdrop-blur-[3px]"
      }`}
    >
      <div className="mc-parchment mc-goldleaf mc-rise w-full max-w-md overflow-hidden">
        <div className="px-6 pb-6 pt-7 text-center">
          {showcase ? (
            <p className="mc-display text-[0.55rem] tracking-[0.42em] text-[#8a6b3a]">
              AI 对战 · 第 {showcase.round} 局
            </p>
          ) : null}

          <div className={`flex justify-center gap-3 ${showcase ? "mt-3" : ""}`}>
            {result.winner ? (
              <Crest faction={result.winner} size={44} active />
            ) : (
              <>
                <Crest faction="w" size={34} />
                <Crest faction="b" size={34} />
              </>
            )}
          </div>

          <h2 className="mc-display mt-4 text-3xl font-bold tracking-[0.14em] text-[#43301a]">{headline}</h2>
          <div className="mc-rule mx-auto mt-2 w-40 opacity-70" />
          <p className="mt-2 text-sm italic text-[#6a5334]">{REASON_COPY[result.reason]}</p>

          {showcase ? (
            <p className="mc-display mt-2 text-[0.6rem] tracking-[0.24em] text-[#7d6236]">
              {ENGINE_NAME[showcase.white]} <span className="text-[#a2854c]">vs</span> {ENGINE_NAME[showcase.black]} ·{" "}
              共 {moveCount} 步
            </p>
          ) : null}

          <div className="mt-5 max-h-24 overflow-y-auto rounded-sm border border-[#8a652255] bg-[#00000010] p-3 text-left font-mono text-[0.7rem] leading-relaxed text-[#4a3a24]">
            {pgn.length > 0 ? pgn : "1.（尚未走子）"}
          </div>

          {showcase?.autoRematch ? (
            <NextDuelCountdown getRemaining={showcase.getRematchRemaining} onHold={showcase.onHold} />
          ) : null}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <button type="button" className="mc-btn mc-btn-primary flex items-center justify-center gap-2" onClick={onRematch}>
              {showcase ? <RotateCw size={15} /> : <Swords size={15} />} {showcase ? "再来一局" : "再 战"}
            </button>
            <button type="button" className="mc-btn flex items-center justify-center gap-2" onClick={onMenu}>
              <Home size={15} /> 返回大厅
            </button>
          </div>
          <button
            type="button"
            className="mc-btn mt-2 flex w-full items-center justify-center gap-2"
            onClick={() => void copyPgn()}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "已复制" : "复制棋谱 (PGN)"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 把 AI 对战循环可视化。它以独立的 100 毫秒节拍从控制器读取截止时间——
 * 倒计时绝不能每十分之一秒就向整个界面推送一次快照——
 * 并补齐了循环唯一缺失的控制：无需翻找控制栏即可停下的方式。
 */
function NextDuelCountdown({ getRemaining, onHold }: { getRemaining: () => number | null; onHold: () => void }) {
  const [remaining, setRemaining] = useState<number | null>(() => getRemaining());
  const read = useRef(getRemaining);
  // 渲染期只读取 props 初始化；ref 的持续同步放到 commit 阶段，
  // 避免在渲染期间写 ref（react-hooks/refs）。
  useEffect(() => {
    read.current = getRemaining;
  });

  useEffect(() => {
    const timer = setInterval(() => setRemaining(read.current()), 100);
    return () => clearInterval(timer);
  }, []);

  if (remaining === null) return null;
  const seconds = Math.max(1, Math.ceil(remaining / 1000));
  const ratio = Math.min(1, Math.max(0, remaining / DEMO_REMATCH_DELAY_MS));

  return (
    <div className="mt-4 rounded-sm border border-[#8a652244] bg-[#00000010] px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="mc-display text-[0.58rem] tracking-[0.26em] text-[#7d6236]">下一局倒计时 {seconds} 秒</p>
        <button
          type="button"
          className="mc-display flex items-center gap-1 rounded-sm border border-[#8a652277] px-2 py-1 text-[0.55rem] tracking-[0.2em] text-[#5f4a26] transition-colors hover:border-[#8a6522] hover:text-[#3d2d15]"
          onClick={onHold}
        >
          <PauseCircle size={12} /> 停驻
        </button>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[#00000022]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#8a6522] via-[#d8b163] to-[#8a6522] transition-[width] duration-100 ease-linear"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
