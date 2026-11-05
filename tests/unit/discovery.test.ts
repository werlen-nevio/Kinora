import { describe, expect, it } from "vitest";
import { countActiveFilters, DEFAULT_DISCOVERY_FILTERS, discoveryFiltersSchema, type FilterableTitle, matchesBasicFilters, matchesDiscoveryFilters } from "@/lib/discovery";
import { type ActedItem, adaptPendingOrder, arrangeFranchises, type PendingItem, selectSessionItems, sessionGenreBias, skippedAfterRejection } from "@/server/discovery/selection";
import type { ScoredCandidate } from "@/server/recommender/types";
import { features } from "./fixtures";

const TITLE: FilterableTitle = { kind: "movie", genreIds: [14, 12], year: 2001, voteAverage: 7.9, originalLanguage: "en", runtime: 152, providerIds: [8, 337] };

function matches(patch: Partial<typeof DEFAULT_DISCOVERY_FILTERS>, title: Partial<FilterableTitle> = {}) {
  return matchesDiscoveryFilters({ ...TITLE, ...title }, { ...DEFAULT_DISCOVERY_FILTERS, ...patch });
}

describe("Filter", () => {
  it("lässt ohne Filter alles durch", () => {
    expect(matches({})).toBe(true);
    expect(countActiveFilters(DEFAULT_DISCOVERY_FILTERS)).toBe(0);
  });

  it("schliesst standardmässig Gesehenes und Watchlist aus", () => {
    expect(DEFAULT_DISCOVERY_FILTERS.excludeSeen).toBe(true);
    expect(DEFAULT_DISCOVERY_FILTERS.excludeWatchlist).toBe(true);
    expect(countActiveFilters({ ...DEFAULT_DISCOVERY_FILTERS, excludeSeen: false })).toBe(1);
  });

  it("prüft Art, Genre, Zeitraum, Bewertung und Sprache", () => {
    expect(matches({ kinds: "movie" })).toBe(true);
    expect(matches({ kinds: "tv" })).toBe(false);
    expect(matches({ genres: [14, 27] })).toBe(true);
    expect(matches({ genres: [27] })).toBe(false);
    expect(matches({ yearFrom: 2001, yearTo: 2001 })).toBe(true);
    expect(matches({ yearFrom: 2002 })).toBe(false);
    expect(matches({ yearTo: 2000 })).toBe(false);
    expect(matches({ ratingMin: 7.9 })).toBe(true);
    expect(matches({ ratingMin: 8 })).toBe(false);
    expect(matches({ language: "en" })).toBe(true);
    expect(matches({ language: "de" })).toBe(false);
  });

  it("prüft Laufzeit und Streaminganbieter", () => {
    expect(matches({ runtimeMax: 152 })).toBe(true);
    expect(matches({ runtimeMax: 120 })).toBe(false);
    expect(matches({ providers: [337] })).toBe(true);
    expect(matches({ providers: [9] })).toBe(false);
  });

  it("wertet fehlende Angaben bei einem aktiven Filter als nicht erfüllt", () => {
    expect(matches({ runtimeMax: 120 }, { runtime: null })).toBe(false);
    expect(matches({ yearFrom: 2000 }, { year: null })).toBe(false);
    expect(matches({ ratingMin: 5 }, { voteAverage: null })).toBe(false);
    expect(matches({ providers: [8] }, { providerIds: null })).toBe(false);
    // Ohne aktiven Filter stört die Lücke nicht.
    expect(matches({}, { runtime: null, year: null, voteAverage: null, providerIds: null })).toBe(true);
  });

  it("prüft die Trefferliste von TMDB ohne Detailabruf", () => {
    expect(matchesBasicFilters(TITLE, { ...DEFAULT_DISCOVERY_FILTERS, runtimeMax: 1, providers: [999] })).toBe(true);
    expect(matchesBasicFilters(TITLE, { ...DEFAULT_DISCOVERY_FILTERS, kinds: "tv" })).toBe(false);
  });

  it("validiert Eingaben und setzt Vorgaben", () => {
    expect(discoveryFiltersSchema.parse({})).toEqual(DEFAULT_DISCOVERY_FILTERS);
    expect(discoveryFiltersSchema.safeParse({ ratingMin: 11 }).success).toBe(false);
    expect(discoveryFiltersSchema.safeParse({ language: "deutsch" }).success).toBe(false);
    expect(discoveryFiltersSchema.safeParse({ genres: Array.from({ length: 13 }, (_, index) => index + 1) }).success).toBe(false);
  });
});

function scored(id: number, score: number, genreIds: number[], source = "tmdb_recommendations", collectionId: number | null = null): ScoredCandidate {
  const card = { kind: "movie" as const, tmdbId: id, title: `Film ${id}`, posterPath: null, backdropPath: null, releaseDate: null, year: 2015, voteAverage: 7, voteCount: 1000, popularity: 10, genreIds, overview: "", originalLanguage: "en" };
  return {
    card,
    features: features(id, { genreIds, collectionId }),
    provenance: [{ source, rank: 0 }],
    score,
    signals: {} as ScoredCandidate["signals"],
    breakdown: {} as ScoredCandidate["breakdown"],
    penalty: 0,
    reasons: [],
  };
}

describe("Session zusammenstellen", () => {
  const FANTASY = 14;
  const pool = [
    ...Array.from({ length: 40 }, (_, index) => scored(index + 1, 1 - index / 100, [FANTASY])),
    ...Array.from({ length: 12 }, (_, index) => scored(index + 100, 0.5 - index / 100, [18 + index])),
    ...Array.from({ length: 10 }, (_, index) => scored(index + 200, 0.3 - index / 100, [80 + index], "new_genres")),
  ];

  it("liefert keine Karte doppelt und hält die Grösse ein", () => {
    const items = selectSessionItems(pool, "FOR_YOU", 30);
    const ids = items.map((item) => item.features.tmdbId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(30);
  });

  it("mischt in «Für dich» bewusst etwas Unerwartetes dazu", () => {
    const items = selectSessionItems(pool, "FOR_YOU", 30);
    const explorers = items.filter((item) => item.provenance[0]?.source === "new_genres");
    expect(explorers.length).toBeGreaterThanOrEqual(2);
    // Die Entdeckungen sind verteilt und nicht am Ende gesammelt.
    expect(items.findIndex((item) => item.provenance[0]?.source === "new_genres")).toBeLessThan(15);
  });

  it("lässt kein Genre die ganze Session beherrschen", () => {
    const items = selectSessionItems(pool, "FOR_YOU", 30);
    const fantasy = items.filter((item) => item.features.genreIds.includes(FANTASY)).length;
    expect(fantasy).toBeLessThan(items.length);
    expect(fantasy).toBeGreaterThan(0);
  });

  it("zeigt in «Überrasch mich» deutlich mehr Entdeckungen als in «Für dich»", () => {
    const share = (mode: "FOR_YOU" | "SURPRISE") => selectSessionItems(pool, mode, 30).filter((item) => item.provenance[0]?.source === "new_genres").length;
    expect(share("SURPRISE")).toBeGreaterThan(share("FOR_YOU"));
  });

  it("kommt auch mit einem kleinen Pool zurecht", () => {
    expect(selectSessionItems(pool.slice(0, 3), "FOR_YOU", 30).length).toBeGreaterThan(0);
    expect(selectSessionItems([], "SURPRISE", 30)).toEqual([]);
  });
});

describe("Filmreihen", () => {
  it("hält Reihen zusammen, die beste zuerst, Teile in Reihenfolge", () => {
    const order = arrangeFranchises([
      { collectionId: 2, name: "B", parts: ["b1", "b2"], score: 0.4 },
      { collectionId: 1, name: "A", parts: ["a1", "a2", "a3"], score: 0.9 },
    ]);
    expect(order).toEqual(["a1", "a2", "a3", "b1", "b2"]);
  });

  it("überspringt nach einer Ablehnung nur die späteren Teile derselben Reihe", () => {
    const pending = [
      { position: 2, collectionId: 1 },
      { position: 3, collectionId: 1 },
      { position: 4, collectionId: 2 },
    ];
    expect(skippedAfterRejection({ position: 1, collectionId: 1 }, pending).map((item) => item.position)).toEqual([2, 3]);
    expect(skippedAfterRejection({ position: 1, collectionId: null }, pending)).toEqual([]);
  });
});

describe("Anpassung während der Session", () => {
  const FANTASY = 14;
  const HORROR = 27;
  const items = (genres: number[][]): PendingItem[] => genres.map((genreIds, rank) => ({ key: `k${rank}`, rank, genreIds, exploration: false }));
  const liked = (id: number, times = 1): ActedItem[] => Array.from({ length: times }, () => ({ genreIds: [id], outcome: "positive" }));
  const rejected = (id: number, times = 1): ActedItem[] => Array.from({ length: times }, () => ({ genreIds: [id], outcome: "negative" }));

  it("dämpft einzelne Entscheidungen", () => {
    expect(sessionGenreBias(liked(FANTASY)).get(FANTASY)).toBeCloseTo(1 / 3);
    expect(sessionGenreBias(liked(FANTASY, 8)).get(FANTASY)).toBeCloseTo(0.8);
    expect(sessionGenreBias(rejected(HORROR, 8)).get(HORROR)).toBeCloseTo(-0.8);
  });

  it("ändert ohne Entscheidungen nichts", () => {
    const pending = items([[1], [2], [3], [4], [5]]);
    expect(adaptPendingOrder(pending, [])).toEqual(pending.map((item) => item.key));
  });

  it("zieht Fantasy nach positiven Swipes nach vorne", () => {
    const pending = items([[1], [2], [3], [4], [5], [6], [7], [8], [9], [FANTASY]]);
    const order = adaptPendingOrder(pending, liked(FANTASY, 6));
    expect(order.indexOf("k9")).toBeLessThan(9);
    expect(order.indexOf("k9")).toBeGreaterThanOrEqual(3);
  });

  it("schiebt Horror nach Ablehnungen nach hinten, wirft es aber nicht hinaus", () => {
    const pending = items([[1], [2], [3], [HORROR], [5], [6], [7], [8], [9], [10]]);
    const order = adaptPendingOrder(pending, rejected(HORROR, 6));
    expect(order.indexOf("k3")).toBeGreaterThan(3);
    expect(order).toContain("k3");
  });

  it("tauscht die sichtbaren Karten des Stapels nie", () => {
    const pending = items([[HORROR], [HORROR], [HORROR], [1], [FANTASY], [FANTASY]]);
    const order = adaptPendingOrder(pending, [...rejected(HORROR, 8), ...liked(FANTASY, 8)]);
    expect(order.slice(0, 3)).toEqual(["k0", "k1", "k2"]);
  });

  it("lässt Entdeckungen auf ihrem Platz, auch bei abgelehntem Genre", () => {
    const pending: PendingItem[] = [...items([[1], [2], [3], [4]]), { key: "x", rank: 4, genreIds: [HORROR], exploration: true }, ...items([[5], [6]]).map((item, index) => ({ ...item, key: `n${index}`, rank: 5 + index }))];
    expect(adaptPendingOrder(pending, rejected(HORROR, 8)).indexOf("x")).toBe(4);
  });

  it("schaukelt sich nicht auf: gleiche Entscheidungen ergeben die gleiche Reihenfolge", () => {
    const pending = items([[1], [2], [3], [4], [5], [FANTASY], [7], [8]]);
    const first = adaptPendingOrder(pending, liked(FANTASY, 4));
    const reordered = first.map((key) => pending.find((item) => item.key === key) as PendingItem);
    expect(adaptPendingOrder(reordered, liked(FANTASY, 4)).slice(3)).toEqual(first.slice(3));
  });

  it("begrenzt lange Läufe eines Genres", () => {
    const pending = items([[1], [2], [3], [FANTASY], [FANTASY], [FANTASY], [FANTASY], [FANTASY], [9], [10]]);
    const order = adaptPendingOrder(pending, liked(FANTASY, 2));
    const genres = order.map((key) => pending.find((item) => item.key === key)?.genreIds[0]);
    let longest = 0;
    let run = 0;
    for (const genre of genres) {
      run = genre === FANTASY ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(3);
  });
});
