import "server-only";
import type { CollectionDetail, MediaCard } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { getCollection } from "../tmdb/api";
import { todayIso } from "@/lib/series-progress";

export interface CollectionProgress {
  id: number;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  total: number;
  seen: number;
  percent: number;
  next: MediaCard | null;
  complete: boolean;
}

/** Fortschritt einer Filmreihe. Angekündigte Teile zählen nicht als verpasst. */
export function collectionProgress(collection: CollectionDetail, watchedIds: ReadonlySet<number>, today: string = todayIso()): CollectionProgress {
  const released = collection.parts.filter((part) => part.releaseDate !== null && part.releaseDate <= today);
  const seen = released.filter((part) => watchedIds.has(part.tmdbId)).length;
  return {
    id: collection.id,
    name: collection.name,
    posterPath: collection.posterPath,
    backdropPath: collection.backdropPath,
    total: released.length,
    seen,
    percent: released.length === 0 ? 0 : Math.round((seen / released.length) * 100),
    next: released.find((part) => !watchedIds.has(part.tmdbId)) ?? null,
    complete: released.length > 0 && seen === released.length,
  };
}

/** Alle Filmreihen, von denen der Nutzer mindestens einen Teil gesehen hat. */
export async function getStartedCollections(userId: string, language?: string): Promise<CollectionProgress[]> {
  const watched = await prisma.userMedia.findMany({
    where: { userId, watched: true, media: { type: "MOVIE" } },
    select: { media: { select: { tmdbId: true, collectionId: true } } },
  });
  const watchedIds = new Set(watched.map((row) => row.media.tmdbId));
  const collectionIds = [
    ...new Set(watched.map((row) => row.media.collectionId).filter((id): id is number => id !== null)),
  ];
  const collections = await Promise.allSettled(collectionIds.map((id) => getCollection(id, language)));
  return collections.flatMap((result) =>
    result.status === "fulfilled" ? [collectionProgress(result.value, watchedIds)] : [],
  );
}
