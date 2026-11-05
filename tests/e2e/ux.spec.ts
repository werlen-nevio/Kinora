// Querschnittsthemen: Tastatur, Fehlerfälle, Sicherheit, Onboarding und Konto.

import { expect, test } from "@playwright/test";
import { collectProblems, register, signIn, signOut, uniqueEmail, freshAddress } from "./helpers";

// Das kleinste gültige PNG: 1 × 1 Pixel. Prüft, ob sharp in der Produktionsausgabe lädt.
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==", "base64");

test("Profilbild: Hochladen läuft im Produktions-Build", async ({ page }) => {
  await register(page);
  await page.goto("/profil");
  await page.getByLabel("Profilbild auswählen").setInputFiles({ name: "bild.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText("Profilbild gespeichert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bild entfernen" })).toBeVisible();
});

test("Ambient-Licht: Die Farbe des Films wird im Produktions-Build berechnet", async ({ page }) => {
  await register(page);
  await page.goto("/film/671");
  await expect(page.locator('[style*="--ambient"]').first()).toHaveAttribute("style", /--ambient:\s*oklch/);
});

test("Onboarding: Nach fünf Bewertungen gibt es persönliche Reihen", async ({ page }) => {
  await register(page, "Neu");
  await expect(page.getByText(/Bewerte mindestens 5 Titel/)).toBeVisible();

  const rate = page.getByRole("button", { name: "Bewerten", exact: true });
  for (let index = 0; index < 5; index += 1) {
    await rate.first().click();
    await page.getByRole("radio", { name: "9 von 10" }).click();
    await expect(page.getByRole("radio", { name: "9 von 10" })).toHaveCount(0);
  }
  await expect(page.getByText(/ersten Empfehlungen sind bereit/)).toBeVisible();
  await page.getByRole("button", { name: "Zu meinen Empfehlungen" }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("region", { name: "Für dich empfohlen" })).toBeVisible({ timeout: 30_000 });
});

test("Onboarding: Überspringen blendet einen Titel aus", async ({ page }) => {
  await register(page);
  const skip = page.getByRole("button", { name: /überspringen$/ }).first();
  const label = (await skip.getAttribute("aria-label")) as string;
  await skip.click();
  await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
});

test("Suche: Tastatur, Verlauf und leere Ergebnisse", async ({ page }) => {
  await register(page);
  await page.getByRole("button", { name: "Vorerst überspringen" }).click();
  await page.waitForURL("/");

  // Tastenkürzel, erst nachdem die Seite interaktiv ist.
  await expect(async () => {
    await page.keyboard.press("/");
    await expect(page.getByRole("combobox", { name: /suchen/ })).toBeFocused({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  const input = page.getByRole("combobox", { name: /suchen/ });
  await input.fill("gibtesganzsichernicht");
  await expect(page.getByText(/gibt es keine Treffer/)).toBeVisible();

  await input.fill("Radcliffe");
  await expect(page.getByRole("option", { name: /Daniel Radcliffe/ })).toBeVisible();

  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", /.+/);
  await page.keyboard.press("Enter");
  await page.waitForURL("**/person/10980");

  await page.getByRole("button", { name: "Suche öffnen" }).click();
  await expect(page.getByText("Zuletzt gesucht")).toBeVisible();
  await expect(page.getByRole("option", { name: "Radcliffe" })).toBeVisible();
});

test("Suche: Enter führt zur Ergebnisseite, Filter wirken", async ({ page }) => {
  await register(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Suche öffnen" }).click();
  await page.getByRole("combobox", { name: /suchen/ }).fill("Hobbit");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/suche\?q=Hobbit/);
  await expect(page.getByRole("heading", { name: /Eine unerwartete Reise/ })).toBeVisible();

  await page.goto("/suche?typ=movie");
  await page.getByRole("button", { name: "Science Fiction", exact: true }).click();
  await page.getByRole("button", { name: "Filter anwenden" }).click();
  await page.waitForURL(/genres=878/);
  await expect(page.getByRole("heading", { name: "Interstellar", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Der Pate", exact: true })).toHaveCount(0);
});

test("Gäste landen auf der Anmeldung und danach am Ziel", async ({ page }) => {
  await page.goto("/film/671");
  await expect(page).toHaveURL(/\/anmelden\?weiter=%2Ffilm%2F671/);

  const email = await register(page, "Weiterleitung");
  await page.goto("/");
  await signOut(page);
  await page.goto("/film/671");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("ein-langes-testpasswort");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/film/671");
});

test("Offene Weiterleitungen sind ausgeschlossen", async ({ page }) => {
  const email = await register(page);
  await page.goto("/");
  await signOut(page);
  await page.goto("/anmelden?weiter=//evil.example");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("ein-langes-testpasswort");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((url) => url.hostname === "localhost" && url.pathname === "/");
});

test("Falsches Passwort zeigt eine verständliche Meldung", async ({ page }) => {
  await freshAddress(page);
  await page.goto("/anmelden");
  await page.getByLabel("E-Mail").fill(uniqueEmail("nicht-da"));
  await page.getByLabel("Passwort").fill("voellig-falsches-passwort");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("form").getByRole("alert")).toHaveText("E-Mail oder Passwort stimmt nicht.");
});

test("Unbekannte Titel führen zur 404-Seite", async ({ page }) => {
  await register(page);
  const response = await page.goto("/film/99999999");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Diese Seite gibt es nicht" })).toBeVisible();
  expect((await page.goto("/film/abc"))?.status()).toBe(404);
});

test("Sicherheits-Header und CSP sind gesetzt, die Seite läuft ohne Verstoss", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  const problems = collectProblems(page);
  await register(page);
  const response = await page.goto("/film/671");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toContain("nonce-");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
  await expect(page.getByRole("region", { name: "Besetzung" })).toBeVisible();
  expect(violations).toEqual([]);
  expect(problems).toEqual([]);
});

test("Kein TMDB-Token im ausgelieferten HTML oder JavaScript", async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (response) => {
    if (/javascript|html/.test(response.headers()["content-type"] ?? "")) bodies.push(await response.text().catch(() => ""));
  });
  await register(page);
  await page.goto("/film/671");
  await page.waitForLoadState("networkidle");
  expect(bodies.length).toBeGreaterThan(0);
  for (const body of bodies) {
    expect(body).not.toContain("kinora-test-token");
    expect(body).not.toContain("TMDB_READ_ACCESS_TOKEN");
    expect(body).not.toContain("api.themoviedb.org");
  }
});

test("Trailer lädt erst nach dem Klick und nur über die datensparsame Domain", async ({ page }) => {
  await register(page);
  await page.goto("/film/671");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Trailer ansehen", exact: true }).click();
  await expect(page.locator("iframe")).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\//);
  await page.keyboard.press("Escape");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("Filmlogos erscheinen als SVG und als PNG", async ({ page }) => {
  await register(page);
  for (const [path, title] of [["/film/27205", "Inception"], ["/film/157336", "Interstellar"]] as const) {
    await page.goto(path);
    const logo = page.getByRole("heading", { level: 1 }).getByRole("img", { name: title });
    await expect(logo).toBeVisible();
    await expect(async () => {
      expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }).toPass();
  }
});

test("Hero wechselt die Empfehlung und folgt der Auswahl", async ({ page }) => {
  await register(page);
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Empfehlung wählen" }).getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  const second = tabs.nth(1);
  const label = (await second.getAttribute("aria-label")) as string;
  const title = label.split(": ").slice(1).join(": ");
  await second.click();
  await expect(second).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible();
});

test("Nicht interessiert hält einen Titel aus den Empfehlungen fern", async ({ page }) => {
  await register(page);
  await page.goto("/film/121");
  await page.getByRole("button", { name: /Weitere Aktionen/ }).click();
  await page.getByRole("menuitem", { name: "Nicht interessiert" }).click();
  await expect(page.getByText("Wird dir nicht empfohlen")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Wird dir nicht empfohlen")).toBeVisible();
});

test("Datenexport und Konto löschen", async ({ page }) => {
  const email = await register(page, "Löschkonto");
  await page.goto("/film/671");
  await page.getByRole("button", { name: "Zur Watchlist", exact: true }).click();
  await expect(page.getByRole("button", { name: "Auf der Watchlist", exact: true })).toBeVisible();

  await page.goto("/profil");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Daten exportieren", exact: true }).click()]);
  expect(download.suggestedFilename()).toMatch(/^kinora-export-.*\.json$/);

  await page.getByRole("button", { name: "Konto löschen" }).click();
  await page.getByLabel("Dein Passwort zur Bestätigung").fill("ein-langes-testpasswort");
  await page.getByRole("dialog").getByRole("button", { name: "Konto löschen" }).click();
  await page.waitForURL("**/anmelden");

  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill("ein-langes-testpasswort");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
});

test("Sitzungsverwaltung zeigt das aktuelle Gerät", async ({ page }) => {
  await register(page);
  await page.goto("/profil");
  await expect(page.getByRole("region", { name: "Angemeldete Geräte" })).toContainText("Dieses Gerät");
});

test("Abmelden beendet den Zugriff", async ({ page }) => {
  const email = await register(page);
  await page.goto("/");
  await signOut(page);
  await page.goto("/watchlist");
  await expect(page).toHaveURL(/\/anmelden/);
  await signIn(page, email);
});
