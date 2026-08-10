import { Chess, type Move } from "chess.js";

import { GameController } from "./gameController";
import type { Premove } from "./types";

/**
 * 搜索跑在 Worker 里，而测试环境没法启动 Worker，所以用一个
 * 按剧本应棋的替身来代替。用剧本而不用随机：下面每条规则
 * 关心的都是*应棋*对排队着法的影响，因此应棋必须是可控的。
 */
function installEngine(script: string[]): void {
  let cursor = 0;
  class ScriptedWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;

    postMessage(request: { id: number; fen: string }): void {
      const chess = new Chess(request.fen);
      const moves = chess.moves({ verbose: true }) as Move[];
      const wanted = script[cursor];
      cursor += 1;
      const move = moves.find((candidate) => candidate.san === wanted) ?? moves[0];
      queueMicrotask(() => {
        this.onmessage?.({
          data: move
            ? { id: request.id, from: move.from, to: move.to, promotion: move.promotion ?? null, score: 0, depth: 1 }
            : null,
        });
      });
    }

    terminate(): void {}
  }
  (globalThis as unknown as { Worker: unknown }).Worker = ScriptedWorker;
}

function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("timed out waiting for the board"));
        return;
      }
      setTimeout(tick, 10);
    };
    tick();
  });
}

function startAiGame(script: string[]): GameController {
  installEngine(script);
  const controller = new GameController();
  controller.start({ mode: "ai", difficulty: "easy", playerColor: "w", clockMinutes: null });
  return controller;
}

describe("premove targets", () => {
  it("reads the second link off the board the first one leaves behind", async () => {
    const controller = startAiGame(["e5"]);
    await controller.tryMove("e2", "e4");
    controller.setPremove("g1", "f3");
    // 棋盘上骑士还站在 g1，但计划里它已经到了 f3，
    // 所以下一环要从 f3 这个格子来瞄准。
    expect(controller.premoveTargets("g1")).toEqual([]);
    expect(controller.premoveTargets("f3")).toContain("g5");
    expect(controller.premovePieceAt("f3")).toEqual({ kind: "n", color: "w" });
    controller.dispose();
  });

  it("offers squares behind a blocker, because the blocker may move away", () => {
    const controller = startAiGame([]);
    const targets = controller.premoveTargets("a1");
    // 战车自己的兵站在 a2、骑士站在 b1；这两格以及
    // 它们身后的所有格子，都应该可以瞄准。
    expect(targets).toContain("a2");
    expect(targets).toContain("a8");
    expect(targets).toContain("b1");
    expect(targets).toContain("h1");
    expect(targets).not.toContain("b2");
    controller.dispose();
  });

  it("offers both castling squares from the king's home square", () => {
    const controller = startAiGame([]);
    const targets = controller.premoveTargets("e1");
    expect(targets).toContain("g1");
    expect(targets).toContain("c1");
    controller.dispose();
  });

  it("offers a pawn both diagonals, capture or not", () => {
    const controller = startAiGame([]);
    const targets = controller.premoveTargets("e2");
    expect(targets.sort()).toEqual(["d3", "e3", "e4", "f3"]);
    controller.dispose();
  });
});

describe("premove queue", () => {
  it("is closed while the board belongs to the player", () => {
    const controller = startAiGame([]);
    expect(controller.canPremove()).toBe(false);
    expect(controller.setPremove("g1", "f3")).toBe(false);
    controller.dispose();
  });

  it("plays the queued move the moment the turn comes back", async () => {
    const controller = startAiGame(["e5"]);
    await controller.tryMove("e2", "e4");
    expect(controller.canPremove()).toBe(true);
    expect(controller.setPremove("g1", "f3")).toBe(true);
    expect(controller.getSnapshot().premoves).toEqual<Premove[]>([{ from: "g1", to: "f3", promotion: null }]);

    await waitFor(() => controller.getSnapshot().sanList.length >= 3);
    expect(controller.getSnapshot().sanList).toEqual(["e4", "e5", "Nf3"]);
    expect(controller.getSnapshot().premoves).toEqual([]);
    controller.dispose();
  });

  it("drops a queued move the reply made illegal, and says so", async () => {
    const controller = startAiGame(["e5"]);
    const failures: { from: string; to: string; dropped: number; reason: string }[] = [];
    controller.on("premovefailed", (event) => failures.push(event));

    await controller.tryMove("e2", "e4");
    // 兵不能走进应棋即将占据的那一格。
    expect(controller.setPremove("e4", "e5")).toBe(true);

    await waitFor(() => failures.length > 0);
    expect(failures[0]).toEqual({ from: "e4", to: "e5", dropped: 1, reason: "illegal" });
    expect(controller.getSnapshot().sanList).toEqual(["e4", "e5"]);
    expect(controller.getSnapshot().premoves).toEqual([]);
    expect(controller.isHumanTurn()).toBe(true);
    controller.dispose();
  });

  it("drops a queued move whose piece was captured", async () => {
    const controller = startAiGame(["d5", "Qxd5"]);
    const failures: { from: string; to: string; dropped: number; reason: string }[] = [];
    controller.on("premovefailed", (event) => failures.push(event));

    await controller.tryMove("e2", "e4");
    await waitFor(() => controller.isHumanTurn());
    await controller.tryMove("e4", "d5");
    expect(controller.setPremove("d5", "d6")).toBe(true);

    await waitFor(() => failures.length > 0);
    expect(failures[0]).toEqual({ from: "d5", to: "d6", dropped: 1, reason: "illegal" });
    expect(controller.getSnapshot().sanList).toEqual(["e4", "d5", "exd5", "Qxd5"]);
    controller.dispose();
  });

  it("stacks moves and plays them one per turn", async () => {
    const controller = startAiGame(["e5", "d6"]);
    await controller.tryMove("e2", "e4");
    expect(controller.setPremove("g1", "f3")).toBe(true);
    // 从 f3 瞄准——骑士还没站到那里：第二环是从第一环
    // 走完后留下的那个局面里读出来的。
    expect(controller.setPremove("f3", "g5")).toBe(true);
    expect(controller.getSnapshot().premoves).toHaveLength(2);

    await waitFor(() => controller.getSnapshot().sanList.length >= 5);
    expect(controller.getSnapshot().sanList).toEqual(["e4", "e5", "Nf3", "d6", "Ng5"]);
    expect(controller.getSnapshot().premoves).toEqual([]);
    controller.dispose();
  });

  it("refuses to stack deeper than the chosen depth", async () => {
    const controller = startAiGame(["e5"]);
    controller.setPremoveDepth(1);
    await controller.tryMove("e2", "e4");
    expect(controller.setPremove("g1", "f3")).toBe(true);
    expect(controller.setPremove("b1", "c3")).toBe(false);
    expect(controller.getSnapshot().premoves).toEqual<Premove[]>([{ from: "g1", to: "f3", promotion: null }]);
    controller.dispose();
  });

  it("takes the chain back one link at a time, and all of it at once", async () => {
    const controller = startAiGame(["e5"]);
    await controller.tryMove("e2", "e4");
    controller.setPremove("g1", "f3");
    controller.setPremove("f3", "g5");
    expect(controller.popPremove()).toBe(true);
    expect(controller.getSnapshot().premoves).toEqual<Premove[]>([{ from: "g1", to: "f3", promotion: null }]);

    controller.setPremove("f3", "g5");
    // 点第一环自己的格子，会把它和它后面的所有环节一起撤掉。
    expect(controller.premoveIndexFrom("g1")).toBe(0);
    expect(controller.truncatePremoves(0)).toBe(true);
    expect(controller.getSnapshot().premoves).toEqual([]);
    controller.dispose();
  });

  it("drops the whole chain when its head cannot be played", async () => {
    const controller = startAiGame(["e5"]);
    const failures: { from: string; to: string; dropped: number; reason: string }[] = [];
    controller.on("premovefailed", (event) => failures.push(event));

    await controller.tryMove("e2", "e4");
    expect(controller.setPremove("e4", "e5")).toBe(true);
    expect(controller.setPremove("e5", "e6")).toBe(true);

    await waitFor(() => failures.length > 0);
    // 队首后面的每一环，瞄准的都是一个永远不会出现的局面。
    expect(failures[0]).toEqual({ from: "e4", to: "e5", dropped: 2, reason: "illegal" });
    expect(controller.getSnapshot().premoves).toEqual([]);
    expect(controller.getSnapshot().sanList).toEqual(["e4", "e5"]);
    controller.dispose();
  });

  it("drops the whole chain the moment the reply gives check", async () => {
    // 1. e4 e5 2. f4 Qh4+ —— 队列瞄准的是一个"国王没被将军"的局面，
    // 而且反正也只有 7.9% 的队首能在被将军后幸存。
    const controller = startAiGame(["e5", "Qh4+"]);
    const failures: { from: string; to: string; dropped: number; reason: string }[] = [];
    controller.on("premovefailed", (event) => failures.push(event));

    await controller.tryMove("e2", "e4");
    await waitFor(() => controller.isHumanTurn());
    await controller.tryMove("f2", "f4");
    expect(controller.setPremove("g1", "f3")).toBe(true);
    expect(controller.setPremove("f3", "g5")).toBe(true);

    await waitFor(() => failures.length > 0);
    expect(failures[0]).toEqual({ from: "g1", to: "f3", dropped: 2, reason: "check" });
    expect(controller.getSnapshot().premoves).toEqual([]);
    expect(controller.getSnapshot().inCheck).toBe(true);
    controller.dispose();
  });

  it("offers only check answers while the king is under attack", async () => {
    const controller = startAiGame(["e5", "Qh4+"]);
    await controller.tryMove("e2", "e4");
    await waitFor(() => controller.isHumanTurn());
    await controller.tryMove("f2", "f4");
    await waitFor(() => controller.getSnapshot().inCheck);

    // 单看几何位置，g3、f3、h3、e2 等格子都该亮起；但能解 h4 之后将的
    // 只有两步棋，所以只有那两个格子允许被瞄准。
    expect(controller.premoveTargets("g2")).toEqual(["g3"]);
    expect(controller.premoveTargets("e1")).toEqual(["e2"]);
    expect(controller.premoveTargets("g1")).toEqual([]);
    controller.dispose();
  });

  it("stands down entirely when the player turns it off", async () => {
    const controller = startAiGame(["e5"]);
    await controller.tryMove("e2", "e4");
    controller.setPremove("g1", "f3");
    controller.setPremovesEnabled(false);
    expect(controller.getSnapshot().premoves).toEqual([]);
    expect(controller.canPremove()).toBe(false);

    await waitFor(() => controller.isHumanTurn());
    expect(controller.getSnapshot().sanList).toEqual(["e4", "e5"]);
    controller.dispose();
  });

  it("forgets the queue when a new game starts", async () => {
    const controller = startAiGame(["e5"]);
    await controller.tryMove("e2", "e4");
    controller.setPremove("g1", "f3");
    controller.start({ mode: "ai", difficulty: "easy", playerColor: "w", clockMinutes: null });
    expect(controller.getSnapshot().premoves).toEqual([]);
    controller.dispose();
  });
});
