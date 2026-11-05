// Zähler pro Nutzer und Route. Liegt im Speicher, weil Kinora in einem Prozess läuft
// und ein Neustart die Zähler ohne Schaden zurücksetzen darf.

export interface RateLimitRule {
  /** Eindeutiger Name, damit sich Routen ihre Kontingente nicht teilen. */
  name: string;
  max: number;
  windowMs: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

const MAX_TRACKED = 50_000;

export class UserRateLimiter {
  private readonly counters = new Map<string, Counter>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Liefert `true`, solange die Anfrage im Kontingent liegt. */
  allow(userId: string, rule: RateLimitRule): boolean {
    const key = `${rule.name}:${userId}`;
    const now = this.now();
    const current = this.counters.get(key);
    if (!current || now >= current.resetAt) {
      this.evictIfFull(now);
      this.counters.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= rule.max;
  }

  private evictIfFull(now: number) {
    if (this.counters.size < MAX_TRACKED) return;
    for (const [key, counter] of this.counters) {
      if (now >= counter.resetAt) this.counters.delete(key);
    }
    // Sind alle Zähler noch aktiv, weicht der älteste Eintrag.
    if (this.counters.size >= MAX_TRACKED) {
      const oldest = this.counters.keys().next().value;
      if (oldest !== undefined) this.counters.delete(oldest);
    }
  }
}

export const userRateLimiter = new UserRateLimiter();

const MINUTE = 60_000;

export const RATE_LIMITS = {
  search: { name: "search", max: 90, windowMs: MINUTE },
  browse: { name: "browse", max: 60, windowMs: MINUTE },
  people: { name: "people", max: 60, windowMs: MINUTE },
  library: { name: "library", max: 180, windowMs: MINUTE },
  // Beim Nachtragen kommen viele Einträge kurz hintereinander.
  diary: { name: "diary", max: 300, windowMs: MINUTE },
  swipe: { name: "swipe", max: 300, windowMs: MINUTE },
  discoverySession: { name: "discovery-session", max: 15, windowMs: MINUTE },
  bulk: { name: "bulk", max: 10, windowMs: MINUTE },
  interactions: { name: "interactions", max: 180, windowMs: MINUTE },
  avatar: { name: "avatar", max: 10, windowMs: MINUTE },
  export: { name: "export", max: 6, windowMs: MINUTE },
  watchlistExtras: { name: "watchlist-extras", max: 20, windowMs: MINUTE },
  preferences: { name: "preferences", max: 30, windowMs: MINUTE },
} satisfies Record<string, RateLimitRule>;
