import "server-only";
import type { InteractionType, Media, Prisma } from "@/generated/prisma/client";
import { type BulkAction, EMPTY_ITEM, type LibraryAction, type LibraryItem, type LibraryState } from "@/lib/library-types";
import { DEFAULT_LANGUAGE } from "@/lib/locale";
import { type MediaKind, type MediaRef, refKey } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { enqueueJob } from "../jobs/queue";
import { getEpisodeIndex } from "../tmdb/api";
import { TmdbError } from "../tmdb/client";
import { ensureMedia, toKind, toMediaType } from "./media";
import { deriveSeriesStatus, episodeKey, hasAired, todayIso } from "@/lib/series-progress";
import { combineWatchedAt } from "@/lib/diary";
import { applyAction, type FlagAction, type ItemFlags } from "@/lib/library-transitions";

type Tx = Prisma.TransactionClient;

const CONFLICT_CODES = new Set(["P2002", "P2034"]);
const CONFLICT_RETRIES = 3;

/**
 * Zwei gleichzeitige Aktionen, etwa ein Doppelklick, können am Unique-Constraint oder
 * an der Transaktion kollidieren. Das ist kein Fehler des Nutzers: Beim erneuten Lesen
 * sieht die Aktion den neuen Stand, und es bleibt nichts mehr zu tun.
 */
export async function withConflictRetry<T>(task: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= CONFLICT_RETRIES || !code || !CONFLICT_CODES.has(code)) throw error;
    }
  }
}

export class LibraryError extends Error {
  constructor(
    readonly code: "not_aired" | "not_found" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/**
 * Aktionen auf denselben Titel derselben Person laufen nacheinander. Sonst lesen zwei
 * gleichzeitige Klicks denselben alten Stand und legen je einen Sehvorgang an. Der Lock
 * endet mit der Transaktion, andere Personen und Titel warten nicht.
 */
export async function lockItem(tx: Tx, userId: string, mediaId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${mediaId}`}, 0))`;
}

export async function loadFlags(tx: Tx, userId: string, mediaId: string): Promise<ItemFlags> {
  const [userMedia, rating, watchlist, favorite] = await Promise.all([
    tx.userMedia.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
    tx.rating.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
    tx.watchlistEntry.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
    tx.favorite.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
  ]);
  return {
    watched: userMedia?.watched ?? false,
    watchlisted: watchlist !== null,
    favorite: favorite !== null,
    rating: rating?.value ?? null,
    notInterested: userMedia?.notInterested ?? false,
  };
}

function parseWatchedAt(value: string | null | undefined): Date | null {
  // Ein Sehdatum entsteht nur, wenn es jemand angibt. Weggelassen heisst «unbekannt», nie «jetzt».
  return value ? combineWatchedAt(value) : null;
}

export async function log(tx: Tx, userId: string, type: InteractionType, mediaId: string, metadata?: Prisma.InputJsonObject) {
  await tx.userInteraction.create({ data: { userId, type, mediaId, metadata } });
}

/** Der Sehvorgang, der entsteht, wenn ein Titel erstmals als gesehen gilt. */
export interface FirstWatch {
  watchedAt: Date | null;
  hasWatchTime?: boolean;
  rating?: number | null;
  review?: string | null;
  isRewatch?: boolean;
}

/** Überträgt die Regeln aus `library-transitions.ts` in die Tabellen. */
export async function persistFlags(
  tx: Tx,
  userId: string,
  media: Media,
  before: ItemFlags,
  after: ItemFlags,
  firstWatch: FirstWatch,
) {
  const mediaId = media.id;
  const where = { userId_mediaId: { userId, mediaId } };
  const kind = toKind(media.type);

  if (before.watchlisted !== after.watchlisted) {
    if (after.watchlisted) {
      await tx.watchlistEntry.upsert({ where, create: { userId, mediaId }, update: {} });
      await log(tx, userId, "WATCHLIST_ADD", mediaId);
    } else {
      await tx.watchlistEntry.deleteMany({ where: { userId, mediaId } });
      await log(tx, userId, "WATCHLIST_REMOVE", mediaId);
    }
  }

  if (before.favorite !== after.favorite) {
    if (after.favorite) {
      await tx.favorite.upsert({ where, create: { userId, mediaId }, update: {} });
      await log(tx, userId, "FAVORITED", mediaId);
    } else {
      await tx.favorite.deleteMany({ where: { userId, mediaId } });
      await log(tx, userId, "UNFAVORITED", mediaId);
    }
  }

  if (before.rating !== after.rating) {
    if (after.rating !== null) {
      await tx.rating.upsert({
        where,
        create: { userId, mediaId, value: after.rating },
        update: { value: after.rating },
      });
      await log(tx, userId, "RATED", mediaId, { value: after.rating });
    } else {
      await tx.rating.deleteMany({ where: { userId, mediaId } });
      await log(tx, userId, "RATING_REMOVED", mediaId);
    }
  }

  if (before.notInterested !== after.notInterested) {
    await log(tx, userId, after.notInterested ? "NOT_INTERESTED" : "INTEREST_RESTORED", mediaId);
  }

  const summary: Prisma.UserMediaUncheckedUpdateInput = { notInterested: after.notInterested };

  if (!before.watched && after.watched && kind === "movie") {
    const { watchedAt } = firstWatch;
    await tx.watchDiaryEntry.create({
      data: {
        userId,
        mediaId,
        watchedAt,
        hasWatchTime: firstWatch.hasWatchTime ?? false,
        // Eine Bewertung, die «gesehen» erst auslöst, gehört zu genau diesem Sehvorgang.
        rating: firstWatch.rating === undefined ? after.rating : firstWatch.rating,
        review: firstWatch.review ?? null,
        isRewatch: firstWatch.isRewatch ?? false,
      },
    });
    summary.watched = true;
    summary.watchCount = 1;
    summary.lastWatchedAt = watchedAt;
    await log(tx, userId, "WATCHED", mediaId, { dateKnown: watchedAt !== null });
  }
  if (before.watched && !after.watched && kind === "movie") {
    await tx.watchDiaryEntry.deleteMany({ where: { userId, mediaId } });
    summary.watched = false;
    summary.watchCount = 0;
    summary.lastWatchedAt = null;
    await log(tx, userId, "UNWATCHED", mediaId);
  }

  await tx.userMedia.upsert({
    where,
    create: {
      userId,
      mediaId,
      notInterested: after.notInterested,
      watched: summary.watched === true,
      watchCount: summary.watchCount === 1 ? 1 : 0,
      lastWatchedAt: summary.lastWatchedAt instanceof Date ? summary.lastWatchedAt : null,
    },
    update: summary,
  });
}

/** Hält Status und Zähler der Serie aus den Episoden konsistent. */
async function syncSeries(tx: Tx, userId: string, media: Media, aired: number, advanced: boolean) {
  const mediaId = media.id;
  const progress = await tx.episodeProgress.findMany({
    where: { userId, mediaId },
    select: { seasonNumber: true, episodeNumber: true, watchedAt: true },
  });
  const current = await tx.userMedia.findUnique({ where: { userId_mediaId: { userId, mediaId } } });
  const watched = progress.length;
  const status = deriveSeriesStatus({ watched, aired, previous: current?.seriesStatus ?? null, advanced });
  const lastWatchedAt = progress.reduce<Date | null>(
    (latest, entry) => (entry.watchedAt && (!latest || entry.watchedAt > latest) ? entry.watchedAt : latest),
    null,
  );
  const data = {
    seriesStatus: status,
    episodesWatched: watched,
    watched: status === "COMPLETED",
    watchCount: status === "COMPLETED" ? 1 : 0,
    lastWatchedAt,
    ...(watched > 0 ? { notInterested: false } : {}),
  };
  await tx.userMedia.upsert({
    where: { userId_mediaId: { userId, mediaId } },
    create: { userId, mediaId, ...data },
    update: data,
  });
  // Wer eine Serie begonnen hat, muss sie nicht mehr als geplant führen.
  if (watched > 0) await tx.watchlistEntry.deleteMany({ where: { userId, mediaId } });
}

export async function setEpisodes(
  userId: string,
  media: Media,
  episodes: { seasonNumber: number; episodeNumber: number; runtime: number | null }[],
  on: boolean,
  watchedAt: Date | null,
) {
  const mediaId = media.id;
  const aired = media.airedEpisodes ?? 0;
  await prisma.$transaction(async (tx) => {
    await lockItem(tx, userId, mediaId);
    if (on) {
      await tx.episodeProgress.createMany({
        data: episodes.map((episode) => ({
          userId,
          mediaId,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          runtime: episode.runtime ?? media.runtime,
          watchedAt,
        })),
        skipDuplicates: true,
      });
    } else {
      await tx.episodeProgress.deleteMany({
        where: {
          userId,
          mediaId,
          OR: episodes.map((episode) => ({ seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber })),
        },
      });
    }
    await log(tx, userId, on ? "EPISODE_WATCHED" : "EPISODE_UNWATCHED", mediaId, { count: episodes.length });
    await syncSeries(tx, userId, media, aired, on);
  });
}

/**
 * Merkt vor, dass die Empfehlungen neu berechnet werden müssen. Läuft nach dem Speichern und darf
 * deshalb nicht scheitern: Sonst gälte eine längst gespeicherte Aktion als fehlgeschlagen.
 */
export async function markDirty(userId: string) {
  const now = new Date();
  try {
    await prisma.recommendationState.upsert({
      where: { userId },
      create: { userId, dirtyAt: now },
      update: { dirtyAt: now },
    });
    // Mehrere Änderungen kurz hintereinander lösen nur eine Neuberechnung aus.
    await enqueueJob(
      "recompute_recommendations",
      { userId },
      { dedupeKey: `recs:${userId}`, runAt: new Date(now.getTime() + 2_000) },
    );
  } catch (error) {
    console.error("[library] Empfehlungen konnten nicht vorgemerkt werden:", error);
  }
}

async function runFlagAction(userId: string, media: Media, action: FlagAction, watchedAtInput?: string | null) {
  const kind = toKind(media.type);
  // Nur eine ausdrückliche Sehen-Aktion kennt einen Zeitpunkt. Bewerten oder
  // Favorisieren setzt «gesehen» zwar voraus, sagt aber nichts über das Wann.
  const watchedAt = action.type === "watched" ? parseWatchedAt(watchedAtInput) : null;
  await prisma.$transaction(async (tx) => {
    await lockItem(tx, userId, media.id);
    const before = await loadFlags(tx, userId, media.id);
    const after = applyAction(kind, before, action);
    await persistFlags(tx, userId, media, before, after, { watchedAt });
  });
}

export async function performLibraryAction(userId: string, input: LibraryAction): Promise<LibraryItem> {
  const ref: MediaRef = { kind: input.kind, tmdbId: input.tmdbId };
  const media = await withConflictRetry(() => ensureMedia(ref));
  await withConflictRetry(() => dispatchAction(userId, media, input));
  await markDirty(userId);
  return getLibraryItem(userId, ref);
}

async function dispatchAction(userId: string, media: Media, input: LibraryAction) {
  switch (input.action) {
    case "watchlist":
      await runFlagAction(userId, media, { type: "watchlist", on: input.on });
      break;
    case "favorite":
      await runFlagAction(userId, media, { type: "favorite", on: input.on });
      break;
    case "rating":
      await runFlagAction(userId, media, { type: "rating", value: input.value });
      break;
    case "notInterested":
      await runFlagAction(userId, media, { type: "notInterested", on: input.on });
      break;
    case "watched":
      if (input.kind === "movie") {
        await runFlagAction(userId, media, { type: "watched", on: input.on }, input.watchedAt);
      } else {
        await setSeriesWatched(userId, media, input.on, parseWatchedAt(input.watchedAt));
      }
      break;
    case "episode":
      await setEpisode(userId, media, input.seasonNumber, input.episodeNumber, input.on);
      break;
    case "season":
      await setSeason(userId, media, input.seasonNumber, input.on);
      break;
    case "pause":
      await setPaused(userId, media, input.on);
      break;
  }
}

async function setEpisode(userId: string, media: Media, seasonNumber: number, episodeNumber: number, on: boolean) {
  if (media.type !== "TV") throw new LibraryError("invalid", "Episoden gibt es nur bei Serien.");
  const episodes = await getEpisodeIndex(media.tmdbId, DEFAULT_LANGUAGE);
  const episode = episodes.find((entry) => entry.seasonNumber === seasonNumber && entry.episodeNumber === episodeNumber);
  if (on) {
    if (!episode) throw new LibraryError("not_found", "Diese Episode gibt es bei TMDB nicht.");
    if (!hasAired(episode, todayIso())) throw new LibraryError("not_aired", "Diese Episode wurde noch nicht ausgestrahlt.");
  }
  await setEpisodes(
    userId,
    media,
    [{ seasonNumber, episodeNumber, runtime: episode?.runtime ?? null }],
    on,
    on ? new Date() : null,
  );
}

async function setSeason(userId: string, media: Media, seasonNumber: number, on: boolean) {
  if (media.type !== "TV") throw new LibraryError("invalid", "Staffeln gibt es nur bei Serien.");
  const today = todayIso();
  const episodes = (await getEpisodeIndex(media.tmdbId, DEFAULT_LANGUAGE)).filter(
    (episode) => episode.seasonNumber === seasonNumber && (!on || hasAired(episode, today)),
  );
  if (episodes.length === 0) {
    if (on) throw new LibraryError("not_aired", "In dieser Staffel ist noch keine Episode ausgestrahlt.");
    return;
  }
  // Eine ganze Staffel auf einmal sagt nichts darüber, wann sie gesehen wurde.
  await setEpisodes(userId, media, episodes, on, null);
}

async function setSeriesWatched(userId: string, media: Media, on: boolean, watchedAt: Date | null) {
  const today = todayIso();
  const episodes = await getEpisodeIndex(media.tmdbId, DEFAULT_LANGUAGE);
  if (on) {
    const aired = episodes.filter((episode) => hasAired(episode, today));
    if (aired.length === 0) throw new LibraryError("not_aired", "Von dieser Serie ist noch keine Episode ausgestrahlt.");
    await setEpisodes(userId, media, aired, true, watchedAt);
    return;
  }
  await prisma.$transaction(async (tx) => {
    await lockItem(tx, userId, media.id);
    await tx.episodeProgress.deleteMany({ where: { userId, mediaId: media.id } });
    await tx.watchDiaryEntry.deleteMany({ where: { userId, mediaId: media.id } });
    await log(tx, userId, "UNWATCHED", media.id);
    await syncSeries(tx, userId, media, media.airedEpisodes ?? 0, false);
  });
}

async function setPaused(userId: string, media: Media, on: boolean) {
  if (media.type !== "TV") throw new LibraryError("invalid", "Nur Serien lassen sich pausieren.");
  await prisma.$transaction(async (tx) => {
    await lockItem(tx, userId, media.id);
    const current = await tx.userMedia.findUnique({ where: { userId_mediaId: { userId, mediaId: media.id } } });
    if (!current || current.episodesWatched === 0) throw new LibraryError("invalid", "Pausieren geht erst nach der ersten Episode.");
    if (on && current.seriesStatus === "COMPLETED") return;
    const status = on
      ? "PAUSED"
      : deriveSeriesStatus({
          watched: current.episodesWatched,
          aired: media.airedEpisodes ?? 0,
          previous: current.seriesStatus,
          advanced: true,
        });
    await tx.userMedia.update({ where: { id: current.id }, data: { seriesStatus: status } });
  });
}

/** Stellt einen früheren Episodenstand samt Serienstatus wieder her, etwa «Pausiert». Alles andere bleibt unberührt. */
export async function restoreEpisodes(userId: string, mediaId: string, keysBefore: readonly string[], statusBefore: LibraryItem["seriesStatus"]) {
  const media = await prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  const keep = new Set(keysBefore);
  await prisma.$transaction(async (tx) => {
    await lockItem(tx, userId, mediaId);
    const rows = await tx.episodeProgress.findMany({ where: { userId, mediaId }, select: { id: true, seasonNumber: true, episodeNumber: true } });
    const remove = rows.filter((row) => !keep.has(episodeKey(row.seasonNumber, row.episodeNumber))).map((row) => row.id);
    if (remove.length) await tx.episodeProgress.deleteMany({ where: { id: { in: remove } } });
    await syncSeries(tx, userId, media, media.airedEpisodes ?? 0, false);
    if (keep.size > 0 && statusBefore) await tx.userMedia.update({ where: { userId_mediaId: { userId, mediaId } }, data: { seriesStatus: statusBefore } });
  });
}

/** Für Teilergebnisse einer Bulk-Aktion: Datenbankmeldungen gehören nicht zum Client. */
function publicMessage(error: unknown): string {
  if (error instanceof LibraryError) return error.message;
  if (error instanceof TmdbError) return error.code === "not_found" ? "Diesen Titel gibt es bei TMDB nicht." : "TMDB ist gerade nicht erreichbar.";
  console.error("[library] Bulk-Aktion fehlgeschlagen:", error);
  return "Das hat nicht geklappt.";
}

export async function performBulkAction(userId: string, input: BulkAction) {
  const results: { key: string; ok: boolean; error?: string }[] = [];
  for (const ref of input.items) {
    const key = refKey(ref);
    try {
      const actions: Record<BulkAction["action"], LibraryAction> = {
        "watchlist-remove": { ...ref, action: "watchlist", on: false } as LibraryAction,
        watched: { ...ref, action: "watched", on: true } as LibraryAction,
        unwatched: { ...ref, action: "watched", on: false } as LibraryAction,
        favorite: { ...ref, action: "favorite", on: true } as LibraryAction,
      };
      await performLibraryAction(userId, actions[input.action]);
      results.push({ key, ok: true });
    } catch (error) {
      results.push({ key, ok: false, error: publicMessage(error) });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

const itemSelect = {
  id: true,
  type: true,
  tmdbId: true,
  airedEpisodes: true,
} as const;

function emptyItem(aired: number | null): LibraryItem {
  return { ...EMPTY_ITEM, airedEpisodes: aired };
}

/** Der gesamte persönliche Stand als kompakte Map. Grundlage für alle Karten im Client. */
export async function getLibraryState(userId: string): Promise<LibraryState> {
  const [userMedia, ratings, watchlist, favorites] = await Promise.all([
    prisma.userMedia.findMany({ where: { userId }, include: { media: { select: itemSelect } } }),
    prisma.rating.findMany({ where: { userId }, select: { value: true, media: { select: itemSelect } } }),
    prisma.watchlistEntry.findMany({ where: { userId }, select: { media: { select: itemSelect } } }),
    prisma.favorite.findMany({ where: { userId }, select: { media: { select: itemSelect } } }),
  ]);

  const state: LibraryState = {};
  const entry = (media: { type: "MOVIE" | "TV"; tmdbId: number; airedEpisodes: number | null }) => {
    const key = refKey({ kind: toKind(media.type), tmdbId: media.tmdbId });
    state[key] ??= emptyItem(media.airedEpisodes);
    return state[key];
  };

  for (const row of userMedia) {
    Object.assign(entry(row.media), {
      watched: row.watched,
      notInterested: row.notInterested,
      watchCount: row.watchCount,
      lastWatchedAt: row.lastWatchedAt?.toISOString() ?? null,
      seriesStatus: row.seriesStatus,
      episodesWatched: row.episodesWatched,
    });
  }
  for (const row of ratings) entry(row.media).rating = row.value;
  for (const row of watchlist) entry(row.media).watchlisted = true;
  for (const row of favorites) entry(row.media).favorite = true;
  return state;
}

export async function getLibraryItem(userId: string, ref: MediaRef): Promise<LibraryItem> {
  const media = await prisma.media.findUnique({
    where: { type_tmdbId: { type: toMediaType(ref.kind), tmdbId: ref.tmdbId } },
  });
  if (!media) return { ...EMPTY_ITEM };
  const where = { userId_mediaId: { userId, mediaId: media.id } };
  const [userMedia, rating, watchlist, favorite] = await Promise.all([
    prisma.userMedia.findUnique({ where }),
    prisma.rating.findUnique({ where }),
    prisma.watchlistEntry.findUnique({ where }),
    prisma.favorite.findUnique({ where }),
  ]);
  return {
    watched: userMedia?.watched ?? false,
    watchlisted: watchlist !== null,
    favorite: favorite !== null,
    rating: rating?.value ?? null,
    notInterested: userMedia?.notInterested ?? false,
    watchCount: userMedia?.watchCount ?? 0,
    lastWatchedAt: userMedia?.lastWatchedAt?.toISOString() ?? null,
    seriesStatus: userMedia?.seriesStatus ?? null,
    episodesWatched: userMedia?.episodesWatched ?? 0,
    airedEpisodes: media.airedEpisodes,
  };
}

/** Gesehene Folgen einer Serie als Schlüsselmenge für Staffel- und Serienseiten. */
export async function getWatchedEpisodeKeys(userId: string, tmdbId: number): Promise<string[]> {
  const rows = await prisma.episodeProgress.findMany({
    where: { userId, media: { type: "TV", tmdbId } },
    select: { seasonNumber: true, episodeNumber: true },
  });
  return rows.map((row) => episodeKey(row.seasonNumber, row.episodeNumber));
}

export interface WatchlistRow {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  runtime: number | null;
  voteAverage: number | null;
  genreIds: number[];
  addedAt: string;
}

export async function getWatchlist(userId: string): Promise<WatchlistRow[]> {
  const rows = await prisma.watchlistEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { media: true },
  });
  return rows.map(({ media, createdAt }) => {
    const releaseDate = media.releaseDate?.toISOString().slice(0, 10) ?? null;
    return {
      kind: toKind(media.type),
      tmdbId: media.tmdbId,
      title: media.title,
      posterPath: media.posterPath,
      backdropPath: media.backdropPath,
      releaseDate,
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : null,
      runtime: media.runtime,
      voteAverage: media.voteAverage,
      genreIds: media.genreIds,
      addedAt: createdAt.toISOString(),
    };
  });
}

export async function recordInteraction(
  userId: string,
  type: InteractionType,
  ref?: MediaRef,
  metadata?: Prisma.InputJsonObject,
) {
  const media = ref
    ? await prisma.media.findUnique({ where: { type_tmdbId: { type: toMediaType(ref.kind), tmdbId: ref.tmdbId } }, select: { id: true } })
    : null;
  await prisma.userInteraction.create({ data: { userId, type, mediaId: media?.id, metadata } });
}

export { markDirty as markRecommendationsDirty };
