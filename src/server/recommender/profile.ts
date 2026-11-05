// Geschmacksprofil aus den Nutzersignalen, frei von I/O.

import type { Affinity, AffinityMap, ItemFeatures, TasteProfile, UserSignal } from "./types";

export interface SignalInput {
  rating: number | null;
  favorite: boolean;
  watched: boolean;
  watchCount: number;
  watchlisted: boolean;
  notInterested: boolean;
  seriesCompleted: boolean;
  seriesInProgress: boolean;
  paused: boolean;
  /** Die letzte Swipe-Entscheidung zu diesem Titel. Ältere zählen nicht mit. */
  swipe?: "interested" | "not_interested" | "watched" | null;
}

/**
 * Bewertung als Gewicht: 9 bis 10 klar positiv, 7 bis 8.5 positiv, 5 bis 6.5 neutral bis leicht
 * positiv, 1 bis 4.5 negativ. Die Sprünge zwischen den Stufen sind gewollt: Eine 5 ist für die
 * meisten Menschen «ganz okay», eine 4.5 schon eine Absage.
 */
export function ratingWeight(rating: number): number {
  if (rating >= 9) return 0.8 + (rating - 9) * 0.2;
  if (rating >= 7) return 0.4 + ((rating - 7) / 2) * 0.35;
  if (rating >= 5) return ((rating - 5) / 2) * 0.15;
  return -0.25 - ((4.5 - rating) / 3.5) * 0.75;
}

const WEIGHT = {
  /** Bewusst schwächer als eine schlechte Bewertung: Ablehnen kostet nur einen Wisch. */
  rejected: -0.5,
  favoriteFloor: 0.5,
  favoriteBonus: 0.3,
  seriesCompleted: 0.25,
  seriesInProgress: 0.15,
  seriesPaused: 0.05,
  /** Interesse ohne Erfahrung: Vormerken und Rechtswischen sagen noch nichts übers Gefallen. */
  interest: 0.15,
  /** Gesehen heisst nicht gemocht. Reicht bewusst nicht aus, um als Vorbild zu dienen. */
  watchedUnrated: 0.1,
  rewatchStep: 0.1,
  rewatchMax: 0.2,
} as const;

/**
 * Präferenzgewicht eines Titels zwischen -1 und +1. Ausdrückliche Bewertungen schlagen alle
 * impliziten Signale. Interesse und Ablehnung wirken nur einmal, egal wie oft jemand swipt.
 */
export function signalWeight(input: SignalInput): number {
  let weight = 0;
  if (input.rating !== null) {
    weight = ratingWeight(input.rating);
  } else if (input.notInterested) {
    weight = WEIGHT.rejected;
  } else if (input.seriesCompleted) {
    weight = WEIGHT.seriesCompleted;
  } else if (input.seriesInProgress) {
    weight = input.paused ? WEIGHT.seriesPaused : WEIGHT.seriesInProgress;
  } else if (input.watched) {
    weight = WEIGHT.watchedUnrated;
  } else if (input.watchlisted || input.swipe === "interested") {
    weight = WEIGHT.interest;
  }

  if (input.favorite) weight = Math.max(weight, WEIGHT.favoriteFloor) + WEIGHT.favoriteBonus;
  // Wiederholtes Schauen spricht für den Film, ausser die Bewertung sagt ausdrücklich das Gegenteil.
  const contradicted = input.rating !== null && input.rating < 5;
  if (input.watchCount > 1 && !contradicted) weight += Math.min(WEIGHT.rewatchMax, (input.watchCount - 1) * WEIGHT.rewatchStep);

  return clamp(weight, -1, 1);
}

/** Lange zurückliegende Signale zählen weniger, verlieren aber nie alle Bedeutung. */
export function recencyFactor(interactedAt: Date | null, now: Date): number {
  if (!interactedAt) return 0.85;
  const years = Math.max(0, now.getTime() - interactedAt.getTime()) / (365.25 * 24 * 3600 * 1000);
  return Math.max(0.6, Math.pow(0.5, years / 3));
}

// Dämpfung nach Evidenz (Pseudo-Beobachtungen): Ein einzelner Film macht niemanden
// zum Genre-Fan. Personen sind seltener und spezifischer, brauchen also weniger Evidenz.
const PRIOR = { genres: 3, keywords: 4, actors: 1.5, directors: 1, decades: 3, collections: 1 } as const;

class Accumulator {
  private readonly sums = new Map<number, { sum: number; count: number }>();

  add(id: number, weight: number) {
    const current = this.sums.get(id) ?? { sum: 0, count: 0 };
    current.sum += weight;
    current.count += 1;
    this.sums.set(id, current);
  }

  finish(prior: number): AffinityMap {
    const out: AffinityMap = new Map();
    for (const [id, { sum, count }] of this.sums) {
      out.set(id, { score: clamp(sum / (count + prior), -1, 1), evidence: count });
    }
    return out;
  }
}

export function decadeOf(year: number | null): number | null {
  return year === null ? null : Math.floor(year / 10) * 10;
}

export interface GenrePreference {
  genreId: number;
  weight: number;
}

export function buildProfile(signals: readonly UserSignal[], genrePreferences: readonly GenrePreference[] = [], now: Date = new Date()): TasteProfile {
  const genres = new Accumulator();
  const keywords = new Accumulator();
  const actors = new Accumulator();
  const directors = new Accumulator();
  const decades = new Accumulator();
  const collections = new Accumulator();

  for (const signal of signals) {
    if (signal.weight === 0) continue;
    const weight = signal.weight * recencyFactor(signal.interactedAt, now);
    const { features } = signal;
    features.genreIds.forEach((id) => genres.add(id, weight));
    features.keywordIds.forEach((id) => keywords.add(id, weight));
    // Hauptrollen prägen einen Film mehr als Nebenrollen.
    features.castIds.slice(0, 8).forEach((id, position) => actors.add(id, weight * (1 - position * 0.08)));
    features.directorIds.forEach((id) => directors.add(id, weight));
    const decade = decadeOf(features.year);
    if (decade !== null) decades.add(decade, weight);
    if (features.collectionId !== null) collections.add(features.collectionId, weight);
  }

  const genreMap = genres.finish(PRIOR.genres);
  for (const preference of genrePreferences) {
    const current: Affinity = genreMap.get(preference.genreId) ?? { score: 0, evidence: 0 };
    // Ausdrückliche Wünsche zählen wie mehrere Titel.
    genreMap.set(preference.genreId, {
      score: clamp(current.score + preference.weight * 0.45, -1, 1),
      evidence: current.evidence + 2,
    });
  }

  const byWeight = (a: UserSignal, b: UserSignal) =>
    b.weight - a.weight || `${a.features.kind}:${a.features.tmdbId}`.localeCompare(`${b.features.kind}:${b.features.tmdbId}`);

  return {
    genres: genreMap,
    keywords: keywords.finish(PRIOR.keywords),
    actors: actors.finish(PRIOR.actors),
    directors: directors.finish(PRIOR.directors),
    decades: decades.finish(PRIOR.decades),
    collections: collections.finish(PRIOR.collections),
    seeds: signals.filter((signal) => signal.weight >= 0.15).slice().sort(byWeight),
    negatives: signals.filter((signal) => signal.weight <= -0.15).slice().sort((a, b) => a.weight - b.weight),
    signalCount: signals.filter((signal) => signal.weight !== 0).length,
  };
}

export function topAffinities(map: AffinityMap, limit: number, minEvidence = 1, minScore = 0.05): { id: number; score: number; evidence: number }[] {
  return [...map.entries()]
    .filter(([, value]) => value.evidence >= minEvidence && value.score >= minScore)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.score - a.score || b.evidence - a.evidence || a.id - b.id)
    .slice(0, limit);
}

export function featureKey(features: Pick<ItemFeatures, "kind" | "tmdbId">): string {
  return `${features.kind}:${features.tmdbId}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
