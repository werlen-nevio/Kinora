// Gemeinsame Typen der Empfehlungs-Engine. Frei von I/O und Prisma, damit
// Scoring und Ranking ohne Datenbank testbar bleiben.

import type { MediaCard, MediaKind } from "@/lib/tmdb-types";

export interface ItemFeatures {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  genreIds: number[];
  keywordIds: number[];
  castIds: number[];
  directorIds: number[];
  collectionId: number | null;
  collectionName: string | null;
  year: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
}

/** Ein Titel aus der Bibliothek samt abgeleitetem Präferenzgewicht. */
export interface UserSignal {
  features: ItemFeatures;
  /** -1 (klar abgelehnt) bis +1 (klar geliebt). */
  weight: number;
  rating: number | null;
  favorite: boolean;
  watched: boolean;
  watchlisted: boolean;
  notInterested: boolean;
  swipe: "interested" | "not_interested" | "watched" | null;
  interactedAt: Date | null;
}

export interface Affinity {
  /** Nach Evidenz gedämpft, -1 bis +1. */
  score: number;
  /** Anzahl der Titel, die den Wert stützen. */
  evidence: number;
}

export type AffinityMap = Map<number, Affinity>;

export interface TasteProfile {
  genres: AffinityMap;
  keywords: AffinityMap;
  actors: AffinityMap;
  directors: AffinityMap;
  decades: AffinityMap;
  collections: AffinityMap;
  /** Titel mit positivem Signal, stärkste zuerst. */
  seeds: UserSignal[];
  /** Titel mit negativem Signal. */
  negatives: UserSignal[];
  signalCount: number;
}

/** Ein Kandidat und woher er stammt. */
export interface Provenance {
  source: string;
  seedKey?: string;
  seedTitle?: string;
  seedWeight?: number;
  /** Position in der Liste der Quelle, 0-basiert. */
  rank?: number;
  personId?: number;
  personName?: string;
  personRole?: "actor" | "director";
}

export interface Candidate {
  card: MediaCard;
  features: ItemFeatures;
  provenance: Provenance[];
}

export interface SignalScores {
  similarity: number;
  genre: number;
  tmdb: number;
  actors: number;
  crew: number;
  keywords: number;
  quality: number;
  novelty: number;
}

export type Weights = Record<keyof SignalScores, number>;

export interface Reason {
  type: "similar" | "genre" | "actor" | "director" | "collection" | "decade" | "quality" | "new_genre";
  text: string;
  /** Beitrag zum Score; bestimmt die Reihenfolge der Begründungen. */
  strength: number;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  signals: SignalScores;
  /** Gewichtete Beiträge je Signal. */
  breakdown: SignalScores;
  penalty: number;
  reasons: Reason[];
}

export interface RecommendationSection {
  id: string;
  title: string;
  /** Film- oder Serientitel, den die UI hervorhebt, etwa in «Weil du … mochtest». */
  emphasis?: string;
  items: ScoredCandidate[];
}
