import { useSyncExternalStore } from "react";

import type { GameController } from "../core/gameController";
import type { GameSnapshot } from "../core/types";

/** 让 React 订阅棋局核心，不复制任何状态。 */
export function useGameSnapshot(controller: GameController): GameSnapshot {
  return useSyncExternalStore(
    (listener) => controller.on("state", listener),
    () => controller.getSnapshot(),
    () => controller.getSnapshot(),
  );
}
