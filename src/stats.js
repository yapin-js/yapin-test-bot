// Shared, in-memory counters. Modules import this file, and imported files aren't re-read when a
// module hot-reloads, so the numbers survive `/modules reload`.

export const stats = {
  startedAt: Date.now(),
  maintenance: false,
  /** command path → { runs, totalMs } */
  commands: new Map(),
  /** raw event type → count */
  events: new Map(),
  denied: 0,
  errors: 0,
  clicks: 0,
  rateLimits: 0,

  recordCommand(path, ms) {
    const entry = this.commands.get(path) ?? { runs: 0, totalMs: 0 };
    entry.runs++;
    entry.totalMs += ms;
    this.commands.set(path, entry);
  },

  recordEvent(type) {
    this.events.set(type, (this.events.get(type) ?? 0) + 1);
  },
};
