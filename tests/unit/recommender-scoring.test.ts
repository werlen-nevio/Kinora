import { describe, expect, it } from "vitest";
import { buildProfile, recencyFactor, signalWeight } from "@/server/recommender/profile";
import {
  bayesianRating,
  computeSignals,
  DEFAULT_WEIGHTS,
  genreScore,
  itemSimilarity,
  keywordScore,
  negativePenalty,
  noveltyScore,
  peopleScore,
  qualityScore,
  resolveWeights,
  saturate,
  similarityScore,
  tmdbScore,
  weightedSum,
} from "@/server/recommender/scoring";
import { candidate, features, signal } from "./fixtures";

const NOW = new Date("2026-06-01");
const BASE = { rating: null, favorite: false, watched: false, watchCount: 0, watchlisted: false, notInterested: false, seriesCompleted: false, seriesInProgress: false, paused: false };

describe("Gewichte", () => {
  it("summieren sich in der Ausgangslage auf 100 %", () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(DEFAULT_WEIGHTS).toMatchObject({ similarity: 0.3, genre: 0.2, tmdb: 0.15, actors: 0.1, crew: 0.1, keywords: 0.05, quality: 0.05, novelty: 0.05 });
  });

  it("werden nach einer Anpassung wieder normiert", () => {
    const weights = resolveWeights({ similarity: 1.3 });
    expect(Object.values(weights).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(weights.similarity).toBeGreaterThan(DEFAULT_WEIGHTS.similarity);
  });

  it("ignorieren unbrauchbare Überschreibungen", () => {
    expect(resolveWeights({ similarity: 0, genre: 0, tmdb: 0, actors: 0, crew: 0, keywords: 0, quality: 0, novelty: 0 })).toEqual(DEFAULT_WEIGHTS);
  });
});

describe("signalWeight", () => {
  it("bildet die Bewertungsstufen ab: 9 bis 10 stark, 7 bis 8.5 positiv, 5 bis 6.5 neutral, darunter negativ", () => {
    const weight = (rating: number) => signalWeight({ ...BASE, rating });
    expect(weight(10)).toBeCloseTo(1);
    expect(weight(9)).toBeCloseTo(0.8);
    expect(weight(8.5)).toBeGreaterThan(0.4);
    expect(weight(8.5)).toBeLessThan(0.8);
    expect(weight(7)).toBeCloseTo(0.4);
    expect(weight(6.5)).toBeGreaterThan(0);
    expect(weight(6.5)).toBeLessThan(0.15);
    expect(weight(5)).toBeCloseTo(0);
    expect(weight(4.5)).toBeLessThan(-0.2);
    expect(weight(1)).toBeCloseTo(-1);
  });

  it("steigt über alle halben Stufen gleichmässig an", () => {
    const steps = Array.from({ length: 19 }, (_, index) => signalWeight({ ...BASE, rating: 1 + index / 2 }));
    steps.slice(1).forEach((value, index) => expect(value).toBeGreaterThan(steps[index] as number));
  });

  it("wertet Gesehenes ohne Bewertung nicht als Vorliebe", () => {
    const seen = signalWeight({ ...BASE, watched: true });
    expect(seen).toBeGreaterThan(0);
    // Unter der Schwelle, ab der ein Titel als Vorbild für Empfehlungen dient.
    expect(seen).toBeLessThan(0.15);
  });

  it("gewichtet Vormerken und Rechtswischen leicht positiv und nie doppelt", () => {
    const list = signalWeight({ ...BASE, watchlisted: true });
    expect(list).toBeCloseTo(0.15);
    expect(signalWeight({ ...BASE, swipe: "interested" })).toBeCloseTo(0.15);
    expect(signalWeight({ ...BASE, watchlisted: true, swipe: "interested" })).toBeCloseTo(list);
  });

  it("wertet Ablehnung als negativ, aber schwächer als eine schlechte Bewertung", () => {
    expect(signalWeight({ ...BASE, notInterested: true })).toBeCloseTo(-0.5);
    expect(signalWeight({ ...BASE, rating: 1 })).toBeLessThan(signalWeight({ ...BASE, notInterested: true }));
  });

  it("lässt eine ausdrückliche Bewertung jedes implizite Signal schlagen", () => {
    expect(signalWeight({ ...BASE, rating: 9, notInterested: true })).toBeCloseTo(0.8);
    expect(signalWeight({ ...BASE, rating: 3, watchlisted: true, swipe: "interested" })).toBeLessThan(0);
  });

  it("nimmt eine zurückgenommene Ablehnung ernst, auch wenn der alte Swipe noch gespeichert ist", () => {
    expect(signalWeight({ ...BASE, notInterested: false, swipe: "not_interested" })).toBe(0);
  });

  it("belohnt Wiederholungen nur, wenn die Bewertung nicht dagegen spricht", () => {
    const again = { ...BASE, watched: true, watchCount: 3 };
    expect(signalWeight(again)).toBeCloseTo(0.1 + 0.2);
    expect(signalWeight({ ...again, rating: 8 })).toBeGreaterThan(signalWeight({ ...BASE, watched: true, rating: 8 }));
    expect(signalWeight({ ...again, rating: 3 })).toBe(signalWeight({ ...BASE, watched: true, rating: 3 }));
  });

  it("wertet blosses Sehen schwächer als eine gute Bewertung", () => {
    expect(signalWeight({ ...BASE, watched: true })).toBeLessThan(signalWeight({ ...BASE, watched: true, rating: 8 }));
  });

  it("macht aus einem Favoriten ein klares Signal, auch mit mittlerer Bewertung", () => {
    expect(signalWeight({ ...BASE, favorite: true, rating: 6 })).toBeGreaterThan(0.7);
  });

  it("belohnt Wiederholungen begrenzt", () => {
    expect(signalWeight({ ...BASE, watched: true, watchCount: 2 })).toBeGreaterThan(signalWeight({ ...BASE, watched: true, watchCount: 1 }));
    expect(signalWeight({ ...BASE, watched: true, watchCount: 50 })).toBeLessThanOrEqual(0.5);
  });
});

describe("recencyFactor", () => {
  it("verringert das Gewicht alter Signale, aber nie unter 0,6", () => {
    expect(recencyFactor(NOW, NOW)).toBeCloseTo(1);
    expect(recencyFactor(new Date("2023-06-01"), NOW)).toBeCloseTo(0.6, 0);
    expect(recencyFactor(new Date("1990-01-01"), NOW)).toBe(0.6);
  });
});

describe("buildProfile", () => {
  it("dämpft ein einzelnes Signal: Ein Film macht niemanden zum Genre-Fan", () => {
    const one = buildProfile([signal(1, 1, { genreIds: [14] })], [], NOW);
    const many = buildProfile([1, 2, 3, 4, 5, 6].map((id) => signal(id, 1, { genreIds: [14] })), [], NOW);
    expect(one.genres.get(14)!.score).toBeLessThan(many.genres.get(14)!.score);
    expect(one.genres.get(14)!.score).toBeLessThan(0.3);
  });

  it("lernt aus negativen Signalen eine negative Affinität", () => {
    const profile = buildProfile([signal(1, -1, { genreIds: [27] }), signal(2, -1, { genreIds: [27] })], [], NOW);
    expect(profile.genres.get(27)!.score).toBeLessThan(0);
    expect(profile.negatives).toHaveLength(2);
    expect(profile.seeds).toHaveLength(0);
  });

  it("berücksichtigt ausdrückliche Genre-Vorlieben", () => {
    const profile = buildProfile([], [{ genreId: 878, weight: 1 }, { genreId: 27, weight: -1 }], NOW);
    expect(profile.genres.get(878)!.score).toBeGreaterThan(0);
    expect(profile.genres.get(27)!.score).toBeLessThan(0);
  });

  it("sortiert Seeds deterministisch nach Stärke", () => {
    const profile = buildProfile([signal(1, 0.4), signal(2, 0.9), signal(3, 0.4)], [], NOW);
    expect(profile.seeds.map((seed) => seed.features.tmdbId)).toEqual([2, 1, 3]);
  });
});

describe("bayesianRating", () => {
  it("zieht Bewertungen aus wenigen Stimmen zum Mittel", () => {
    expect(bayesianRating(10, 3)).toBeLessThan(7);
  });

  it("stellt einen breit bewerteten Film vor einen mit wenigen Höchstwertungen", () => {
    expect(bayesianRating(8.6, 30000)).toBeGreaterThan(bayesianRating(10, 3));
  });

  it("nähert sich bei vielen Stimmen dem echten Wert", () => {
    expect(bayesianRating(8.6, 1_000_000)).toBeCloseTo(8.6, 1);
  });

  it("liefert ohne Stimmen das Mittel", () => {
    expect(bayesianRating(null, null)).toBeCloseTo(6.6);
  });
});

describe("Normalisierung", () => {
  it("hält alle Signale im Bereich 0 bis 1", () => {
    const shared = { genreIds: [14, 12], keywordIds: [1, 2, 3], castIds: [10, 11], directorIds: [20] };
    const profile = buildProfile(Array.from({ length: 20 }, (_, index) => signal(index + 1, 1, shared)), [], NOW);
    const extreme = candidate(
      999,
      { ...shared, popularity: 100000, voteAverage: 10, voteCount: 1000000 },
      Array.from({ length: 30 }, () => ({ source: "tmdb_recommendations", seedWeight: 1, rank: 0 })),
    );
    const signals = computeSignals(extreme, profile, NOW);
    for (const [name, value] of Object.entries(signals)) {
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(1);
    }
    expect(weightedSum(signals, DEFAULT_WEIGHTS).total).toBeLessThanOrEqual(1);
  });

  it("sättigt: Die zehnte Überschneidung bringt weniger als die erste", () => {
    expect(saturate(2) - saturate(1)).toBeLessThan(saturate(1) - saturate(0));
    expect(saturate(-5)).toBe(0);
  });

  it("lässt Popularität die Qualität nicht dominieren", () => {
    const blockbuster = qualityScore(features(1, { voteAverage: 6, voteCount: 30000, popularity: 5000 }));
    const gem = qualityScore(features(2, { voteAverage: 8.3, voteCount: 12000, popularity: 15 }));
    expect(gem).toBeGreaterThan(blockbuster);
  });

  it("bevorzugt Titel mit vielen Metadaten nicht", () => {
    const seed = features(1, { genreIds: [14], keywordIds: [1, 2], castIds: [10], directorIds: [20] });
    const focused = features(2, { genreIds: [14], keywordIds: [1, 2], castIds: [10], directorIds: [20] });
    const noisy = features(3, { genreIds: [14, 12, 28, 35, 18], keywordIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], castIds: [10, 11, 12, 13, 14, 15, 16, 17], directorIds: [20, 21, 22] });
    expect(itemSimilarity(seed, focused)).toBeGreaterThan(itemSimilarity(seed, noisy));
  });

  it("bewertet lange Keyword-Listen nicht automatisch höher", () => {
    const profile = buildProfile([1, 2, 3, 4].map((id) => signal(id, 1, { keywordIds: [1] })), [], NOW);
    const short = keywordScore(features(10, { keywordIds: [1] }), profile);
    const long = keywordScore(features(11, { keywordIds: [1, ...Array.from({ length: 30 }, (_, index) => 100 + index)] }), profile);
    expect(long).toBeLessThanOrEqual(short);
  });
});

describe("Einzelsignale", () => {
  it("ist bei fehlender Datenlage neutral statt negativ", () => {
    expect(genreScore(features(1, { genreIds: [14] }), buildProfile([], [], NOW))).toBe(0.5);
  });

  it("erkennt Ähnlichkeit zu positiven Seeds", () => {
    const seed = signal(1, 1, { genreIds: [14, 12], keywordIds: [1, 2] });
    const near = similarityScore(features(2, { genreIds: [14, 12], keywordIds: [1, 2] }), [seed]);
    const far = similarityScore(features(3, { genreIds: [27], keywordIds: [9] }), [seed]);
    expect(near.score).toBeGreaterThan(far.score);
    expect(far.score).toBe(0);
    expect(near.matches[0]?.seed).toBe(seed);
  });

  it("vergleicht einen Titel nicht mit sich selbst", () => {
    expect(similarityScore(features(1, { genreIds: [14] }), [signal(1, 1, { genreIds: [14] })]).score).toBe(0);
  });

  it("macht Teile derselben Filmreihe ähnlich, auch mit wenig Metadaten", () => {
    expect(itemSimilarity(features(1, { collectionId: 5 }), features(2, { collectionId: 5 }))).toBeGreaterThanOrEqual(0.4);
  });

  it("wertet frühe TMDB-Listenplätze und starke Seeds höher", () => {
    const early = tmdbScore([{ source: "tmdb_recommendations", seedWeight: 1, rank: 0 }]);
    const late = tmdbScore([{ source: "tmdb_recommendations", seedWeight: 1, rank: 18 }]);
    const weakSeed = tmdbScore([{ source: "tmdb_recommendations", seedWeight: 0.2, rank: 0 }]);
    expect(early).toBeGreaterThan(late);
    expect(early).toBeGreaterThan(weakSeed);
    expect(tmdbScore([{ source: "trending", rank: 0 }])).toBe(0);
  });

  it("zählt nur positive Personen-Affinität", () => {
    const profile = buildProfile([signal(1, -1, { castIds: [7] }), signal(2, -1, { castIds: [7] })], [], NOW);
    expect(peopleScore([7], profile.actors)).toBe(0);
  });

  it("zieht Titel nahe an abgelehnten Filmen nach unten", () => {
    const negative = signal(1, -1, { genreIds: [27], keywordIds: [1, 2] });
    expect(negativePenalty(features(2, { genreIds: [27], keywordIds: [1, 2] }), [negative])).toBeGreaterThan(0);
    expect(negativePenalty(features(3, { genreIds: [14], keywordIds: [9] }), [negative])).toBe(0);
  });

  it("bevorzugt bei der Neuheit neuere und weniger bekannte Titel", () => {
    expect(noveltyScore(features(1, { year: 2026, popularity: 5 }), NOW)).toBeGreaterThan(noveltyScore(features(2, { year: 1980, popularity: 400 }), NOW));
  });
});
