import { describe, expect, it, vi } from "vitest";
import { POST as authRoutePost } from "@/app/api/auth/[...all]/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db";
import { authCall, call, ORIGIN, PASSWORD, signUp, uniqueEmail } from "./helpers";

describe("Registrierung und Anmeldung", () => {
  it("legt ein Konto samt Einstellungen an und meldet direkt an", async () => {
    const user = await signUp("Nevio");
    expect(user.cookie).toContain("session_token");

    const preferences = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    expect(preferences).toMatchObject({ language: "de-DE", region: "CH", onboardingCompletedAt: null });

    const session = await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) });
    expect(session?.user.name).toBe("Nevio");
  });

  it("speichert das Passwort nur als Hash", async () => {
    const user = await signUp();
    const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id, providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
    expect(account.password!.length).toBeGreaterThan(60);
  });

  it("lehnt zu kurze Passwörter und doppelte E-Mails ab", async () => {
    const short = await authCall("/sign-up/email", { name: "A", email: uniqueEmail(), password: "kurz" });
    expect(short.ok).toBe(false);
    expect(((await short.json()) as { code: string }).code).toBe("PASSWORD_TOO_SHORT");

    const email = uniqueEmail();
    await signUp("A", email);
    const duplicate = await authCall("/sign-up/email", { name: "B", email, password: PASSWORD });
    expect(duplicate.ok).toBe(false);
  });

  it("meldet mit richtigem Passwort an und unterscheidet Fehler nicht nach Ursache", async () => {
    const user = await signUp();
    const good = await authCall("/sign-in/email", { email: user.email, password: PASSWORD });
    expect(good.ok).toBe(true);

    const wrong = await authCall("/sign-in/email", { email: user.email, password: "falsches-passwort-123" });
    const unknown = await authCall("/sign-in/email", { email: uniqueEmail("niemand"), password: "falsches-passwort-123" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(((await wrong.json()) as { code: string }).code).toBe(((await unknown.json()) as { code: string }).code);
  });

  it("setzt das Session-Cookie HttpOnly und SameSite=Lax", async () => {
    const user = await signUp();
    const response = await authCall("/sign-in/email", { email: user.email, password: PASSWORD });
    const cookie = response.headers.getSetCookie().find((entry) => entry.includes("session_token"));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("beendet die Session beim Abmelden", async () => {
    const user = await signUp();
    expect((await call(libraryGet, { user })).status).toBe(200);
    const out = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { Cookie: user.cookie, Origin: ORIGIN } }));
    expect(out.ok).toBe(true);
    expect((await call(libraryGet, { user })).status).toBe(401);
  });

  it("begrenzt Anmeldeversuche pro Adresse", async () => {
    const user = await signUp();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await authCall("/sign-in/email", { email: user.email, password: "falsches-passwort-123" }, { "x-forwarded-for": ip });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 8).every((status) => status === 401)).toBe(true);
    expect(statuses).toContain(429);
  });

  it("weist fremde Origins bei der Anmeldung ab, auch ohne Cookie", async () => {
    const user = await signUp();
    const request = (origin: string) =>
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, "x-forwarded-for": "203.0.113.250" },
        body: JSON.stringify({ email: user.email, password: PASSWORD }),
      });
    expect((await authRoutePost(request("https://boese.example"))).status).toBe(403);
    expect((await authRoutePost(request(ORIGIN))).status).toBe(200);
  });
});

describe("Passwort zurücksetzen", () => {
  it("ändert das Passwort über den Link und meldet andere Geräte ab", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const user = await signUp();

    const request = await authCall("/request-password-reset", { email: user.email, redirectTo: "/passwort-zuruecksetzen" });
    expect(request.ok).toBe(true);

    await vi.waitFor(() => expect(log.mock.calls.some(([line]) => String(line).includes(user.email))).toBe(true));
    const line = String(log.mock.calls.find(([entry]) => String(entry).includes(user.email))?.[0]);
    const url = /https?:\S+/.exec(line)?.[0];
    expect(url).toBeTruthy();
    log.mockRestore();

    const token = new URL(url as string).pathname.split("/").pop();
    const newPassword = "ein-ganz-neues-passwort";
    const reset = await authCall("/reset-password", { token, newPassword });
    expect(reset.ok).toBe(true);

    expect((await authCall("/sign-in/email", { email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await authCall("/sign-in/email", { email: user.email, password: newPassword })).ok).toBe(true);
    expect((await call(libraryGet, { user })).status).toBe(401);
  });

  it("antwortet für unbekannte Adressen gleich und verrät so kein Konto", async () => {
    const response = await authCall("/request-password-reset", { email: uniqueEmail("niemand"), redirectTo: "/passwort-zuruecksetzen" });
    expect(response.ok).toBe(true);
  });

  it("lehnt ungültige Tokens ab", async () => {
    const response = await authCall("/reset-password", { token: "ungueltig", newPassword: "ein-ganz-neues-passwort" });
    expect(response.ok).toBe(false);
  });
});

describe("Autorisierung der API", () => {
  it("verlangt für alle Bibliotheksrouten eine Session", async () => {
    expect((await call(libraryGet)).status).toBe(401);
    expect((await call(libraryPost, { body: { kind: "movie", tmdbId: 671, action: "watchlist", on: true } })).status).toBe(401);
  });

  it("lehnt ein gefälschtes Session-Cookie ab", async () => {
    const forged = { id: "x", email: "x", cookie: "better-auth.session_token=gefaelscht.signatur" };
    expect((await call(libraryGet, { user: forged })).status).toBe(401);
  });

  it("blockiert schreibende Anfragen von fremden Seiten, auch mit gültiger Session", async () => {
    const user = await signUp();
    const result = await call(libraryPost, {
      user,
      body: { kind: "movie", tmdbId: 671, action: "watchlist", on: true },
      origin: "https://boese.example",
    });
    expect(result.status).toBe(403);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(0);
  });

});
