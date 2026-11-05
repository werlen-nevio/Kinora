// Stellt aus dem Kandidatenpool eine Session zusammen und passt ihre Reihenfolge an das
// an, was in dieser Session passiert. Pure Funktionen und deterministisch.

import type { DiscoveryModeName } from "@/lib/discovery";
import { diversify } from "../recommender/ranking";
import type { ScoredCandidate } from "../recommender/types";

export const SESSION_SIZE = 30;

interface ModeProfile {
  /** 1 = nur Relevanz, 0 = nur Vielfalt. */
  lambda: number;
  /** Anteil an Titeln ausserhalb der bekannten Vorlieben. */
  explorationShare: number;
  maxGenreShare: number;
  maxPerCollection: number;
}

const MODE_PROFILES: Record<Exclude<DiscoveryModeName, "FRANCHISES">, ModeProfile> = {
  FOR_YOU: { lambda: 0.8, explorationShare: 0.15, maxGenreShare: 0.45, maxPerCollection: 2 },
  SURPRISE: { lambda: 0.5, explorationShare: 0.45, maxGenreShare: 0.25, maxPerCollection: 1 },
  TOP_RATED: { lambda: 0.85, explorationShare: 0.1, maxGenreShare: 0.5, maxPerCollection: 2 },
  HIDDEN_GEMS: { lambda: 0.7, explorationShare: 0.2, maxGenreShare: 0.4, maxPerCollection: 1 },
};

const EXPLORATION_SOURCES = new Set(["new_genres", "exploration"]);

/** Eine Entdeckung kommt aus einer Entdeckerquelle. Was zu einem Vorbild oder einer begonnenen Reihe passt, ist keine Überraschung. */
export function isExploration(item: ScoredCandidate): boolean {
  const { provenance } = item;
  const linked = provenance.some((entry) => entry.seedKey !== undefined || entry.personName !== undefined || entry.source === "collection_parts");
  return !linked && provenance.some((entry) => EXPLORATION_SOURCES.has(entry.source));
}

/** Verteilt Entdeckungen gleichmässig, damit sie nicht gesammelt am Ende landen. */
function weave(main: readonly ScoredCandidate[], exploration: readonly ScoredCandidate[], size: number): ScoredCandidate[] {
  const result: ScoredCandidate[] = [];
  const interval = exploration.length ? Math.max(2, Math.floor(size / exploration.length)) : Number.POSITIVE_INFINITY;
  let mainIndex = 0;
  let explorationIndex = 0;
  while (result.length < size && (mainIndex < main.length || explorationIndex < exploration.length)) {
    const position = result.length + 1;
    const wantsExploration = position % interval === 0 && explorationIndex < exploration.length;
    const next = wantsExploration || mainIndex >= main.length ? exploration[explorationIndex++] : main[mainIndex++];
    if (next) result.push(next);
  }
  return result;
}

export function selectSessionItems(pool: readonly ScoredCandidate[], mode: Exclude<DiscoveryModeName, "FRANCHISES">, size = SESSION_SIZE): ScoredCandidate[] {
  const profile = MODE_PROFILES[mode];
  const explorationSlots = Math.round(size * profile.explorationShare);
  const explorationPool = pool.filter(isExploration);
  const exploration = diversify(explorationPool, { limit: explorationSlots, lambda: 0.6, maxGenreShare: 0.4, maxPerCollection: 1 });
  const used = new Set(exploration.map((item) => `${item.features.kind}:${item.features.tmdbId}`));

  const remaining = pool.filter((item) => !used.has(`${item.features.kind}:${item.features.tmdbId}`));
  const main = diversify(remaining, {
    limit: size - exploration.length,
    lambda: profile.lambda,
    maxGenreShare: profile.maxGenreShare,
    maxPerCollection: profile.maxPerCollection,
    maxPerDirector: 2,
  });
  return weave(main, exploration, size);
}

export interface FranchiseGroup<T> {
  collectionId: number;
  name: string;
  /** Ungesehene, erschienene Teile in Veröffentlichungsreihenfolge. */
  parts: T[];
  score: number;
}

/**
 * Reihen bleiben zusammen und in ihrer Reihenfolge. Die vielversprechendste Reihe zuerst;
 * wer einen Teil ablehnt, überspringt den Rest (siehe `skippedAfterRejection`).
 */
export function arrangeFranchises<T>(groups: readonly FranchiseGroup<T>[], size = SESSION_SIZE): T[] {
  const sorted = [...groups].sort((a, b) => b.score - a.score || a.collectionId - b.collectionId);
  return sorted.flatMap((group) => group.parts).slice(0, size);
}

export interface PendingItem {
  key: string;
  /** Platz bei Sessionstart. */
  rank: number;
  genreIds: readonly number[];
  exploration: boolean;
}

export interface ActedItem {
  genreIds: readonly number[];
  outcome: "positive" | "negative";
}

/** So viele Karten zeigt der Stapel: Was schon sichtbar oder vorgeladen ist, wird nicht getauscht. */
const LOCKED_NEXT_CARDS = 3;
/** So viele Plätze verschiebt ein ganz eindeutiges Genre eine Karte. */
const POSITIONS_PER_BIAS = 9;
const MAX_SAME_GENRE_RUN = 3;

/** Wie die Entscheidungen dieser Session ein Genre bewerten, -1 bis +1. */
export function sessionGenreBias(acted: readonly ActedItem[]): Map<number, number> {
  const sums = new Map<number, { total: number; count: number }>();
  for (const item of acted) {
    const value = item.outcome === "positive" ? 1 : -1;
    for (const id of item.genreIds) {
      const entry = sums.get(id) ?? { total: 0, count: 0 };
      entry.total += value;
      entry.count += 1;
      sums.set(id, entry);
    }
  }
  // Pseudo-Beobachtungen: Eine einzelne Entscheidung soll die Reihenfolge nicht kippen.
  return new Map([...sums.entries()].map(([id, { total, count }]) => [id, total / (count + 2)]));
}

/**
 * Passt die noch offenen Karten an, ohne die sichtbaren Karten des Stapels zu tauschen. Gerechnet wird immer vom Startplatz aus: Das Ergebnis hängt
 * nur von den bisherigen Entscheidungen ab, schaukelt sich nicht auf und lässt sich sauber
 * zurücknehmen. Entdeckungen behalten ihren Platz, damit bewusste Abwechslung erhalten bleibt.
 */
export function adaptPendingOrder(pending: readonly PendingItem[], acted: readonly ActedItem[]): string[] {
  const keys = pending.map((item) => item.key);
  if (acted.length === 0 || pending.length <= LOCKED_NEXT_CARDS + 1) return keys;

  const bias = sessionGenreBias(acted);
  const shifted = (item: PendingItem) => {
    if (item.exploration || item.genreIds.length === 0) return item.rank;
    const mean = item.genreIds.reduce((sum, id) => sum + (bias.get(id) ?? 0), 0) / item.genreIds.length;
    return item.rank - mean * POSITIONS_PER_BIAS;
  };

  const locked = pending.slice(0, LOCKED_NEXT_CARDS);
  const rest = pending
    .slice(LOCKED_NEXT_CARDS)
    .map((item) => ({ item, value: shifted(item) }))
    .sort((a, b) => a.value - b.value || a.item.rank - b.item.rank)
    .map(({ item }) => item);

  return limitGenreRuns([...locked, ...rest]).map((item) => item.key);
}

/** Holt einen anderen Titel nach vorne, wenn sonst zu viele aus demselben Genre aufeinander folgen. */
function limitGenreRuns(items: PendingItem[]): PendingItem[] {
  const result = [...items];
  for (let index = LOCKED_NEXT_CARDS + MAX_SAME_GENRE_RUN - 1; index < result.length; index += 1) {
    const primary = result[index]?.genreIds[0];
    if (primary === undefined) continue;
    const window = result.slice(index - MAX_SAME_GENRE_RUN + 1, index + 1);
    if (!window.every((item) => item.genreIds[0] === primary)) continue;
    const swap = result.findIndex((item, position) => position > index && item.genreIds[0] !== primary);
    if (swap === -1) break;
    const [other] = result.splice(swap, 1);
    if (other) result.splice(index, 0, other);
  }
  return result;
}

/** Wer einen Teil einer Reihe ablehnt, muss die weiteren nicht auch noch einzeln ablehnen. */
export function skippedAfterRejection<T extends { position: number; collectionId: number | null }>(rejected: { position: number; collectionId: number | null }, pending: readonly T[]): T[] {
  if (rejected.collectionId === null) return [];
  return pending.filter((item) => item.collectionId === rejected.collectionId && item.position > rejected.position);
}

