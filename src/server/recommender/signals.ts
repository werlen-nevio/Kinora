import "server-only";
import { prisma } from "../db";
import { toKind } from "../library/media";
import { buildProfile, signalWeight } from "./profile";
import { resolveWeights } from "./scoring";
import type { ItemFeatures, TasteProfile, UserSignal, Weights } from "./types";

const SWIPE_NAMES = {
  INTERESTED: "interested",
  NOT_INTERESTED: "not_interested",
  WATCHED: "watched",
} as const;

/**
 * Baut pro Titel ein Signal aus den Bibliothekstabellen. Alle Abfragen filtern
 * auf den einen Nutzer; andere Nutzer tauchen hier nie auf.
 */
export async function loadUserSignals(userId: string): Promise<UserSignal[]> {
  const [userMedia, ratings, watchlist, favorites, swipes] = await Promise.all([
    prisma.userMedia.findMany({ where: { userId } }),
    prisma.rating.findMany({ where: { userId } }),
    prisma.watchlistEntry.findMany({ where: { userId } }),
    prisma.favorite.findMany({ where: { userId } }),
    // Pro Titel nur die letzte Entscheidung: So kann wiederholtes Swipen nichts aufschaukeln.
    prisma.mediaSwipeInteraction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      distinct: ["mediaId"],
      select: { mediaId: true, action: true, createdAt: true },
    }),
  ]);

  const mediaIds = new Set<string>([
    ...userMedia.map((row) => row.mediaId),
    ...ratings.map((row) => row.mediaId),
    ...watchlist.map((row) => row.mediaId),
    ...favorites.map((row) => row.mediaId),
    ...swipes.map((row) => row.mediaId),
  ]);
  if (mediaIds.size === 0) return [];

  const media = await prisma.media.findMany({
    where: { id: { in: [...mediaIds] } },
    include: { credits: { include: { person: { select: { tmdbId: true } } }, orderBy: { position: "asc" } } },
  });

  const ratingBy = new Map(ratings.map((row) => [row.mediaId, row]));
  const userMediaBy = new Map(userMedia.map((row) => [row.mediaId, row]));
  const watchlistBy = new Map(watchlist.map((row) => [row.mediaId, row]));
  const favoriteBy = new Map(favorites.map((row) => [row.mediaId, row]));
  const swipeBy = new Map(swipes.map((row) => [row.mediaId, row]));

  return media.map((item) => {
    const features: ItemFeatures = {
      kind: toKind(item.type),
      tmdbId: item.tmdbId,
      title: item.title,
      genreIds: item.genreIds,
      keywordIds: item.keywordIds,
      castIds: item.credits.filter((credit) => credit.role === "ACTOR").map((credit) => credit.person.tmdbId),
      directorIds: item.credits
        .filter((credit) => credit.role === "DIRECTOR" || credit.role === "CREATOR")
        .map((credit) => credit.person.tmdbId),
      collectionId: item.collectionId,
      collectionName: item.collectionName,
      year: item.releaseDate?.getUTCFullYear() ?? null,
      voteAverage: item.voteAverage,
      voteCount: item.voteCount,
      popularity: item.popularity,
    };
    const state = userMediaBy.get(item.id);
    const rating = ratingBy.get(item.id);
    const watchlisted = watchlistBy.get(item.id);
    const favorite = favoriteBy.get(item.id);
    const swiped = swipeBy.get(item.id);
    const swipe = swiped ? SWIPE_NAMES[swiped.action] : null;
    const timestamps = [state?.updatedAt, rating?.updatedAt, watchlisted?.createdAt, favorite?.createdAt, swiped?.createdAt].filter(
      (value): value is Date => value instanceof Date,
    );
    const status = state?.seriesStatus ?? null;
    return {
      features,
      weight: signalWeight({
        rating: rating?.value ?? null,
        favorite: favorite !== undefined,
        watched: state?.watched ?? false,
        watchCount: state?.watchCount ?? 0,
        watchlisted: watchlisted !== undefined,
        notInterested: state?.notInterested ?? false,
        seriesCompleted: status === "COMPLETED",
        seriesInProgress: status === "STARTED" || status === "WATCHING" || status === "PAUSED",
        paused: status === "PAUSED",
        swipe,
      }),
      rating: rating?.value ?? null,
      favorite: favorite !== undefined,
      watched: state?.watched ?? false,
      watchlisted: watchlisted !== undefined,
      notInterested: state?.notInterested ?? false,
      swipe,
      interactedAt: timestamps.length ? new Date(Math.max(...timestamps.map((value) => value.getTime()))) : null,
    };
  });
}

export async function loadProfile(userId: string, now: Date = new Date()): Promise<{ profile: TasteProfile; signals: UserSignal[]; weights: Weights }> {
  const [signals, genrePrefs, preferences] = await Promise.all([
    loadUserSignals(userId),
    prisma.userGenrePreference.findMany({ where: { userId } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { recommendationWeights: true } }),
  ]);
  return {
    signals,
    profile: buildProfile(signals, genrePrefs, now),
    weights: resolveWeights(preferences?.recommendationWeights as Partial<Weights> | null),
  };
}
