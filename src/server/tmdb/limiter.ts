// Begrenzt parallele Anfragen und die Rate pro Sekunde. TMDB toleriert rund
// 50 Anfragen pro Sekunde; der Client bleibt bewusst deutlich darunter.

export interface LimiterOptions {
  maxConcurrent: number;
  requestsPerSecond: number;
  /** Wartende Anfragen; darüber wird abgelehnt, statt den Speicher zu füllen. */
  maxQueue?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class LimiterQueueFullError extends Error {
  constructor() {
    super("Zu viele wartende TMDB-Anfragen.");
    this.name = "LimiterQueueFullError";
  }
}

const DEFAULT_MAX_QUEUE = 1_000;

export class RequestLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private tokens: number;
  private lastRefill: number;
  private pausedUntil = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: LimiterOptions) {
    this.tokens = options.requestsPerSecond;
    this.now = options.now ?? Date.now;
    this.lastRefill = this.now();
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Nach einem 429 pausieren alle Anfragen gemeinsam, nicht nur die betroffene. */
  pauseFor(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      await this.acquireToken();
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private async acquireSlot() {
    if (this.active < this.options.maxConcurrent) {
      this.active += 1;
      return;
    }
    if (this.waiting.length >= (this.options.maxQueue ?? DEFAULT_MAX_QUEUE)) throw new LimiterQueueFullError();
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private releaseSlot() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  private async acquireToken() {
    for (;;) {
      const now = this.now();
      if (now < this.pausedUntil) {
        await this.sleep(this.pausedUntil - now);
        continue;
      }
      const elapsed = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(
        this.options.requestsPerSecond,
        this.tokens + elapsed * this.options.requestsPerSecond,
      );
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.options.requestsPerSecond) * 1000));
    }
  }
}
