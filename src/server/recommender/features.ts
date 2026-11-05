import type { MediaCard, MediaDetail } from "@/lib/tmdb-types";
import type { ItemFeatures } from "./types";

/** Vollständige Merkmale aus der TMDB-Detailantwort. */
export function featuresFromDetail(detail: MediaDetail): ItemFeatures {
  const directorIds =
    detail.kind === "movie"
      ? detail.crew.filter((member) => member.job === "Director").map((member) => member.id)
      : detail.createdBy.map((person) => person.id);
  return {
    kind: detail.kind,
    tmdbId: detail.tmdbId,
    title: detail.title,
    genreIds: detail.genres.map((genre) => genre.id),
    keywordIds: detail.keywords.map((keyword) => keyword.id),
    castIds: detail.cast.slice(0, 12).map((member) => member.id),
    directorIds: [...new Set(directorIds)],
    collectionId: detail.kind === "movie" ? (detail.collection?.id ?? null) : null,
    collectionName: detail.kind === "movie" ? (detail.collection?.name ?? null) : null,
    year: detail.year,
    voteAverage: detail.voteAverage,
    voteCount: detail.voteCount,
    popularity: detail.popularity,
  };
}

/** Grobe Merkmale einer Listenantwort, reichen für die Vorauswahl. */
export function featuresFromCard(card: MediaCard): ItemFeatures {
  return {
    kind: card.kind,
    tmdbId: card.tmdbId,
    title: card.title,
    genreIds: card.genreIds,
    keywordIds: [],
    castIds: [],
    directorIds: [],
    collectionId: null,
    collectionName: null,
    year: card.year,
    voteAverage: card.voteAverage,
    voteCount: card.voteCount,
    popularity: card.popularity,
  };
}
