import { LimiterQueueFullError, RequestLimiter } from "./limiter";

export type TmdbErrorCode =
  | "not_configured"
  | "not_found"
  | "unauthorized"
  | "rate_limited"
  | "unavailable"
  | "bad_request";

export class TmdbError extends Error {
  constructor(
    readonly code: TmdbErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

/** Lebensdauer eines Eintrags: frisch bis `ttl`, danach bis `stale` noch nutzbar. */
export interface CachePolicy {
  ttl: number;
  stale: number;
}

export interface CacheEntry {
  payload: unknown;
  expiresAt: number;
  staleAt: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

export interface TmdbClientOptions {
  token: string | undefined;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  store?: CacheStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
  maxConcurrent?: number;
  requestsPerSecond?: number;
  maxQueue?: number;
  memoryEntries?: number;
  random?: () => number;
  onError?: (error: unknown, context: string) => void;
}

const NOT_FOUND_TTL_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 8_000;

type MemoryEntry = CacheEntry | { notFoundUntil: number };

export class TmdbClient {
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly refreshing = new Set<string>();
  private readonly limiter: RequestLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly memoryEntries: number;
  private readonly random: () => number;

  constructor(private readonly options: TmdbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = options.maxAttempts ?? 4;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.memoryEntries = options.memoryEntries ?? 2_000;
    this.random = options.random ?? Math.random;
    this.limiter = new RequestLimiter({
      maxConcurrent: options.maxConcurrent ?? 12,
      requestsPerSecond: options.requestsPerSecond ?? 25,
      maxQueue: options.maxQueue,
      now: this.now,
      sleep: this.sleep,
    });
  }

  async get<T>(path: string, params: Record<string, string | number | boolean | undefined>, policy: CachePolicy): Promise<T> {
    const key = cacheKey(path, params);

    const cached = this.readMemory(key);
    if (cached && this.isFresh(cached)) return cached.payload as T;

    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;

    const lookup = this.resolve<T>(key, path, params, policy, cached);
    this.inflight.set(key, lookup);
    try {
      return await lookup;
    } finally {
      if (this.inflight.get(key) === lookup) this.inflight.delete(key);
    }
  }

  private async resolve<T>(
    key: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    policy: CachePolicy,
    memoryEntry: CacheEntry | null,
  ): Promise<T> {
    let entry = memoryEntry;
    if (!entry && this.options.store) {
      entry = await this.options.store.get(key).catch((error) => {
        this.options.onError?.(error, "tmdb-cache-read");
        return null;
      });
      if (entry && this.now() < entry.staleAt) this.remember(key, entry);
    }

    if (entry && this.isFresh(entry)) return entry.payload as T;

    if (entry && this.now() < entry.staleAt) {
      // Veraltet, aber nutzbar: sofort ausliefern und im Hintergrund erneuern.
      if (!this.refreshing.has(key)) {
        this.refreshing.add(key);
        void this.refresh(key, path, params, policy)
          .catch((error) => this.options.onError?.(error, `tmdb-background-refresh ${path}`))
          .finally(() => this.refreshing.delete(key));
      }
      return entry.payload as T;
    }

    return (await this.refresh(key, path, params, policy)) as T;
  }

  private async refresh(
    key: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
    policy: CachePolicy,
  ): Promise<unknown> {
    const payload = await this.limiter.run(() => this.fetchWithRetry(key, path, params)).catch((error: unknown) => {
      if (error instanceof LimiterQueueFullError) throw new TmdbError("rate_limited", error.message);
      throw error;
    });
    const now = this.now();
    const entry: CacheEntry = {
      payload,
      expiresAt: now + policy.ttl * 1000,
      staleAt: now + (policy.ttl + policy.stale) * 1000,
    };
    this.remember(key, entry);
    void this.options.store?.set(key, entry).catch((error) => {
      this.options.onError?.(error, "tmdb-cache-write");
    });
    return payload;
  }

  private async fetchWithRetry(
    key: string,
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    if (!this.options.token) {
      throw new TmdbError("not_configured", "TMDB_READ_ACCESS_TOKEN ist nicht gesetzt.");
    }

    const url = new URL(this.options.baseUrl.replace(/\/$/, "") + path);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(name, String(value));
    }

    let lastError: TmdbError | null = null;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (attempt > 0) await this.sleep(this.backoff(attempt, lastError));

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.options.token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
      } catch (cause) {
        lastError = new TmdbError("unavailable", `TMDB nicht erreichbar: ${String(cause)}`);
        continue;
      }

      if (response.ok) return response.json();

      await response.body?.cancel().catch(() => undefined);

      if (response.status === 404) {
        this.memory.set(key, { notFoundUntil: this.now() + NOT_FOUND_TTL_MS });
        throw new TmdbError("not_found", `TMDB kennt ${path} nicht.`, 404);
      }
      if (response.status === 401) {
        throw new TmdbError("unauthorized", "TMDB hat das Token abgelehnt.", 401);
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1_000;
        this.limiter.pauseFor(waitMs);
        lastError = new TmdbError("rate_limited", "TMDB begrenzt gerade die Anfragen.", 429);
        continue;
      }
      if (response.status >= 500) {
        lastError = new TmdbError("unavailable", `TMDB antwortete mit ${response.status}.`, response.status);
        continue;
      }
      throw new TmdbError("bad_request", `TMDB lehnte ${path} ab (${response.status}).`, response.status);
    }
    throw lastError ?? new TmdbError("unavailable", "TMDB ist nicht erreichbar.");
  }

  private backoff(attempt: number, previous: TmdbError | null): number {
    // Nach 429 wartet bereits der Limiter; hier nur noch Jitter, damit nicht alle gleichzeitig starten.
    const base = previous?.code === "rate_limited" ? 100 : Math.min(MAX_BACKOFF_MS, 400 * 2 ** (attempt - 1));
    return base + Math.floor(this.random() * 200);
  }

  private readMemory(key: string): CacheEntry | null {
    const entry = this.memory.get(key);
    if (!entry) return null;
    if ("notFoundUntil" in entry) {
      if (this.now() < entry.notFoundUntil) throw new TmdbError("not_found", `TMDB kennt ${key} nicht.`, 404);
      this.memory.delete(key);
      return null;
    }
    if (this.now() >= entry.staleAt) {
      this.memory.delete(key);
      return null;
    }
    // LRU: zuletzt gelesene Einträge wandern ans Ende der Map.
    this.memory.delete(key);
    this.memory.set(key, entry);
    return entry;
  }

  private remember(key: string, entry: CacheEntry) {
    this.memory.delete(key);
    this.memory.set(key, entry);
    while (this.memory.size > this.memoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }

  private isFresh(entry: CacheEntry) {
    return this.now() < entry.expiresAt;
  }
}

export function cacheKey(path: string, params: Record<string, string | number | boolean | undefined>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${String(value)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}
