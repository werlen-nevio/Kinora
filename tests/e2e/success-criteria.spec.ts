// Die zehn Erfolgskriterien aus dem Auftrag, Schritt für Schritt im echten Browser.

import { expect, test } from "@playwright/test";
import { collectProblems, PASSWORD, rateViaApi, register, signIn, signOut, uniqueEmail, markSeen } from "./helpers";

test.describe.configure({ mode: "serial" });

const email = uniqueEmail("hauptkonto");

test("1. Registrieren und Profil einrichten", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/anmelden/);

  await register(page, "Mira", email);
  await expect(page.getByRole("heading", { name: /Welche Filme und Serien magst du, Mira/ })).toBeVisible();

  await page.getByRole("button", { name: "Vorerst überspringen" }).click();
  await page.waitForURL("/");

  await page.goto("/profil");
  const name = page.getByLabel("Anzeigename");
  await expect(name).toHaveValue("Mira");
  await name.fill("Mira L.");
  await page.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(page.getByText("Anzeigename gespeichert")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Anzeigename")).toHaveValue("Mira L.");
});

test("2. Harry Potter suchen und die Detailseite öffnen", async ({ page }) => {
  const problems = collectProblems(page);
  await signIn(page, email);

  await page.getByRole("button", { name: "Suche öffnen" }).click();
  const input = page.getByRole("combobox", { name: /suchen/ });
  await input.fill("Harry Potter");
  const option = page.getByRole("option", { name: /Stein der Weisen/ });
  await expect(option).toBeVisible();
  await option.click();

  await page.waitForURL("**/film/671");
  await expect(page.getByRole("heading", { level: 1, name: "Harry Potter und der Stein der Weisen" })).toBeVisible();
  await expect(page.getByText("Originaltitel: Harry Potter and the Philosopher's Stone")).toBeVisible();
  await expect(page.getByText("2 Std. 32 Min.").first()).toBeVisible();
  await expect(page.getByText("CH 6")).toBeVisible();
  await expect(page.getByRole("region", { name: "Handlung" })).toContainText("Hogwarts");
  await expect(page.getByRole("region", { name: "Verfügbarkeit" })).toContainText("Netflix");
  await expect(page.getByRole("region", { name: "Verfügbarkeit" })).toContainText("Angaben für die Schweiz");
  // Die Anbieter stehen auch im Kopf der Seite, der Link springt zur vollständigen Liste.
  await expect(page.getByRole("link", { name: "Alle Angebote", exact: true })).toHaveAttribute("href", "#verfuegbarkeit");
  await expect(page.getByRole("region", { name: "Technische Informationen" })).toContainText("Budget");
  expect(problems).toEqual([]);
});

test("3. Alle acht Filme der Reihe samt Fortschritt", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/film/671");

  const franchise = page.getByRole("region", { name: "Harry Potter Filmreihe" });
  await expect(franchise.getByText("0 von 8 Filmen gesehen")).toBeVisible();
  const links = franchise.getByRole("group", { name: /Filme der Reihe/ }).getByRole("link");
  await expect(links).toHaveCount(8);

  // Chronologisch, obwohl die API die Teile ungeordnet liefert.
  await expect(links.first()).toContainText("Stein der Weisen");
  await expect(links.nth(2)).toContainText("Askaban");
  await expect(links.last()).toContainText("Heiligtümer des Todes 2");

  await markSeen(page);
  await expect(franchise.getByText("1 von 8 Filmen gesehen")).toBeVisible();
  await expect(franchise.getByText("13 %")).toBeVisible();
  await expect(links.first()).toContainText("Gesehen");
  await expect(franchise.getByRole("link", { name: /Nächster Teil: Harry Potter und die Kammer des Schreckens/ })).toBeVisible();
});

test("4. Ähnliche und persönlich empfohlene Filme", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/film/671");

  await expect(page.getByRole("region", { name: "Ähnliche Filme" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mit Daniel Radcliffe" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Mehr aus der Wizarding World" })).toContainText("Phantastische Tierwesen");

  // Kein Titel doppelt, und der Film selbst steht nicht in seinen eigenen Empfehlungen.
  const rows = ["Ähnliche Filme", "Weitere Empfehlungen", "Mit Daniel Radcliffe", "Mit Rupert Grint", "Von Chris Columbus", "Mehr Abenteuer", "Mehr aus der Wizarding World"];
  const hrefs: string[] = [];
  for (const name of rows) {
    const region = page.getByRole("region", { name, exact: true });
    if ((await region.count()) === 0) continue;
    for (const link of await region.getByRole("heading").getByRole("link").all()) hrefs.push((await link.getAttribute("href")) as string);
  }
  expect(hrefs.length).toBeGreaterThan(0);
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(hrefs).not.toContain("/film/671");
});

test("5. Daniel Radcliffe und seine Filmografie", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/film/671");

  await page.getByRole("region", { name: "Besetzung" }).getByRole("link", { name: /Daniel Radcliffe/ }).click();
  await page.waitForURL("**/person/10980");

  await expect(page.getByRole("heading", { level: 1, name: "Daniel Radcliffe" })).toBeVisible();
  await expect(page.getByText("23. Juli 1989")).toBeVisible();
  await expect(page.getByText("Fulham, London, England")).toBeVisible();

  const filmography = page.getByRole("region", { name: "Filmografie" });
  await expect(filmography.getByText("11 Titel")).toBeVisible();
  await expect(filmography.getByRole("link", { name: /Swiss Army Man/ })).toBeVisible();

  // Sortierung: Älteste zuerst beginnt mit Harry Potter.
  await filmography.getByRole("combobox", { name: "Sortierung" }).click();
  await page.getByRole("option", { name: "Älteste zuerst" }).click();
  await expect(filmography.getByRole("listitem").first()).toContainText("Stein der Weisen");

  // Persönlich: Film 671 wurde oben als gesehen markiert.
  await expect(page.getByRole("region", { name: "Deine Bibliothek" })).toContainText("Von dir gesehen");
  // Verwandte Personen nennen gemeinsame Produktionen.
  await expect(page.getByRole("region", { name: "Gemeinsame Produktionen" })).toContainText("Emma Watson");
});

test("6. Watchlist und «Gesehen»", async ({ page }) => {
  await signIn(page, email);

  await page.goto("/film/672");
  await page.getByRole("button", { name: "Zur Watchlist", exact: true }).click();
  await expect(page.getByRole("button", { name: "Auf der Watchlist", exact: true })).toBeVisible();

  await page.goto("/film/27205");
  await page.getByRole("button", { name: "Zur Watchlist", exact: true }).click();
  await expect(page.getByRole("button", { name: "Auf der Watchlist", exact: true })).toBeVisible();

  await page.goto("/watchlist");
  await expect(page.getByText("2 Titel", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Inception", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Netflix" })).toHaveCount(2);

  // Sortieren und Filtern laufen ohne Neuladen.
  await page.getByRole("radiogroup", { name: "Darstellung" }).getByRole("radio", { name: "Liste" }).click();
  await expect(page.getByRole("link", { name: /Inception/ })).toBeVisible();
  await expect(page.getByRole("img", { name: "Netflix" })).toHaveCount(2);
  await page.getByRole("radiogroup", { name: "Darstellung" }).getByRole("radio", { name: "Raster" }).click();

  await page.goto("/film/672");
  await markSeen(page);
  await expect(page.getByRole("button", { name: "Gesehen", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zur Watchlist", exact: true })).toBeVisible();

  await page.goto("/watchlist");
  await expect(page.getByText("1 Titel", { exact: true })).toBeVisible();

  // Bulk-Aktion
  await page.getByRole("button", { name: "Auswählen" }).click();
  await page.getByRole("button", { name: "Alle auswählen" }).click();
  await expect(page.getByText("1 Titel ausgewählt")).toBeVisible();
  // Für viele Titel auf einmal bewusst ohne Dialog.
  await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
  await expect(page.getByText("Noch nichts vorgemerkt")).toBeVisible();
});

test("7. Bewertungen verändern die Empfehlungen", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/film/120");

  await page.getByRole("button", { name: "Persönlich bewerten" }).click();
  await page.getByRole("radio", { name: "10 von 10" }).click();
  await expect(page.getByRole("button", { name: /Deine Bewertung: 10 von 10/ })).toBeVisible();

  const forYou = page.getByRole("region", { name: "Für dich empfohlen" });
  const titles = async () => forYou.getByRole("heading", { level: 3 }).allInnerTexts();

  await rateViaApi(page, 671, 10);
  await rateViaApi(page, 121, 10);
  await rateViaApi(page, 673, 9);
  await rateViaApi(page, 157336, 2);

  await page.goto("/");
  await expect(forYou).toBeVisible({ timeout: 30_000 });
  const before = await titles();
  expect(before.length).toBeGreaterThan(3);
  // Die Begründung stammt aus echten Bewertungen.
  await expect(forYou.getByText(/Weil du .*(bewertet hast|magst)\./).first()).toBeVisible();

  for (const id of [155, 680, 278, 238, 496243]) await rateViaApi(page, id, 10);
  for (const id of [121, 122, 49051]) await rateViaApi(page, id, 1);

  // Neue Signale lösen eine Neuberechnung aus. Der Worker braucht dafür höchstens Sekunden.
  await expect(async () => {
    await page.goto("/");
    await expect(forYou).toBeVisible();
    expect(await titles()).not.toEqual(before);
  }).toPass({ timeout: 45_000, intervals: [2_000] });

  // Bewertetes erscheint nicht mehr als Empfehlung.
  const after = await titles();
  expect(after).not.toContain("Der Herr der Ringe: Die Gefährten");
});

test("8. Serien episodenweise tracken", async ({ page }) => {
  await signIn(page, email);
  await page.goto("/serie/95396/staffel/2");

  await expect(page.getByRole("heading", { level: 1, name: "Staffel 2" })).toBeVisible();
  await page.getByRole("button", { name: "Staffel 2, Episode 1 als gesehen markieren" }).click();
  await expect(page.getByRole("button", { name: "Staffel 2, Episode 1 nicht mehr als gesehen markieren" })).toBeVisible();
  await expect(page.getByText("1 von 4")).toBeVisible();

  // Künftige Folgen lassen sich nicht abhaken.
  await expect(page.getByText("Staffel 2, Episode 6: noch nicht ausgestrahlt")).toBeAttached();
  await expect(page.getByRole("button", { name: "Staffel 2, Episode 6 als gesehen markieren" })).toHaveCount(0);

  await page.getByRole("button", { name: "Staffel als gesehen markieren" }).click();
  await expect(page.getByRole("button", { name: "Staffel gesehen" })).toBeVisible();
  await expect(page.getByText("4 von 4")).toBeVisible();

  await page.goto("/serie/95396");
  const panel = page.getByRole("region", { name: "Dein Fortschritt" });
  await expect(panel.getByText("4 von 13 Episoden gesehen")).toBeVisible();
  await expect(panel.getByText("31 %")).toBeVisible();
  await expect(panel.getByText("2 weitere Episoden sind angekündigt und zählen nicht als offen.")).toBeVisible();

  await panel.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
  await expect(panel.getByText("5 von 13 Episoden gesehen")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Weiterschauen" })).toContainText("Severance");
});

test("9. Statistiken und Filmgeschmack", async ({ page }) => {
  const problems = collectProblems(page);
  await signIn(page, email);
  await page.goto("/statistiken");

  await expect(page.getByRole("heading", { level: 1, name: "Deine Statistiken" })).toBeVisible();
  await expect(page.getByText(/Du schaust am liebsten/)).toBeVisible();
  await expect(page.getByText("Filme gesehen")).toBeVisible();
  await expect(page.getByText("Episoden gesehen")).toBeVisible();
  await expect(page.getByRole("region", { name: "Sehaktivität nach Monaten" })).toContainText("ohne Datum zählen hier nicht mit");
  await expect(page.getByRole("region", { name: "Lieblingsgenres" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Deine Top 10" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Meistgesehene Regie" })).toContainText("Christopher Nolan");

  // Jede Grafik steht auch als Tabelle bereit.
  const genres = page.getByRole("region", { name: "Lieblingsgenres" });
  await genres.getByText("Als Tabelle anzeigen").click();
  await expect(genres.getByRole("table")).toBeVisible();
  expect(problems).toEqual([]);
});

test("10. Ein zweites Konto hat eine völlig eigene Bibliothek", async ({ page }) => {
  await signIn(page, email);
  await signOut(page);

  await register(page, "Zweitkonto");
  await page.getByRole("button", { name: "Vorerst überspringen" }).click();
  await page.waitForURL("/");

  await page.goto("/watchlist");
  await expect(page.getByText("Noch nichts vorgemerkt")).toBeVisible();

  await page.goto("/statistiken");
  await expect(page.getByRole("heading", { name: "Deine Statistik beginnt mit dem ersten Titel" })).toBeVisible();

  await page.goto("/film/671");
  await expect(page.getByRole("button", { name: "Als gesehen markieren", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Harry Potter Filmreihe" }).getByText("0 von 8 Filmen gesehen")).toBeVisible();

  await page.goto("/serie/95396");
  await expect(page.getByRole("region", { name: "Dein Fortschritt" }).getByText("0 von 13 Episoden gesehen")).toBeVisible();

  // Und das erste Konto hat seine Daten noch.
  await signOut(page);
  await signIn(page, email);
  await page.goto("/film/671");
  await expect(page.getByRole("region", { name: "Harry Potter Filmreihe" }).getByText(/[1-8] von 8 Filmen gesehen/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Gesehen", exact: true })).toBeVisible();
  expect(PASSWORD.length).toBeGreaterThan(9);
});
