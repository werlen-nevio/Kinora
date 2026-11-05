import "server-only";
import type { MediaKind } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { getStartedCollections } from "../library/collections";
import { toKind } from "../library/media";
import { describeTaste } from "../recommender/explain";
import { loadProfile } from "../recommender/signals";
import { getGenreMap } from "../tmdb/api";
import { average, dailyActivity, type DayBucket, decadeDistribution, genreDistribution, type MonthBucket, monthlyActivity, ratingHistogram, type WatchEvent, yearlyActivity } from "./compute";

export interface PersonStat {
  tmdbId: number;
  name: string;
  profilePath: string | null;
  count: number;
}

export interface TimelineEntry {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  watchedAt: string;
  rewatch: boolean;
}

export interface TopTitle {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  year: number | null;
  rating: number | null;
  favorite: boolean;
}

export interface RewatchedTitle {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  year: number | null;
  count: number;
}

export interface UserStats {
  moviesWatched: number;
  seriesCompleted: number;
  episodesWatched: number;
  totalMinutes: number;
  /** Nur Sehvorgänge mit bekanntem Datum und bekannter Laufzeit, dazu Episoden mit Datum. */
  documentedMinutes: number;
  /** Anteil der Sehzeit ohne bekannte Laufzeit, damit «geschätzt» ehrlich bleibt. */
  unknownRuntimeCount: number;
  averageRating: number | null;
  ratingCount: number;
  collectionsCompleted: number;
  datedEvents: number;
  undatedEvents: number;
  genres: { id: number; name: string; count: number }[];
  ratings: { value: number; count: number }[];
  decades: { decade: number; count: number }[];
  months: MonthBucket[];
  /** Filme pro Monat und Jahr. Ein Eintrag ohne Datum gehört zu keinem von beiden. */
  movieMonths: MonthBucket[];
  movieYears: { year: number; count: number }[];
  undatedMovieEntries: number;
  activity: DayBucket[];
  rewatched: RewatchedTitle[];
  timeline: TimelineEntry[];
  topTitles: TopTitle[];
  actors: PersonStat[];
  directors: PersonStat[];
  tasteSummary: string | null;
}

export async function getUserStats(userId: string, language?: string, now: Date = new Date()): Promise<UserStats> {
  const [watchedMovies, seriesRows, history, episodes, ratings, favorites] = await Promise.all([
    prisma.userMedia.findMany({
      where: { userId, watched: true, media: { type: "MOVIE" } },
      include: { media: true },
    }),
    prisma.userMedia.findMany({
      where: { userId, media: { type: "TV" }, episodesWatched: { gt: 0 } },
      include: { media: true },
    }),
    prisma.watchDiaryEntry.findMany({ where: { userId }, include: { media: true }, orderBy: [{ watchedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] }),
    prisma.episodeProgress.findMany({
      where: { userId },
      include: { media: { select: { runtime: true, type: true, tmdbId: true, title: true, posterPath: true } } },
    }),
    prisma.rating.findMany({ where: { userId }, include: { media: true }, orderBy: [{ value: "desc" }, { updatedAt: "desc" }] }),
    prisma.favorite.findMany({ where: { userId }, include: { media: true } }),
  ]);

  // Serien hängen an den Episoden; ihre Tagebucheinträge dürfen nicht doppelt zählen.
  const movieEntries = history.filter((entry) => entry.media.type === "MOVIE");
  const movieMinutes = movieEntries.reduce((sum, entry) => sum + (entry.media.runtime ?? 0), 0);
  const episodeMinutes = episodes.reduce((sum, entry) => sum + (entry.runtime ?? entry.media.runtime ?? 0), 0);
  const unknownRuntimeCount =
    movieEntries.filter((entry) => entry.media.runtime === null).length +
    episodes.filter((entry) => entry.runtime === null && entry.media.runtime === null).length;

  const events: WatchEvent[] = [
    ...movieEntries.map((entry) => ({ watchedAt: entry.watchedAt, minutes: entry.media.runtime ?? 0 })),
    ...episodes.map((entry) => ({ watchedAt: entry.watchedAt, minutes: entry.runtime ?? entry.media.runtime ?? 0 })),
  ];

  const movieEvents: WatchEvent[] = movieEntries.map((entry) => ({ watchedAt: entry.watchedAt, minutes: entry.media.runtime ?? 0 }));
  const movieDates = movieEntries.flatMap((entry) => entry.watchedAt ?? []);
  const documentedMinutes = events.reduce((sum, event) => sum + (event.watchedAt ? event.minutes : 0), 0);

  const genreNames = await getGenreMap(language).catch(() => new Map<number, string>());
  const watchedMedia = [...watchedMovies.map((row) => row.media), ...seriesRows.map((row) => row.media)];

  const timeline: TimelineEntry[] = history.slice(0, 40).flatMap((entry) =>
    entry.watchedAt
      ? [
          {
            kind: toKind(entry.media.type),
            tmdbId: entry.media.tmdbId,
            title: entry.media.title,
            posterPath: entry.media.posterPath,
            watchedAt: entry.watchedAt.toISOString(),
            rewatch: entry.isRewatch,
          },
        ]
      : [],
  );

  const rewatched: RewatchedTitle[] = watchedMovies
    .filter((row) => row.watchCount > 1)
    .sort((a, b) => b.watchCount - a.watchCount || a.media.title.localeCompare(b.media.title, "de"))
    .slice(0, 10)
    .map((row) => ({
      kind: "movie",
      tmdbId: row.media.tmdbId,
      title: row.media.title,
      posterPath: row.media.posterPath,
      year: row.media.releaseDate?.getUTCFullYear() ?? null,
      count: row.watchCount,
    }));

  const favoriteIds = new Set(favorites.map((row) => row.mediaId));
  const seen = new Set<string>();
  const topTitles: TopTitle[] = [];
  const pushTop = (media: (typeof ratings)[number]["media"], rating: number | null) => {
    if (seen.has(media.id) || topTitles.length >= 10) return;
    seen.add(media.id);
    topTitles.push({
      kind: toKind(media.type),
      tmdbId: media.tmdbId,
      title: media.title,
      posterPath: media.posterPath,
      year: media.releaseDate?.getUTCFullYear() ?? null,
      rating,
      favorite: favoriteIds.has(media.id),
    });
  };
  // Favoriten mit Bewertung, dann weitere hohe Bewertungen, dann unbewertete Favoriten.
  ratings.filter((row) => favoriteIds.has(row.mediaId)).forEach((row) => pushTop(row.media, row.value));
  ratings.filter((row) => row.value >= 6).forEach((row) => pushTop(row.media, row.value));
  favorites.forEach((row) => pushTop(row.media, null));

  const [actors, directors, collections, tasteSummary] = await Promise.all([
    topPeople(userId, ["ACTOR"]),
    topPeople(userId, ["DIRECTOR", "CREATOR"]),
    getStartedCollections(userId, language).catch(() => []),
    loadProfile(userId, now).then(({ profile }) => describeTaste(profile, genreNames)),
  ]);

  return {
    moviesWatched: watchedMovies.length,
    seriesCompleted: seriesRows.filter((row) => row.seriesStatus === "COMPLETED").length,
    episodesWatched: episodes.length,
    totalMinutes: movieMinutes + episodeMinutes,
    documentedMinutes,
    unknownRuntimeCount,
    averageRating: average(ratings.map((row) => row.value)),
    ratingCount: ratings.length,
    collectionsCompleted: collections.filter((collection) => collection.complete).length,
    datedEvents: events.filter((event) => event.watchedAt !== null).length,
    undatedEvents: events.filter((event) => event.watchedAt === null).length,
    genres: genreDistribution(watchedMedia, genreNames),
    ratings: ratingHistogram(ratings.map((row) => row.value)),
    decades: decadeDistribution(watchedMedia.map((media) => media.releaseDate?.getUTCFullYear() ?? null)),
    months: monthlyActivity(events, now),
    movieMonths: monthlyActivity(movieEvents, now),
    movieYears: yearlyActivity(movieDates, now),
    undatedMovieEntries: movieEntries.length - movieDates.length,
    activity: dailyActivity(events.flatMap((event) => event.watchedAt ?? []), now),
    rewatched,
    timeline,
    topTitles,
    actors,
    directors,
    tasteSummary,
  };
}

async function topPeople(userId: string, roles: ("ACTOR" | "DIRECTOR" | "CREATOR")[]): Promise<PersonStat[]> {
  const rows = await prisma.mediaPerson.findMany({
    where: {
      role: { in: roles },
      // Besetzung zählt nur bei tatsächlich Gesehenem; Top-Rollen statt langer Listen.
      ...(roles.includes("ACTOR") ? { position: { lt: 10 } } : {}),
      media: {
        userMedia: { some: { userId, OR: [{ watched: true }, { episodesWatched: { gt: 0 } }] } },
      },
    },
    select: { mediaId: true, person: { select: { tmdbId: true, name: true, profilePath: true } } },
  });
  const counts = new Map<number, PersonStat & { media: Set<string> }>();
  for (const { mediaId, person } of rows) {
    const current = counts.get(person.tmdbId) ?? { ...person, count: 0, media: new Set<string>() };
    current.media.add(mediaId);
    current.count = current.media.size;
    counts.set(person.tmdbId, current);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"))
    .slice(0, 10)
    .map(({ tmdbId, name, profilePath, count }) => ({ tmdbId, name, profilePath, count }));
}
