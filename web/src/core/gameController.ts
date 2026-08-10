import { Chess, type Move, type Square } from "chess.js";

import { Emitter } from "./emitter";
import {
  type Animator,
  type CapturedPiece,
  type ClockState,
  type DemoOptions,
  type Difficulty,
  type ElapsedState,
  type Faction,
  type GameMode,
  type GameResult,
  type GameSnapshot,
  type HistoryRow,
  type LedgerMove,
  type MoveEvent,
  type PieceKind,
  type Premove,
  type SquareId,
  PIECE_VALUE,
} from "./types";
import { AiClient } from "../ai/aiClient";

export interface StartOptions {
  mode: GameMode;
  difficulty: Difficulty;
  playerColor: Faction;
  clockMinutes: number | null;
  /** 仅当 `mode === "demo"` 时读取。 */
  demo?: DemoOptions;
}

export const DEFAULT_DEMO: DemoOptions = {
  white: "medium",
  black: "medium",
  speed: 1,
  autoRematch: true,
};

/**
 * 棋盘在最终局面停留多久后开始下一场演示对局。
 *
 * 导出是因为结算弹窗会在屏幕上倒计时：即将被切换到新对局的观众
 * 应该能看到倒计时并可以阻止它，而不是在话说到一半时棋盘被重置。
 */
export const DEMO_REMATCH_DELAY_MS = 9000;

interface ControllerEvents {
  state: GameSnapshot;
  move: MoveEvent;
  check: Faction;
  gameover: GameResult;
  reset: StartOptions;
  illegal: { from: SquareId; to: SquareId };
  /** 队列已变更 — 当队列被清空或刚好耗尽时为空。 */
  premove: Premove[];
  /**
   * 队首的着法在对手应招之后无法走出。
   * `dropped` 统计它本身加上它后面的每一个环节，它们会一起被丢弃。
   *
   * `reason` 区分计划夭折的两种方式：`"illegal"` 在棋盘交还时发现，
   * 该着法根本无法走出；`"check"` 在应招攻击到国王的瞬间触发 ——
   * 甚至在该着法动画播放之前。
   */
  premovefailed: { from: SquareId; to: SquareId; dropped: number; reason: "illegal" | "check" };
}

const CLOCK_TICK_MS = 100;

/**
 * 电脑应招耗时的下限，单位毫秒。
 *
 * 简单难度下搜索本身平均只需 7ms，若没有下限，机器会在玩家的手还没离开棋盘时
 * 就应招——这看起来像是 bug，而不是实力。420ms 是仍然让人感觉像在思考的最小等待时间。
 */
export const DEFAULT_THINK_FLOOR_MS = 420;

/** 设置界面中提供的下限选项，在界面上按从长到短排列。 */
export const THINK_FLOOR_CHOICES = [0, DEFAULT_THINK_FLOOR_MS, 1500, 3000, 6000] as const;

/**
 * 队列中最多可以同时堆叠多少步着法。
 *
 * 基于对中等难度引擎的 241 条链实测，每一环都瞄准前面环节走完后留下的棋盘：
 * 队首在应招后存活的概率为 59.6%，而其后的每一环存活率反而*更高*（69.9%、72.2%、
 * 90.9%、72.0%）——只要第一环活下来，局面就基本朝计划设想的方向发展。真正衰减的是
 * 整条链：41.7% 能走到两层深，30.1% 三层，19.7% 全部五层。三层是尾端仍然物有所值的
 * 深度；超过它之后，环节被排入队列的次数远远多于被真正走出的次数。
 */
export const DEFAULT_PREMOVE_DEPTH = 3;

/** 设置界面中提供的队列深度选项。 */
export const PREMOVE_DEPTH_CHOICES = [1, 3, 5] as const;

/** 玩家所瞄准的棋盘上实际存在的一枚棋子。 */
interface ProjectedPiece {
  type: PieceKind;
  color: Faction;
}

const FILES = "abcdefgh";

/** 每种滑动棋子的射线方向，以 (file, rank) 步长表示。 */
const SLIDES: Record<string, [number, number][]> = {
  b: [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
  r: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ],
  q: [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ],
};

const KNIGHT_STEPS: [number, number][] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_STEPS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

function toSquare(file: number, rank: number): SquareId | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return `${FILES[file]}${rank + 1}`;
}

/**
 * 把一步排队着法投影到一个普通的格子映射上。
 *
 * 刻意不使用 chess.js：排队着法的意义恰恰在于它对当前棋盘可能是非法的，
 * 所以这里不做任何合法性校验。它只是移动棋子、按要求升变，并在国王易位时
 * 把车一起拖动——足够让下一环从正确的格子继续瞄准。
 */
function projectMove(board: Map<SquareId, ProjectedPiece>, move: Premove): void {
  const piece = board.get(move.from);
  if (!piece) return;
  board.delete(move.from);
  board.set(move.to, move.promotion ? { type: move.promotion, color: piece.color } : piece);

  const fromFile = FILES.indexOf(move.from[0]);
  const toFile = FILES.indexOf(move.to[0]);
  if (piece.type !== "k" || Math.abs(toFile - fromFile) !== 2) return;
  const rank = move.from[1];
  const kingside = toFile > fromFile;
  const rookFrom = `${kingside ? "h" : "a"}${rank}`;
  const rook = board.get(rookFrom);
  if (!rook) return;
  board.delete(rookFrom);
  board.set(`${kingside ? "f" : "d"}${rank}`, rook);
}

/**
 * 拥有所有国际象棋状态。渲染、音频和 UI 订阅它；它对 three.js 和 DOM 一无所知。
 */
export class GameController extends Emitter<ControllerEvents> {
  private chess = new Chess();
  private ai = new AiClient();
  private animator: Animator | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private rematchTimer: ReturnType<typeof setTimeout> | null = null;
  /** 已排队的演示重赛计划触发时的 `performance.now()` 时间戳。 */
  private rematchAt = 0;
  private lastTickAt = 0;
  private generation = 0;
  private paused = false;
  private demoRound = 1;
  /** 等待演示对局离开暂停状态的 resolver 列表。 */
  private resumeWaiters: (() => void)[] = [];

  private status: GameSnapshot["status"] = "idle";
  private options: StartOptions = {
    mode: "ai",
    difficulty: "medium",
    playerColor: "w",
    clockMinutes: null,
  };
  private clock: ClockState = { enabled: false, initialMs: 0, whiteMs: 0, blackMs: 0 };
  /** 已计入各方 army 的实际耗时，单位毫秒。 */
  private elapsed: Record<Faction, number> = { w: 0, b: 0 };
  /** 计时器当前正在计费的一方，空闲 / 暂停 / 终局时为 null。 */
  private timingSide: Faction | null = null;
  private timingSince = 0;
  private result: GameResult | null = null;
  private thinking = false;
  private busy = false;
  /** 玩家在引擎走棋期间排队的着法，最早的在前。 */
  private premoves: Premove[] = [];
  private premovesEnabled = true;
  /** 最多可以同时堆叠多少步着法。 */
  private premoveDepth: number = DEFAULT_PREMOVE_DEPTH;
  /** 引擎应招的最小实际耗时，单位毫秒。 */
  private thinkFloorMs: number = DEFAULT_THINK_FLOOR_MS;
  private snapshot: GameSnapshot = this.buildSnapshot();

  /** 渲染器注册一个异步动画器；着法会等待它完成。 */
  setAnimator(animator: Animator | null): void {
    this.animator = animator;
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  /**
   * 各方实时耗时。由计分面板直接读取（而非从快照读取），
   * 该面板自行计时刷新，这样每一秒的流逝都不会强迫整个界面重新渲染。
   */
  getElapsed(): ElapsedState {
    const live: Record<Faction, number> = { w: this.elapsed.w, b: this.elapsed.b };
    if (this.timingSide !== null) {
      live[this.timingSide] += Math.max(0, performance.now() - this.timingSince);
    }
    return { whiteMs: live.w, blackMs: live.b, totalMs: live.w + live.b };
  }

  /**
   * 把上次同步以来的时间计入刚才行棋的一方，然后把计时器重新指向
   * 当前该走棋的一方。在每个改变"谁在思考"的事件上都会调用：
   * 走出一步棋、暂停、悔棋、战斗结束。
   */
  private syncElapsed(): void {
    const now = performance.now();
    if (this.timingSide !== null) {
      this.elapsed[this.timingSide] += Math.max(0, now - this.timingSince);
    }
    this.timingSince = now;
    this.timingSide = this.status === "playing" && !this.paused ? (this.chess.turn() as Faction) : null;
  }

  getBoard(): { square: SquareId; kind: PieceKind; color: Faction }[] {
    const out: { square: SquareId; kind: PieceKind; color: Faction }[] = [];
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (!cell) continue;
        out.push({ square: cell.square, kind: cell.type as PieceKind, color: cell.color as Faction });
      }
    }
    return out;
  }

  /**
   * 棋子的目标格列表，按格子去重（一次升变会按每种候选棋子各生成一步着法），
   * 并打上标记，以便棋盘可以给它们着色区分。
   */
  legalTargets(from: SquareId): { to: SquareId; capture: boolean; castle: boolean; promotion: boolean }[] {
    const moves = this.chess.moves({ square: from as Square, verbose: true }) as Move[];
    const targets = new Map<SquareId, { to: SquareId; capture: boolean; castle: boolean; promotion: boolean }>();
    for (const move of moves) {
      const existing = targets.get(move.to);
      const entry = existing ?? { to: move.to, capture: false, castle: false, promotion: false };
      entry.capture = entry.capture || move.flags.includes("c") || move.flags.includes("e");
      entry.castle = entry.castle || move.flags.includes("k") || move.flags.includes("q");
      entry.promotion = entry.promotion || move.flags.includes("p");
      targets.set(move.to, entry);
    }
    return [...targets.values()];
  }

  isPromotion(from: SquareId, to: SquareId): boolean {
    const moves = this.chess.moves({ square: from as Square, verbose: true }) as Move[];
    return moves.some((move) => move.to === to && move.flags.includes("p"));
  }

  pieceAt(square: SquareId): { kind: PieceKind; color: Faction } | null {
    const piece = this.chess.get(square as Square);
    if (!piece) return null;
    return { kind: piece.type as PieceKind, color: piece.color as Faction };
  }

  // ------------------------------------------------------------ 预排着法

  /**
   * 当前是否可以排队一步着法。
   *
   * 时间窗口恰好是"玩家正在等待机器"：既包括引擎正在搜索的时候，
   * *也包括*上一步棋还在屏幕上播放动画的时候——后者是搜索耗时
   * 统计中看不到的那一半等待。
   */
  canPremove(): boolean {
    if (!this.premovesEnabled) return false;
    if (this.options.mode !== "ai" || this.status !== "playing") return false;
    return !this.isHumanTurn();
  }

  setPremovesEnabled(enabled: boolean): void {
    if (this.premovesEnabled === enabled) return;
    this.premovesEnabled = enabled;
    if (!enabled) this.clearPremove();
  }

  /**
   * 设置最多可以同时堆叠多少步着法。缩短深度会立即把队列截断到该深度，
   * 而不是等待尾部自己走完。
   */
  setPremoveDepth(depth: number): void {
    const next = Math.min(5, Math.max(1, Math.round(depth)));
    if (this.premoveDepth === next) return;
    this.premoveDepth = next;
    if (this.premoves.length > next) this.truncatePremoves(next);
  }

  getPremoveDepth(): number {
    return this.premoveDepth;
  }

  /** 队列中是否还有空位。 */
  canQueueMore(): boolean {
    return this.canPremove() && this.premoves.length < this.premoveDepth;
  }

  /**
   * 设置电脑应招耗时的下限，单位毫秒。
   *
   * 这是下限，绝不是上限：真正需要三秒的搜索仍然会花三秒。调高它会拓宽
   * 预排着法可以瞄准的时间窗口，这也是在简单难度下诚实地演练该功能的
   * 唯一办法——简单难度下搜索只需 7ms 就结束了。
   */
  setThinkFloorMs(ms: number): void {
    this.thinkFloorMs = Math.min(15000, Math.max(0, Math.round(ms)));
  }

  getThinkFloorMs(): number {
    return this.thinkFloorMs;
  }

  getPremoves(): Premove[] {
    return this.premoves.map((move) => ({ ...move }));
  }

  /**
   * 玩家正在瞄准的棋盘：当前局面加上所有已排队着法都走出来的样子。
   *
   * 一条链瞄准的是一个并不存在的棋盘，每一环瞄准的都是比屏幕上更远一步的棋盘。
   * 没有这层投影，第二环会从棋子*正站着*的格子读取目标，而不是它*将要到达*的格子，
   * 那就不是任何人想要的那步棋了。
   */
  private projectedBoard(): Map<SquareId, ProjectedPiece> {
    const board = new Map<SquareId, ProjectedPiece>();
    for (const row of this.chess.board()) {
      for (const cell of row) {
        if (cell) board.set(cell.square, { type: cell.type as PieceKind, color: cell.color as Faction });
      }
    }
    for (const queued of this.premoves) projectMove(board, queued);
    return board;
  }

  /** 队列走完后某个格子上站着的棋子，如果有的话。 */
  premovePieceAt(square: SquareId): { kind: PieceKind; color: Faction } | null {
    const piece = this.projectedBoard().get(square);
    return piece ? { kind: piece.type, color: piece.color } : null;
  }

  /** 从某个格子出发的排队着法在队列中的下标，没有则为 -1。 */
  premoveIndexFrom(square: SquareId): number {
    return this.premoves.findIndex((move) => move.from === square);
  }

  /**
   * 一枚棋子理论上能够走到的所有格子，依据它的走法几何计算，
   * 而不是依据当前局面。
   *
   * 预排着法瞄准的是一个还不存在的棋盘，所以挡路的棋子不是隐藏某个格子的理由：
   * 挡在中间的那枚棋子很可能正是会走开的那枚。合法性只在该着法真正执行时
   * 判定一次。
   */
  premoveTargets(from: SquareId): SquareId[] {
    const piece = this.projectedBoard().get(from);
    if (!piece) return [];
    const file = FILES.indexOf(from[0]);
    const rank = Number(from[1]) - 1;
    const out = new Set<SquareId>();
    const add = (f: number, r: number): void => {
      const square = toSquare(f, r);
      if (square) out.add(square);
    };

    if (piece.type === "p") {
      const dir = piece.color === "w" ? 1 : -1;
      add(file, rank + dir);
      if (rank === (piece.color === "w" ? 1 : 6)) add(file, rank + dir * 2);
      // 两条斜线都要加：吃子目标可能还不存在，而吃过路兵从来都不会提前存在。
      add(file - 1, rank + dir);
      add(file + 1, rank + dir);
    } else if (piece.type === "n") {
      for (const [df, dr] of KNIGHT_STEPS) add(file + df, rank + dr);
    } else if (piece.type === "k") {
      for (const [df, dr] of KING_STEPS) add(file + df, rank + dr);
      // 无论王车易位当前是否合法，都从初始格提供该选项。
      const home = piece.color === "w" ? "e1" : "e8";
      if (from === home) {
        add(file + 2, rank);
        add(file - 2, rank);
      }
    } else {
      for (const [df, dr] of SLIDES[piece.type]) {
        for (let step = 1; step < 8; step += 1) add(file + df * step, rank + dr * step);
      }
    }

    out.delete(from);

    // 被将军时棋盘不再是假想局面。对 190 次将军应招的实测显示，
    // 这种几何算法点亮的格子中只有 5.2% 真正可以走（10470 个中的 546 个）
    // ——二十个被点亮的格子里有十九个是玩家根本无法落实的假象。所以国王被攻击时，
    // 第一环会被过滤为真正能应将的着法；更深的环节仍然瞄准一个谁也看不见的棋盘，
    // 继续保留原始几何结果。
    if (this.premoves.length === 0 && this.inPlayerCheck()) {
      const legal = new Set<string>(
        (this.chess.moves({ square: from as Square, verbose: true }) as Move[]).map((move) => move.to),
      );
      return [...out].filter((square) => legal.has(square));
    }

    return [...out];
  }

  /** 当前棋盘上玩家自己的国王正被攻击时为 true。 */
  private inPlayerCheck(): boolean {
    return this.chess.isCheck() && this.chess.turn() === this.options.playerColor;
  }

  /**
   * 应招把玩家置于被将军状态，所以整个队列立即清空，
   * 而不是等到棋盘交还时。
   *
   * 基于对中等难度引擎 949 个思考窗口的实测：平静应招后队首仍有 79.2% 的概率
   * 可以走出，而将军应招后只剩 7.9%——而且那 15 个幸存者中有 14 个只是国王
   * 恰好走到了某个合法格子，这是巧合而不是计划。整条链在一次将军中存活下来的
   * 概率是 3.2%。为了在将军动画期间维持这些概率而让标记继续亮着，
   * 是在为一个已经死掉的计划撑场面。
   */
  private dropPremovesOnCheck(): void {
    if (this.premoves.length === 0) return;
    const head = this.premoves[0];
    const dropped = this.premoves.length;
    this.premoves = [];
    this.publish();
    this.emit("premove", []);
    this.emit("premovefailed", { from: head.from, to: head.to, dropped, reason: "check" });
  }

  /** 当排队的兵着法会落到底线时为 true。 */
  isPremovePromotion(from: SquareId, to: SquareId): boolean {
    const piece = this.projectedBoard().get(from);
    if (!piece || piece.type !== "p") return false;
    return to[1] === (piece.color === "w" ? "8" : "1");
  }

  /**
   * 把一步着法追加到队列末尾。
   *
   * 每一环都瞄准前面环节走完后留下的棋盘，所以一条链是一个计划而不是
   * 一堆散棋：把骑士排到某个格子上，下一环就能*从那个格子*出发继续瞄准，
   * 而那枚棋子此时还站在原地。
   */
  setPremove(from: SquareId, to: SquareId, promotion?: PieceKind): boolean {
    if (!this.canQueueMore()) return false;
    const piece = this.projectedBoard().get(from);
    if (!piece || piece.color !== this.options.playerColor) return false;
    if (!this.premoveTargets(from).includes(to)) return false;
    this.premoves.push({ from, to, promotion: promotion ?? null });
    this.publish();
    this.emit("premove", this.getPremoves());
    return true;
  }

  /** 丢弃整个队列。 */
  clearPremove(): void {
    if (this.premoves.length === 0) return;
    this.premoves = [];
    this.publish();
    this.emit("premove", []);
  }

  /** 只撤回最后一环 —— 链式悔棋。 */
  popPremove(): boolean {
    if (this.premoves.length === 0) return false;
    this.premoves.pop();
    this.publish();
    this.emit("premove", this.getPremoves());
    return true;
  }

  /**
   * 保留前 `count` 环并丢弃其余。被撤回那一环之后的每一环瞄准的都是
   * 一个现在永远不会出现的棋盘，所以它们不能保留。
   */
  truncatePremoves(count: number): boolean {
    const keep = Math.max(0, Math.round(count));
    if (keep >= this.premoves.length) return false;
    this.premoves = this.premoves.slice(0, keep);
    this.publish();
    this.emit("premove", this.getPremoves());
    return true;
  }

  /**
   * 如果对方的应着让排队着法仍然合法就走出它，否则丢弃。
   * 真的走出了着法时返回 true，调用方由此知道回合已经交替。
   */
  private async consumePremove(): Promise<boolean> {
    if (this.premoves.length === 0) return false;
    if (!this.premovesEnabled || this.options.mode !== "ai") {
      this.clearPremove();
      return false;
    }
    // 每步棋结束时都会走到这里，包括刚被走出的排队着法：
    // 轮到机器思考时，队列的其余部分就继续等着。
    if (!this.isHumanTurn()) return false;

    const queued = this.premoves[0];
    const legal = (this.chess.moves({ square: queued.from as Square, verbose: true }) as Move[]).some(
      (move) => move.to === queued.to,
    );

    if (!legal) {
      // 后面的每一步都是冲着"这步棋走完后留下的局面"去的，
      // 所以整串队列跟着一起作废，而不是对着一个
      // 谁都没想到的局面继续走下去。
      const dropped = this.premoves.length;
      this.premoves = [];
      this.publish();
      this.emit("premove", []);
      this.emit("premovefailed", { from: queued.from, to: queued.to, dropped, reason: "illegal" });
      return false;
    }

    this.premoves.shift();
    this.publish();
    this.emit("premove", this.getPremoves());
    return this.play(queued.from, queued.to, queued.promotion ?? undefined);
  }

  isHumanTurn(): boolean {
    if (this.status !== "playing" || this.busy) return false;
    if (this.options.mode === "attract" || this.options.mode === "demo") return false;
    if (this.options.mode === "hotseat") return true;
    return this.chess.turn() === this.options.playerColor;
  }

  start(options: StartOptions): void {
    this.generation += 1;
    this.ai.cancel();
    this.clearRematchTimer();
    this.releasePause();
    this.paused = false;
    if (options.mode !== "demo" || this.options.mode !== "demo") this.demoRound = 1;
    this.options = options.mode === "demo" ? { ...options, demo: options.demo ?? DEFAULT_DEMO } : options;
    this.chess = new Chess();
    this.status = "playing";
    this.result = null;
    this.thinking = false;
    this.busy = false;
    this.premoves = [];
    const ms = options.clockMinutes ? options.clockMinutes * 60_000 : 0;
    this.clock = {
      enabled: options.clockMinutes !== null,
      initialMs: ms,
      whiteMs: ms,
      blackMs: ms,
    };
    this.elapsed = { w: 0, b: 0 };
    this.timingSide = null;
    this.syncElapsed();
    this.emit("reset", options);
    this.publish();
    this.startClock();
    void this.maybeRunEngine();
  }

  stop(): void {
    this.generation += 1;
    this.ai.cancel();
    this.clearRematchTimer();
    this.stopClock();
    this.status = "idle";
    this.thinking = false;
    this.busy = false;
    this.premoves = [];
    this.paused = false;
    this.releasePause();
    this.syncElapsed();
    this.publish();
  }

  // ------------------------------------------------------- 演示模式控制

  /**
   * 在半步棋之间暂停演示。已经发出的搜索允许跑完，
   * 但它的着法会被扣住，直到恢复播放才落下。
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      this.stopClock();
      this.syncElapsed();
    } else {
      this.releasePause();
      this.syncElapsed();
      this.startClock();
    }
    this.publish();
    if (!paused) void this.maybeRunEngine();
  }

  togglePaused(): void {
    this.setPaused(!this.paused);
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** 实时调速——从下一步棋开始生效。 */
  setDemoSpeed(speed: number): void {
    if (!this.options.demo) return;
    this.options = { ...this.options, demo: { ...this.options.demo, speed: clamp(speed, 0.25, 4) } };
    this.publish();
  }

  setDemoAutoRematch(autoRematch: boolean): void {
    if (!this.options.demo) return;
    this.options = { ...this.options, demo: { ...this.options.demo, autoRematch } };
    if (!autoRematch) this.clearRematchTimer();
    this.publish();
  }

  /** 立即用相同设置重开演示。 */
  restartDemo(): void {
    if (this.options.mode !== "demo") return;
    this.demoRound += 1;
    this.start({ ...this.options });
  }

  /**
   * 距演示循环开下一局还剩多少毫秒；没有排队时返回 null。
   * 由对话框按自己的节奏读取，这样倒计时跳动不会
   * 导致整个界面反复重渲染。
   */
  getDemoRematchRemaining(): number | null {
    if (this.rematchTimer === null) return null;
    return Math.max(0, this.rematchAt - performance.now());
  }

  private releasePause(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && this.status === "playing") {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
  }

  private clearRematchTimer(): void {
    if (this.rematchTimer !== null) {
      clearTimeout(this.rematchTimer);
      this.rematchTimer = null;
    }
  }

  async tryMove(from: SquareId, to: SquareId, promotion?: PieceKind): Promise<boolean> {
    if (!this.isHumanTurn()) return false;
    return this.play(from, to, promotion);
  }

  private async play(from: SquareId, to: SquareId, promotion?: PieceKind): Promise<boolean> {
    let move: Move | null = null;
    try {
      move = this.chess.move({ from, to, promotion: promotion ?? "q" }) as Move;
    } catch {
      move = null;
    }
    if (!move) {
      this.emit("illegal", { from, to });
      return false;
    }
    await this.commit(move);
    return true;
  }

  private async commit(move: Move): Promise<void> {
    const generation = this.generation;
    this.busy = true;
    // 着法已经落定，这里把耗时记在刚走完棋的一方账上，
    // 并同时开始给应棋方计时——与倒计时棋钟同一套记账方式。
    this.syncElapsed();

    const capture = this.buildCapture(move);
    const rook = this.buildRookTrip(move);
    const inCheck = this.chess.isCheck();
    const gameOver = this.chess.isGameOver();

    const event: MoveEvent = {
      color: move.color as Faction,
      kind: move.piece as PieceKind,
      from: move.from,
      to: move.to,
      san: move.san,
      capture,
      rook,
      promotion: (move.promotion as PieceKind | undefined) ?? null,
      isCheck: inCheck,
      isGameOver: gameOver,
    };

    this.publish();
    this.emit("move", event);
    if (inCheck) this.emit("check", this.chess.turn() as Faction);
    // 要在动画之前清、而不是之后：预排队列随这步"将军"一起作废，
    // 这样标记就不会亮在一个已被将军终结的计划之上。
    if (inCheck && this.inPlayerCheck()) this.dropPremovesOnCheck();

    if (this.animator) {
      try {
        await this.animator(event);
      } catch (error) {
        console.error("[game] animator failed", error);
      }
    }
    if (generation !== this.generation) return;

    this.busy = false;
    this.publish();

    if (this.checkEnd()) return;
    // 排队着法从这里走出、而不是从引擎回合走出：
    // 棋盘交还给玩家的那一刻，正是玩家预想中着法落下的时刻。
    if (await this.consumePremove()) return;
    void this.maybeRunEngine();
  }

  private buildCapture(move: Move): MoveEvent["capture"] {
    if (move.flags.includes("e")) {
      const square = `${move.to[0]}${move.from[1]}`;
      return { square, kind: "p", color: move.color === "w" ? "b" : "w" };
    }
    if (move.captured) {
      return {
        square: move.to,
        kind: move.captured as PieceKind,
        color: move.color === "w" ? "b" : "w",
      };
    }
    return null;
  }

  private buildRookTrip(move: Move): MoveEvent["rook"] {
    if (move.flags.includes("k")) {
      const rank = move.color === "w" ? "1" : "8";
      return { from: `h${rank}`, to: `f${rank}` };
    }
    if (move.flags.includes("q")) {
      const rank = move.color === "w" ? "1" : "8";
      return { from: `a${rank}`, to: `d${rank}` };
    }
    return null;
  }

  private checkEnd(): boolean {
    if (!this.chess.isGameOver()) return false;
    const loser = this.chess.turn() as Faction;
    if (this.chess.isCheckmate()) {
      this.finish({ winner: loser === "w" ? "b" : "w", reason: "checkmate" });
      return true;
    }
    if (this.chess.isStalemate()) {
      this.finish({ winner: null, reason: "stalemate" });
      return true;
    }
    if (this.chess.isThreefoldRepetition()) {
      this.finish({ winner: null, reason: "threefold" });
      return true;
    }
    if (this.chess.isInsufficientMaterial()) {
      this.finish({ winner: null, reason: "insufficient" });
      return true;
    }
    this.finish({ winner: null, reason: "draw" });
    return true;
  }

  private finish(result: GameResult): void {
    this.generation += 1;
    this.ai.cancel();
    this.stopClock();
    this.releasePause();
    this.status = "over";
    this.thinking = false;
    this.busy = false;
    this.premoves = [];
    this.result = result;
    this.syncElapsed();
    this.publish();
    this.emit("gameover", result);
    this.scheduleDemoRematch();
  }

  /** 让录制会话持续滚动：新的一局自动开始。 */
  private scheduleDemoRematch(): void {
    if (this.options.mode !== "demo" || !this.options.demo?.autoRematch) return;
    this.clearRematchTimer();
    this.rematchAt = performance.now() + DEMO_REMATCH_DELAY_MS;
    this.rematchTimer = setTimeout(() => {
      this.rematchTimer = null;
      if (this.status !== "over" || this.options.mode !== "demo") return;
      this.demoRound += 1;
      this.start({ ...this.options });
    }, DEMO_REMATCH_DELAY_MS);
  }

  resign(): void {
    if (this.status !== "playing") return;
    const loser = this.options.mode === "ai" ? this.options.playerColor : (this.chess.turn() as Faction);
    this.finish({ winner: loser === "w" ? "b" : "w", reason: "resignation" });
  }

  /** 悔棋半步（双人热座）或一整对（对人机）。 */
  undo(): boolean {
    if (this.status === "over") {
      this.status = "playing";
      this.result = null;
    }
    if (this.status !== "playing" || this.busy || this.thinking) return false;
    if (this.chess.history().length === 0) return false;
    this.generation += 1;
    this.ai.cancel();
    this.premoves = [];
    this.chess.undo();
    if (this.options.mode === "ai" && this.chess.turn() !== this.options.playerColor) {
      this.chess.undo();
    }
    this.thinking = false;
    this.busy = false;
    this.syncElapsed();
    this.publish();
    return true;
  }

  private async maybeRunEngine(): Promise<void> {
    if (this.status !== "playing" || this.paused) return;
    const mode = this.options.mode;
    if (mode === "hotseat") return;
    const turn = this.chess.turn() as Faction;
    if (mode === "ai" && turn === this.options.playerColor) return;
    if (this.thinking) return;

    const generation = this.generation;
    this.thinking = true;
    this.publish();

    const demo = mode === "demo" ? (this.options.demo ?? DEFAULT_DEMO) : null;
    const difficulty: Difficulty =
      mode === "attract" ? "medium" : demo ? (turn === "w" ? demo.white : demo.black) : this.options.difficulty;
    const started = performance.now();
    const best = await this.ai.bestMove(this.chess.fen(), difficulty);
    if (generation !== this.generation || this.status !== "playing") {
      this.thinking = false;
      return;
    }

    // 给思考时间设一个下限，避免秒回显得机械；
    // 演示模式停留更久，让吃子和运镜能落在镜头里。
    const elapsed = performance.now() - started;
    const base = mode === "attract" ? 900 : demo ? 1150 : this.thinkFloorMs;
    const floor = demo ? clamp(base / demo.speed, 120, 6000) : base;
    if (elapsed < floor) await wait(floor - elapsed);
    if (generation !== this.generation || this.status !== "playing") {
      this.thinking = false;
      return;
    }

    // 暂停时把算好的着法扣住，而不是把这次搜索白白扔掉。
    if (this.paused) {
      this.thinking = false;
      this.publish();
      await this.waitWhilePaused();
      if (generation !== this.generation || this.status !== "playing") return;
    }

    this.thinking = false;
    if (!best) {
      this.checkEnd();
      this.publish();
      return;
    }
    await this.play(best.from, best.to, best.promotion ?? undefined);
  }

  private startClock(): void {
    this.stopClock();
    if (!this.clock.enabled || this.paused || this.status !== "playing") return;
    this.lastTickAt = performance.now();
    this.clockTimer = setInterval(() => this.tickClock(), CLOCK_TICK_MS);
  }

  private stopClock(): void {
    if (this.clockTimer !== null) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private tickClock(): void {
    if (this.status !== "playing" || this.paused) return;
    const now = performance.now();
    const delta = now - this.lastTickAt;
    this.lastTickAt = now;
    const turn = this.chess.turn() as Faction;
    if (turn === "w") this.clock.whiteMs = Math.max(0, this.clock.whiteMs - delta);
    else this.clock.blackMs = Math.max(0, this.clock.blackMs - delta);

    if (this.clock.whiteMs === 0 || this.clock.blackMs === 0) {
      const loser: Faction = this.clock.whiteMs === 0 ? "w" : "b";
      this.finish({ winner: loser === "w" ? "b" : "w", reason: "timeout" });
      return;
    }
    this.publish();
  }

  private buildSnapshot(): GameSnapshot {
    const verbose = this.chess.history({ verbose: true }) as Move[];
    const sanList = verbose.map((move) => move.san);
    const history: HistoryRow[] = [];
    for (let i = 0; i < sanList.length; i += 2) {
      history.push({
        number: i / 2 + 1,
        white: sanList[i] ?? null,
        black: sanList[i + 1] ?? null,
      });
    }

    const moves: LedgerMove[] = verbose.map((move, index) => ({
      ply: index,
      number: Math.floor(index / 2) + 1,
      color: move.color as Faction,
      kind: move.piece as PieceKind,
      san: move.san,
      from: move.from,
      to: move.to,
      capture: move.flags.includes("c") || move.flags.includes("e"),
      castle: move.flags.includes("k") || move.flags.includes("q"),
      promotion: (move.promotion as PieceKind | undefined) ?? null,
      check: move.san.endsWith("+"),
      mate: move.san.endsWith("#"),
    }));

    const captured: CapturedPiece[] = [];
    let diff = 0;
    for (const move of verbose) {
      if (!move.captured) continue;
      const kind = move.captured as PieceKind;
      const color: Faction = move.color === "w" ? "b" : "w";
      captured.push({ kind, color });
      diff += color === "b" ? PIECE_VALUE[kind] : -PIECE_VALUE[kind];
    }
    for (const move of verbose) {
      if (!move.promotion) continue;
      const gain = PIECE_VALUE[move.promotion as PieceKind] - PIECE_VALUE.p;
      diff += move.color === "w" ? gain : -gain;
    }

    const last = verbose.length > 0 ? verbose[verbose.length - 1] : null;

    return {
      status: this.status,
      mode: this.options.mode,
      difficulty: this.options.difficulty,
      playerColor: this.options.playerColor,
      turn: this.chess.turn() as Faction,
      fen: this.chess.fen(),
      pgn: this.chess.pgn(),
      inCheck: this.chess.isCheck(),
      thinking: this.thinking,
      busy: this.busy,
      result: this.result,
      history,
      sanList,
      moves,
      captured,
      materialDiff: diff,
      lastMove: last ? { from: last.from, to: last.to } : null,
      premoves: this.getPremoves(),
      clock: { ...this.clock },
      elapsed: this.getElapsed(),
      canUndo:
        verbose.length > 0 &&
        !this.thinking &&
        !this.busy &&
        this.options.mode !== "attract" &&
        this.options.mode !== "demo",
      demo: this.options.mode === "demo" ? { ...(this.options.demo ?? DEFAULT_DEMO) } : null,
      paused: this.paused,
      demoRound: this.demoRound,
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    this.emit("state", this.snapshot);
  }

  dispose(): void {
    this.stopClock();
    this.clearRematchTimer();
    this.releasePause();
    this.ai.dispose();
    this.clear();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
