import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

function pgCtlPath() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const binary = process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl";
  return path.resolve("node_modules/@embedded-postgres", `${platform}-${process.arch}`, "native/bin", binary);
}

/**
 * Fährt die Test-Datenbank geordnet herunter. Unter Windows beendet Playwright den
 * Server hart, sodass die Abmeldung in `start-stack.ts` nicht mehr läuft.
 * `pg_ctl` trifft dabei nur die Instanz im eigenen Datenverzeichnis.
 */
export default function globalTeardown() {
  const root = path.resolve(".tmp");
  if (!existsSync(root)) return;

  for (const entry of readdirSync(root).filter((name) => name.startsWith("pg-e2e-"))) {
    const directory = path.join(root, entry);
    try {
      execFileSync(pgCtlPath(), ["stop", "-D", directory, "-m", "fast", "-w"], { stdio: "ignore", timeout: 20_000 });
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Läuft diese Instanz nicht mehr, gibt es nichts zu tun. Ein Rest stört nicht: Jeder Lauf hat eigenen Port und eigenes Verzeichnis.
    }
  }
}
