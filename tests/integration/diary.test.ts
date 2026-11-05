import { describe, expect, it } from "vitest";
import { DELETE as diaryDelete, GET as diaryGet, PATCH as diaryPatch, POST as diaryPost } from "@/app/api/diary/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import type { DiaryEntryView } from "@/lib/diary";
import type { LibraryItem, LibraryState } from "@/lib/library-types";
import { prisma } from "@/server/db";
import { getCompletableCollections, getContinueWatching, getFilmYear } from "@/server/home/rows";
import { getUserStats } from "@/server/stats/service";
import { call, signUp, type TestUser } from "./helpers";

interface DiaryResult {
  entry: DiaryEntryView;
  item: LibraryItem;
}

const HP1 = { kind: "movie", tmdbId: 671 } as const;
const BREAKING_BAD = { kind: "tv", tmdbId: 1396 } as const;

async function log(user: TestUser, body: object) {
  const result = await call<DiaryResult>(diaryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

async function edit(user: TestUser, body: object) {
  const result = await call<DiaryResult>(diaryPatch, { user, method: "PATCH", body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

const remove = (user: TestUser, id: string) => call<{ item: LibraryItem }>(diaryDelete, { user, method: "DELETE", path: `/api/diary?id=${id}` });

const entriesOf = async (user: TestUser, ref: { kind: string; tmdbId: number } = HP1) =>
  (await call<{ entries: DiaryEntryView[] }>(diaryGet, { user, path: `/api/diary?kind=${ref.kind}&tmdbId=${ref.tmdbId}` })).data.entries;

describe("Als gesehen markieren", () => {
  it("speichert ohne Bewertung und Datum, mit echtem NULL in der Datenbank", async () => {
    const user = await signUp();
    const { entry, item } = await log(user, HP1);
    expect(entry).toMatchObject({ watchedDate: null, watchedTime: null, rating: null, review: null, isRewatch: false });
    expect(item).toMatchObject({ watched: true, watchCount: 1, rating: null, lastWatchedAt: null });

    const row = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.watchedAt).toBeNull();
    expect(row.rating).toBeNull();
    expect(row.hasWatchTime).toBe(false);
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(0);
  });

  it("speichert Bewertung, Datum, Uhrzeit und Notiz", async () => {
    const user = await signUp();
    const { entry, item } = await log(user, { ...HP1, rating: 8.5, watchedAt: "2024-03-12", watchedTime: "20:15", review: "  Wie früher.  " });
    expect(entry).toMatchObject({ rating: 8.5, watchedDate: "2024-03-12", watchedTime: "20:15", review: "Wie früher." });
    expect(item.rating).toBe(8.5);
    expect(item.lastWatchedAt?.slice(0, 10)).toBe("2024-03-12");
    const row = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.watchedAt?.toISOString()).toBe("2024-03-12T20:15:00.000Z");
    expect(row.hasWatchTime).toBe(true);
  });

  it("merkt sich, ob eine Uhrzeit angegeben wurde", async () => {
    const user = await signUp();
    const { entry } = await log(user, { ...HP1, watchedAt: "2024-03-12" });
    expect(entry.watchedTime).toBeNull();
  });

  it("nimmt den Film von der Watchlist und hebt eine Ablehnung auf", async () => {
    const user = await signUp();
    await call(libraryPost, { user, body: { ...HP1, action: "watchlist", on: true } });
    const { item } = await log(user, HP1);
    expect(item).toMatchObject({ watched: true, watchlisted: false });
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(0);

    await call(libraryPost, { user, body: { kind: "movie", tmdbId: 672, action: "notInterested", on: true } });
    expect((await log(user, { kind: "movie", tmdbId: 672 })).item.notInterested).toBe(false);
  });

  it("lehnt ungültige Angaben ab", async () => {
    const user = await signUp();
    for (const body of [
      { ...HP1, rating: 8.25 },
      { ...HP1, rating: 0.5 },
      { ...HP1, watchedAt: "2999-01-01" },
      { ...HP1, watchedTime: "20:00" },
      { ...HP1, review: "x".repeat(2001) },
    ]) {
      expect((await call(diaryPost, { user, body })).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("verlangt eine Anmeldung", async () => {
    expect((await call(diaryPost, { body: HP1 })).status).toBe(401);
    expect((await call(diaryGet, {})).status).toBe(401);
  });

  it("markiert bei einer Serie alle ausgestrahlten Episoden", async () => {
    const user = await signUp();
    const { item } = await log(user, { ...BREAKING_BAD, rating: 9, watchedAt: "2024-01-01" });
    expect(item.episodesWatched).toBeGreaterThan(0);
    expect(item.seriesStatus).toBe("COMPLETED");
    expect(item.rating).toBe(9);
    const undated = await signUp();
    await log(undated, BREAKING_BAD);
    const episode = await prisma.episodeProgress.findFirstOrThrow({ where: { userId: undated.id } });
    expect(episode.watchedAt).toBeNull();
  });
});

describe("Einträge bearbeiten", () => {
  it("ändert einen alten Eintrag und ergänzt ein fehlendes Datum", async () => {
    const user = await signUp();
    const { entry } = await log(user, HP1);
    const { entry: updated, item } = await edit(user, { id: entry.id, watchedAt: "2019-07-01", watchedTime: "18:30", rating: 7.5, review: "Nachgetragen" });
    expect(updated).toMatchObject({ watchedDate: "2019-07-01", watchedTime: "18:30", rating: 7.5, review: "Nachgetragen" });
    expect(item.lastWatchedAt?.slice(0, 10)).toBe("2019-07-01");
    expect(item.rating).toBe(7.5);
  });

  it("kann Datum und Bewertung eines Eintrags wieder entfernen", async () => {
    const user = await signUp();
    const { entry } = await log(user, { ...HP1, rating: 8, watchedAt: "2020-01-01", watchedTime: "20:00" });
    const { entry: updated, item } = await edit(user, { id: entry.id, watchedAt: null, watchedTime: null, rating: null });
    expect(updated).toMatchObject({ watchedDate: null, watchedTime: null, rating: null });
    expect(item.lastWatchedAt).toBeNull();
    // Die Gesamtbewertung ist eine eigene Aussage und verschwindet nicht mit dem Eintrag.
    expect(item.rating).toBe(8);
    expect(item.watched).toBe(true);
  });

  it("verschiebt die Gesamtbewertung nicht, wenn nur eine Notiz geändert wird", async () => {
    const user = await signUp();
    const old = await log(user, { ...HP1, watchedAt: "2019-01-01", rating: 5 });
    await log(user, { ...HP1, watchedAt: "2024-01-01", rating: 9 });
    await call(libraryPost, { user, body: { ...HP1, action: "rating", value: null } });

    const { item } = await edit(user, { id: old.entry.id, review: "Eine Notiz" });
    expect(item.rating).toBeNull();
  });

  it("lässt nicht zu, einen Eintrag in die Zukunft zu verschieben", async () => {
    const user = await signUp();
    const { entry } = await log(user, HP1);
    expect((await call(diaryPatch, { user, method: "PATCH", body: { id: entry.id, watchedAt: "2999-01-01" } })).status).toBe(400);
  });
});

describe("Mehrfach ansehen", () => {
  it("führt mehrere Sehvorgänge und trennt sie von der Gesamtbewertung", async () => {
    const user = await signUp();
    await log(user, { ...HP1, watchedAt: "2024-03-12", rating: 9 });
    await log(user, { ...HP1, watchedAt: "2025-12-24", rating: 9.5 });
    const { item } = await log(user, HP1);

    expect(item).toMatchObject({ watched: true, watchCount: 3, rating: 9.5 });
    expect(item.lastWatchedAt?.slice(0, 10)).toBe("2025-12-24");

    const entries = await entriesOf(user);
    expect(entries.map((entry) => [entry.watchedDate, entry.rating])).toEqual([
      ["2025-12-24", 9.5],
      ["2024-03-12", 9],
      [null, null],
    ]);
    expect(entries.filter((entry) => entry.isRewatch)).toHaveLength(2);
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(1);
  });

  it("ändert die Gesamtbewertung nicht durch einen älteren Nachtrag", async () => {
    const user = await signUp();
    await log(user, { ...HP1, watchedAt: "2025-01-01", rating: 9 });
    const { item } = await log(user, { ...HP1, watchedAt: "2010-01-01", rating: 4 });
    expect(item.rating).toBe(9);
  });

  it("lässt eine direkt geänderte Gesamtbewertung die Einträge unberührt", async () => {
    const user = await signUp();
    await log(user, { ...HP1, watchedAt: "2024-01-01", rating: 7 });
    const { data } = await call<{ item: LibraryItem }>(libraryPost, { user, body: { ...HP1, action: "rating", value: 10 } });
    expect(data.item.rating).toBe(10);
    expect((await entriesOf(user))[0]?.rating).toBe(7);
  });

  it("bleibt gesehen, solange noch ein Eintrag übrig ist", async () => {
    const user = await signUp();
    const first = await log(user, { ...HP1, watchedAt: "2024-01-01", rating: 7 });
    const second = await log(user, { ...HP1, watchedAt: "2025-01-01", rating: 8 });

    const afterFirst = await remove(user, second.entry.id);
    expect(afterFirst.status).toBe(200);
    expect(afterFirst.data.item).toMatchObject({ watched: true, watchCount: 1 });
    expect(afterFirst.data.item.lastWatchedAt?.slice(0, 10)).toBe("2024-01-01");

    const afterLast = await remove(user, first.entry.id);
    expect(afterLast.data.item).toMatchObject({ watched: false, watchCount: 0, rating: null, lastWatchedAt: null });
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(0);
  });

  it("räumt beim Zurücknehmen von «gesehen» alle Einträge auf", async () => {
    const user = await signUp();
    await log(user, { ...HP1, rating: 8 });
    await log(user, HP1);
    await call(libraryPost, { user, body: { ...HP1, action: "watched", on: false } });
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(0);
    expect((await call<LibraryState>(libraryGet, { user })).data["movie:671"]).toMatchObject({ watched: false, watchCount: 0 });
  });

  it("legt bei gleichzeitigen ersten Einträgen keinen Widerspruch an", async () => {
    const user = await signUp();
    const results = await Promise.all(Array.from({ length: 5 }, () => call<DiaryResult>(diaryPost, { user, body: HP1 })));
    expect(results.map((result) => result.status)).toEqual(Array(5).fill(200));
    const count = await prisma.watchDiaryEntry.count({ where: { userId: user.id } });
    const summary = await prisma.userMedia.findFirstOrThrow({ where: { userId: user.id } });
    expect(summary.watchCount).toBe(count);
    expect(summary.watched).toBe(true);
  });
});

describe("Schnellimport", () => {
  it("trägt viele Filme ohne Zwischenschritte nach", async () => {
    const user = await signUp();
    const ids = [671, 672, 673, 674, 675, 767, 12444, 12445, 120, 121, 122, 49051, 57158, 122917, 259316, 338952, 338953, 411, 2270, 2493, 1417, 129, 128, 27205, 157336];
    for (const tmdbId of ids) await log(user, { kind: "movie", tmdbId });

    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id, watchedAt: null, rating: null } })).toBe(ids.length);
    const state = (await call<LibraryState>(libraryGet, { user })).data;
    expect(ids.every((tmdbId) => state[`movie:${tmdbId}`]?.watched)).toBe(true);

    const stats = await getUserStats(user.id);
    expect(stats.moviesWatched).toBe(ids.length);
    // Ohne Datum gehört keiner dieser Filme zu einem Monat, Jahr oder Tag.
    expect(stats.movieMonths.every((month) => month.count === 0)).toBe(true);
    expect(stats.movieYears).toEqual([]);
    expect(stats.activity.every((day) => day.count === 0)).toBe(true);
    expect(stats.undatedMovieEntries).toBe(ids.length);
    expect(stats.documentedMinutes).toBe(0);
    expect(stats.totalMinutes).toBeGreaterThan(0);
  });

  it("verkraftet parallele Klicks auf verschiedene Filme", async () => {
    const user = await signUp();
    const ids = [671, 672, 673, 674, 675, 767, 120, 121];
    const results = await Promise.all(ids.map((tmdbId) => call<DiaryResult>(diaryPost, { user, body: { kind: "movie", tmdbId } })));
    expect(results.map((result) => result.status)).toEqual(ids.map(() => 200));
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(ids.length);
  });

  it("lässt die Bewertung nachträglich ergänzen", async () => {
    const user = await signUp();
    const { entry } = await log(user, HP1);
    const { item } = await edit(user, { id: entry.id, rating: 9 });
    expect(item.rating).toBe(9);
    expect((await entriesOf(user))[0]).toMatchObject({ rating: 9, watchedDate: null });
  });
});

describe("Statistik", () => {
  it("zählt dokumentierte Sehzeit, Jahre und Wiederholungen nur aus echten Daten", async () => {
    const user = await signUp();
    const now = new Date();
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    await log(user, { ...HP1, watchedAt: thisMonth, rating: 8.5 });
    await log(user, { ...HP1, watchedAt: "2019-05-01" });
    await log(user, HP1);
    await log(user, { kind: "movie", tmdbId: 672 });

    const stats = await getUserStats(user.id);
    const runtime = (await prisma.media.findFirstOrThrow({ where: { type: "MOVIE", tmdbId: 671 } })).runtime ?? 0;
    expect(stats.documentedMinutes).toBe(2 * runtime);
    expect(stats.movieYears.find((year) => year.year === 2019)?.count).toBe(1);
    expect(stats.movieYears.find((year) => year.year === 2020)?.count).toBe(0);
    expect(stats.movieMonths.at(-1)?.count).toBe(1);
    expect(stats.undatedMovieEntries).toBe(2);
    expect(stats.rewatched).toEqual([expect.objectContaining({ tmdbId: 671, count: 3 })]);
    expect(stats.averageRating).toBe(8.5);
    expect(stats.ratings[15]).toEqual({ value: 8.5, count: 1 });
  });

  it("rechnet Tagebucheinträge von Serien nicht doppelt als Filmzeit", async () => {
    const user = await signUp();
    await log(user, { ...BREAKING_BAD, watchedAt: "2024-01-01" });
    const stats = await getUserStats(user.id);
    expect(stats.moviesWatched).toBe(0);
    expect(stats.movieYears).toEqual([]);
    expect(stats.undatedMovieEntries).toBe(0);
  });
});

describe("Startseite", () => {
  it("zählt im Filmjahr nur bestätigte Daten des laufenden Jahres", async () => {
    const user = await signUp();
    expect(await getFilmYear(user.id)).toBeNull();

    const year = new Date().getUTCFullYear();
    await log(user, { ...HP1, watchedAt: `${year}-01-02`, rating: 8 });
    await log(user, { ...HP1, watchedAt: `${year - 1}-12-31`, rating: 2 });
    await log(user, { kind: "movie", tmdbId: 672 });
    const filmYear = await getFilmYear(user.id);
    expect(filmYear).toMatchObject({ year, count: 1, averageRating: 8 });
    expect(filmYear?.posters).toHaveLength(1);
  });

  it("drängt in «Weiterschauen» keine Reihe auf, die durchgefallen ist", async () => {
    const user = await signUp();
    await log(user, { ...HP1, rating: 3 });
    await log(user, { kind: "movie", tmdbId: 120, rating: 9 });

    const titles = (await getContinueWatching(user.id, "de-DE")).map((item) => item.title).join();
    expect(titles).toContain("Herr der Ringe");
    expect(titles).not.toContain("Harry Potter");
    const completable = (await getCompletableCollections(user.id, "de-DE")).map((item) => item.name).join();
    expect(completable).toContain("Herr der Ringe");
    expect(completable).not.toContain("Harry Potter");
  });

  it("führt eine Reihe ohne Bewertung weiterhin auf", async () => {
    const user = await signUp();
    await log(user, HP1);
    expect((await getContinueWatching(user.id, "de-DE")).map((item) => item.title).join()).toContain("Harry Potter");
  });
});

describe("Benutzerisolierung", () => {
  it("zeigt und ändert keine Einträge anderer Personen", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    const { entry } = await log(anna, { ...HP1, rating: 9, review: "Privat" });

    // Ben sieht nichts davon, weder einzeln noch in der Gesamtliste.
    expect(await entriesOf(ben)).toEqual([]);
    const benList = await call<{ entries: DiaryEntryView[] }>(diaryGet, { user: ben, path: "/api/diary" });
    expect(benList.data.entries).toEqual([]);

    expect((await call(diaryPatch, { user: ben, method: "PATCH", body: { id: entry.id, rating: 1 } })).status).toBe(404);
    expect((await remove(ben, entry.id)).status).toBe(404);

    const annaEntries = await entriesOf(anna);
    expect(annaEntries).toHaveLength(1);
    expect(annaEntries[0]).toMatchObject({ rating: 9, review: "Privat" });
  });

  it("hält gleiche Filme zweier Personen getrennt", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    await log(anna, { ...HP1, rating: 10 });
    const { item } = await log(ben, { ...HP1, rating: 2 });
    expect(item.rating).toBe(2);
    expect((await call<LibraryState>(libraryGet, { user: anna })).data["movie:671"]?.rating).toBe(10);
  });
});
