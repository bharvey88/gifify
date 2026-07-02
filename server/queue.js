// Serial job queue: one conversion at a time, FIFO. Pure state machine —
// the runner function is injected, so tests don't need ffmpeg.

export class JobQueue {
  constructor() {
    this.pending = [];
    this.running = null;
  }

  // task: async () => void. Returns a promise resolving when the task itself
  // finishes (errors are propagated to the caller's promise, not the queue).
  push(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.#drain();
    });
  }

  get length() {
    return this.pending.length + (this.running ? 1 : 0);
  }

  async #drain() {
    if (this.running || this.pending.length === 0) return;
    this.running = this.pending.shift();
    const { task, resolve, reject } = this.running;
    try {
      resolve(await task());
    } catch (err) {
      reject(err);
    } finally {
      this.running = null;
      this.#drain();
    }
  }
}
