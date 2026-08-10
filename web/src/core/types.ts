/**
 * 共享的、与渲染无关的游戏类型。
 * 棋局核心从不引用 `src/scene` 中的任何内容——场景层只是它的订阅者。
 */

export type Faction = "w" | "b";

export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";

export type SquareId = string;

export type Difficulty = "easy" | "medium" | "hard";

export type GameMode = "ai" | "hotseat" | "attract" | "demo";

/** 电脑对战电脑的演示设置（用于录制演示视频）。 */
export interface DemoOptions {
  /** 白曜军队的引擎强度。 */
  white: Difficulty;
  /** 黑曜军队的引擎强度。 */
  black: Difficulty;
  /** 着法间隔的节奏倍率（1 = 正常，2 = 快一倍）。 */
  speed: number;
  /** 上一局结束几秒后自动开启新一局。 */
  autoRematch: boolean;
}

export type GameStatus = "idle" | "playing" | "over";

export type EndReason =
  | "checkmate"
  | "stalemate"
  | "resignation"
  | "timeout"
  | "threefold"
  | "insufficient"
  | "fiftymove"
  | "draw";

export interface GameResult {
  /** 获胜方，和棋时为 null。 */
  winner: Faction | null;
  reason: EndReason;
}

export interface ClockState {
  enabled: boolean;
  initialMs: number;
  whiteMs: number;
  blackMs: number;
}

/**
 * 每支军队在棋盘上实际花费的墙钟时间，单位为毫秒。
 *
 * 与 {@link ClockState} 相互独立：倒计时是可选的且向*下*递减，
 * 而这里始终累计，因此即使在无时限的对局中，
 * 战况统计也能报告这场战斗持续了多久。
 */
export interface ElapsedState {
  whiteMs: number;
  blackMs: number;
  /** 双方合计——战斗至今的时长。 */
  totalMs: number;
}

export interface CapturedPiece {
  kind: PieceKind;
  /** 被吃棋子的颜色。 */
  color: Faction;
}

export interface HistoryRow {
  number: number;
  white: string | null;
  black: string | null;
}

/** 一手已走出的着法（标准代数记谱），以及它触及的信息。 */
export interface LedgerMove {
  /** 从 0 开始的半回合索引。 */
  ply: number;
  /** 从 1 开始的完整回合序号。 */
  number: number;
  color: Faction;
  kind: PieceKind;
  san: string;
  from: SquareId;
  to: SquareId;
  capture: boolean;
  castle: boolean;
  promotion: PieceKind | null;
  check: boolean;
  mate: boolean;
}

/**
 * 在对手仍在行棋时提前排入队列的着法。
 *
 * 升变棋子在着法被*排入*时即已选定，而不是在执行时才选——
 * 若在引擎回复的中途才弹出选择器，
 * 就失去了提前排着法的全部意义。
 */
export interface Premove {
  from: SquareId;
  to: SquareId;
  promotion: PieceKind | null;
}

export interface GameSnapshot {
  status: GameStatus;
  mode: GameMode;
  difficulty: Difficulty;
  /** 人机模式下人类玩家的颜色。 */
  playerColor: Faction;
  turn: Faction;
  fen: string;
  pgn: string;
  inCheck: boolean;
  thinking: boolean;
  busy: boolean;
  result: GameResult | null;
  history: HistoryRow[];
  sanList: string[];
  /** 标准记谱的完整着法记录，最旧的在前。 */
  moves: LedgerMove[];
  captured: CapturedPiece[];
  /** 正数 = 白方领先这么多个兵的子力。 */
  materialDiff: number;
  lastMove: { from: SquareId; to: SquareId } | null;
  /** 等待执行的预排着法，最旧的在前——第一个将最先执行。 */
  premoves: Premove[];
  clock: ClockState;
  /** 双方各自的用时，无论棋钟是否启用都会统计。 */
  elapsed: ElapsedState;
  canUndo: boolean;
  /** `mode === "demo"` 时的演示设置。 */
  demo: DemoOptions | null;
  /** 演示播放在着法之间暂停。 */
  paused: boolean;
  /** 从 1 开始的演示对局计数（自动再战会递增它）。 */
  demoRound: number;
}

/** 渲染器为一步走子制作动画所需的全部信息。 */
export interface MoveEvent {
  color: Faction;
  kind: PieceKind;
  from: SquareId;
  to: SquareId;
  san: string;
  /** 有棋子离开棋盘时设置（普通吃子或吃过路兵）。 */
  capture: { square: SquareId; kind: PieceKind; color: Faction } | null;
  /** 王车易位时设置——车自己的那一段行程。 */
  rook: { from: SquareId; to: SquareId } | null;
  promotion: PieceKind | null;
  isCheck: boolean;
  isGameOver: boolean;
}

export type Animator = (event: MoveEvent) => Promise<void>;

export const PIECE_VALUE: Record<PieceKind, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export const PIECE_LABEL: Record<PieceKind, string> = {
  p: "步卒",
  n: "骑士",
  b: "主教",
  r: "战车",
  q: "王后",
  k: "国王",
};
