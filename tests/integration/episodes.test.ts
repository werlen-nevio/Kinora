import { describe, expect, it } from "vitest";
import { POST as libraryPost } from "@/app/api/library/route";
import type { LibraryItem } from "@/lib/library-types";
import { computeProgress, todayIso } from "@/lib/series-progress";
import { prisma } from "@/server/db";
import { getContinueWatching } from "@/server/home/rows";
import { getLibraryItem, getWatchedEpisodeKeys } from "@/server/library/service";
import { getEpisodeIndex } from "@/server/tmdb/api";
import { call, signUp, type TestUser } from "./helpers";

// Breaking Bad: 62 ausgestrahlte Folgen. Severance: 15 Folgen, davon 2 in der Zukunft.
const BB = { kind: "tv", tmdbId: 1396 } as const;
const SEVERANCE = { kind: "tv", tmdbId: 95396 } as const;

async function act(user: TestUser, body: object) {
  const result = await call<{ item: LibraryItem }>(libraryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data.item;
}

describe("Episodentracking", () => {
  it("führt den Status von angefangen über am Schauen", async () => {
    const user = await signUp();
    expect(await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true })).toMatchObject({ seriesStatus: "STARTED", episodesWatched: 1, watched: false });
    expect(await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 2, on: true })).toMatchObject({ seriesStatus: "WATCHING", episodesWatched: 2 });
  });

  it("nimmt einzelne Episoden wieder zurück", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    expect(await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: false })).toMatchObject({ seriesStatus: null, episodesWatched: 0 });
  });

  it("markiert eine ganze Staffel", async () => {
    const user = await signUp();
    const item = await act(user, { ...BB, action: "season", seasonNumber: 1, on: true });
    expect(item.episodesWatched).toBe(7);
    expect((await getWatchedEpisodeKeys(user.id, BB.tmdbId)).sort()).toContain("1:7");
    expect(await act(user, { ...BB, action: "season", seasonNumber: 1, on: false })).toMatchObject({ episodesWatched: 0, seriesStatus: null });
  });

  it("schliesst die Serie ab, wenn alle Folgen gesehen sind", async () => {
    const user = await signUp();
    const item = await act(user, { ...BB, action: "watched", on: true });
    expect(item).toMatchObject({ seriesStatus: "COMPLETED", watched: true, episodesWatched: 62 });
  });

  it("entfernt eine begonnene Serie von der Watchlist", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "watchlist", on: true });
    expect(await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true })).toMatchObject({ watchlisted: false });
  });

  it("lehnt noch nicht ausgestrahlte Folgen ab", async () => {
    const user = await signUp();
    const result = await call<{ error: { code: string } }>(libraryPost, { user, body: { ...SEVERANCE, action: "episode", seasonNumber: 2, episodeNumber: 6, on: true } });
    expect(result.status).toBe(409);
    expect(result.data.error.code).toBe("not_aired");
    expect(await getLibraryItem(user.id, SEVERANCE)).toMatchObject({ episodesWatched: 0 });
  });

  it("lehnt Folgen ab, die es nicht gibt", async () => {
    const user = await signUp();
    expect((await call(libraryPost, { user, body: { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 99, on: true } })).status).toBe(404);
  });

  it("zählt beim Markieren einer laufenden Serie nur Ausgestrahltes", async () => {
    const user = await signUp();
    const item = await act(user, { ...SEVERANCE, action: "watched", on: true });
    const today = todayIso();
    const episodes = await getEpisodeIndex(SEVERANCE.tmdbId);
    const aired = episodes.filter((episode) => episode.airDate !== null && episode.airDate <= today);
    expect(episodes).toHaveLength(15);
    expect(aired).toHaveLength(13);
    expect(item).toMatchObject({ episodesWatched: 13, seriesStatus: "COMPLETED", airedEpisodes: 13 });
    // Die angekündigten Folgen bleiben ungesehen und gelten nicht als offen.
    const keys = new Set(await getWatchedEpisodeKeys(user.id, SEVERANCE.tmdbId));
    expect(computeProgress(episodes, keys, today)).toMatchObject({ caughtUp: true, percent: 100, next: null, total: 15, aired: 13 });
  });

  it("markiert in einer laufenden Staffel nur Ausgestrahltes", async () => {
    const user = await signUp();
    expect((await act(user, { ...SEVERANCE, action: "season", seasonNumber: 2, on: true })).episodesWatched).toBe(4);
  });

  it("pausiert und setzt mit der nächsten Folge automatisch fort", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 2, on: true });
    expect((await act(user, { ...BB, action: "pause", on: true })).seriesStatus).toBe("PAUSED");
    expect((await act(user, { ...BB, action: "pause", on: false })).seriesStatus).toBe("WATCHING");
    await act(user, { ...BB, action: "pause", on: true });
    expect((await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 3, on: true })).seriesStatus).toBe("WATCHING");
  });

  it("lässt sich vor der ersten Folge nicht pausieren", async () => {
    const user = await signUp();
    expect((await call(libraryPost, { user, body: { ...BB, action: "pause", on: true } })).status).toBe(409);
  });

  it("speichert die Laufzeit jeder Folge für die Sehzeit", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    expect((await prisma.episodeProgress.findFirstOrThrow({ where: { userId: user.id } })).runtime).toBe(47);
  });
});

describe("Weiterschauen", () => {
  it("zeigt begonnene Serien mit der nächsten Folge und dem Fortschritt", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "season", seasonNumber: 1, on: true });
    const [item] = await getContinueWatching(user.id, "de-DE");
    expect(item).toMatchObject({ kind: "tv", tmdbId: 1396, watched: 7, total: 62, percent: 11, paused: false });
    expect(item?.href).toBe("/serie/1396/staffel/2/episode/1");
    expect(item?.label).toContain("S2 E1");
  });

  it("zeigt Serien nicht mehr, wenn nur noch angekündigte Folgen fehlen", async () => {
    const user = await signUp();
    await act(user, { ...SEVERANCE, action: "watched", on: true });
    expect(await getContinueWatching(user.id, "de-DE")).toEqual([]);
  });

  it("zeigt pausierte Serien am Ende und markiert sie", async () => {
    const user = await signUp();
    await act(user, { ...BB, action: "season", seasonNumber: 1, on: true });
    await act(user, { ...BB, action: "pause", on: true });
    await act(user, { kind: "tv", tmdbId: 1399, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    const items = await getContinueWatching(user.id, "de-DE");
    expect(items.map((item) => item.tmdbId)).toEqual([1399, 1396]);
    expect(items[1]?.paused).toBe(true);
  });

  it("nimmt angefangene Filmreihen mit dem nächsten Teil auf", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "watched", on: true });
    const [item] = await getContinueWatching(user.id, "de-DE");
    expect(item).toMatchObject({ kind: "movie", tmdbId: 672, watched: 1, total: 8, href: "/film/672" });
  });
});
