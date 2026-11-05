import { expect, type Page, test } from "@playwright/test";
import { collectProblems, rateViaApi, register, signOut, uniqueEmail } from "./helpers";

async function api<T>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ method, url, body }) => {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    },
    { method, url, body },
  );
}

const diaryEntries = async (page: Page, tmdbId: number) => (await api<{ entries: Record<string, unknown>[] }>(page, "GET", `/api/diary?kind=movie&tmdbId=${tmdbId}`)).data.entries;

interface SessionData {
  session: { id: string; done: number; queue: { card: { title: string; tmdbId: number; kind: string } }[] } | null;
}

const sessionState = async (page: Page) => (await api<SessionData>(page, "GET", "/api/discovery")).data.session;

/** Startet eine Session für Filme und wartet auf die erste Karte. */
async function startDeck(page: Page) {
  await page.goto("/swipe");
  await page.getByRole("radio", { name: "Nur Filme" }).click();
  await page.getByRole("button", { name: "Swipe starten" }).click();
  await expect(page.getByRole("button", { name: "Letzte Aktion rückgängig machen" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Details zu / })).toBeVisible();
}

const topTitle = async (page: Page) => (await page.getByRole("link", { name: /^Details zu / }).getAttribute("aria-label"))?.replace("Details zu ", "") ?? "";

async function dragCard(page: Page, dx: number, dy: number) {
  const card = page.locator("article").filter({ has: page.locator("h2") }).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("Keine Karte sichtbar");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) await page.mouse.move(x + (dx * step) / 8, y + (dy * step) / 8);
  await page.mouse.up();
}

test.describe("Tagebuchdialog", () => {
  test("1. Film ohne Bewertung und Datum als gesehen markieren", async ({ page }) => {
    const problems = collectProblems(page);
    await register(page);
    await page.goto("/film/671");
    await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Wie hat dir der Film gefallen?" })).toBeVisible();
    await dialog.getByRole("button", { name: "Ohne weitere Angaben als gesehen markieren" }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Gesehen" })).toBeVisible();
    const [entry] = await diaryEntries(page, 671);
    expect(entry).toMatchObject({ watchedDate: null, rating: null, review: null });

    await page.goto("/tagebuch");
    const undated = page.getByRole("region", { name: "Datum unbekannt" });
    await expect(undated).toContainText("Harry Potter und der Stein der Weisen");
    expect(problems).toEqual([]);
  });

  test("2. Film mit halber Bewertung, Datum und Notiz speichern", async ({ page }) => {
    await register(page);
    await page.goto("/film/120");
    await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "8.5 von 10" }).click();
    await expect(dialog.getByRole("heading", { name: "Wann hast du den Film gesehen?" })).toBeVisible();

    // Mit den Pfeiltasten durch den Kalender, zukünftige Tage sind gesperrt.
    await dialog.getByRole("button", { name: "Vorheriger Monat" }).click();
    await dialog.getByRole("grid").getByRole("button").filter({ hasText: /^15$/ }).first().click();
    await dialog.getByRole("button", { name: "Uhrzeit ergänzen" }).click();
    await dialog.getByLabel("Uhrzeit").fill("21:30");
    await dialog.getByRole("button", { name: "Weiter", exact: true }).click();

    await dialog.getByPlaceholder("Was bleibt dir in Erinnerung?").fill("Immer noch gross.");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0);

    const [entry] = await diaryEntries(page, 120);
    expect(entry).toMatchObject({ rating: 8.5, watchedTime: "21:30", review: "Immer noch gross." });
    expect(String(entry?.watchedDate)).toMatch(/-15$/);

    const panel = page.getByRole("region", { name: "Deine Sehvorgänge" });
    await expect(panel).toContainText("Aktuelle Gesamtbewertung: 8.5 von 10");
    await expect(panel).toContainText("21:30 Uhr");
  });

  test("«Datum unbekannt» speichert auch mit Bewertung kein heutiges Datum", async ({ page }) => {
    await register(page);
    await page.goto("/film/671");
    await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "7 von 10" }).click();
    await dialog.getByRole("button", { name: "Datum unbekannt" }).click();
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0);
    const [entry] = await diaryEntries(page, 671);
    expect(entry).toMatchObject({ rating: 7, watchedDate: null });
  });

  test("Abbrechen speichert nichts", async ({ page }) => {
    await register(page);
    await page.goto("/film/671");
    await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
    await page.getByRole("dialog").getByRole("radio", { name: "7 von 10" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Als gesehen markieren", exact: true })).toBeVisible();
    expect(await diaryEntries(page, 671)).toEqual([]);
  });

  test("die Bewertungsskala ist vollständig per Tastatur bedienbar", async ({ page }) => {
    await register(page);
    await page.goto("/film/671");
    await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "7 von 10" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "7 von 10" })).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("radio", { name: "8.5 von 10" })).toHaveAttribute("aria-checked", "true");
    await expect(dialog.getByRole("radio", { name: "8.5 von 10" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("heading", { name: "Wann hast du den Film gesehen?" })).toBeVisible();
  });

  test("3. und 4. Alten Eintrag bearbeiten und denselben Film mehrfach ansehen", async ({ page }) => {
    await register(page);
    await page.goto("/film/671");

    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: "2024-03-12", rating: 9 });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: "2025-12-24", rating: 9.5 });
    await page.reload();

    await page.getByRole("button", { name: "Gesehen" }).click();
    await page.getByRole("menuitem", { name: "Weiteren Sehvorgang erfassen" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Bewertung überspringen" }).click();
    await dialog.getByRole("button", { name: "Datum unbekannt" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Erneut angesehen" })).toBeChecked();
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0);

    const panel = page.getByRole("region", { name: "Deine Sehvorgänge" });
    await expect(panel.getByRole("listitem")).toHaveCount(3);
    await expect(panel).toContainText("12. März 2024");
    await expect(panel).toContainText("24. Dezember 2025");
    await expect(panel).toContainText("Datum unbekannt");
    await expect(panel).toContainText("Aktuelle Gesamtbewertung: 9.5 von 10");

    // Den ältesten Eintrag bearbeiten: Die aktuelle Meinung bleibt.
    await panel.getByRole("button", { name: "Eintrag vom 12. März 2024 bearbeiten" }).click();
    const editor = page.getByRole("dialog");
    await editor.getByRole("radio", { name: "6 von 10" }).click();
    await editor.getByPlaceholder("Was bleibt dir in Erinnerung?").fill("Beim ersten Mal noch skeptisch.");
    await editor.getByRole("button", { name: "Speichern" }).click();
    await expect(editor).toHaveCount(0);
    await expect(panel).toContainText("Beim ersten Mal noch skeptisch.");
    await expect(panel).toContainText("Aktuelle Gesamtbewertung: 9.5 von 10");

    await page.goto("/tagebuch");
    await expect(page.getByRole("region", { name: "Jahr 2025" })).toContainText("9.5/10");
    await expect(page.getByRole("region", { name: "Jahr 2024" })).toContainText("6/10");
    await expect(page.getByRole("region", { name: "Datum unbekannt" })).toContainText("Harry Potter");
    await expect(page.getByText("Erneut angesehen").first()).toBeVisible();
  });
});

test.describe("Tagebuchseite", () => {
  test("filtert, zeigt den Kalender und führt unbekannte Daten getrennt", async ({ page }) => {
    await register(page);
    await page.goto("/tagebuch");
    await expect(page.getByRole("heading", { name: "Dein Tagebuch ist noch leer" })).toBeVisible();

    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: "2024-03-12", rating: 9 });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 27205, watchedAt: "2024-03-20" });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 120 });
    await page.reload();

    await expect(page.getByText("3 Einträge")).toBeVisible();

    await page.getByRole("combobox", { name: "Fehlende Angaben" }).click();
    await page.getByRole("option", { name: "Ohne Sehdatum" }).click();
    await expect(page.getByText("1 Eintrag von 3")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Der Herr der Ringe");
    await expect(page.getByRole("main")).not.toContainText("Inception");
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();

    await page.getByRole("combobox", { name: "Bewertung", exact: true }).click();
    await page.getByRole("option", { name: "Ab 8 von 10" }).click();
    await expect(page.getByText("1 Eintrag von 3")).toBeVisible();
    await page.getByRole("button", { name: "Filter zurücksetzen" }).click();

    await page.getByRole("radio", { name: "Kalender" }).click();
    await expect(page.getByRole("heading", { name: /2024/ })).toBeVisible();
    const day = page.getByRole("button", { name: /12\. März 2024: Harry Potter/ });
    await expect(day).toBeVisible();
    await day.click();
    await expect(page.getByRole("heading", { name: "12. März 2024" })).toBeVisible();
    // Ohne Datum steht der Film nur unten, in keinem Kalendertag.
    await expect(page.getByRole("grid").getByRole("button", { name: /Der Herr der Ringe/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Datum unbekannt" })).toContainText("Der Herr der Ringe");
  });

  test("Statistik zählt unbekannte Daten nicht als Monat oder Jahr", async ({ page }) => {
    await register(page);
    await page.goto("/statistiken");
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: "2024-03-12", rating: 8.5 });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: "2025-03-12" });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 120 });
    await page.reload();

    await expect(page.getByRole("region", { name: "Filme pro Jahr" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Filme pro Monat" })).toContainText("1 Sehvorgang ohne Datum zählt hier nicht mit");
    await expect(page.getByRole("region", { name: "Am häufigsten wieder geschaut" })).toContainText("Harry Potter");
    await expect(page.getByText("Dokumentierte Sehzeit")).toBeVisible();
    await expect(page.getByRole("region", { name: "Deine Bewertungen" }).getByRole("button", { name: "8.5: 1 Bewertung" })).toBeVisible();
  });
});

test.describe("Schnellimport", () => {
  test("5. Viele Filme ohne Dialoge nachtragen, einzeln ergänzen und zurücknehmen", async ({ page }) => {
    const problems = collectProblems(page);
    await register(page);
    await page.goto("/tagebuch/nachtragen");

    const tiles = page.getByRole("button", { name: /als gesehen nachtragen$/ });
    await expect(tiles.first()).toBeVisible();
    const total = Math.min(await tiles.count(), 12);
    for (let index = 0; index < total; index += 1) await tiles.first().click();

    await expect(page.getByText(`${total} Filme nachgetragen`)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await api<{ entries: unknown[] }>(page, "GET", "/api/diary")).data.entries.length).toBe(total);

    // Suchen, mit einem Klick nachtragen, dann optional bewerten.
    await page.getByRole("searchbox", { name: "Film suchen" }).fill("Swiss Army Man");
    await page.getByRole("button", { name: "Swiss Army Man als gesehen nachtragen" }).click();
    await expect(page.getByText(`${total + 1} Filme nachgetragen`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Swiss Army Man bewerten" })).toBeVisible();
    await expect.poll(async () => (await diaryEntries(page, 347031)).length).toBe(1);

    await page.getByRole("button", { name: "Swiss Army Man bewerten" }).click();
    await page.getByRole("radio", { name: "9.5 von 10" }).click();
    await expect.poll(async () => (await diaryEntries(page, 347031))[0]?.rating).toBe(9.5);
    await page.keyboard.press("Escape");

    expect((await diaryEntries(page, 347031))[0]).toMatchObject({ watchedDate: null });

    await page.getByRole("button", { name: "Swiss Army Man: nachgetragen, rückgängig machen" }).click();
    await expect.poll(async () => (await diaryEntries(page, 347031)).length).toBe(0);
    await expect(page.getByText(`${total} Filme nachgetragen`)).toBeVisible();

    // Mit der Tastatur: tippen, Enter, und der erste Treffer ist nachgetragen.
    await page.getByRole("searchbox", { name: "Film suchen" }).fill("Das letzte Grimoire");
    await expect(page.getByRole("button", { name: "Das letzte Grimoire als gesehen nachtragen" })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await diaryEntries(page, 6480)).length).toBe(1);

    await page.getByRole("link", { name: "Zum Tagebuch" }).click();
    await expect(page.getByRole("region", { name: "Datum unbekannt" })).toBeVisible();
    expect(problems).toEqual([]);
  });
});

test.describe("Swipe", () => {
  test("6. und 7. Rechts und links wischen aktualisiert Watchlist und Ablehnung", async ({ page }) => {
    const problems = collectProblems(page);
    await register(page);
    await rateViaApi(page, 671, 9);
    await startDeck(page);

    // Nur die oberste Karte zählt, die übrigen sind für Hilfstechnik ausgeblendet.
    await expect(page.getByRole("img", { name: "Netflix" })).toHaveCount(1);

    const liked = await topTitle(page);
    await dragCard(page, 340, 0);
    await expect.poll(() => topTitle(page)).not.toBe(liked);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    const rejected = await topTitle(page);
    await dragCard(page, -340, 0);
    await expect.poll(() => topTitle(page)).not.toBe(rejected);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(2);

    const library = (await api<Record<string, { watchlisted: boolean; notInterested: boolean }>>(page, "GET", "/api/library")).data;
    expect(Object.values(library).filter((item) => item.watchlisted)).toHaveLength(1);
    expect(Object.values(library).filter((item) => item.notInterested)).toHaveLength(1);

    await page.goto("/watchlist");
    await expect(page.getByRole("main")).toContainText(liked);
    expect(problems).toEqual([]);
  });

  test("ein kurzer Zug zählt nicht und die Karte bleibt", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const title = await topTitle(page);
    await dragCard(page, 50, 0);
    await page.waitForTimeout(400);
    expect(await topTitle(page)).toBe(title);
    expect((await sessionState(page))?.done).toBe(0);
  });

  test("8. Nach oben öffnet den Tagebuchdialog, erst Speichern zählt", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const title = await topTitle(page);

    await dragCard(page, 0, -320);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /gefallen\?$/ })).toBeVisible();
    await expect(dialog).toContainText(title);

    // Abbrechen: Die Karte ist noch dran.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(await topTitle(page)).toBe(title);
    expect((await sessionState(page))?.done).toBe(0);

    await dragCard(page, 0, -320);
    await dialog.getByRole("radio", { name: "8 von 10" }).click();
    await dialog.getByRole("button", { name: "Datum unbekannt" }).click();
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => topTitle(page)).not.toBe(title);
    await expect.poll(async () => (await api<{ entries: { title: string; rating: number; watchedDate: string | null }[] }>(page, "GET", "/api/diary")).data.entries[0]).toMatchObject({ title, rating: 8, watchedDate: null });
  });

  test("9. Rückgängig holt die Karte zurück und räumt auf", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const undoButton = page.getByRole("button", { name: "Letzte Aktion rückgängig machen" });
    await expect(undoButton).toBeDisabled();

    const title = await topTitle(page);
    await page.getByRole("button", { name: /Zur Watchlist/ }).click();
    await expect.poll(() => topTitle(page)).not.toBe(title);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    await undoButton.click();
    await expect.poll(() => topTitle(page)).toBe(title);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(0);
    const library = (await api<Record<string, { watchlisted: boolean }>>(page, "GET", "/api/library")).data;
    expect(Object.values(library).filter((item) => item.watchlisted)).toHaveLength(0);
  });

  test("die Tastatur steuert alles und ohne Touchscreen geht nichts verloren", async ({ page }) => {
    await register(page);
    await startDeck(page);

    const first = await topTitle(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => topTitle(page)).not.toBe(first);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    const second = await topTitle(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => topTitle(page)).not.toBe(second);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(2);

    await page.keyboard.press("u");
    await expect.poll(() => topTitle(page)).toBe(second);

    await page.keyboard.press("ArrowUp");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Solange der Dialog offen ist, bedient die Pfeiltaste die Skala und wischt keine Karte weg.
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByRole("radio", { name: "6.5 von 10" })).toHaveAttribute("aria-checked", "true");
    expect((await sessionState(page))?.done).toBe(1);
    await dialog.getByRole("button", { name: "Ohne weitere Angaben als gesehen markieren" }).click();
    await expect.poll(() => topTitle(page)).not.toBe(second);

    const current = await topTitle(page);
    await page.keyboard.press("i");
    await page.waitForURL(/\/(film|serie)\//);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(current);
  });

  test("11. Die Session bleibt nach der Detailseite und nach einem Neuladen erhalten", async ({ page }) => {
    await register(page);
    await startDeck(page);

    const first = await topTitle(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => topTitle(page)).not.toBe(first);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    const current = await topTitle(page);
    await page.getByRole("link", { name: `Details zu ${current}` }).click();
    await page.waitForURL(/\/(film|serie)\//);
    await page.goBack();
    await page.waitForURL("**/swipe");
    await expect.poll(() => topTitle(page)).toBe(current);
    await expect(page.getByText("1 von", { exact: false }).first()).toBeVisible();

    await page.reload();
    await expect.poll(() => topTitle(page)).toBe(current);
    expect(await page.getByRole("radio", { name: "Für dich" }).count()).toBe(0);
  });

  test("eine auf der Detailseite abgelehnte Karte ist nach der Rückkehr weg", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const title = await topTitle(page);
    await page.getByRole("link", { name: `Details zu ${title}` }).click();
    await page.waitForURL(/\/(film|serie)\//);
    await page.getByRole("button", { name: `Weitere Aktionen zu ${title}` }).click();
    await page.getByRole("menuitem", { name: "Nicht interessiert" }).click();
    await page.goBack();
    await page.waitForURL("**/swipe");
    await expect.poll(() => topTitle(page)).not.toBe(title);
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);
    expect((await sessionState(page))?.queue.map((item) => item.card.title)).not.toContain(title);
  });

  test("Einstellungen starten neue Karten mit den gewählten Filtern", async ({ page }) => {
    await register(page);
    await startDeck(page);
    await page.getByRole("button", { name: "Modus und Filter ändern" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: /Top bewertet/ }).click();
    await dialog.getByRole("button", { name: "Science Fiction" }).click();
    await dialog.getByRole("button", { name: "Neue Karten starten" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Modus und Filter ändern" })).toContainText("Top bewertet");

    await page.reload();
    await expect(page.getByRole("button", { name: "Modus und Filter ändern" })).toContainText("Top bewertet");
  });

  test("zu enge Filter führen zu einem klaren Hinweis statt zu einer leeren Seite", async ({ page }) => {
    await register(page);
    await page.goto("/swipe");
    await page.getByLabel("Von").fill("2099");
    await page.getByRole("button", { name: "Swipe starten" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Lockere die Filter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Swipe starten" })).toBeVisible();
  });

  test("abgelehnte Titel lassen sich im Profil zurücksetzen", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const title = await topTitle(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    await page.goto("/profil");
    const panel = page.getByRole("region", { name: "Abgelehnte Titel" });
    await expect(panel).toContainText(title);
    await panel.getByRole("button", { name: `${title} wieder vorschlagen` }).click();
    await expect(panel).toContainText("Du hast bisher nichts abgelehnt.");
  });

  test("Startseite zeigt Einstieg, Filmjahr, zuletzt Gesehenes und neue Entdeckungen", async ({ page }) => {
    await register(page);
    await startDeck(page);
    const liked = await topTitle(page);
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await sessionState(page))?.done).toBe(1);

    const today = new Date().toISOString().slice(0, 10);
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, watchedAt: today, rating: 9 });
    await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 120 });

    await page.goto("/");
    await expect(page.getByRole("region", { name: "Was schaust du als Nächstes?" }).getByRole("link", { name: "Weiter swipen" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Dein Filmjahr" })).toBeVisible();
    const recent = page.getByRole("region", { name: "Zuletzt gesehen" });
    await expect(recent).toContainText("Harry Potter");
    // Ohne Datum zählt ein Film nie als «zuletzt gesehen».
    await expect(recent).not.toContainText("Der Herr der Ringe");
    await expect(page.getByRole("region", { name: "Deine neuen Entdeckungen" })).toContainText(liked);
  });
});

test("12. Tagebuch und Swipes bleiben bei einer zweiten Person unsichtbar", async ({ page }) => {
  const email = uniqueEmail("anna");
  await register(page, "Anna", email);
  await api(page, "POST", "/api/diary", { kind: "movie", tmdbId: 671, rating: 9, review: "Nur für mich" });
  await startDeck(page);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sessionState(page))?.done).toBe(1);
  const annaSession = await sessionState(page);
  await signOut(page);

  await register(page, "Ben");
  await page.goto("/tagebuch");
  await expect(page.getByRole("heading", { name: "Dein Tagebuch ist noch leer" })).toBeVisible();
  expect(await sessionState(page)).toBeNull();
  expect((await api(page, "POST", "/api/discovery/undo", { sessionId: annaSession?.id })).status).toBe(404);
  await page.goto("/profil");
  await expect(page.getByRole("region", { name: "Abgelehnte Titel" })).toContainText("Du hast bisher nichts abgelehnt.");
});
