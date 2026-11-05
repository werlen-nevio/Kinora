import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCHEMA = "migration_check";
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const read = (name: string) => readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8");

/**
 * Spielt die Migration auf Bestandsdaten, in einem eigenen Schema derselben Datenbank.
 * Geprüft wird das Wichtigste daran: dass kein Sehvorgang und keine Bewertung verloren geht.
 */
describe("Migration Tagebuch und Discovery", () => {
  let client: Client;

  const mediaId = (tmdbId: number) => `media-${tmdbId}`;

  beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA};`);
    await client.query(read("20261104124559_init"));

    await client.query(`
      INSERT INTO users (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('anna', 'Anna', 'anna@example.com', true, now(), now());
    `);
    for (const tmdbId of [1, 2, 3, 4]) {
      await client.query(`INSERT INTO media (id, type, "tmdbId", title) VALUES ($1, 'MOVIE', $2, $3)`, [mediaId(tmdbId), tmdbId, `Film ${tmdbId}`]);
    }
    const userMedia = (tmdbId: number, watched: boolean, count: number) =>
      client.query(`INSERT INTO user_media (id, "userId", "mediaId", watched, "watchCount", "createdAt", "updatedAt") VALUES ($1, 'anna', $2, $3, $4, now(), now())`, [`um-${tmdbId}`, mediaId(tmdbId), watched, count]);
    const history = (id: string, tmdbId: number, watchedAt: string | null) =>
      client.query(`INSERT INTO watch_history (id, "userId", "mediaId", "watchedAt", "createdAt") VALUES ($1, 'anna', $2, $3, $4)`, [id, mediaId(tmdbId), watchedAt, watchedAt ?? "2026-01-01"]);

    // Film 1: dreimal gesehen, einmal davon ohne Datum, mit Bewertung.
    await userMedia(1, true, 3);
    await history("h1", 1, "2024-03-12T00:00:00Z");
    await history("h2", 1, "2025-12-24T00:00:00Z");
    await history("h3", 1, null);
    await client.query(`INSERT INTO ratings (id, "userId", "mediaId", value, "createdAt", "updatedAt") VALUES ('r1', 'anna', $1, 9, now(), now())`, [mediaId(1)]);
    // Film 2: als gesehen markiert, aber ohne jeden Verlaufseintrag.
    await userMedia(2, true, 0);
    await client.query(`INSERT INTO ratings (id, "userId", "mediaId", value, "createdAt", "updatedAt") VALUES ('r2', 'anna', $1, 7, now(), now())`, [mediaId(2)]);
    // Film 3: nur auf der Watchlist, darf keinen Eintrag bekommen.
    await userMedia(3, false, 0);
    await client.query(`INSERT INTO watchlist_entries (id, "userId", "mediaId", "createdAt") VALUES ('w3', 'anna', $1, now())`, [mediaId(3)]);

    await client.query(read("20261104150748_diary_and_discovery"));
  }, 60_000);

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.end();
  });

  const entries = async (tmdbId: number) =>
    (await client.query(`SELECT to_char("watchedAt", 'YYYY-MM-DD') AS "watchedAt", rating, "isRewatch", "hasWatchTime" FROM watch_diary_entries WHERE "mediaId" = $1 ORDER BY "watchedAt" ASC NULLS LAST`, [mediaId(tmdbId)])).rows;

  it("übernimmt jeden Sehvorgang mit Datum und unbekanntem Datum", async () => {
    const rows = await entries(1);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.watchedAt)).toEqual(["2024-03-12", "2025-12-24", null]);
  });

  it("kennzeichnet genau einen Sehvorgang als Erstsichtung; ohne Datum gilt als der älteste", async () => {
    // Wie bei der Gesamtbewertung: Ein unbekanntes Datum liegt vermutlich vor den bekannten.
    expect((await entries(1)).map((row) => row.isRewatch)).toEqual([true, true, false]);
  });

  it("legt die Gesamtbewertung auf den jüngsten Sehvorgang und lässt sie selbst bestehen", async () => {
    const rows = await entries(1);
    expect(rows.map((row) => row.rating)).toEqual([null, 9, null]);
    expect((await client.query(`SELECT value FROM ratings WHERE id = 'r1'`)).rows[0].value).toBe(9);
  });

  it("gibt gesehenen Filmen ohne Verlauf einen Eintrag ohne erfundenes Datum", async () => {
    const rows = await entries(2);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ watchedAt: null, rating: 7, isRewatch: false });
    expect((await client.query(`SELECT "watchCount" FROM user_media WHERE id = 'um-2'`)).rows[0].watchCount).toBe(1);
  });

  it("legt für Ungesehenes nichts an und lässt die Watchlist in Ruhe", async () => {
    expect(await entries(3)).toEqual([]);
    expect(await entries(4)).toEqual([]);
    expect((await client.query(`SELECT count(*)::int AS count FROM watchlist_entries`)).rows[0].count).toBe(1);
  });

  it("entfernt die alte Tabelle erst nach der Übernahme", async () => {
    const { rows } = await client.query(`SELECT to_regclass('${SCHEMA}.watch_history') AS name`);
    expect(rows[0].name).toBeNull();
  });

  it("erzwingt die neuen Regeln in der Datenbank", async () => {
    const insert = (values: string) => client.query(`INSERT INTO watch_diary_entries (id, "userId", "mediaId", rating, "hasWatchTime", "watchedAt", review, "updatedAt") VALUES ${values}`);
    await expect(insert(`('x1', 'anna', '${mediaId(1)}', 8.25, false, NULL, NULL, now())`)).rejects.toThrow(/half_steps/);
    await expect(insert(`('x2', 'anna', '${mediaId(1)}', NULL, true, NULL, NULL, now())`)).rejects.toThrow(/time_needs_date/);
    await expect(insert(`('x3', 'anna', '${mediaId(1)}', NULL, false, NULL, repeat('x', 2001), now())`)).rejects.toThrow(/review_length/);
    await expect(client.query(`UPDATE ratings SET value = 8.25 WHERE id = 'r1'`)).rejects.toThrow(/half_steps/);
    await expect(client.query(`UPDATE ratings SET value = 8.5 WHERE id = 'r1'`)).resolves.toBeDefined();
  });

  it("erlaubt pro Person nur eine aktive Session", async () => {
    const insert = (id: string) => client.query(`INSERT INTO discovery_sessions (id, "userId", mode, state, "updatedAt") VALUES ($1, 'anna', 'FOR_YOU', 'ACTIVE', now())`, [id]);
    await insert("s1");
    await expect(insert("s2")).rejects.toThrow(/discovery_sessions_one_active/);
    await client.query(`UPDATE discovery_sessions SET state = 'ABANDONED' WHERE id = 's1'`);
    await expect(insert("s2")).resolves.toBeDefined();
  });
});
