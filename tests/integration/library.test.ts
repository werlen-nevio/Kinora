import { describe, expect, it } from "vitest";
import { POST as bulkPost } from "@/app/api/library/bulk/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import type { LibraryItem, LibraryState } from "@/lib/library-types";
import { prisma } from "@/server/db";
import { getWatchlist } from "@/server/library/service";
import { call, signUp, type TestUser } from "./helpers";

const HP1 = { kind: "movie", tmdbId: 671 } as const;
const HP2 = { kind: "movie", tmdbId: 672 } as const;
const BREAKING_BAD = { kind: "tv", tmdbId: 1396 } as const;

async function act(user: TestUser, body: object) {
  const result = await call<{ item: LibraryItem }>(libraryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data.item;
}

describe("Watchlist", () => {
  it("fügt hinzu, listet und entfernt", async () => {
    const user = await signUp();
    expect((await act(user, { ...HP1, action: "watchlist", on: true })).watchlisted).toBe(true);

    const rows = await getWatchlist(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "movie", tmdbId: 671, title: "Harry Potter und der Stein der Weisen", year: 2001, runtime: 152 });

    expect((await act(user, { ...HP1, action: "watchlist", on: false })).watchlisted).toBe(false);
    expect(await getWatchlist(user.id)).toHaveLength(0);
  });

  it("verträgt doppelte Aufrufe, etwa durch Doppelklick", async () => {
    const user = await signUp();
    await Promise.all([act(user, { ...HP1, action: "watchlist", on: true }), act(user, { ...HP1, action: "watchlist", on: true })]);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("legt pro Titel nur einen Medien-Snapshot an und trennt Film und Serie mit gleicher ID", async () => {
    const first = await signUp();
    const second = await signUp();
    await act(first, { ...HP1, action: "watchlist", on: true });
    await act(second, { ...HP1, action: "watchlist", on: true });
    expect(await prisma.media.count({ where: { type: "MOVIE", tmdbId: 671 } })).toBe(1);

    // TMDB-IDs sind nur je Typ eindeutig; 1396 existiert hier nur als Serie.
    await act(first, { ...BREAKING_BAD, action: "watchlist", on: true });
    expect((await call(libraryPost, { user: first, body: { kind: "movie", tmdbId: 1396, action: "watchlist", on: true } })).status).toBe(404);
  });

  it("speichert Besetzung und Regie für Statistik und Empfehlungen", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    const media = await prisma.media.findFirstOrThrow({ where: { type: "MOVIE", tmdbId: 671 }, include: { credits: { include: { person: true } } } });
    expect(media.collectionId).toBe(1241);
    expect(media.genreIds).toEqual([12, 14]);
    expect(media.credits.some((credit) => credit.role === "ACTOR" && credit.person.name === "Daniel Radcliffe")).toBe(true);
    expect(media.credits.some((credit) => credit.role === "DIRECTOR" && credit.person.name === "Chris Columbus")).toBe(true);
  });
});

describe("Sehstatus", () => {
  it("entfernt beim Sehen von der Watchlist und erfasst den Zeitpunkt", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    const item = await act(user, { ...HP1, action: "watched", on: true, watchedAt: "2026-03-10" });
    expect(item).toMatchObject({ watched: true, watchlisted: false, watchCount: 1 });
    expect(item.lastWatchedAt?.slice(0, 10)).toBe("2026-03-10");
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("speichert ohne Datum NULL und erfindet keinen Zeitpunkt", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watched", on: true, watchedAt: null });
    const history = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(history.watchedAt).toBeNull();
  });

  it("erfindet auch ohne jede Angabe kein Sehdatum", async () => {
    const user = await signUp();
    const item = await act(user, { ...HP1, action: "watched", on: true });
    const history = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(history.watchedAt).toBeNull();
    expect(item.lastWatchedAt).toBeNull();
  });

  it("räumt beim Zurücknehmen alles Abhängige auf", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "rating", value: 9 });
    await act(user, { ...HP1, action: "favorite", on: true });
    const item = await act(user, { ...HP1, action: "watched", on: false });
    expect(item).toMatchObject({ watched: false, rating: null, favorite: false, watchCount: 0, lastWatchedAt: null });
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.favorite.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("markiert beim «Nicht interessiert» ab und hebt es beim Vormerken wieder auf", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    expect(await act(user, { ...HP1, action: "notInterested", on: true })).toMatchObject({ notInterested: true, watchlisted: false });
    expect(await act(user, { ...HP1, action: "watchlist", on: true })).toMatchObject({ notInterested: false, watchlisted: true });
  });

  it("protokolliert Interaktionen", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    await act(user, { ...HP1, action: "rating", value: 8 });
    const types = (await prisma.userInteraction.findMany({ where: { userId: user.id } })).map((row) => row.type);
    expect(types).toEqual(expect.arrayContaining(["WATCHLIST_ADD", "RATED", "WATCHED", "WATCHLIST_REMOVE"]));
  });

  it("markiert Empfehlungen als veraltet und legt genau einen Job an", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    await act(user, { ...HP2, action: "watchlist", on: true });
    const state = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.dirtyAt).not.toBeNull();
    expect(await prisma.job.count({ where: { dedupeKey: `recs:${user.id}`, status: "PENDING" } })).toBe(1);
  });
});

describe("Bewertungen", () => {
  it("speichert, ändert und entfernt", async () => {
    const user = await signUp();
    expect((await act(user, { ...HP1, action: "rating", value: 7 })).rating).toBe(7);
    expect((await act(user, { ...HP1, action: "rating", value: 10 })).rating).toBe(10);
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(1);
    expect((await act(user, { ...HP1, action: "rating", value: null })).rating).toBeNull();
  });

  it("setzt beim Bewerten eines Films «gesehen» ohne Datum", async () => {
    const user = await signUp();
    const item = await act(user, { ...HP1, action: "rating", value: 8 });
    expect(item).toMatchObject({ watched: true, lastWatchedAt: null });
  });

  it("lehnt Werte ausserhalb von 1 bis 10 ab", async () => {
    const user = await signUp();
    for (const value of [0, 11, 8.25, "9"]) {
      const result = await call(libraryPost, { user, body: { ...HP1, action: "rating", value } });
      expect(result.status).toBe(400);
    }
  });

  it("sichert den Wertebereich zusätzlich in der Datenbank ab", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    const media = await prisma.media.findFirstOrThrow({ where: { type: "MOVIE", tmdbId: 671 } });
    await expect(prisma.rating.create({ data: { userId: user.id, mediaId: media.id, value: 11 } })).rejects.toThrow();
  });
});

describe("Eingaben und Fehler", () => {
  it("meldet ungültige Eingaben mit 400 und einer Meldung", async () => {
    const user = await signUp();
    const result = await call<{ error: { code: string; message: string } }>(libraryPost, { user, body: { kind: "movie", action: "watchlist" } });
    expect(result.status).toBe(400);
    expect(result.data.error.code).toBe("invalid_input");
  });

  it("meldet unbekannte Titel mit 404", async () => {
    const user = await signUp();
    expect((await call(libraryPost, { user, body: { kind: "movie", tmdbId: 99999999, action: "watchlist", on: true } })).status).toBe(404);
  });
});

describe("Bulk-Aktionen", () => {
  it("wendet eine Aktion auf mehrere Titel an und liefert den neuen Stand", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watchlist", on: true });
    await act(user, { ...HP2, action: "watchlist", on: true });

    const result = await call<{ results: { ok: boolean }[]; state: LibraryState }>(bulkPost, { user, body: { items: [HP1, HP2], action: "watched" } });
    expect(result.status).toBe(200);
    expect(result.data.results.every((entry) => entry.ok)).toBe(true);
    expect(result.data.state["movie:671"]).toMatchObject({ watched: true, watchlisted: false });
    expect(result.data.state["movie:672"]).toMatchObject({ watched: true, watchlisted: false });
  });

  it("berichtet einzelne Fehler, ohne den Rest abzubrechen", async () => {
    const user = await signUp();
    const result = await call<{ results: { key: string; ok: boolean }[] }>(bulkPost, {
      user,
      body: { items: [HP1, { kind: "movie", tmdbId: 99999998 }], action: "favorite" },
    });
    expect(result.data.results.find((entry) => entry.key === "movie:671")?.ok).toBe(true);
    expect(result.data.results.find((entry) => entry.key === "movie:99999998")?.ok).toBe(false);
  });

  it("begrenzt die Anzahl der Titel", async () => {
    const user = await signUp();
    const items = Array.from({ length: 101 }, (_, index) => ({ kind: "movie", tmdbId: index + 1 }));
    expect((await call(bulkPost, { user, body: { items, action: "watched" } })).status).toBe(400);
  });
});

describe("Bibliothekszustand", () => {
  it("liefert den Stand kompakt pro Titel", async () => {
    const user = await signUp();
    await act(user, { ...HP1, action: "watched", on: true });
    await act(user, { ...HP2, action: "watchlist", on: true });
    await act(user, { ...BREAKING_BAD, action: "favorite", on: true });
    const { data } = await call<LibraryState>(libraryGet, { user });
    expect(Object.keys(data).sort()).toEqual(["movie:671", "movie:672", "tv:1396"]);
    expect(data["tv:1396"]).toMatchObject({ favorite: true, watched: false, airedEpisodes: 62 });
  });
});
