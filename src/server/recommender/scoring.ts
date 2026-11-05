// Scoring: acht Signale im Bereich 0 bis 1, gewichtet und aufsummiert.
// Pure Funktionen und deterministisch: gleiche Eingabe ergibt die gleiche Reihenfolge.

import { featureKey } from "./profile";
import { decadeOf } from "./profile";
import type { AffinityMap, Candidate, ItemFeatures, Provenance, SignalScores, TasteProfile, UserSignal, Weights } from "./types";

export const DEFAULT_WEIGHTS: Weights = {
  similarity: 0.3,
  genre: 0.2,
  tmdb: 0.15,
  actors: 0.1,
  crew: 0.1,
  keywords: 0.05,
  quality: 0.05,
  novelty: 0.05,
};

/** Normalisiert überschriebene Gewichte, damit der Score vergleichbar bleibt. */
export function resolveWeights(override?: Partial<Weights> | null): Weights {
  const merged: Weights = { ...DEFAULT_WEIGHTS, ...override };
  const total = Object.values(merged).reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [key, Math.max(0, value) / total]),
  ) as Weights;
}

// Bayes-Mittel nach IMDb-Art. Ohne das stünde ein Film mit 10,0 aus drei Stimmen
// vor einem Film mit 8,6 aus 30 000 Stimmen.
const PRIOR_VOTES = 500;
const PRIOR_MEAN = 6.6;

export function bayesianRating(voteAverage: number | null, voteCount: number | null, m = PRIOR_VOTES, c = PRIOR_MEAN): number {
  if (voteAverage === null || voteCount === null || voteCount <= 0) return c;
  return (voteCount / (voteCount + m)) * voteAverage + (m / (voteCount + m)) * c;
}

/** Sättigung: wandelt eine beliebig grosse Summe in 0 bis 1 um. */
export function saturate(value: number, scale = 1): number {
  return value <= 0 ? 0 : 1 - Math.exp(-value / scale);
}

function jaccard(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((value) => setB.has(value)).length;
  return intersection / (a.length + b.length - intersection);
}

/**
 * Ähnlichkeit zweier Titel, 0 bis 1. Jaccard normiert auf die Grösse der Mengen,
 * damit Titel mit vielen Metadaten nicht automatisch ähnlicher wirken.
 * Fehlt ein Merkmal auf beiden Seiten, verteilt sich sein Gewicht auf die übrigen.
 */
export function itemSimilarity(a: ItemFeatures, b: ItemFeatures): number {
  const parts: [number, number, boolean][] = [
    [0.3, jaccard(a.genreIds, b.genreIds), a.genreIds.length > 0 && b.genreIds.length > 0],
    [0.3, jaccard(a.keywordIds, b.keywordIds), a.keywordIds.length > 0 && b.keywordIds.length > 0],
    [0.15, jaccard(a.castIds.slice(0, 10), b.castIds.slice(0, 10)), a.castIds.length > 0 && b.castIds.length > 0],
    [0.1, jaccard(a.directorIds, b.directorIds), a.directorIds.length > 0 && b.directorIds.length > 0],
  ];
  let weightSum = 0;
  let score = 0;
  for (const [weight, value, available] of parts) {
    if (!available) continue;
    weightSum += weight;
    score += weight * value;
  }
  const base = weightSum === 0 ? 0 : score / weightSum;
  // Teile derselben Filmreihe sind ähnlich, auch wenn TMDB wenig Metadaten führt.
  const sameCollection = a.collectionId !== null && a.collectionId === b.collectionId;
  return sameCollection ? Math.min(1, base * 0.6 + 0.4) : base;
}

const SIMILARITY_TOP_K = 3;
// Eine Jaccard-Ähnlichkeit von 0,35 ist schon sehr hoch; das spreizt den Bereich.
const SIMILARITY_SCALE = 0.25;

/** Mittel der ähnlichsten positiven Seeds, gewichtet mit deren Präferenz. */
export function similarityScore(features: ItemFeatures, seeds: readonly UserSignal[]): { score: number; matches: { seed: UserSignal; similarity: number }[] } {
  const matches = seeds
    .filter((seed) => featureKey(seed.features) !== featureKey(features))
    .map((seed) => ({ seed, similarity: itemSimilarity(features, seed.features) }))
    .filter((match) => match.similarity > 0)
    .sort((a, b) => b.similarity * b.seed.weight - a.similarity * a.seed.weight);
  const top = matches.slice(0, SIMILARITY_TOP_K);
  if (top.length === 0) return { score: 0, matches: [] };
  const value = top.reduce((sum, match) => sum + match.similarity * match.seed.weight, 0) / SIMILARITY_TOP_K;
  return { score: saturate(value, SIMILARITY_SCALE), matches: top };
}

/** Mittel der Affinitäten auf 0 bis 1 abgebildet. Ohne Datenlage: neutral, also 0,5. */
function meanAffinity(ids: readonly number[], map: AffinityMap): number {
  const values = ids.map((id) => map.get(id)?.score ?? 0);
  if (values.length === 0) return 0.5;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (mean + 1) / 2;
}

export function genreScore(features: ItemFeatures, profile: TasteProfile): number {
  return meanAffinity(features.genreIds, profile.genres);
}

/**
 * Mittel der fünf stärksten Keywords. Der Durchschnitt aller Keywords würde
 * Titel mit langen Keyword-Listen bestrafen, die Summe sie bevorzugen.
 */
export function keywordScore(features: ItemFeatures, profile: TasteProfile): number {
  const strongest = features.keywordIds
    .map((id) => profile.keywords.get(id)?.score ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 5);
  if (strongest.length === 0) return 0.5;
  const mean = strongest.reduce((sum, value) => sum + value, 0) / strongest.length;
  return (mean + 1) / 2;
}

/** Summe über die Rollen, gesättigt. Mehrere bekannte Gesichter zählen, aber abnehmend. */
export function peopleScore(ids: readonly number[], map: AffinityMap, scale = 0.8): number {
  const sum = ids.reduce((total, id) => {
    const affinity = map.get(id);
    return total + (affinity ? Math.max(0, affinity.score) : 0);
  }, 0);
  return saturate(sum, scale);
}

/** Wie stark TMDB den Titel zu den Seeds empfiehlt; frühe Listenplätze zählen mehr. */
export function tmdbScore(provenance: readonly Provenance[]): number {
  const sum = provenance
    .filter((entry) => entry.source === "tmdb_recommendations" || entry.source === "tmdb_similar")
    .reduce((total, entry) => {
      const rankFactor = 1 / (1 + (entry.rank ?? 0) / 8);
      const sourceFactor = entry.source === "tmdb_recommendations" ? 1 : 0.7;
      return total + (entry.seedWeight ?? 0.5) * rankFactor * sourceFactor;
    }, 0);
  return saturate(sum, 1);
}

/**
 * Qualität: vor allem Bayes-Bewertung, dazu ein kleiner, logarithmisch gedämpfter
 * Popularitätsanteil. Popularität kann den Gesamtscore so nicht dominieren.
 */
export function qualityScore(features: ItemFeatures): number {
  const rating = bayesianRating(features.voteAverage, features.voteCount);
  const ratingPart = Math.min(1, Math.max(0, (rating - 5) / 3.5));
  const popularityPart = Math.min(1, Math.log1p(features.popularity ?? 0) / Math.log1p(500));
  return 0.8 * ratingPart + 0.2 * popularityPart;
}

/** Neuheit: neuere und weniger überall sichtbare Titel. Hält die Liste frisch. */
export function noveltyScore(features: ItemFeatures, now: Date): number {
  const age = features.year === null ? 15 : Math.max(0, now.getFullYear() - features.year);
  const freshness = Math.exp(-age / 12);
  const obscurity = 1 - Math.min(1, Math.log1p(features.popularity ?? 0) / Math.log1p(500));
  return 0.6 * freshness + 0.4 * obscurity;
}

const NEGATIVE_SIMILARITY_FLOOR = 0.15;

/** Abzug für Nähe zu abgelehnten Titeln: 0 (keiner) bis 0,6 (fast identisch). */
export function negativePenalty(features: ItemFeatures, negatives: readonly UserSignal[]): number {
  let strongest = 0;
  for (const negative of negatives) {
    const similarity = itemSimilarity(features, negative.features);
    strongest = Math.max(strongest, similarity * Math.abs(negative.weight));
  }
  if (strongest < NEGATIVE_SIMILARITY_FLOOR) return 0;
  return Math.min(0.6, strongest);
}

export function computeSignals(candidate: Candidate, profile: TasteProfile, now: Date): SignalScores {
  const { features, provenance } = candidate;
  return {
    similarity: similarityScore(features, profile.seeds).score,
    genre: genreScore(features, profile),
    tmdb: tmdbScore(provenance),
    actors: peopleScore(features.castIds.slice(0, 10), profile.actors),
    crew: peopleScore(features.directorIds, profile.directors),
    keywords: keywordScore(features, profile),
    quality: qualityScore(features),
    novelty: noveltyScore(features, now),
  };
}

export function weightedSum(signals: SignalScores, weights: Weights): { total: number; breakdown: SignalScores } {
  const breakdown = Object.fromEntries(
    (Object.keys(signals) as (keyof SignalScores)[]).map((key) => [key, signals[key] * weights[key]]),
  ) as unknown as SignalScores;
  return { total: Object.values(breakdown).reduce((sum, value) => sum + value, 0), breakdown };
}

export function decadeAffinity(features: ItemFeatures, profile: TasteProfile): number {
  const decade = decadeOf(features.year);
  return decade === null ? 0 : (profile.decades.get(decade)?.score ?? 0);
}
