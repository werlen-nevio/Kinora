import "server-only";
import type { MediaCard, MediaKind } from "@/lib/tmdb-types";
import type { DiscoveryCard } from "@/lib/discovery";
import { getAmbient } from "../ambient";
import { prisma } from "../db";
import { getStartedCollections } from "../library/collections";
import { toKind } from "../library/media";
import { computeProgress, episodeKey, todayIso } from "@/lib/series-progress";
import { getRecommendationSections, type StoredSection } from "../recommender/service";
import { bayesianRating } from "../recommender/scoring";
import { discover, getDetail, getEpisodeIndex, getTrending } from "../tmdb/api";
import { cache } from "react";

export interface HeroItem {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  logoPath: string | null;
  backdropPath: string;
  year: number | null;
  genres: string[];
  runtime: number | null;
  seasons: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  overview: string;
  reason: string | null;
  trailerKey: string | null;
  ambient: { accent: string; glow: string } | null;
}

const HERO_SIZE = 5;

export const getSectionsCached = cache((userId: string) => getRecommendationSections(userId));

async function toHeroItem(card: MediaCard, language: string, region: string): Promise<HeroItem | null> {
  const detail = await getDetail({ kind: card.kind, tmdbId: card.tmdbId }, language, region).catch(() => null);
  if (!detail?.backdropPath) return null;
  return {
    kind: card.kind,
    tmdbId: card.tmdbId,
    title: detail.title,
    logoPath: detail.logoPath,
    backdropPath: detail.backdropPath,
    year: detail.year,
    genres: detail.genres.slice(0, 3).map((genre) => genre.name),
    runtime: detail.kind === "movie" ? detail.runtime : detail.episodeRuntime,
    seasons: detail.kind === "tv" ? detail.numberOfSeasons : null,
    voteAverage: detail.voteAverage,
    voteCount: detail.voteCount,
    overview: detail.overview,
    reason: card.reason ?? null,
    trailerKey: detail.videos.find((video) => video.type === "Trailer")?.key ?? null,
    ambient: await getAmbient(detail.backdropPath),
  };
}

/** Hero: persönliche Empfehlungen; ohne Datenlage die bestbewerteten Trends der Woche. */
export async function getHeroItems(userId: string, language: string, region: string): Promise<HeroItem[]> {
  const sections = await getSectionsCached(userId);
  const personal = sections.find((section) => section.id === "for_you")?.items ?? [];
  let cards = personal.filter((card) => card.backdropPath).slice(0, HERO_SIZE + 3);

  if (cards.length < HERO_SIZE) {
    const trending = await getTrending("all", "week", language);
    const fill = trending.results
      .filter((card) => card.backdropPath && (card.voteCount ?? 0) >= 100)
      .filter((card) => !cards.some((other) => other.kind === card.kind && other.tmdbId === card.tmdbId))
      .sort((a, b) => bayesianRating(b.voteAverage, b.voteCount) - bayesianRating(a.voteAverage, a.voteCount));
    cards = [...cards, ...fill];
  }

  const items = await Promise.all(cards.slice(0, HERO_SIZE + 3).map((card) => toHeroItem(card, language, region)));
  return items.filter((item): item is HeroItem => item !== null).slice(0, HERO_SIZE);
}

export interface ContinueItem {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  backdropPath: string | null;
  posterPath: string | null;
  href: string;
  label: string;
  watched: number;
  total: number;
  percent: number;
  paused: boolean;
}

const CONTINUE_SERIES_LIMIT = 16;
const DISLIKED_BELOW = 5;

/** Reihen, deren bewertete Teile im Schnitt durchfallen. Gesehen heisst nicht, dass jemand weitermachen will. */
async function dislikedCollections(userId: string): Promise<Set<number>> {
  const ratings = await prisma.rating.findMany({
    where: { userId, media: { collectionId: { not: null } } },
    select: { value: true, media: { select: { collectionId: true } } },
  });
  const sums = new Map<number, { total: number; count: number }>();
  for (const { value, media } of ratings) {
    if (media.collectionId === null) continue;
    const entry = sums.get(media.collectionId) ?? { total: 0, count: 0 };
    sums.set(media.collectionId, { total: entry.total + value, count: entry.count + 1 });
  }
  return new Set([...sums.entries()].filter(([, { total, count }]) => total / count < DISLIKED_BELOW).map(([id]) => id));
}

/** Serien mit offenen, bereits ausgestrahlten Folgen und angefangene Filmreihen. */
export async function getContinueWatching(userId: string, language: string): Promise<ContinueItem[]> {
  const today = todayIso();
  const rows = await prisma.userMedia.findMany({
    where: { userId, episodesWatched: { gt: 0 }, media: { type: "TV" } },
    orderBy: { updatedAt: "desc" },
    take: CONTINUE_SERIES_LIMIT,
    include: { media: true },
  });
  const progressRows = await prisma.episodeProgress.findMany({
    where: { userId, mediaId: { in: rows.map((row) => row.mediaId) } },
    select: { mediaId: true, seasonNumber: true, episodeNumber: true },
  });

  const series = await Promise.all(
    rows.map(async (row): Promise<ContinueItem | null> => {
      const episodes = await getEpisodeIndex(row.media.tmdbId, language).catch(() => null);
      if (!episodes) return null;
      const watched = new Set(
        progressRows
          .filter((entry) => entry.mediaId === row.mediaId)
          .map((entry) => episodeKey(entry.seasonNumber, entry.episodeNumber)),
      );
      const progress = computeProgress(episodes, watched, today);
      if (progress.caughtUp || !progress.next) return null;
      return {
        kind: "tv",
        tmdbId: row.media.tmdbId,
        title: row.media.title,
        backdropPath: progress.next.stillPath ?? row.media.backdropPath,
        posterPath: row.media.posterPath,
        href: `/serie/${row.media.tmdbId}/staffel/${progress.next.seasonNumber}/episode/${progress.next.episodeNumber}`,
        label: `S${progress.next.seasonNumber} E${progress.next.episodeNumber}: ${progress.next.name}`,
        watched: progress.watched,
        total: progress.aired,
        percent: progress.percent,
        paused: row.seriesStatus === "PAUSED",
      };
    }),
  );

  const [collections, disliked] = await Promise.all([getStartedCollections(userId, language), dislikedCollections(userId)]);
  const films = collections
    .filter((collection) => !collection.complete && collection.next && !disliked.has(collection.id))
    .slice(0, 8)
    .map((collection): ContinueItem => ({
      kind: "movie",
      tmdbId: collection.next?.tmdbId ?? 0,
      title: collection.name,
      backdropPath: collection.next?.backdropPath ?? collection.backdropPath,
      posterPath: collection.next?.posterPath ?? collection.posterPath,
      href: `/film/${collection.next?.tmdbId}`,
      label: `Als Nächstes: ${collection.next?.title}`,
      watched: collection.seen,
      total: collection.total,
      percent: collection.percent,
      paused: false,
    }));

  const open = series.filter((item): item is ContinueItem => item !== null);
  return [...open.filter((item) => !item.paused), ...films, ...open.filter((item) => item.paused)];
}

export async function getWatchlistRow(userId: string): Promise<MediaCard[]> {
  const rows = await prisma.watchlistEntry.findMany({
    where: { userId, media: { userMedia: { none: { userId, watched: true } } } },
    orderBy: { createdAt: "desc" },
    take: 24,
    include: { media: true },
  });
  return rows.map(({ media }) => {
    const releaseDate = media.releaseDate?.toISOString().slice(0, 10) ?? null;
    return {
      kind: toKind(media.type),
      tmdbId: media.tmdbId,
      title: media.title,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      releaseDate,
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
      voteAverage: media.voteAverage,
      voteCount: media.voteCount,
      popularity: media.popularity,
      genreIds: media.genreIds,
      overview: "",
      originalLanguage: media.originalLanguage,
    };
  });
}

function dateOffset(days: number) {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getTrendingRow(language: string) {
  return (await getTrending("all", "week", language)).results.filter((card) => card.posterPath);
}

export async function getNewReleases(language: string, region: string) {
  const page = await discover(
    {
      kind: "movie",
      releaseFrom: dateOffset(-60),
      releaseTo: dateOffset(0),
      region,
      releaseTypes: [2, 3, 4, 5],
      voteCountMin: 10,
      sort: "popularity.desc",
    },
    language,
  );
  return page.results.filter((card) => card.posterPath);
}

export async function getTopRatedRow(language: string) {
  const [movies, series] = await Promise.all([
    discover({ kind: "movie", voteCountMin: 5000, sort: "vote_average.desc" }, language),
    discover({ kind: "tv", voteCountMin: 2000, sort: "vote_average.desc" }, language),
  ]);
  return [...movies.results, ...series.results]
    .filter((card) => card.posterPath)
    .sort((a, b) => bayesianRating(b.voteAverage, b.voteCount) - bayesianRating(a.voteAverage, a.voteCount))
    .slice(0, 24);
}

export async function getUpcoming(language: string, region: string) {
  const page = await discover(
    {
      kind: "movie",
      releaseFrom: dateOffset(1),
      releaseTo: dateOffset(180),
      region,
      releaseTypes: [2, 3],
      sort: "popularity.desc",
    },
    language,
  );
  return page.results.filter((card) => card.posterPath);
}

export interface FranchiseRowItem {
  id: number;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  seen: number;
  total: number;
  percent: number;
  nextHref: string | null;
  nextTitle: string | null;
}

export async function getCompletableCollections(userId: string, language: string): Promise<FranchiseRowItem[]> {
  const [collections, disliked] = await Promise.all([getStartedCollections(userId, language), dislikedCollections(userId)]);
  return collections
    .filter((collection) => !collection.complete && collection.total > 1 && !disliked.has(collection.id))
    .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name, "de"))
    .slice(0, 12)
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      posterPath: collection.next?.posterPath ?? collection.posterPath,
      backdropPath: collection.next?.backdropPath ?? collection.backdropPath,
      seen: collection.seen,
      total: collection.total,
      percent: collection.percent,
      nextHref: collection.next ? `/film/${collection.next.tmdbId}` : null,
      nextTitle: collection.next?.title ?? null,
    }));
}

export function sectionById(sections: readonly StoredSection[], id: string) {
  return sections.find((section) => section.id === id) ?? null;
}

export interface FilmYear {
  year: number;
  count: number;
  minutes: number;
  averageRating: number | null;
  posters: { kind: MediaKind; tmdbId: number; title: string; posterPath: string }[];
}

/** Die Filme des laufenden Jahres. Nur bestätigte Sehdaten zählen, unbekannte gehören nirgends hin. */
export async function getFilmYear(userId: string, now: Date = new Date()): Promise<FilmYear | null> {
  const year = now.getUTCFullYear();
  const entries = await prisma.watchDiaryEntry.findMany({
    where: { userId, watchedAt: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }, media: { type: "MOVIE" } },
    orderBy: { watchedAt: "desc" },
    include: { media: { select: { id: true, type: true, tmdbId: true, title: true, posterPath: true, runtime: true } } },
  });
  if (entries.length === 0) return null;
  const ratings = entries.flatMap((entry) => entry.rating ?? []);
  const seen = new Set<string>();
  const posters: FilmYear["posters"] = [];
  for (const { media } of entries) {
    if (seen.has(media.id) || !media.posterPath) continue;
    seen.add(media.id);
    posters.push({ kind: toKind(media.type), tmdbId: media.tmdbId, title: media.title, posterPath: media.posterPath });
  }
  return {
    year,
    count: entries.length,
    minutes: entries.reduce((sum, entry) => sum + (entry.media.runtime ?? 0), 0),
    averageRating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
    posters: posters.slice(0, 7),
  };
}

export interface DiscoveryTeaser {
  remaining: number;
  posters: string[];
}

/** Einstieg in den Swipe-Modus: die nächsten Karten einer laufenden Session oder persönliche Vorschläge. */
export async function getDiscoveryTeaser(userId: string): Promise<DiscoveryTeaser> {
  const session = await prisma.discoverySession.findFirst({ where: { userId, state: "ACTIVE" }, select: { id: true } });
  if (session) {
    const pending = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id, status: "PENDING" }, orderBy: { position: "asc" }, select: { card: true } });
    const posters = pending.flatMap((item) => (item.card as unknown as DiscoveryCard).posterPath ?? []);
    return { remaining: pending.length, posters: posters.slice(0, 3) };
  }
  const sections = await getSectionsCached(userId).catch(() => []);
  const personal = sections.find((section) => section.id === "for_you")?.items ?? [];
  return { remaining: 0, posters: personal.flatMap((card) => card.posterPath ?? []).slice(0, 3) };
}
