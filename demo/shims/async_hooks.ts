// node:async_hooks for the browser demo: one store at a time, enough for the synchronous
// handlers the demo runs (the demo never opens an earlier course).
export class AsyncLocalStorage<T> {
  private store: T | undefined;
  getStore(): T | undefined {
    return this.store;
  }
  run<R>(store: T, fn: () => R): R {
    const prev = this.store;
    this.store = store;
    try {
      return fn();
    } finally {
      this.store = prev;
    }
  }
}
