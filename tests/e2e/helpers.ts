import { expect, type Page } from "@playwright/test";

export const PASSWORD = "ein-langes-testpasswort";

let counter = 0;
let addressCounter = Math.floor(Math.random() * 60_000);

export function uniqueEmail(prefix = "e2e") {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/**
 * Jeder Test kommt von einer eigenen Adresse, wie mehrere Personen in der Wirklichkeit.
 * Sonst greift das Rate Limiting (10 Registrierungen pro Stunde) zwischen den Tests.
 */
export async function freshAddress(page: Page) {
  addressCounter += 1;
  const first = (process.pid + addressCounter) % 250;
  const second = addressCounter % 250;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.${first}.${second + 1}` });
}

export async function register(page: Page, name = "Testperson", email = uniqueEmail()) {
  await freshAddress(page);
  await page.goto("/registrieren");
  await page.getByLabel("Anzeigename").fill(name);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(PASSWORD);
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/onboarding");
  return email;
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Profilmenü" }).click();
  await page.getByRole("menuitem", { name: "Abmelden" }).click();
  await page.waitForURL("**/anmelden");
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await freshAddress(page);
  await page.goto("/anmelden");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/anmelden"));
}

/** Der kürzeste Weg durch den Tagebuchdialog: gesehen, ohne weitere Angaben. */
export async function markSeen(page: Page) {
  await page.getByRole("button", { name: "Als gesehen markieren", exact: true }).click();
  await page.getByRole("button", { name: "Ohne weitere Angaben als gesehen markieren" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Direkt per API bewerten; schneller, wenn die Oberfläche nicht das Testziel ist. */
export async function rateViaApi(page: Page, tmdbId: number, value: number, kind: "movie" | "tv" = "movie") {
  const status = await page.evaluate(
    async (body) => {
      const response = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return response.status;
    },
    { kind, tmdbId, action: "rating", value },
  );
  expect(status).toBe(200);
}

export function collectProblems(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Ein 4xx, das der Test selbst auslöst, ist kein Fehler der Anwendung.
    if (/status of 4\d\d/.test(text)) return;
    // YouTube ist im Testnetz egal; alles andere soll auffallen.
    if (/ytimg|youtube/.test(text)) return;
    problems.push(`console: ${text}`);
  });
  return problems;
}
