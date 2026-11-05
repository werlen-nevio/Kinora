import { describe, expect, it } from "vitest";
import { GET as avatarGet } from "@/app/api/account/avatar/route";
import { GET as exportGet } from "@/app/api/account/export/route";
import { GET as libraryGet, POST as libraryPost } from "@/app/api/library/route";
import { POST as searchPost } from "@/app/api/search/route";
import { GET as historyGet } from "@/app/api/search/history/route";
import type { LibraryItem, LibraryState } from "@/lib/library-types";
import { auth } from "@/server/auth/auth";
import { prisma } from "@/server/db";
import { getWatchedEpisodeKeys, getWatchlist } from "@/server/library/service";
import { getRecommendationSections } from "@/server/recommender/service";
import { getUserStats } from "@/server/stats/service";
import { call, ORIGIN, PASSWORD, signUp, type TestUser } from "./helpers";

const HP1 = { kind: "movie", tmdbId: 671 } as const;
const BB = { kind: "tv", tmdbId: 1396 } as const;

async function act(user: TestUser, body: object) {
  const result = await call<{ item: LibraryItem }>(libraryPost, { user, body });
  expect(result.status).toBe(200);
  return result.data.item;
}

describe("Trennung der Benutzerdaten", () => {
  it("hält denselben Film für zwei Personen vollständig getrennt", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");

    await act(anna, { ...HP1, action: "rating", value: 10 });
    await act(anna, { ...HP1, action: "favorite", on: true });
    await act(ben, { ...HP1, action: "watchlist", on: true });

    const annaState = (await call<LibraryState>(libraryGet, { user: anna })).data;
    const benState = (await call<LibraryState>(libraryGet, { user: ben })).data;

    expect(annaState["movie:671"]).toMatchObject({ rating: 10, favorite: true, watched: true, watchlisted: false });
    expect(benState["movie:671"]).toMatchObject({ rating: null, favorite: false, watched: false, watchlisted: true });
  });

  it("zeigt einer neuen Person eine leere Bibliothek", async () => {
    const anna = await signUp();
    await act(anna, { ...HP1, action: "watched", on: true });
    const ben = await signUp();
    expect((await call<LibraryState>(libraryGet, { user: ben })).data).toEqual({});
    expect(await getWatchlist(ben.id)).toEqual([]);
  });

  it("trennt den Episodenfortschritt", async () => {
    const anna = await signUp();
    const ben = await signUp();
    await act(anna, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    expect(await getWatchedEpisodeKeys(anna.id, BB.tmdbId)).toEqual(["1:1"]);
    expect(await getWatchedEpisodeKeys(ben.id, BB.tmdbId)).toEqual([]);
  });

  it("ändert mit einer Aktion nie die Daten einer anderen Person", async () => {
    const anna = await signUp();
    const ben = await signUp();
    await act(ben, { ...HP1, action: "rating", value: 3 });
    await act(anna, { ...HP1, action: "rating", value: 10 });
    await act(anna, { ...HP1, action: "watched", on: false });
    const benState = (await call<LibraryState>(libraryGet, { user: ben })).data;
    expect(benState["movie:671"]).toMatchObject({ rating: 3, watched: true });
  });

  it("nimmt keine fremde Nutzer-ID aus der Anfrage an", async () => {
    const anna = await signUp();
    const ben = await signUp();
    const result = await call(libraryPost, { user: anna, body: { ...HP1, action: "watchlist", on: true, userId: ben.id } });
    expect(result.status).toBe(200);
    expect(await prisma.watchlistEntry.count({ where: { userId: ben.id } })).toBe(0);
    expect(await prisma.watchlistEntry.count({ where: { userId: anna.id } })).toBe(1);
  });

  it("trennt Statistiken", async () => {
    const anna = await signUp();
    const ben = await signUp();
    await act(anna, { ...HP1, action: "rating", value: 9 });
    expect(await getUserStats(anna.id)).toMatchObject({ moviesWatched: 1, ratingCount: 1, averageRating: 9 });
    expect(await getUserStats(ben.id)).toMatchObject({ moviesWatched: 0, ratingCount: 0, averageRating: null });
  });

  it("trennt Empfehlungen", async () => {
    const anna = await signUp();
    const ben = await signUp();
    await act(anna, { ...HP1, action: "rating", value: 10 });
    await act(anna, { kind: "movie", tmdbId: 120, action: "rating", value: 10 });
    expect((await getRecommendationSections(anna.id)).length).toBeGreaterThan(0);
    expect(await getRecommendationSections(ben.id)).toEqual([]);
    expect(await prisma.recommendationCache.count({ where: { userId: ben.id } })).toBe(0);
  });

  it("trennt die Suchhistorie", async () => {
    const anna = await signUp();
    const ben = await signUp();
    await call(searchPost, { user: anna, body: { query: "Harry Potter" } });
    expect((await call<{ queries: string[] }>(historyGet, { user: anna })).data.queries).toEqual(["Harry Potter"]);
    expect((await call<{ queries: string[] }>(historyGet, { user: ben })).data.queries).toEqual([]);
  });

  it("exportiert nur eigene Daten und keine Passwort-Hashes", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    await act(anna, { ...HP1, action: "rating", value: 10 });
    await act(ben, { ...BB, action: "favorite", on: true });

    const response = await exportGet(new Request(`${ORIGIN}/api/account/export`, { headers: { Cookie: anna.cookie } }));
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.user.email).toBe(anna.email);
    expect(data.ratings).toHaveLength(1);
    expect(data.favorites).toHaveLength(0);
    expect(text).not.toContain(ben.email);
    expect(text).not.toContain("Breaking Bad");
    expect(text).not.toMatch(/"password"/);
    expect(text).not.toMatch(/"token"/);
  });

  it("liefert ein Profilbild nur dem eigenen Konto", async () => {
    const anna = await signUp();
    await prisma.userAvatar.create({ data: { userId: anna.id, data: Buffer.from("x"), mimeType: "image/webp" } });
    const ben = await signUp();
    const request = (cookie: string) => new Request(`${ORIGIN}/api/account/avatar`, { headers: { Cookie: cookie } });
    expect((await avatarGet(request(anna.cookie))).status).toBe(200);
    expect((await avatarGet(request(ben.cookie))).status).toBe(404);
  });
});

describe("Konto löschen", () => {
  it("entfernt alle persönlichen Daten und lässt andere Konten unberührt", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    await act(anna, { ...HP1, action: "rating", value: 10 });
    await act(anna, { ...BB, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    await call(searchPost, { user: anna, body: { query: "geheim" } });
    await act(ben, { ...HP1, action: "rating", value: 5 });

    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/delete-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: anna.cookie },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    expect(response.ok, await response.clone().text()).toBe(true);

    const where = { where: { userId: anna.id } };
    const counts = await Promise.all([
      prisma.user.count({ where: { id: anna.id } }),
      prisma.session.count(where),
      prisma.account.count(where),
      prisma.userPreference.count(where),
      prisma.userMedia.count(where),
      prisma.rating.count(where),
      prisma.watchDiaryEntry.count(where),
      prisma.mediaSwipeInteraction.count(where),
      prisma.discoverySession.count(where),
      prisma.episodeProgress.count(where),
      prisma.watchlistEntry.count(where),
      prisma.favorite.count(where),
      prisma.recommendationCache.count(where),
      prisma.recommendationState.count(where),
      prisma.userInteraction.count(where),
      prisma.searchHistory.count(where),
    ]);
    expect(counts.every((count) => count === 0), counts.join(",")).toBe(true);

    // Der gemeinsame Titel und die Daten der anderen Person bleiben.
    expect((await call<LibraryState>(libraryGet, { user: ben })).data["movie:671"]).toMatchObject({ rating: 5 });
    expect(await prisma.media.count({ where: { type: "MOVIE", tmdbId: 671 } })).toBe(1);
  });

  it("verlangt das Passwort", async () => {
    const anna = await signUp();
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/delete-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: anna.cookie },
        body: JSON.stringify({ password: "falsches-passwort-123" }),
      }),
    );
    expect(response.ok).toBe(false);
    expect(await prisma.user.count({ where: { id: anna.id } })).toBe(1);
  });
});
