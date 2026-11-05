import { describe, expect, it, vi } from "vitest";
import { type CacheEntry, cacheKey, TmdbClient, TmdbError } from "@/server/tmdb/client";

const POLICY = { ttl: 60, stale: 600 };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function setup(responses: (() => Response | Promise<Response>)[], options: { now?: () => number; store?: Map<string, CacheEntry> } = {}) {
  const fetchImpl = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unerwartete Anfrage");
    return next();
  });
  const sleeps: number[] = [];
  const store = options.store;
  const client = new TmdbClient({
    token: "token",
    baseUrl: "https://tmdb.test/3",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: options.now,
    random: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    store: store
      ? {
          get: async (key) => store.get(key) ?? null,
          set: async (key, entry) => {
            store.set(key, entry);
          },
        }
      : undefined,
  });
  return { client, fetchImpl, sleeps };
}

describe("TmdbClient", () => {
  it("schickt das Token als Bearer-Header und nicht in der URL", async () => {
    const { client, fetchImpl } = setup([() => json({ ok: true })]);
    await client.get("/movie/1", { language: "de-DE" }, POLICY);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://tmdb.test/3/movie/1?language=de-DE");
    expect(String(url)).not.toContain("token");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("beantwortet wiederholte Anfragen aus dem Cache", async () => {
    const { client, fetchImpl } = setup([() => json({ value: 1 })]);
    await client.get("/a", {}, POLICY);
    expect(await client.get("/a", {}, POLICY)).toEqual({ value: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bündelt gleichzeitige Anfragen zu einer einzigen", async () => {
    const { client, fetchImpl } = setup([() => json({ value: 1 })]);
    const results = await Promise.all([client.get("/a", {}, POLICY), client.get("/a", {}, POLICY), client.get("/a", {}, POLICY)]);
    expect(results).toEqual([{ value: 1 }, { value: 1 }, { value: 1 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("unterscheidet Einträge nach Parametern, unabhängig von der Reihenfolge", () => {
    expect(cacheKey("/a", { b: 1, a: 2 })).toBe(cacheKey("/a", { a: 2, b: 1 }));
    expect(cacheKey("/a", { a: 1 })).not.toBe(cacheKey("/a", { a: 2 }));
    expect(cacheKey("/a", { a: undefined, b: "" })).toBe("/a");
  });

  it("wiederholt 5xx mit wachsendem Abstand und hat dann Erfolg", async () => {
    const { client, fetchImpl, sleeps } = setup([() => json({}, 503), () => json({}, 500), () => json({ ok: true })]);
    expect(await client.get("/a", {}, POLICY)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it("wiederholt auch Netzwerkfehler", async () => {
    const { client } = setup([() => Promise.reject(new Error("ECONNRESET")), () => json({ ok: true })]);
    expect(await client.get("/a", {}, POLICY)).toEqual({ ok: true });
  });

  it("gibt nach zu vielen Versuchen mit einem klaren Fehler auf", async () => {
    const { client, fetchImpl } = setup(Array.from({ length: 4 }, () => () => json({}, 503)));
    await expect(client.get("/a", {}, POLICY)).rejects.toMatchObject({ code: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("wartet nach 429 mindestens die Zeit aus Retry-After", async () => {
    let time = 1_000;
    const sleeps: number[] = [];
    const responses = [() => json({}, 429, { "Retry-After": "3" }), () => json({ ok: true })];
    const fetchImpl = vi.fn(async () => responses.shift()!());
    const client = new TmdbClient({
      token: "t",
      baseUrl: "https://tmdb.test/3",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => time,
      random: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    });
    const start = time;
    await client.get("/first", {}, POLICY);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Die Sperre gilt auch für alle folgenden Anfragen.
    responses.push(() => json({ ok: true }));
    await client.get("/second", {}, POLICY);
    expect(time - start).toBeLessThan(10_000);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it("lässt nach 429 nicht weiter anfragen, bis die Wartezeit vorbei ist", async () => {
    let time = 0;
    const calledAt: number[] = [];
    const responses = [() => json({}, 429, { "Retry-After": "3" }), () => json({ ok: true })];
    const fetchImpl = vi.fn(async () => {
      calledAt.push(time);
      return responses.shift()!();
    });
    const client = new TmdbClient({
      token: "t",
      baseUrl: "https://tmdb.test/3",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => time,
      random: () => 0,
      sleep: async (ms) => {
        time += ms;
      },
    });
    await client.get("/a", {}, POLICY);
    await client.get("/b", {}, POLICY).catch(() => undefined);
    expect(calledAt[0]).toBe(0);
    expect(calledAt.length).toBeGreaterThanOrEqual(2);
  });

  it("wiederholt 404 und 401 nicht", async () => {
    const notFound = setup([() => json({}, 404)]);
    await expect(notFound.client.get("/a", {}, POLICY)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(notFound.fetchImpl).toHaveBeenCalledTimes(1);

    const unauthorized = setup([() => json({}, 401)]);
    await expect(unauthorized.client.get("/a", {}, POLICY)).rejects.toMatchObject({ code: "unauthorized" });
    expect(unauthorized.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("merkt sich 404 kurz und fragt TMDB nicht erneut", async () => {
    const { client, fetchImpl } = setup([() => json({}, 404)]);
    await expect(client.get("/a", {}, POLICY)).rejects.toBeInstanceOf(TmdbError);
    await expect(client.get("/a", {}, POLICY)).rejects.toMatchObject({ code: "not_found" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("nennt ein fehlendes Token ausdrücklich und ruft TMDB nicht auf", async () => {
    const fetchImpl = vi.fn();
    const client = new TmdbClient({ token: undefined, baseUrl: "https://tmdb.test/3", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.get("/a", {}, POLICY)).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("liefert Abgelaufenes sofort aus und erneuert es im Hintergrund", async () => {
    let time = 0;
    const { client, fetchImpl } = setup([() => json({ version: 1 }), () => json({ version: 2 })], { now: () => time });
    await client.get("/a", {}, POLICY);
    time = 61_000;
    expect(await client.get("/a", {}, POLICY)).toEqual({ version: 1 });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await client.get("/a", {}, POLICY)).toEqual({ version: 2 }));
  });

  it("bleibt bei einem TMDB-Ausfall bis zum Ende des Stale-Fensters nutzbar", async () => {
    let time = 0;
    let calls = 0;
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? json({ version: 1 }) : json({}, 503);
    });
    const client = new TmdbClient({
      token: "t",
      baseUrl: "https://tmdb.test/3",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => time,
      sleep: async () => undefined,
      onError,
    });
    await client.get("/a", {}, POLICY);
    time = 61_000;
    expect(await client.get("/a", {}, POLICY)).toEqual({ version: 1 });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });

  it("nutzt den Datenbank-Cache nach einem Neustart", async () => {
    const store = new Map<string, CacheEntry>([["/a", { payload: { cached: true }, expiresAt: Date.now() + 10_000, staleAt: Date.now() + 20_000 }]]);
    const { client, fetchImpl } = setup([], { store });
    expect(await client.get("/a", {}, POLICY)).toEqual({ cached: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verwirft Einträge jenseits des Stale-Fensters", async () => {
    const store = new Map<string, CacheEntry>([["/a", { payload: { old: true }, expiresAt: 0, staleAt: 1 }]]);
    const { client } = setup([() => json({ fresh: true })], { store });
    expect(await client.get("/a", {}, POLICY)).toEqual({ fresh: true });
  });

  it("begrenzt die Grösse des Speichers", async () => {
    const responses = Array.from({ length: 6 }, (_, index) => () => json({ index }));
    const fetchImpl = vi.fn(async () => responses.shift()!());
    const client = new TmdbClient({ token: "t", baseUrl: "https://tmdb.test/3", fetchImpl: fetchImpl as unknown as typeof fetch, memoryEntries: 2 });
    await client.get("/1", {}, POLICY);
    await client.get("/2", {}, POLICY);
    await client.get("/3", {}, POLICY);
    await client.get("/1", {}, POLICY);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
