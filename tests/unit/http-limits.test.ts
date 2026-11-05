import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBodyLimited } from "@/server/http/body";
import { UserRateLimiter } from "@/server/http/rate-limit";
import { LimiterQueueFullError, RequestLimiter } from "@/server/tmdb/limiter";

describe("UserRateLimiter", () => {
  const rule = { name: "test", max: 2, windowMs: 1_000 };

  it("erlaubt das Kontingent und lehnt darüber ab", () => {
    const limiter = new UserRateLimiter(() => 0);
    expect(limiter.allow("a", rule)).toBe(true);
    expect(limiter.allow("a", rule)).toBe(true);
    expect(limiter.allow("a", rule)).toBe(false);
  });

  it("zählt pro Nutzer und pro Route getrennt", () => {
    const limiter = new UserRateLimiter(() => 0);
    limiter.allow("a", rule);
    limiter.allow("a", rule);
    expect(limiter.allow("a", rule)).toBe(false);
    expect(limiter.allow("b", rule)).toBe(true);
    expect(limiter.allow("a", { ...rule, name: "andere" })).toBe(true);
  });

  it("beginnt nach Ablauf des Fensters neu", () => {
    let now = 0;
    const limiter = new UserRateLimiter(() => now);
    limiter.allow("a", rule);
    limiter.allow("a", rule);
    expect(limiter.allow("a", rule)).toBe(false);
    now = 1_000;
    expect(limiter.allow("a", rule)).toBe(true);
  });
});

describe("readBodyLimited", () => {
  const request = (body: string, headers: Record<string, string> = {}) => new Request("http://x/", { method: "POST", body, headers });

  it("liest Inhalte bis zur Grenze", async () => {
    expect(new TextDecoder().decode(await readBodyLimited(request("hallo"), 5))).toBe("hallo");
  });

  it("lehnt nach Content-Length ab, ohne zu lesen", async () => {
    await expect(readBodyLimited(request("x", { "content-length": "999" }), 5)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("lehnt auch ohne Content-Length ab, sobald die Grenze überschritten ist", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("0123"));
        controller.enqueue(new TextEncoder().encode("4567"));
        controller.close();
      },
    });
    const chunked = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    await expect(readBodyLimited(chunked, 5)).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("kommt mit leeren Anfragen zurecht", async () => {
    expect(await readBodyLimited(new Request("http://x/", { method: "POST" }), 5)).toHaveLength(0);
  });
});

describe("RequestLimiter", () => {
  const limiter = () => new RequestLimiter({ maxConcurrent: 1, requestsPerSecond: 1000, maxQueue: 1, now: () => 0, sleep: async () => undefined });

  it("lehnt ab, statt die Warteschlange unbegrenzt wachsen zu lassen", async () => {
    const instance = limiter();
    let release!: () => void;
    const running = instance.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();
    const queued = instance.run(async () => "wartet");
    await expect(instance.run(async () => "abgelehnt")).rejects.toBeInstanceOf(LimiterQueueFullError);
    release();
    await running;
    expect(await queued).toBe("wartet");
  });

  it("bleibt nach einer Ablehnung voll funktionsfähig", async () => {
    const instance = limiter();
    let release!: () => void;
    const running = instance.run(() => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();
    const queued = instance.run(async () => 1);
    await instance.run(async () => 2).catch(() => undefined);
    release();
    await running;
    await queued;
    expect(await instance.run(async () => 3)).toBe(3);
  });
});
