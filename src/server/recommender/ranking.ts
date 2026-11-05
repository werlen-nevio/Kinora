// Ranking: Punkte vergeben, dann auf Vielfalt umsortieren. Pure Funktionen.

import { buildReasons } from "./explain";
import { featureKey } from "./profile";
import { computeSignals, itemSimilarity, negativePenalty, weightedSum } from "./scoring";
import type { Candidate, ScoredCandidate, TasteProfile, Weights } from "./types";

export interface RankContext {
  profile: TasteProfile;
  weights: Weights;
  now: Date;
  genreNames: ReadonlyMap<number, string>;
}

export function scoreCandidate(candidate: Candidate, context: RankContext): ScoredCandidate {
  const signals = computeSignals(candidate, context.profile, context.now);
  const { total, breakdown } = weightedSum(signals, context.weights);
  const penalty = negativePenalty(candidate.features, context.profile.negatives);
  const scored: ScoredCandidate = {
    ...candidate,
    signals,
    breakdown,
    penalty,
    score: total * (1 - penalty),
    reasons: [],
  };
  scored.reasons = buildReasons(scored, context);
  return scored;
}

/** Stabile Reihenfolge: Bei gleichem Score entscheidet der Schlüssel, nie der Zufall. */
export function byScore(a: ScoredCandidate, b: ScoredCandidate): number {
  return b.score - a.score || featureKey(a.features).localeCompare(featureKey(b.features));
}

export interface DiversifyOptions {
  limit: number;
  /** 1 = nur Relevanz, 0 = nur Vielfalt. */
  lambda?: number;
  maxPerCollection?: number;
  maxPerDirector?: number;
  /** Nimmt jeden Primärgenre-Anteil auf höchstens diesen Teil der Liste. */
  maxGenreShare?: number;
}

/**
 * Maximal Marginal Relevance: Jeder Schritt wählt den Titel mit dem besten
 * Kompromiss aus eigenem Score und Abstand zu den bereits gewählten.
 * Die harten Grenzen verhindern etwa acht Teile einer Reihe nebeneinander.
 */
export function diversify(items: readonly ScoredCandidate[], options: DiversifyOptions): ScoredCandidate[] {
  const { limit, lambda = 0.78, maxPerCollection = 2, maxPerDirector = 3, maxGenreShare = 0.6 } = options;
  const pool = [...items].sort(byScore);
  const picked: ScoredCandidate[] = [];
  const collectionCounts = new Map<number, number>();
  const directorCounts = new Map<number, number>();
  const genreCounts = new Map<number, number>();
  const maxPerGenre = Math.max(2, Math.ceil(limit * maxGenreShare));

  const allowed = (item: ScoredCandidate) => {
    const { collectionId, directorIds, genreIds } = item.features;
    if (collectionId !== null && (collectionCounts.get(collectionId) ?? 0) >= maxPerCollection) return false;
    if (directorIds.some((id) => (directorCounts.get(id) ?? 0) >= maxPerDirector)) return false;
    const primary = genreIds[0];
    return primary === undefined || (genreCounts.get(primary) ?? 0) < maxPerGenre;
  };

  while (picked.length < limit && pool.length > 0) {
    let bestIndex = -1;
    let bestValue = -Infinity;
    pool.forEach((item, index) => {
      if (!allowed(item)) return;
      const redundancy = picked.reduce((max, other) => Math.max(max, itemSimilarity(item.features, other.features)), 0);
      const value = lambda * item.score - (1 - lambda) * redundancy;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) break;
    const [chosen] = pool.splice(bestIndex, 1);
    if (!chosen) break;
    picked.push(chosen);
    const { collectionId, directorIds, genreIds } = chosen.features;
    if (collectionId !== null) collectionCounts.set(collectionId, (collectionCounts.get(collectionId) ?? 0) + 1);
    directorIds.forEach((id) => directorCounts.set(id, (directorCounts.get(id) ?? 0) + 1));
    const primary = genreIds[0];
    if (primary !== undefined) genreCounts.set(primary, (genreCounts.get(primary) ?? 0) + 1);
  }
  return picked;
}
