// Discovery-Modus: Typen und Regeln, die Server und Client gemeinsam nutzen.

import { z } from "zod";
import { diaryPayload } from "./diary";
import type { MediaKind } from "./tmdb-types";

export const DISCOVERY_MODES = ["FOR_YOU", "SURPRISE", "TOP_RATED", "HIDDEN_GEMS", "FRANCHISES"] as const;
export type DiscoveryModeName = (typeof DISCOVERY_MODES)[number];

export const MODE_LABELS: Record<DiscoveryModeName, { title: string; description: string }> = {
  FOR_YOU: { title: "Für dich", description: "Am stärksten auf deinen Geschmack zugeschnitten." },
  SURPRISE: { title: "Überrasch mich", description: "Mehr Abwechslung, unbekannte Genres, kleinere Produktionen." },
  TOP_RATED: { title: "Top bewertet", description: "Breit anerkannte Titel, die du noch nicht kennst." },
  HIDDEN_GEMS: { title: "Verborgene Schätze", description: "Weniger bekannt, aber von genug Menschen gut bewertet." },
  FRANCHISES: { title: "Filmreihen entdecken", description: "Neue Reihen, Teil für Teil in der richtigen Reihenfolge." },
};

const nullableYear = z.number().int().min(1870).max(2100).nullable().default(null);

export const discoveryFiltersSchema = z.object({
  kinds: z.enum(["all", "movie", "tv"]).default("all"),
  genres: z.array(z.number().int().positive()).max(12).default([]),
  yearFrom: nullableYear,
  yearTo: nullableYear,
  ratingMin: z.number().min(0).max(10).nullable().default(null),
  language: z.string().regex(/^[a-z]{2}$/).nullable().default(null),
  runtimeMax: z.number().int().min(1).max(1000).nullable().default(null),
  providers: z.array(z.number().int().positive()).max(20).default([]),
  excludeSeen: z.boolean().default(true),
  excludeWatchlist: z.boolean().default(true),
});

export type DiscoveryFilters = z.infer<typeof discoveryFiltersSchema>;

export const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = discoveryFiltersSchema.parse({});

export const startSessionSchema = z.object({
  mode: z.enum(DISCOVERY_MODES),
  filters: discoveryFiltersSchema,
});

const SWIPE_ACTIONS = ["interested", "not_interested", "watched"] as const;
export type SwipeActionName = (typeof SWIPE_ACTIONS)[number];

export const swipeSchema = z.object({
  sessionId: z.string().min(1).max(64),
  kind: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive().max(100_000_000),
  action: z.enum(SWIPE_ACTIONS),
  diary: diaryPayload.optional(),
});

export type SwipeInput = z.infer<typeof swipeSchema>;

export const undoSchema = z.object({ sessionId: z.string().min(1).max(64) });

export interface DiscoveryCard {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  runtime: number | null;
  seasons: number | null;
  genres: string[];
  genreIds: number[];
  overview: string;
  /** Begründung aus echten Nutzersignalen; fehlt, wenn es keine gibt. */
  reason: string | null;
  /** Ausserhalb der bekannten Vorlieben, sorgt für Abwechslung. */
  exploration: boolean;
  collectionId: number | null;
  collectionName: string | null;
  /** Platz bei Sessionstart: Die Anpassung rechnet immer von hier aus, damit sich nichts aufschaukelt. */
  rank: number;
  ambient: { accent: string; glow: string } | null;
}

export interface DiscoveryQueueItem {
  position: number;
  card: DiscoveryCard;
}

export interface DiscoverySessionView {
  id: string;
  mode: DiscoveryModeName;
  filters: DiscoveryFilters;
  state: "ACTIVE" | "COMPLETED" | "ABANDONED";
  total: number;
  /** Bereits entschieden, inklusive automatisch übersprungener Teile. */
  done: number;
  counts: { interested: number; notInterested: number; watched: number };
  queue: DiscoveryQueueItem[];
  canUndo: boolean;
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface FilterableTitle {
  kind: MediaKind;
  genreIds: readonly number[];
  year: number | null;
  voteAverage: number | null;
  originalLanguage: string | null;
  runtime: number | null;
  /** Abo-Anbieter der Region; `null`, wenn TMDB dazu nichts geliefert hat. */
  providerIds: readonly number[] | null;
}

type BasicTitle = Pick<FilterableTitle, "kind" | "genreIds" | "year" | "voteAverage" | "originalLanguage">;

/** Alles, was schon die Trefferliste von TMDB verrät, also ohne Abruf der Details prüfbar ist. */
export function matchesBasicFilters(title: BasicTitle, filters: DiscoveryFilters): boolean {
  if (filters.kinds !== "all" && title.kind !== filters.kinds) return false;
  if (filters.genres.length && !filters.genres.some((id) => title.genreIds.includes(id))) return false;
  if (filters.yearFrom !== null && (title.year === null || title.year < filters.yearFrom)) return false;
  if (filters.yearTo !== null && (title.year === null || title.year > filters.yearTo)) return false;
  if (filters.ratingMin !== null && (title.voteAverage === null || title.voteAverage < filters.ratingMin)) return false;
  if (filters.language !== null && title.originalLanguage !== filters.language) return false;
  return true;
}

/**
 * Prüft einen Titel gegen die Filter. Ein Filter, den ein Titel mangels Angabe nicht
 * belegen kann, gilt als nicht erfüllt: Wer «höchstens 2 Stunden» wählt, will keine Überraschung.
 */
export function matchesDiscoveryFilters(title: FilterableTitle, filters: DiscoveryFilters): boolean {
  if (!matchesBasicFilters(title, filters)) return false;
  if (filters.runtimeMax !== null && (title.runtime === null || title.runtime > filters.runtimeMax)) return false;
  if (filters.providers.length && !title.providerIds?.some((id) => filters.providers.includes(id))) return false;
  return true;
}

export function countActiveFilters(filters: DiscoveryFilters): number {
  return [
    filters.kinds !== "all",
    filters.genres.length > 0,
    filters.yearFrom !== null || filters.yearTo !== null,
    filters.ratingMin !== null,
    filters.language !== null,
    filters.runtimeMax !== null,
    filters.providers.length > 0,
    !filters.excludeSeen,
    !filters.excludeWatchlist,
  ].filter(Boolean).length;
}
