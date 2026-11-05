import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { startMockTmdb } from "../mock-tmdb/server";

const POSTGRES_PORT = 55433;
const TMDB_PORT = 54322;

/**
 * Echte PostgreSQL-Instanz ohne Docker und echter HTTP-Weg zum TMDB-Testserver.
 * Mit TEST_DATABASE_URL lässt sich stattdessen eine vorhandene Datenbank nutzen.
 */
export default async function setup() {
  const external = process.env.TEST_DATABASE_URL;
  let databaseUrl = external;
  let postgres: EmbeddedPostgres | null = null;

  if (!external) {
    // Eigenes Verzeichnis pro Lauf: Unter Windows blockieren Reste eines abgebrochenen Laufs
    // sonst den Speicherblock, der am Pfad des Datenverzeichnisses hängt.
    const dataDir = path.resolve(`.tmp/pg-integration-${process.pid}`);
    mkdirSync(path.dirname(dataDir), { recursive: true });
    postgres = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "kinora",
      password: "kinora",
      port: POSTGRES_PORT,
      persistent: false,
      // Unter Windows wählt initdb sonst WIN1252, und koreanische Titel scheitern.
      initdbFlags: ["--encoding=UTF8", "--locale=C"],
      onLog: () => undefined,
      onError: () => undefined,
    });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("kinora_test");
    databaseUrl = `postgresql://kinora:kinora@localhost:${POSTGRES_PORT}/kinora_test`;
  }

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" });
  const tmdb = await startMockTmdb(TMDB_PORT);

  return async () => {
    await tmdb.close();
    await postgres?.stop();
  };
}
