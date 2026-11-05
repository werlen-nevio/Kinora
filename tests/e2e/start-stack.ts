// Startet alles für die End-to-End-Tests: echte Datenbank, TMDB-Testserver und den
// Produktions-Build, genau so, wie er auch im Docker-Image läuft.

import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { MOCK_TOKEN, startMockTmdb } from "../mock-tmdb/server";

const APP_PORT = 3101;
const TMDB_PORT = 54323;

const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(APP_PORT),
  HOSTNAME: "127.0.0.1",
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
  BETTER_AUTH_URL: `http://localhost:${APP_PORT}`,
  TMDB_READ_ACCESS_TOKEN: MOCK_TOKEN,
  TMDB_API_BASE_URL: `http://localhost:${TMDB_PORT}/3`,
  NEXT_PUBLIC_TMDB_IMAGE_BASE_URL: `http://localhost:${TMDB_PORT}/t/p`,
  // Der Testserver läuft ohne Mail-Dienst; der Test für das Zurücksetzen liest den Link aus dem Log.
  LOG_RESET_LINKS: "true",
};

function assertPortFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error(`Port ${port} ist belegt, vermutlich von einem abgebrochenen Testlauf. Beende den Prozess und starte neu.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

/** Ein vom System vergebener Port: Reste eines früheren Laufs können so nie im Weg stehen. */
function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function main() {
  await Promise.all([APP_PORT, TMDB_PORT].map(assertPortFree));
  const postgresPort = await findFreePort();
  env.DATABASE_URL = `postgresql://kinora:kinora@localhost:${postgresPort}/kinora_e2e`;

  // Eigenes Verzeichnis pro Lauf: Unter Windows blockieren Reste eines abgebrochenen Laufs
  // sonst den Speicherblock, der am Pfad des Datenverzeichnisses hängt.
  const dataDir = path.resolve(`.tmp/pg-e2e-${process.pid}`);
  mkdirSync(path.dirname(dataDir), { recursive: true });

  const postgres = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "kinora",
    password: "kinora",
    port: postgresPort,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => undefined,
    onError: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("kinora_e2e");
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  const tmdb = await startMockTmdb(TMDB_PORT);

  if (!process.env.E2E_SKIP_BUILD || !existsSync(".next/standalone/server.js")) {
    console.log("[e2e] Baue die Anwendung");
    execSync("npx next build", { env, stdio: "inherit" });
  }
  // Standalone enthält statische Dateien nicht; das Dockerfile kopiert sie genauso.
  cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
  cpSync("public", ".next/standalone/public", { recursive: true });

  const server = spawn(process.execPath, [".next/standalone/server.js"], { env, stdio: "inherit" });

  const shutdown = async () => {
    server.kill();
    await tmdb.close().catch(() => undefined);
    await postgres.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  server.on("exit", (code) => {
    console.log(`[e2e] Server beendet (${code})`);
    void shutdown();
  });
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
