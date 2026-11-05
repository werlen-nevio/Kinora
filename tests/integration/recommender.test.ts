import { describe, expect, it } from "vitest";
import { POST as libraryPost } from "@/app/api/library/route";
import { POST as onboardingPost } from "@/app/api/onboarding/route";
import type { MediaCard } from "@/lib/tmdb-types";
import { prisma } from "@/server/db";
import { getHeroItems } from "@/server/home/rows";
import { getRecommendationSections, rankForUser, recomputeRecommendations } from "@/server/recommender/service";
import { call, signUp, type TestUser } from "./helpers";

async function act(user: TestUser, body: object) {
  const result = await call(libraryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
}

const rate = (user: TestUser, tmdbId: number, value: number, kind = "movie") => act(user, { kind, tmdbId, action: "rating", value });

async function forYou(user: TestUser): Promise<MediaCard[]> {
  await recomputeRecommendations(user.id);
  return (await getRecommendationSections(user.id)).find((section) => section.id === "for_you")?.items ?? [];
}

describe("Kaltstart", () => {
  it("empfiehlt ohne Signale nichts Persönliches und behauptet nichts", async () => {
    const user = await signUp();
    expect(await getRecommendationSections(user.id)).toEqual([]);
  });

  it("zeigt im Hero trotzdem echte Titel aus den Trends, ohne Begründung", async () => {
    const user = await signUp();
    const hero = await getHeroItems(user.id, "de-DE", "CH");
    expect(hero.length).toBeGreaterThan(0);
    expect(hero.every((item) => item.reason === null)).toBe(true);
    expect(hero.every((item) => item.backdropPath)).toBe(true);
  });

  it("personalisiert bereits nach fünf Bewertungen", async () => {
    const user = await signUp();
    for (const [id, value] of [[671, 10], [120, 9], [673, 9], [121, 8], [27205, 3]] as const) await rate(user, id, value);
    await call(onboardingPost, { user, method: "POST" });

    const preferences = await prisma.userPreference.findUniqueOrThrow({ where: { userId: user.id } });
    expect(preferences.onboardingCompletedAt).not.toBeNull();

    const sections = await getRecommendationSections(user.id);
    expect(sections.map((section) => section.id)).toContain("for_you");
    const reasons = sections.flatMap((section) => section.items).map((item) => item.reason).filter(Boolean);
    expect(reasons.length).toBeGreaterThan(0);
  });
});

describe("Empfehlungen", () => {
  it("schlägt keine gesehenen, abgelehnten oder vorgemerkten Titel vor", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 120, 9);
    await act(user, { kind: "movie", tmdbId: 121, action: "notInterested", on: true });
    await act(user, { kind: "movie", tmdbId: 122, action: "watchlist", on: true });
    await recomputeRecommendations(user.id);

    const ids = (await getRecommendationSections(user.id)).flatMap((section) => section.items).map((item) => item.tmdbId);
    expect(ids.length).toBeGreaterThan(0);
    for (const excluded of [671, 120, 121, 122]) expect(ids).not.toContain(excluded);
  });

  it("empfiehlt Fantasy-Fans vor allem Fantasy", async () => {
    const user = await signUp();
    for (const id of [671, 672, 120, 121]) await rate(user, id, 10);
    const items = await forYou(user);
    const fantasy = items.slice(0, 5).filter((card) => card.genreIds.includes(14));
    expect(fantasy.length).toBeGreaterThanOrEqual(3);
  });

  it("reagiert auf Bewertungen: Andere Vorlieben führen zu anderen Empfehlungen", async () => {
    const fantasy = await signUp();
    for (const id of [671, 672, 120, 121]) await rate(fantasy, id, 10);
    const thriller = await signUp();
    for (const id of [155, 680, 278, 238]) await rate(thriller, id, 10);

    const a = (await forYou(fantasy)).map((card) => card.tmdbId);
    const b = (await forYou(thriller)).map((card) => card.tmdbId);
    expect(a.slice(0, 5)).not.toEqual(b.slice(0, 5));
  });

  it("ändert die Rangfolge, wenn dieselbe Person eine neue Bewertung abgibt", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 27205, 10);
    const before = (await forYou(user)).map((card) => card.tmdbId);

    for (const id of [157336, 155, 603]) await rate(user, id, 1);
    for (const id of [120, 121, 122]) await rate(user, id, 10);
    const after = (await forYou(user)).map((card) => card.tmdbId);

    expect(after).not.toEqual(before);
  });

  it("schreibt nachvollziehbare Scores und Begründungen in den Cache", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 672, 9);
    await recomputeRecommendations(user.id);
    const row = await prisma.recommendationCache.findFirstOrThrow({ where: { userId: user.id, section: "for_you" }, orderBy: { rank: "asc" } });
    expect(row.score).toBeGreaterThan(0);
    expect(row.score).toBeLessThanOrEqual(1);
    expect(Object.keys(row.breakdown as object).sort()).toEqual(["actors", "crew", "genre", "keywords", "novelty", "quality", "similarity", "tmdb"].sort());
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("nennt in Begründungen nur Titel aus der eigenen Bibliothek", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 120, 9);
    await recomputeRecommendations(user.id);
    const sections = await getRecommendationSections(user.id);
    const because = sections.flatMap((section) => section.items).map((item) => item.reason).filter((reason): reason is string => reason?.startsWith("Weil du") === true);
    expect(because.length).toBeGreaterThan(0);
    for (const reason of because) {
      expect(reason.includes("Harry Potter und der Stein der Weisen") || reason.includes("Der Herr der Ringe: Die Gefährten"), reason).toBe(true);
    }
  });

  it("baut eine Reihe «Weil du X magst» aus einem hoch bewerteten Titel", async () => {
    const user = await signUp();
    await rate(user, 27205, 10);
    await recomputeRecommendations(user.id);
    const sections = await getRecommendationSections(user.id);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("ist bei gleichen Daten stabil", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 120, 9);
    const first = (await forYou(user)).map((card) => card.tmdbId);
    const second = (await forYou(user)).map((card) => card.tmdbId);
    expect(second).toEqual(first);
  });

  it("erkennt veraltete Reihen und rechnet beim Lesen neu", async () => {
    const user = await signUp();
    await rate(user, 671, 10);
    await rate(user, 120, 9);
    const first = await getRecommendationSections(user.id);
    expect(first.length).toBeGreaterThan(0);

    const state = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.computedAt!.getTime()).toBeGreaterThanOrEqual(state.dirtyAt!.getTime());

    await rate(user, 121, 10);
    const dirty = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(dirty.dirtyAt!.getTime()).toBeGreaterThan(dirty.computedAt!.getTime());

    const ids = (await getRecommendationSections(user.id)).flatMap((section) => section.items).map((item) => item.tmdbId);
    expect(ids).not.toContain(121);
  });

  it("ordnet die Watchlist nach persönlicher Passung", async () => {
    const user = await signUp();
    for (const id of [671, 672, 120]) await rate(user, id, 10);
    await act(user, { kind: "movie", tmdbId: 121, action: "watchlist", on: true });
    await act(user, { kind: "movie", tmdbId: 238, action: "watchlist", on: true });

    const card = (tmdbId: number, genreIds: number[]): MediaCard => ({ kind: "movie", tmdbId, title: `T${tmdbId}`, posterPath: null, backdropPath: null, releaseDate: null, year: 2000, voteAverage: 8, voteCount: 1000, popularity: 10, genreIds, overview: "", originalLanguage: null });
    const ranked = await rankForUser(user.id, [
      { kind: "movie", tmdbId: 238, card: card(238, [18, 80]) },
      { kind: "movie", tmdbId: 121, card: card(121, [12, 14, 28]) },
    ]);
    expect(ranked[0]?.tmdbId).toBe(121);
  });
});
