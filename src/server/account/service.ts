import "server-only";
import { prisma } from "../db";

/** Alle persönlichen Daten eines Nutzers in lesbarer Form. Passwort-Hashes bleiben draussen. */
export async function exportUserData(userId: string) {
  const mediaRef = { select: { type: true, tmdbId: true, title: true } } as const;
  const [user, preferences, genrePreferences, library, ratings, history, episodes, watchlist, favorites, searches, interactions, sessions, swipes, discoverySessions] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, createdAt: true, updatedAt: true },
      }),
      prisma.userPreference.findUnique({ where: { userId } }),
      prisma.userGenrePreference.findMany({ where: { userId } }),
      prisma.userMedia.findMany({ where: { userId }, include: { media: mediaRef } }),
      prisma.rating.findMany({ where: { userId }, include: { media: mediaRef } }),
      prisma.watchDiaryEntry.findMany({ where: { userId }, include: { media: mediaRef }, orderBy: { watchedAt: "asc" } }),
      prisma.episodeProgress.findMany({ where: { userId }, include: { media: mediaRef } }),
      prisma.watchlistEntry.findMany({ where: { userId }, include: { media: mediaRef } }),
      prisma.favorite.findMany({ where: { userId }, include: { media: mediaRef } }),
      prisma.searchHistory.findMany({ where: { userId }, select: { query: true, updatedAt: true } }),
      prisma.userInteraction.findMany({ where: { userId }, select: { type: true, metadata: true, createdAt: true } }),
      prisma.session.findMany({ where: { userId }, select: { createdAt: true, expiresAt: true, ipAddress: true, userAgent: true } }),
      prisma.mediaSwipeInteraction.findMany({ where: { userId }, select: { action: true, createdAt: true, media: mediaRef } }),
      prisma.discoverySession.findMany({ where: { userId }, select: { mode: true, filters: true, state: true, createdAt: true, updatedAt: true } }),
    ]);

  return {
    exportedAt: new Date().toISOString(),
    format: "kinora-export-v1",
    user,
    preferences,
    genrePreferences,
    library,
    ratings,
    diary: history,
    swipes,
    discoverySessions,
    episodeProgress: episodes,
    watchlist,
    favorites,
    searchHistory: searches,
    interactions,
    sessions,
  };
}
