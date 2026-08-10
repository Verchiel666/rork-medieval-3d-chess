/** 极简的类型化事件发射器 — 无依赖、无全局状态。 */
export class Emitter<Events> {
  private listeners: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners[event];
    if (!set) {
      set = new Set();
      this.listeners[event] = set;
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners[event];
    if (!set) return;
    for (const listener of Array.from(set)) {
      try {
        listener(payload);
      } catch (error) {
        console.error(`[emitter] 事件 "${String(event)}" 的监听器执行失败`, error);
      }
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
