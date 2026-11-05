// Auf dem Handy dürfen weder Inhalte überlaufen noch Funktionen an Hover hängen.

import { expect, type Page, test } from "@playwright/test";
import { rateViaApi, register } from "./helpers";

const PAGES = ["/", "/tagebuch", "/tagebuch/nachtragen", "/swipe", "/entdecken", "/filme", "/serien", "/film/671", "/film/347031", "/filmreihe/1241", "/serie/95396", "/serie/95396/staffel/2", "/serie/95396/staffel/2/episode/1", "/person/10980", "/watchlist", "/statistiken", "/suche?typ=movie", "/profil", "/onboarding"];

async function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const element of document.querySelectorAll("main *, header *, footer *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= width + 1) continue;
      // Karussells scrollen absichtlich horizontal.
      if (element.closest(".reel")) continue;
      // Abgeschnittener Text (truncate) ragt nur rechnerisch hinaus, sichtbar ist er nicht.
      let clipped = false;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if ((overflowX === "hidden" || overflowX === "clip") && parent !== document.body && parent !== document.documentElement) clipped = true;
      }
      if (clipped) continue;
      offenders.push(`${element.tagName.toLowerCase()}.${String(element.getAttribute("class")).slice(0, 60)} rechts bei ${Math.round(rect.right)}`);
    }
    return { scroll: document.documentElement.scrollWidth - width, offenders: offenders.slice(0, 5) };
  });
}

test("Keine Seite läuft horizontal über", async ({ page }) => {
  test.setTimeout(240_000);
  await register(page, "Mobil");
  await rateViaApi(page, 671, 9);
  await rateViaApi(page, 120, 10);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const result = await overflow(page);
    expect(result, path).toEqual({ scroll: 0, offenders: [] });
  }
});

test("Untere Navigation führt zu den Hauptbereichen", async ({ page }) => {
  await register(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Hauptnavigation mobil" });
  await expect(nav).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Hauptnavigation", exact: true })).toBeHidden();
  await nav.getByRole("link", { name: "Watchlist" }).click();
  await page.waitForURL("**/watchlist");
  await expect(nav.getByRole("link", { name: "Watchlist" })).toHaveAttribute("aria-current", "page");
});

test("Watchlist-Knopf auf Karten ist ohne Hover erreichbar", async ({ page }) => {
  await register(page);
  await page.goto("/film/671");
  const add = page.getByRole("button", { name: /zur Watchlist hinzufügen/ }).first();
  await expect(add).toBeVisible();
  await add.tap();
  await expect(page.getByRole("button", { name: /von der Watchlist entfernen/ }).first()).toBeVisible();
});

test("Karussells lassen sich horizontal wischen", async ({ page }) => {
  await register(page);
  await page.goto("/film/671");
  const reel = page.getByRole("group", { name: /Filme der Reihe/ });
  await expect(reel).toBeVisible();
  const scrollable = await reel.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrollable).toBe(true);
});

test("Suche funktioniert auf dem Handy", async ({ page }) => {
  await register(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Suche öffnen" }).tap();
  await page.getByRole("combobox", { name: /suchen/ }).fill("Harry");
  await page.getByRole("option", { name: /Stein der Weisen/ }).tap();
  await page.waitForURL("**/film/671");
});

test("Episoden lassen sich auf dem Handy abhaken", async ({ page }) => {
  await register(page);
  await page.goto("/serie/95396/staffel/2");
  await page.getByRole("button", { name: "Staffel 2, Episode 1 als gesehen markieren" }).tap();
  await expect(page.getByRole("button", { name: "Staffel 2, Episode 1 nicht mehr als gesehen markieren" })).toBeVisible();
});

/** Wischt mit echten Touch-Ereignissen über die aktuelle Karte. */
async function touchSwipe(page: Page, dx: number, dy: number) {
  const card = page.locator("article").filter({ has: page.locator("h2") }).first();
  const box = await card.boundingBox();
  if (!box) throw new Error("Keine Karte sichtbar");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 3;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }] });
    await page.waitForTimeout(16);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const topCard = async (page: Page) => (await page.getByRole("link", { name: /^Details zu / }).getAttribute("aria-label")) ?? "";

test.describe("Swipe auf dem Handy", () => {
  test.beforeEach(async ({ page }) => {
    await register(page, "Mobil");
    await page.goto("/swipe");
    await page.getByRole("radio", { name: "Nur Filme" }).tap();
    await page.getByRole("button", { name: "Swipe starten" }).tap();
    await expect(page.getByRole("link", { name: /^Details zu / })).toBeVisible();
  });

  test("Karte, Knöpfe und Navigation passen in den Bildschirm", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    expect(await overflow(page)).toEqual({ scroll: 0, offenders: [] });
    // Der Startknopf liegt weit unten, die Karte muss danach trotzdem ganz im Bild sein.
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

    const viewport = page.viewportSize();
    const buttons = ["Nicht interessiert", "Bereits gesehen", "Zur Watchlist"];
    for (const name of buttons) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(box, name).not.toBeNull();
      // Über der unteren Navigation und gross genug für einen Finger.
      expect((box?.y ?? 0) + (box?.height ?? 0), name).toBeLessThanOrEqual((viewport?.height ?? 0) - 56);
      expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(44);
    }
    const card = await page.locator("article").filter({ has: page.locator("h2") }).first().boundingBox();
    expect(card?.width ?? 0).toBeGreaterThan(220);
  });

  test("Wischen nach rechts und links funktioniert per Touch", async ({ page }) => {
    const first = await topCard(page);
    await touchSwipe(page, 150, 0);
    await expect.poll(() => topCard(page)).not.toBe(first);

    const second = await topCard(page);
    await touchSwipe(page, -150, 0);
    await expect.poll(() => topCard(page)).not.toBe(second);

    const library = await page.evaluate(async () => (await fetch("/api/library")).json());
    const items = Object.values(library) as { watchlisted: boolean; notInterested: boolean }[];
    await expect.poll(async () => {
      const state = await page.evaluate(async () => (await fetch("/api/discovery")).json());
      return state.session.done;
    }).toBe(2);
    expect(items.some((item) => item.watchlisted)).toBe(true);
  });

  test("Wischen nach oben öffnet den Dialog und die Seite scrollt dabei nicht", async ({ page }) => {
    const before = await page.evaluate(() => window.scrollY);
    await touchSwipe(page, 0, -220);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= (viewport?.width ?? 0)).toBe(true);
    await dialog.getByRole("radio", { name: "8.5 von 10" }).tap();
    await expect(dialog.getByRole("heading", { name: /gesehen\?$/ })).toBeVisible();
    await dialog.getByRole("button", { name: "Datum unbekannt" }).tap();
    await dialog.getByRole("button", { name: "Speichern" }).tap();
    await expect(dialog).toHaveCount(0);
  });
});

test("Tagebuchdialog ist auf dem Handy vollständig bedienbar", async ({ page }) => {
  await register(page, "Mobil");
  await page.goto("/film/671");
  await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).tap();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "9 von 10" }).tap();
  await expect(dialog.getByRole("grid")).toBeVisible();
  const viewport = page.viewportSize();
  const save = dialog.getByRole("button", { name: "Weiter", exact: true });
  await save.scrollIntoViewIfNeeded();
  const box = await save.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
  await save.tap();
  await dialog.getByRole("button", { name: "Speichern" }).tap();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gesehen", exact: true })).toBeVisible();
});
