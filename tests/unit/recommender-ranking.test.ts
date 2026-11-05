import { describe, expect, it } from "vitest";
import { describeTaste, joinTitles } from "@/server/recommender/explain";
import { buildProfile } from "@/server/recommender/profile";
import { byScore, diversify, type RankContext, scoreCandidate } from "@/server/recommender/ranking";
import { DEFAULT_WEIGHTS } from "@/server/recommender/scoring";
import { buildSections } from "@/server/recommender/sections";
import type { UserSignal } from "@/server/recommender/types";
import { candidate, scored, signal } from "./fixtures";

const NOW = new Date("2026-06-01");
const GENRES = new Map([[14, "Fantasy"], [12, "Abenteuer"], [27, "Horror"], [53, "Thriller"]]);

function context(signals: UserSignal[]): RankContext {
  return { profile: buildProfile(signals, [], NOW), weights: DEFAULT_WEIGHTS, now: NOW, genreNames: GENRES };
}

const FANTASY = { genreIds: [14, 12], keywordIds: [1, 2], castIds: [100], directorIds: [200] };

function fanSignals(): UserSignal[] {
  return [
    signal(1, 1, { ...FANTASY, title: "Harry Potter" }, { rating: 10 }),
    signal(2, 0.8, { ...FANTASY, title: "Der Herr der Ringe" }, { rating: 9 }),
    signal(3, 0.6, { ...FANTASY, title: "Der Hobbit" }, { rating: 8 }),
  ];
}

describe("scoreCandidate", () => {
  it("bewertet passende Titel höher als unpassende", () => {
    const ctx = context(fanSignals());
    const match = scoreCandidate(candidate(10, FANTASY), ctx);
    const other = scoreCandidate(candidate(11, { genreIds: [27], keywordIds: [9] }), ctx);
    expect(match.score).toBeGreaterThan(other.score);
  });

  it("ist deterministisch: gleiche Eingabe, gleiches Ergebnis", () => {
    const run = () => scoreCandidate(candidate(10, FANTASY), context(fanSignals()));
    expect(run().score).toBe(run().score);
    expect(run().reasons).toEqual(run().reasons);
  });

  it("verändert den Score, wenn sich eine Bewertung ändert", () => {
    const loved = scoreCandidate(candidate(10, FANTASY), context([signal(1, 1, FANTASY, { rating: 10 })]));
    const hated = scoreCandidate(candidate(10, FANTASY), context([signal(1, -1, FANTASY, { rating: 1 })]));
    expect(loved.score).toBeGreaterThan(hated.score);
    expect(hated.penalty).toBeGreaterThan(0);
  });

  it("führt in der Aufschlüsselung die Gewichte der Signale", () => {
    const result = scoreCandidate(candidate(10, FANTASY), context(fanSignals()));
    expect(result.breakdown.similarity).toBeCloseTo(result.signals.similarity * DEFAULT_WEIGHTS.similarity);
    const total = Object.values(result.breakdown).reduce((sum, value) => sum + value, 0);
    expect(result.score).toBeCloseTo(total * (1 - result.penalty));
  });
});

describe("Begründungen", () => {
  it("nennt nur Titel, die der Nutzer wirklich bewertet hat", () => {
    const result = scoreCandidate(candidate(10, FANTASY), context(fanSignals()));
    const similar = result.reasons.find((reason) => reason.type === "similar");
    expect(similar?.text).toMatch(/Weil du .*(hoch bewertet hast|mit .*\/10 bewertet hast)\./);
    expect(similar?.text).toMatch(/Harry Potter|Der Herr der Ringe|Der Hobbit/);
  });

  it("erfindet ohne Nutzersignale keine Begründung", () => {
    expect(scoreCandidate(candidate(10, FANTASY), context([])).reasons).toEqual([]);
  });

  it("gibt ohne inhaltliche Nähe keine Ähnlichkeitsbegründung", () => {
    const result = scoreCandidate(candidate(10, { genreIds: [27], keywordIds: [50] }), context(fanSignals()));
    expect(result.reasons.some((reason) => reason.type === "similar")).toBe(false);
  });

  it("behauptet kein Lieblingsgenre aus einem einzelnen Film", () => {
    const result = scoreCandidate(candidate(10, FANTASY), context([signal(1, 1, FANTASY, { rating: 10 })]));
    expect(result.reasons.some((reason) => reason.type === "genre")).toBe(false);
  });

  it("nennt Lieblingsschauspieler nur mit mehreren Belegen", () => {
    const provenance = [{ source: "people_credits", personId: 100, personName: "Daniel Radcliffe", personRole: "actor" as const }];
    const one = scoreCandidate(candidate(10, { castIds: [100] }, provenance), context([signal(1, 1, { castIds: [100] }, { rating: 10 })]));
    expect(one.reasons.some((reason) => reason.type === "actor")).toBe(false);
    const many = scoreCandidate(candidate(10, { castIds: [100] }, provenance), context(fanSignals()));
    expect(many.reasons.find((reason) => reason.type === "actor")?.text).toContain("Daniel Radcliffe");
  });

  it("verknüpft Titel in natürlicher Sprache", () => {
    expect(joinTitles(["A"])).toBe("A");
    expect(joinTitles(["A", "B"])).toBe("A und B");
    expect(joinTitles(["A", "B", "C"])).toBe("A, B und C");
  });

  it("beschreibt den Geschmack nur bei ausreichender Datenlage", () => {
    expect(describeTaste(buildProfile([], [], NOW), GENRES)).toBeNull();
    const many = Array.from({ length: 6 }, (_, index) => signal(index + 1, 1, { genreIds: [14], year: 2003 }));
    expect(describeTaste(buildProfile(many, [], NOW), GENRES)).toContain("Fantasy");
  });
});

describe("diversify", () => {
  it("hält Grenzen pro Filmreihe ein", () => {
    const items = Array.from({ length: 8 }, (_, index) => scored(index + 1, 0.9 - index * 0.01, { collectionId: 1241 }));
    items.push(scored(50, 0.3), scored(51, 0.25));
    const result = diversify(items, { limit: 6, maxPerCollection: 2 });
    expect(result.filter((item) => item.features.collectionId === 1241)).toHaveLength(2);
  });

  it("zieht Abwechslung knapp besseren Dubletten vor", () => {
    const shared = { genreIds: [14], keywordIds: [1, 2, 3] };
    const items = [scored(1, 0.8, shared), scored(2, 0.79, shared), scored(3, 0.74, { genreIds: [53], keywordIds: [9] })];
    expect(diversify(items, { limit: 2 }).map((item) => item.features.tmdbId)).toEqual([1, 3]);
  });

  it("begrenzt die Liste und bleibt bei Gleichstand stabil", () => {
    const items = [scored(3, 0.5), scored(1, 0.5), scored(2, 0.5)];
    expect([...items].sort(byScore).map((item) => item.features.tmdbId)).toEqual([1, 2, 3]);
    expect(diversify(items, { limit: 2 })).toHaveLength(2);
  });

  it("verkraftet leere Listen", () => {
    expect(diversify([], { limit: 5 })).toEqual([]);
  });
});

describe("buildSections", () => {
  const seedKey = "movie:1";
  const pool = Array.from({ length: 40 }, (_, index) => {
    const id = index + 100;
    const source = index % 2 === 0 ? "tmdb_recommendations" : "hidden_gems";
    return scored(id, 1 - index * 0.01, { ...FANTASY, voteCount: 800, castIds: [100 + index], directorIds: [] }, [
      { source, seedKey: index % 2 === 0 ? seedKey : undefined, seedWeight: 1, rank: index },
      ...(index % 4 === 0 ? [{ source: "people_credits", personId: 1, personName: "Daniel Radcliffe", personRole: "actor" as const }] : []),
    ]);
  });
  const input = (signals: UserSignal[], items = pool) => ({ scored: items, profile: buildProfile(signals, [], NOW), genreNames: GENRES, now: NOW });

  it("erzeugt persönliche Reihen, in denen jeder Titel nur einmal vorkommt", () => {
    const sections = buildSections(input(fanSignals()));
    expect(sections.map((section) => section.id)).toContain("for_you");
    const ids = sections.flatMap((section) => section.items.map((item) => item.features.tmdbId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lässt eine Reihe weg, statt sie mit Wiederholungen zu füllen", () => {
    // Alle Titel teilen ein Genre: «Für dich» nimmt 12, für weitere Reihen bleiben 2.
    const sections = buildSections(input(fanSignals(), pool.slice(0, 14)));
    expect(sections.map((section) => section.id)).toEqual(["for_you"]);
  });

  it("gibt späteren Reihen noch freie Kandidaten, auch wenn «Für dich» die besten nimmt", () => {
    const sections = buildSections(input(fanSignals()));
    const forYou = new Set(sections.find((section) => section.id === "for_you")?.items.map((item) => item.features.tmdbId));
    const because = sections.find((section) => section.id.startsWith("because:"));
    expect(because?.items.length).toBeGreaterThanOrEqual(4);
    expect(because?.items.every((item) => !forYou.has(item.features.tmdbId))).toBe(true);
  });

  it("baut «Weil du X magst» nur aus starken Signalen", () => {
    expect(buildSections(input([signal(1, 0.3, FANTASY)])).some((section) => section.id.startsWith("because:"))).toBe(false);

    const because = buildSections(input(fanSignals())).find((section) => section.id === `because:${seedKey}`);
    expect(because?.title).toBe("Weil du Harry Potter magst");
    expect(because?.emphasis).toBe("Harry Potter");
    expect(because?.items[0]?.reasons[0]?.text).toContain("Harry Potter");
  });

  it("zeigt zu kurze Reihen gar nicht erst", () => {
    expect(buildSections(input(fanSignals(), pool.slice(0, 2)))).toEqual([]);
  });

  it("bietet pro noch nicht begonnener Filmreihe nur den frühesten Teil an", () => {
    const franchise = [
      scored(300, 0.9, { collectionId: 7, collectionName: "Neue Reihe", year: 2010 }),
      scored(301, 0.95, { collectionId: 7, collectionName: "Neue Reihe", year: 2005 }),
      scored(302, 0.8, { collectionId: 8, collectionName: "Zweite Reihe", year: 2001 }),
      scored(303, 0.7, { collectionId: 9, collectionName: "Dritte Reihe", year: 2001 }),
      scored(304, 0.6, { collectionId: 10, collectionName: "Vierte Reihe", year: 2001 }),
      scored(305, 0.5, { collectionId: 11, collectionName: "Fünfte Reihe", year: 2001 }),
    ];
    const next = buildSections(input(fanSignals(), franchise)).find((section) => section.id === "next_franchise");
    const allSectionsIds = next?.items.map((item) => item.features.tmdbId) ?? [];
    expect(allSectionsIds).not.toContain(300);
  });
});
