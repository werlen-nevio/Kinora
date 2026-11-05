import "server-only";
import type { Media, Prisma } from "@/generated/prisma/client";
import { combineWatchedAt, type CreateDiaryEntry, type DiaryEntryView, type DiaryPersonOption, resolveOverallRating, type UpdateDiaryEntry } from "@/lib/diary";
import { applyAction } from "@/lib/library-transitions";
import type { LibraryItem } from "@/lib/library-types";
import { DEFAULT_LANGUAGE } from "@/lib/locale";
import { episodeKey, hasAired, todayIso } from "@/lib/series-progress";
import { type MediaKind, type MediaRef, refKey } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { ensureMedia, toKind, toMediaType } from "../library/media";
import { getLibraryItem, LibraryError, loadFlags, lockItem, log, markDirty, persistFlags, restoreEpisodes, setEpisodes, withConflictRetry } from "../library/service";
import { getEpisodeIndex } from "../tmdb/api";

type Tx = Prisma.TransactionClient;

type EntryWithMedia = Prisma.WatchDiaryEntryGetPayload<{ include: { media: true } }>;

function toView(entry: EntryWithMedia): DiaryEntryView {
  const iso = entry.watchedAt?.toISOString() ?? null;
  return {
    id: entry.id,
    kind: toKind(entry.media.type),
    tmdbId: entry.media.tmdbId,
    title: entry.media.title,
    year: entry.media.releaseDate?.getUTCFullYear() ?? null,
    posterPath: entry.media.posterPath,
    backdropPath: entry.media.backdropPath,
    runtime: entry.media.runtime,
    genreIds: entry.media.genreIds,
    watchedDate: iso?.slice(0, 10) ?? null,
    watchedTime: iso && entry.hasWatchTime ? iso.slice(11, 16) : null,
    rating: entry.rating,
    review: entry.review,
    isRewatch: entry.isRewatch,
    createdAt: entry.createdAt.toISOString(),
  };
}

/** Sehzähler und letztes Sehdatum folgen immer den Einträgen eines Films. */
async function syncMovieSummary(tx: Tx, userId: string, mediaId: string) {
  const entries = await tx.watchDiaryEntry.findMany({ where: { userId, mediaId }, select: { watchedAt: true } });
  const latest = entries.reduce<Date | null>((max, entry) => (entry.watchedAt && (!max || entry.watchedAt > max) ? entry.watchedAt : max), null);
  await tx.userMedia.update({
    where: { userId_mediaId: { userId, mediaId } },
    data: { watched: entries.length > 0, watchCount: entries.length, lastWatchedAt: latest },
  });
}

async function setOverallRating(tx: Tx, userId: string, mediaId: string, current: number | null, next: number | null) {
  if (next === current) return;
  const where = { userId_mediaId: { userId, mediaId } };
  if (next === null) {
    await tx.rating.deleteMany({ where: { userId, mediaId } });
    await log(tx, userId, "RATING_REMOVED", mediaId);
    return;
  }
  await tx.rating.upsert({ where, create: { userId, mediaId, value: next }, update: { value: next } });
  await log(tx, userId, "RATED", mediaId, { value: next });
}

async function loadRatingContext(tx: Tx, userId: string, mediaId: string) {
  const [overall, entries] = await Promise.all([
    tx.rating.findUnique({ where: { userId_mediaId: { userId, mediaId } } }),
    tx.watchDiaryEntry.findMany({
      where: { userId, mediaId },
      select: { id: true, rating: true, watchedAt: true, createdAt: true },
    }),
  ]);
  return { current: overall?.value ?? null, entries };
}

/** Serien hängen an den Episoden: Der Eintrag markiert alles Ausgestrahlte als gesehen. */
async function markSeriesEpisodes(userId: string, media: Media, watchedAt: Date | null) {
  const today = todayIso();
  const episodes = await getEpisodeIndex(media.tmdbId, DEFAULT_LANGUAGE);
  const aired = episodes.filter((episode) => hasAired(episode, today));
  if (aired.length === 0) throw new LibraryError("not_aired", "Von dieser Serie ist noch keine Episode ausgestrahlt.");
  await setEpisodes(userId, media, aired, true, watchedAt);
}

/** Merkt sich den Episodenstand, falls der Tagebucheintrag danach scheitert. */
async function rememberEpisodes(userId: string, mediaId: string) {
  const [rows, state] = await Promise.all([
    prisma.episodeProgress.findMany({ where: { userId, mediaId }, select: { seasonNumber: true, episodeNumber: true } }),
    prisma.userMedia.findUnique({ where: { userId_mediaId: { userId, mediaId } }, select: { seriesStatus: true } }),
  ]);
  const keys = rows.map((row) => episodeKey(row.seasonNumber, row.episodeNumber));
  return () => restoreEpisodes(userId, mediaId, keys, state?.seriesStatus ?? null);
}

export interface DiaryResult {
  entry: DiaryEntryView;
  item: LibraryItem;
}

export async function createDiaryEntry(userId: string, input: CreateDiaryEntry): Promise<DiaryResult> {
  const ref: MediaRef = { kind: input.kind, tmdbId: input.tmdbId };
  const media = await withConflictRetry(() => ensureMedia(ref));
  const watchedAt = input.watchedAt ? combineWatchedAt(input.watchedAt, input.watchedTime) : null;
  const hasWatchTime = Boolean(input.watchedAt && input.watchedTime);
  const rating = input.rating ?? null;
  const review = input.review?.trim() || null;

  const undoEpisodes = input.kind === "tv" ? await rememberEpisodes(userId, media.id) : null;
  if (input.kind === "tv") await markSeriesEpisodes(userId, media, watchedAt);

  const entryId = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockItem(tx, userId, media.id);
      const before = await loadFlags(tx, userId, media.id);
      const previousEntries = await tx.watchDiaryEntry.count({ where: { userId, mediaId: media.id } });
      // Gibt es schon einen Sehvorgang, ist dieser eine Wiederholung; sonst entscheidet die Angabe.
      const isRewatch = previousEntries > 0 ? (input.isRewatch ?? true) : (input.isRewatch ?? false);

      if (input.kind === "movie" && !before.watched) {
        const after = applyAction("movie", before, { type: "watched", on: true });
        // Die Gesamtbewertung setzt erst die Regel unten; hier entsteht nur der Sehvorgang.
        await persistFlags(tx, userId, media, before, after, { watchedAt, hasWatchTime, rating, review, isRewatch });
      } else {
        await tx.watchDiaryEntry.create({ data: { userId, mediaId: media.id, watchedAt, hasWatchTime, rating, review, isRewatch } });
        if (input.kind === "movie") await log(tx, userId, "WATCHED", media.id, { rewatch: isRewatch, dateKnown: watchedAt !== null });
        // Ein neuer Sehvorgang erfüllt eine vorgemerkte Wiederholung.
        await tx.watchlistEntry.deleteMany({ where: { userId, mediaId: media.id } });
        if (before.notInterested) await tx.userMedia.update({ where: { userId_mediaId: { userId, mediaId: media.id } }, data: { notInterested: false } });
      }

      const created = await tx.watchDiaryEntry.findFirstOrThrow({
        where: { userId, mediaId: media.id },
        orderBy: { createdAt: "desc" },
      });
      const { current, entries } = await loadRatingContext(tx, userId, media.id);
      await setOverallRating(tx, userId, media.id, current, resolveOverallRating({ current, entries, changed: created }));
      if (input.kind === "movie") await syncMovieSummary(tx, userId, media.id);
      return created.id;
    }),
  ).catch(async (error: unknown) => {
    await undoEpisodes?.().catch((cleanup: unknown) => console.error("[diary] Episodenstand nicht wiederhergestellt:", cleanup));
    throw error;
  });

  await markDirty(userId);
  return { entry: await getOwnEntry(userId, entryId), item: await getLibraryItem(userId, ref) };
}

async function getOwnEntry(userId: string, id: string): Promise<DiaryEntryView> {
  // Die userId steht in jeder Abfrage: Eine fremde ID verhält sich wie eine, die es nicht gibt.
  const entry = await prisma.watchDiaryEntry.findFirst({ where: { id, userId }, include: { media: true } });
  if (!entry) throw new LibraryError("not_found", "Diesen Tagebucheintrag gibt es nicht.");
  return toView(entry);
}

export async function updateDiaryEntry(userId: string, input: UpdateDiaryEntry): Promise<DiaryResult> {
  const existing = await prisma.watchDiaryEntry.findFirst({ where: { id: input.id, userId }, include: { media: true } });
  if (!existing) throw new LibraryError("not_found", "Diesen Tagebucheintrag gibt es nicht.");
  const ref: MediaRef = { kind: toKind(existing.media.type), tmdbId: existing.media.tmdbId };

  await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockItem(tx, userId, existing.mediaId);
      const data: Prisma.WatchDiaryEntryUncheckedUpdateInput = {};
      if (input.watchedAt !== undefined) {
        data.watchedAt = input.watchedAt ? combineWatchedAt(input.watchedAt, input.watchedTime) : null;
        data.hasWatchTime = Boolean(input.watchedAt && input.watchedTime);
      }
      if (input.rating !== undefined) data.rating = input.rating;
      if (input.review !== undefined) data.review = input.review?.trim() || null;
      if (input.isRewatch !== undefined) data.isRewatch = input.isRewatch;

      const updated = await tx.watchDiaryEntry.update({ where: { id: existing.id }, data });
      const { current, entries } = await loadRatingContext(tx, userId, existing.mediaId);
      await setOverallRating(
        tx,
        userId,
        existing.mediaId,
        current,
        resolveOverallRating({ current, entries, changed: updated, previousEntryRating: existing.rating }),
      );
      if (ref.kind === "movie") await syncMovieSummary(tx, userId, existing.mediaId);
    }),
  );

  await markDirty(userId);
  return { entry: await getOwnEntry(userId, input.id), item: await getLibraryItem(userId, ref) };
}

/**
 * Löscht einen Sehvorgang. War es der letzte eines Films, gilt er nicht mehr als gesehen,
 * und damit entfallen laut den Statusregeln auch Bewertung und Favorit.
 */
export async function deleteDiaryEntry(userId: string, id: string): Promise<LibraryItem> {
  const existing = await prisma.watchDiaryEntry.findFirst({ where: { id, userId }, include: { media: true } });
  if (!existing) throw new LibraryError("not_found", "Diesen Tagebucheintrag gibt es nicht.");
  const kind = toKind(existing.media.type);

  await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockItem(tx, userId, existing.mediaId);
      await tx.watchDiaryEntry.deleteMany({ where: { id, userId } });
      if (kind !== "movie") return;

      const remaining = await tx.watchDiaryEntry.count({ where: { userId, mediaId: existing.mediaId } });
      if (remaining > 0) {
        await syncMovieSummary(tx, userId, existing.mediaId);
        return;
      }
      const before = await loadFlags(tx, userId, existing.mediaId);
      await persistFlags(tx, userId, existing.media, before, applyAction("movie", before, { type: "watched", on: false }), { watchedAt: null });
    }),
  );

  await markDirty(userId);
  return getLibraryItem(userId, { kind, tmdbId: existing.media.tmdbId });
}

export async function getEntriesForMedia(userId: string, ref: MediaRef): Promise<DiaryEntryView[]> {
  const entries = await prisma.watchDiaryEntry.findMany({
    where: { userId, media: { type: toMediaType(ref.kind), tmdbId: ref.tmdbId } },
    include: { media: true },
    orderBy: [{ watchedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return entries.map(toView);
}

const DIARY_PEOPLE_LIMIT = 40;

export interface DiaryData {
  entries: DiaryEntryView[];
  people: DiaryPersonOption[];
}

export async function getDiary(userId: string): Promise<DiaryData> {
  const entries = await prisma.watchDiaryEntry.findMany({
    where: { userId },
    include: { media: true },
    orderBy: [{ watchedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });

  const mediaIds = [...new Set(entries.map((entry) => entry.mediaId))];
  const credits = mediaIds.length
    ? await prisma.mediaPerson.findMany({
        where: { mediaId: { in: mediaIds }, role: "ACTOR", position: { lt: 10 } },
        select: { media: { select: { type: true, tmdbId: true } }, person: { select: { tmdbId: true, name: true } } },
      })
    : [];

  const people = new Map<number, { name: string; keys: Set<string> }>();
  for (const { media, person } of credits) {
    const entry = people.get(person.tmdbId) ?? { name: person.name, keys: new Set<string>() };
    entry.keys.add(refKey({ kind: toKind(media.type), tmdbId: media.tmdbId }));
    people.set(person.tmdbId, entry);
  }

  return {
    entries: entries.map(toView),
    people: [...people.entries()]
      .map(([tmdbId, { name, keys }]) => ({ tmdbId, name, count: keys.size, mediaKeys: [...keys] }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"))
      .slice(0, DIARY_PEOPLE_LIMIT),
  };
}

export interface RecentWatch {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  voteAverage: number | null;
  genreIds: number[];
  watchedDate: string;
  rating: number | null;
}

/** Die neuesten Einträge mit bekanntem Datum, pro Titel nur der jüngste. */
export async function getRecentWatches(userId: string, limit = 20): Promise<RecentWatch[]> {
  const rows = await prisma.watchDiaryEntry.findMany({
    where: { userId, watchedAt: { not: null } },
    orderBy: [{ watchedAt: "desc" }, { createdAt: "desc" }],
    take: limit * 3,
    include: { media: true },
  });
  const seen = new Set<string>();
  const result: RecentWatch[] = [];
  for (const row of rows) {
    if (seen.has(row.mediaId) || result.length >= limit) continue;
    seen.add(row.mediaId);
    result.push({
      kind: toKind(row.media.type),
      tmdbId: row.media.tmdbId,
      title: row.media.title,
      posterPath: row.media.posterPath,
      backdropPath: row.media.backdropPath,
      year: row.media.releaseDate?.getUTCFullYear() ?? null,
      voteAverage: row.media.voteAverage,
      genreIds: row.media.genreIds,
      watchedDate: (row.watchedAt as Date).toISOString().slice(0, 10),
      rating: row.rating,
    });
  }
  return result;
}
