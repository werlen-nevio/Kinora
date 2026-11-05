// Absicherungen aus dem Security-Review. Jeder Test hält einen konkreten Angriffsweg fest.

import { describe, expect, it, vi } from "vitest";
import { GET as authGet, POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as bulkPost } from "@/app/api/library/bulk/route";
import { POST as libraryPost } from "@/app/api/library/route";
import { POST as searchPost } from "@/app/api/search/route";
import type { LibraryItem } from "@/lib/library-types";
import { prisma } from "@/server/db";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { authCall, call, ORIGIN, PASSWORD, signUp } from "./helpers";

function authRequest(path: string, init: RequestInit = {}) {
  return new Request(`${ORIGIN}/api/auth/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "x-forwarded-for": "203.0.113.77", ...init.headers },
  });
}

describe("Auth-Endpunkte", () => {
  it("beantwortet erfundene Pfade sofort, ohne einen Rate-Limit-Eintrag anzulegen", async () => {
    const before = await prisma.rateLimit.count();
    for (const path of ["zufall-1", "zufall-2", "sign-in/social", "admin/list-users"]) {
      expect((await authGet(authRequest(path))).status, path).toBe(404);
      expect((await authPost(authRequest(path, { method: "POST", body: "{}" }))).status, path).toBe(404);
    }
    expect(await prisma.rateLimit.count()).toBe(before);
  });

  it("lässt die genutzten Pfade durch", async () => {
    expect((await authGet(authRequest("get-session"))).status).toBe(200);
    expect((await authGet(authRequest("ok"))).status).toBe(200);
    const signIn = await authPost(authRequest("sign-in/email", { method: "POST", body: JSON.stringify({ email: "niemand@example.com", password: "falsches-passwort-123" }) }));
    expect(signIn.status).toBe(401);
  });

  it("lässt den Link aus der Mail zum Zurücksetzen durch", async () => {
    const response = await authGet(authRequest("reset-password/ungueltiges-token?callbackURL=%2Fpasswort-zuruecksetzen"));
    expect(response.status).not.toBe(404);
  });
});

describe("Konto löschen", () => {
  it("verlangt das Passwort auch bei einer frischen Session", async () => {
    const user = await signUp();
    for (const body of ["{}", '{"password":""}', "kein json", '{"password":123}']) {
      const response = await authPost(authRequest("delete-user", { method: "POST", body, headers: { Cookie: user.cookie } }));
      expect(response.status, body).toBe(400);
    }
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
  });

  it("löscht mit dem richtigen Passwort", async () => {
    const user = await signUp();
    const response = await authPost(authRequest("delete-user", { method: "POST", body: JSON.stringify({ password: PASSWORD }), headers: { Cookie: user.cookie } }));
    expect(response.status).toBe(200);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });
});

describe("Anzeigename", () => {
  it("wird auch serverseitig gekürzt und bereinigt", async () => {
    const user = await signUp(`Klick hier:\n\nhttps://boese.example ${"x".repeat(500)}`);
    const { name } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).not.toContain("\n");
  });

  it("wird auch beim Ändern begrenzt", async () => {
    const user = await signUp();
    const response = await authPost(authRequest("update-user", { method: "POST", body: JSON.stringify({ name: "y".repeat(500) }), headers: { Cookie: user.cookie } }));
    expect(response.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toHaveLength(60);
  });
});

describe("Mail zum Zurücksetzen", () => {
  it("enthält den frei wählbaren Anzeigenamen nicht", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = await signUp("Rufe sofort 0900 000 an");
    await authCall("/request-password-reset", { email: user.email, redirectTo: "/passwort-zuruecksetzen" });
    await vi.waitFor(() => expect(log.mock.calls.some(([line]) => String(line).includes(user.email))).toBe(true));
    const output = log.mock.calls.map(([line]) => String(line)).join("\n");
    log.mockRestore();
    expect(output).not.toContain("Rufe sofort");
  });
});

describe("Kontingente pro Nutzer", () => {
  it("drosselt Bulk-Aktionen, ohne andere Nutzer zu treffen", async () => {
    const heavy = await signUp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < RATE_LIMITS.bulk.max + 2; attempt += 1) {
      statuses.push((await call(bulkPost, { user: heavy, body: { items: [{ kind: "movie", tmdbId: 671 }], action: "favorite" } })).status);
    }
    expect(statuses.slice(0, RATE_LIMITS.bulk.max).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const other = await signUp();
    expect((await call(bulkPost, { user: other, body: { items: [{ kind: "movie", tmdbId: 671 }], action: "favorite" } })).status).toBe(200);
  });
});

describe("Grössenlimits", () => {
  it("lehnt zu grosse JSON-Anfragen ab, bevor sie gelesen werden", async () => {
    const user = await signUp();
    const result = await call<{ error: { code: string } }>(libraryPost, { user, body: { kind: "movie", tmdbId: 671, action: "watchlist", on: true, padding: "x".repeat(70_000) } });
    expect(result.status).toBe(413);
    expect(result.data.error.code).toBe("too_large");
  });
});

describe("Suchhistorie", () => {
  it("wächst nicht unbegrenzt", async () => {
    const user = await signUp();
    const rows = Array.from({ length: 105 }, (_, index) => ({ userId: user.id, query: `begriff ${index}`, normalized: `begriff ${index}` }));
    await prisma.searchHistory.createMany({ data: rows });
    await call(searchPost, { user, body: { query: "neu" } });
    expect(await prisma.searchHistory.count({ where: { userId: user.id } })).toBe(100);
    expect(await prisma.searchHistory.count({ where: { userId: user.id, normalized: "neu" } })).toBe(1);
  });
});

describe("Bulk-Fehler", () => {
  it("geben keine internen Meldungen preis", async () => {
    const user = await signUp();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(prisma.media, "findUnique").mockRejectedValueOnce(new Error("connect ECONNREFUSED db.intern:5432 geheim"));
    const result = await call<{ results: { ok: boolean; error?: string }[] }>(bulkPost, { user, body: { items: [{ kind: "movie", tmdbId: 672 }], action: "watched" } });
    spy.mockRestore();
    error.mockRestore();
    expect(result.data.results[0]?.ok).toBe(false);
    expect(result.data.results[0]?.error).toBe("Das hat nicht geklappt.");
  });
});

describe("Gleichzeitige Aktionen", () => {
  it("führen nie zu einem Serverfehler und bleiben konsistent", async () => {
    const user = await signUp();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => call<{ item: LibraryItem }>(libraryPost, { user, body: { kind: "movie", tmdbId: 674, action: "rating", value: 8 } })),
    );
    expect(results.map((result) => result.status)).toEqual(Array(6).fill(200));
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(1);
  });
});
