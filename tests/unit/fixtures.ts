import type { MediaCard } from "@/lib/tmdb-types";
import type { Candidate, ItemFeatures, ScoredCandidate, UserSignal } from "@/server/recommender/types";

export function features(id: number, patch: Partial<ItemFeatures> = {}): ItemFeatures {
  return {
    kind: "movie",
    tmdbId: id,
    title: `Film ${id}`,
    genreIds: [],
    keywordIds: [],
    castIds: [],
    directorIds: [],
    collectionId: null,
    collectionName: null,
    year: 2015,
    voteAverage: 7,
    voteCount: 2000,
    popularity: 50,
    ...patch,
  };
}

export function signal(id: number, weight: number, patch: Partial<ItemFeatures> = {}, extra: Partial<UserSignal> = {}): UserSignal {
  return {
    features: features(id, patch),
    weight,
    rating: null,
    favorite: false,
    watched: true,
    watchlisted: false,
    swipe: null,
    notInterested: weight < 0,
    interactedAt: new Date("2026-01-01"),
    ...extra,
  };
}

export function card(id: number, patch: Partial<MediaCard> = {}): MediaCard {
  return {
    kind: "movie",
    tmdbId: id,
    title: `Film ${id}`,
    posterPath: `/p${id}.jpg`,
    backdropPath: `/b${id}.jpg`,
    releaseDate: "2015-01-01",
    year: 2015,
    voteAverage: 7,
    voteCount: 2000,
    popularity: 50,
    genreIds: [],
    overview: "",
    originalLanguage: "en",
    ...patch,
  };
}

export function candidate(id: number, patch: Partial<ItemFeatures> = {}, provenance: Candidate["provenance"] = []): Candidate {
  return { card: card(id, { genreIds: patch.genreIds ?? [] }), features: features(id, patch), provenance };
}

export function scored(id: number, score: number, patch: Partial<ItemFeatures> = {}, provenance: Candidate["provenance"] = []): ScoredCandidate {
  const zero = { similarity: 0, genre: 0, tmdb: 0, actors: 0, crew: 0, keywords: 0, quality: 0, novelty: 0 };
  return { ...candidate(id, patch, provenance), score, signals: zero, breakdown: zero, penalty: 0, reasons: [] };
}
