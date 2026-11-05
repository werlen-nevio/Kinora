import "server-only";
import { type DiscoveryItemStatus, type DiscoverySession, Prisma, type SwipeAction } from "@/generated/prisma/client";
import { type DiscoveryCard, type DiscoveryFilters, type DiscoveryModeName, type DiscoveryQueueItem, type DiscoverySessionView, discoveryFiltersSchema, type SwipeInput } from "@/lib/discovery";
import type { LibraryItem } from "@/lib/library-types";
import { DEFAULT_DISCOVERY_FILTERS } from "@/lib/discovery";
import { episodeKey } from "@/lib/series-progress";
import type { MediaRef } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { createDiaryEntry, deleteDiaryEntry } from "../diary/service";
import { toKind, toMediaType } from "../library/media";
import { getLibraryItem, LibraryError, markDirty, performLibraryAction, restoreEpisodes } from "../library/service";
import { buildSessionItems } from "./engine";
import { adaptPendingOrder, type ActedItem, skippedAfterRejection } from "./selection";

const QUEUE_SIZE = 6;

const ACTION_TO_STATUS: Record<SwipeInput["action"], { status: DiscoveryItemStatus; swipe: SwipeAction }> = {
  interested: { status: "INTERESTED", swipe: "INTERESTED" },
  not_interested: { status: "NOT_INTERESTED", swipe: "NOT_INTERESTED" },
  watched: { status: "WATCHED", swipe: "WATCHED" },
};

interface FlagSnapshot {
  watched: boolean;
  watchlisted: boolean;
  favorite: boolean;
  rating: number | null;
  notInterested: boolean;
  seriesStatus: LibraryItem["seriesStatus"];
}

function snapshotOf({ watched, watchlisted, favorite, rating, notInterested, seriesStatus }: LibraryItem): FlagSnapshot {
  return { watched, watchlisted, favorite, rating, notInterested, seriesStatus };
}

/**
 * Was ein Swipe verändert hat. Rückgängig stellt genau das wieder her und nichts anderes:
 * Was seit dem Swipe anders ist als in `after`, hat jemand bewusst geändert und bleibt.
 */
interface SwipeEffect {
  swipeId: string | null;
  before: FlagSnapshot;
  /** Leer, falls nach dem Speichern die Buchführung gescheitert ist. */
  after: FlagSnapshot | null;
  /** Damit ein zurückgeholter Titel auf der Watchlist seinen Platz behält. */
  watchlistedAt: string | null;
  diaryEntryId?: string;
  /** Episoden vor dem Swipe, damit «Bereits gesehen» bei Serien sauber zurückgeht. */
  episodesBefore?: string[];
  /** Teile einer Reihe, die wegen dieser Ablehnung übersprungen wurden. */
  skippedMediaIds?: string[];
}

function parseFilters(value: Prisma.JsonValue | null | undefined): DiscoveryFilters {
  const parsed = discoveryFiltersSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : DEFAULT_DISCOVERY_FILTERS;
}

async function toView(session: DiscoverySession): Promise<DiscoverySessionView> {
  const items = await prisma.discoverySessionItem.findMany({
    where: { sessionId: session.id },
    orderBy: { position: "asc" },
    select: { position: true, status: true, card: true, actedAt: true },
  });
  const pending = items.filter((item) => item.status === "PENDING");
  const queue: DiscoveryQueueItem[] = pending.slice(0, QUEUE_SIZE).map((item) => ({ position: item.position, card: item.card as unknown as DiscoveryCard }));
  const count = (status: DiscoveryItemStatus) => items.filter((item) => item.status === status).length;
  return {
    id: session.id,
    mode: session.mode,
    filters: parseFilters(session.filters),
    state: session.state,
    total: items.length,
    done: items.length - pending.length,
    counts: { interested: count("INTERESTED"), notInterested: count("NOT_INTERESTED"), watched: count("WATCHED") },
    queue,
    canUndo: items.some((item) => item.actedAt !== null),
  };
}

/**
 * Nimmt offene Karten aus dem Stapel, über die inzwischen anderswo entschieden wurde, etwa auf der
 * Detailseite. Ohne das käme ein gerade abgelehnter Titel trotzdem noch als Karte.
 */
async function retireDecidedCards(session: DiscoverySession): Promise<DiscoverySession> {
  const { userId, id: sessionId } = session;
  const filters = parseFilters(session.filters);
  const decided: Prisma.MediaWhereInput[] = [{ userMedia: { some: { userId, notInterested: true } } }];
  if (filters.excludeSeen) decided.push({ userMedia: { some: { userId, watched: true } } });
  if (filters.excludeWatchlist) decided.push({ watchlist: { some: { userId } } });

  const { count } = await prisma.discoverySessionItem.updateMany({
    where: { sessionId, status: "PENDING", media: { OR: decided } },
    data: { status: "SKIPPED" },
  });
  if (count === 0) return session;
  await refreshSessionState(sessionId);
  return prisma.discoverySession.findUniqueOrThrow({ where: { id: sessionId } });
}

export interface DiscoveryState {
  session: DiscoverySessionView | null;
  mode: DiscoveryModeName;
  filters: DiscoveryFilters;
}

/** Die laufende Session. Da alles in der Datenbank liegt, überlebt sie jede Navigation. */
export async function getDiscoveryState(userId: string): Promise<DiscoveryState> {
  const [active, preferences] = await Promise.all([
    prisma.discoverySession.findFirst({ where: { userId, state: "ACTIVE" }, orderBy: { updatedAt: "desc" } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { discoveryMode: true, discoveryFilters: true } }),
  ]);
  const session = active ? await retireDecidedCards(active) : null;
  const running = session?.state === "ACTIVE" ? session : null;
  return {
    session: running ? await toView(running) : null,
    mode: session?.mode ?? preferences?.discoveryMode ?? "FOR_YOU",
    filters: session ? parseFilters(session.filters) : parseFilters(preferences?.discoveryFilters),
  };
}

/** Legt pro Titel einen schlanken Medieneintrag an; den vollen Snapshot holt die erste Aktion nach. */
async function ensureCardMedia(cards: readonly DiscoveryCard[]) {
  await prisma.media.createMany({
    data: cards.map((card) => ({
      type: toMediaType(card.kind),
      tmdbId: card.tmdbId,
      title: card.title,
      posterPath: card.posterPath,
      backdropPath: card.backdropPath,
      releaseDate: card.year ? new Date(Date.UTC(card.year, 0, 1)) : null,
      runtime: card.runtime,
      voteAverage: card.voteAverage,
      voteCount: card.voteCount,
      genreIds: card.genreIds,
      // Gilt als veraltet, damit `ensureMedia` bei der ersten Aktion alles nachlädt.
      fetchedAt: new Date(0),
    })),
    skipDuplicates: true,
  });
  const media = await prisma.media.findMany({
    where: { OR: cards.map((card) => ({ type: toMediaType(card.kind), tmdbId: card.tmdbId })) },
    select: { id: true, type: true, tmdbId: true },
  });
  return new Map(media.map((row) => [`${toKind(row.type)}:${row.tmdbId}`, row.id]));
}

export class DiscoveryEmptyError extends Error {
  constructor() {
    super("Zu diesen Einstellungen gibt es gerade keine passenden Titel. Lockere die Filter oder wähle einen anderen Modus.");
    this.name = "DiscoveryEmptyError";
  }
}

export async function startDiscoverySession(userId: string, mode: DiscoveryModeName, filters: DiscoveryFilters): Promise<DiscoverySessionView> {
  const round = await prisma.discoverySession.count({ where: { userId, mode } });
  const items = await buildSessionItems(userId, mode, filters, round);
  if (items.length === 0) throw new DiscoveryEmptyError();

  const mediaIds = await ensureCardMedia(items.map((item) => item.card));
  const filtersJson = filters as unknown as Prisma.InputJsonObject;

  const session = await prisma.$transaction(async (tx) => {
    await tx.discoverySession.updateMany({ where: { userId, state: "ACTIVE" }, data: { state: "ABANDONED" } });
    await tx.userPreference.upsert({
      where: { userId },
      create: { userId, discoveryMode: mode, discoveryFilters: filtersJson },
      update: { discoveryMode: mode, discoveryFilters: filtersJson },
    });
    const created = await tx.discoverySession.create({ data: { userId, mode, filters: filtersJson } });
    await tx.discoverySessionItem.createMany({
      data: items.flatMap((item, position) => {
        const mediaId = mediaIds.get(`${item.card.kind}:${item.card.tmdbId}`);
        return mediaId
          ? [{ sessionId: created.id, mediaId, position, recommendationScore: item.score, card: item.card as unknown as Prisma.InputJsonObject }]
          : [];
      }),
    });
    return created;
  });
  // Während die Karten gemischt wurden, kann schon über einen Titel entschieden worden sein.
  return toView(await retireDecidedCards(session));
}

async function loadOwnSession(userId: string, sessionId: string) {
  // Die userId steht in der Abfrage: Eine fremde Session verhält sich wie eine, die es nicht gibt.
  const session = await prisma.discoverySession.findFirst({ where: { id: sessionId, userId } });
  if (!session) throw new LibraryError("not_found", "Diese Discovery-Session gibt es nicht.");
  return session;
}

/** Sortiert die offenen Karten nach dem, was in dieser Session bisher entschieden wurde. */
async function reorderPending(sessionId: string, mode: DiscoveryModeName) {
  // Filmreihen behalten ihre Reihenfolge: Teil 3 vor Teil 1 ergäbe keinen Sinn.
  if (mode === "FRANCHISES") return;

  await prisma.$transaction(async (tx) => {
    // Zwei Geräte könnten sonst mit veralteten Plätzen aneinandergeraten.
    await tx.$queryRaw`SELECT id FROM discovery_sessions WHERE id = ${sessionId} FOR UPDATE`;
    const items = await tx.discoverySessionItem.findMany({
      where: { sessionId },
      orderBy: { position: "asc" },
      select: { mediaId: true, position: true, status: true, card: true },
    });
    const pending = items.filter((item) => item.status === "PENDING");
    const acted = items.flatMap((item): ActedItem[] => {
      const { genreIds } = item.card as unknown as DiscoveryCard;
      if (item.status === "INTERESTED" || item.status === "WATCHED") return [{ genreIds, outcome: "positive" }];
      if (item.status === "NOT_INTERESTED") return [{ genreIds, outcome: "negative" }];
      return [];
    });

    const order = adaptPendingOrder(
      pending.map((item) => {
        const card = item.card as unknown as DiscoveryCard;
        return { key: item.mediaId, rank: card.rank, genreIds: card.genreIds, exploration: card.exploration };
      }),
      acted,
    );
    const slots = pending.map((item) => item.position);
    const changes = order.flatMap((mediaId, index) => {
      const current = pending.find((item) => item.mediaId === mediaId);
      const slot = slots[index];
      return current && slot !== undefined && current.position !== slot ? [{ mediaId, slot }] : [];
    });

    // Zwei Schritte, weil die Position pro Session eindeutig bleiben muss.
    for (const { mediaId, slot } of changes) {
      await tx.discoverySessionItem.update({ where: { sessionId_mediaId: { sessionId, mediaId } }, data: { position: -slot - 1 } });
    }
    for (const { mediaId, slot } of changes) {
      await tx.discoverySessionItem.update({ where: { sessionId_mediaId: { sessionId, mediaId } }, data: { position: slot } });
    }
  });
}

/** Die Reihenfolge ist eine Verfeinerung: Scheitert sie, gilt die Entscheidung trotzdem. */
async function reorderSafely(sessionId: string, mode: DiscoveryModeName) {
  await reorderPending(sessionId, mode).catch((error: unknown) => console.error("[discovery] Reihenfolge nicht angepasst:", error));
}

/** Eine inzwischen abgelöste Session bleibt abgelöst: Es darf nur eine aktive geben. */
async function refreshSessionState(sessionId: string, tx: Prisma.TransactionClient = prisma) {
  const next = await tx.discoverySessionItem.findFirst({ where: { sessionId, status: "PENDING" }, orderBy: { position: "asc" }, select: { position: true } });
  const total = await tx.discoverySessionItem.count({ where: { sessionId } });
  await tx.discoverySession.updateMany({
    where: { id: sessionId, state: { not: "ABANDONED" } },
    data: { currentPosition: next?.position ?? total, state: next ? "ACTIVE" : "COMPLETED" },
  });
}

export interface SwipeResult {
  session: DiscoverySessionView;
  item: LibraryItem;
}

export async function applySwipe(userId: string, input: SwipeInput): Promise<SwipeResult> {
  const session = await loadOwnSession(userId, input.sessionId);
  if (session.state !== "ACTIVE") throw new LibraryError("invalid", "Diese Session läuft nicht mehr. Starte eine neue.");
  const ref: MediaRef = { kind: input.kind, tmdbId: input.tmdbId };
  const target = await prisma.discoverySessionItem.findFirst({
    where: { sessionId: session.id, media: { type: toMediaType(input.kind), tmdbId: input.tmdbId } },
  });
  if (!target) throw new LibraryError("not_found", "Dieser Titel gehört nicht zu dieser Session.");

  const { status, swipe } = ACTION_TO_STATUS[input.action];
  const itemKey = { sessionId: session.id, mediaId: target.mediaId };
  const before = await getLibraryItem(userId, ref);
  const listed = await prisma.watchlistEntry.findUnique({ where: { userId_mediaId: { userId, mediaId: target.mediaId } }, select: { createdAt: true } });

  const effect: SwipeEffect = {
    swipeId: null,
    before: snapshotOf(before),
    after: null,
    watchlistedAt: listed?.createdAt.toISOString() ?? null,
  };
  if (input.action === "watched" && input.kind === "tv") {
    const rows = await prisma.episodeProgress.findMany({ where: { userId, mediaId: target.mediaId }, select: { seasonNumber: true, episodeNumber: true } });
    effect.episodesBefore = rows.map((row) => episodeKey(row.seasonNumber, row.episodeNumber));
  }

  // Die Karte zuerst beanspruchen: Ein doppelt gesendeter Swipe legt so nichts doppelt an. Der
  // Ausgangsstand steht sofort dabei, damit Rückgängig auch nach einem späteren Fehler möglich bleibt.
  const claimed = await prisma.discoverySessionItem.updateMany({
    where: { ...itemKey, status: "PENDING" },
    data: { status, actedAt: new Date(), effect: effect as unknown as Prisma.InputJsonObject },
  });
  if (claimed.count === 0) return { session: await toView(session), item: before };

  try {
    if (input.action === "interested") {
      await performLibraryAction(userId, { ...ref, action: "watchlist", on: true });
    } else if (input.action === "not_interested") {
      await performLibraryAction(userId, { ...ref, action: "notInterested", on: true });
    } else {
      const { entry } = await createDiaryEntry(userId, { ...ref, ...input.diary });
      effect.diaryEntryId = entry.id;
    }
  } catch (error) {
    await prisma.discoverySessionItem.updateMany({ where: itemKey, data: { status: "PENDING", actedAt: null, effect: Prisma.DbNull } });
    throw error;
  }

  const card = target.card as unknown as DiscoveryCard;
  effect.after = snapshotOf(await getLibraryItem(userId, ref));

  // Ab hier ist die Aktion gespeichert. Scheitert nur noch die Buchführung, darf die Oberfläche sie nicht als fehlgeschlagen zurückrollen.
  await prisma
    .$transaction(async (tx) => {
      const row = await tx.mediaSwipeInteraction.create({ data: { userId, mediaId: target.mediaId, action: swipe } });
      effect.swipeId = row.id;

      // Filmreihen: Wer einen Teil ablehnt, soll nicht jeden weiteren einzeln ablehnen müssen.
      if (session.mode === "FRANCHISES" && input.action === "not_interested") {
        const pending = await tx.discoverySessionItem.findMany({ where: { sessionId: session.id, status: "PENDING" }, select: { mediaId: true, position: true, card: true } });
        const skipped = skippedAfterRejection(
          { position: target.position, collectionId: card.collectionId },
          pending.map((item) => ({ ...item, collectionId: (item.card as unknown as DiscoveryCard).collectionId })),
        ).map((item) => item.mediaId);
        if (skipped.length) {
          await tx.discoverySessionItem.updateMany({ where: { sessionId: session.id, mediaId: { in: skipped } }, data: { status: "SKIPPED" } });
          effect.skippedMediaIds = skipped;
        }
      }

      await tx.discoverySessionItem.update({
        where: { sessionId_mediaId: itemKey },
        data: { effect: effect as unknown as Prisma.InputJsonObject },
      });
      await refreshSessionState(session.id, tx);
    })
    .catch((error: unknown) => console.error("[discovery] Swipe nicht vollständig verbucht:", error));

  await reorderSafely(session.id, session.mode);
  await markDirty(userId);

  const fresh = await prisma.discoverySession.findUniqueOrThrow({ where: { id: session.id } });
  return { session: await toView(await retireDecidedCards(fresh)), item: await getLibraryItem(userId, ref) };
}

export interface UndoResult extends SwipeResult {
  ref: MediaRef;
}

function ignoreMissing(error: unknown) {
  if (!(error instanceof LibraryError && error.code === "not_found")) throw error;
}

/**
 * Macht rückgängig, was der Swipe in der Bibliothek verändert hat. Was seitdem anders geworden ist,
 * bleibt: Ein später erfasster Sehvorgang oder eine neue Bewertung gehören nicht zu diesem Swipe.
 */
async function restoreLibrary(userId: string, ref: MediaRef, mediaId: string, status: DiscoveryItemStatus, effect: SwipeEffect) {
  const { before, after } = effect;

  if (status === "WATCHED") {
    if (effect.diaryEntryId) await deleteDiaryEntry(userId, effect.diaryEntryId).catch(ignoreMissing);
    if (ref.kind === "tv") await restoreEpisodes(userId, mediaId, effect.episodesBefore ?? [], before.seriesStatus);
  }

  const current = await getLibraryItem(userId, ref);
  const unchanged = (key: "rating" | "favorite" | "notInterested") => after === null || current[key] === after[key];
  // Bleibt der Titel gesehen, obwohl er es vorher nicht war, gibt es einen späteren Sehvorgang.
  const seenAgainSince = status === "WATCHED" && current.watched && !before.watched;

  if (unchanged("rating") && current.rating !== before.rating) {
    await performLibraryAction(userId, { ...ref, action: "rating", value: before.rating });
  }
  // Selbst abgelehnt wird nur, was erst dieser Swipe abgelehnt hat.
  if (status === "NOT_INTERESTED" && !before.notInterested && current.notInterested) {
    await performLibraryAction(userId, { ...ref, action: "notInterested", on: false });
  }
  if (status === "INTERESTED" && !before.watchlisted && current.watchlisted) {
    await performLibraryAction(userId, { ...ref, action: "watchlist", on: false });
  }
  if (before.watchlisted && !current.watchlisted && !seenAgainSince) {
    await performLibraryAction(userId, { ...ref, action: "watchlist", on: true });
    if (effect.watchlistedAt) await prisma.watchlistEntry.updateMany({ where: { userId, mediaId }, data: { createdAt: new Date(effect.watchlistedAt) } });
  }
  if (before.favorite && !current.favorite && unchanged("favorite")) {
    await performLibraryAction(userId, { ...ref, action: "favorite", on: true });
  }
  // Zuletzt: Eine Ablehnung nimmt den Titel laut Statusregeln von der Watchlist.
  if (status !== "NOT_INTERESTED" && before.notInterested && !current.notInterested && unchanged("notInterested") && !seenAgainSince) {
    await performLibraryAction(userId, { ...ref, action: "notInterested", on: true });
  }
}

/** Nimmt die letzte Entscheidung der Session zurück, samt allem, was sie ausgelöst hat. */
export async function undoLastSwipe(userId: string, sessionId: string): Promise<UndoResult> {
  const session = await loadOwnSession(userId, sessionId);
  if (session.state !== "ACTIVE") {
    // Eine abgeschlossene Session darf wieder aufleben, solange keine neue läuft: Es gibt nur eine aktive.
    const other = await prisma.discoverySession.count({ where: { userId, state: "ACTIVE", id: { not: sessionId } } });
    if (session.state === "ABANDONED" || other > 0) throw new LibraryError("invalid", "Diese Session läuft nicht mehr.");
  }
  const last = await prisma.discoverySessionItem.findFirst({
    where: { sessionId, actedAt: { not: null } },
    orderBy: { actedAt: "desc" },
    include: { media: { select: { type: true, tmdbId: true } } },
  });
  if (!last) throw new LibraryError("invalid", "In dieser Session gibt es nichts rückgängig zu machen.");

  const ref: MediaRef = { kind: toKind(last.media.type), tmdbId: last.media.tmdbId };
  const effect = last.effect as unknown as SwipeEffect | null;
  if (effect) await restoreLibrary(userId, ref, last.mediaId, last.status, effect);

  await prisma.$transaction(async (tx) => {
    // Ohne Prüfung hiesse eine fehlende ID für Prisma «alle Swipes dieser Person».
    if (effect?.swipeId) await tx.mediaSwipeInteraction.deleteMany({ where: { id: effect.swipeId, userId } });
    if (effect?.skippedMediaIds?.length) {
      await tx.discoverySessionItem.updateMany({ where: { sessionId, mediaId: { in: effect.skippedMediaIds } }, data: { status: "PENDING" } });
    }
    await tx.discoverySessionItem.update({
      where: { sessionId_mediaId: { sessionId, mediaId: last.mediaId } },
      data: { status: "PENDING", actedAt: null, effect: Prisma.DbNull },
    });
    await refreshSessionState(sessionId, tx);
  });
  await reorderSafely(sessionId, session.mode);
  await markDirty(userId);

  const fresh = await prisma.discoverySession.findUniqueOrThrow({ where: { id: session.id } });
  return { session: await toView(fresh), item: await getLibraryItem(userId, ref), ref };
}

export interface RejectedTitle {
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  posterPath: string | null;
  year: number | null;
}

export async function getRejectedTitles(userId: string): Promise<RejectedTitle[]> {
  const rows = await prisma.userMedia.findMany({
    where: { userId, notInterested: true },
    orderBy: { updatedAt: "desc" },
    include: { media: { select: { type: true, tmdbId: true, title: true, posterPath: true, releaseDate: true } } },
  });
  return rows.map(({ media }) => ({
    kind: toKind(media.type),
    tmdbId: media.tmdbId,
    title: media.title,
    posterPath: media.posterPath,
    year: media.releaseDate?.getUTCFullYear() ?? null,
  }));
}

/** Nimmt alle Ablehnungen zurück. Die Titel dürfen danach wieder empfohlen werden. */
export async function resetRejectedTitles(userId: string): Promise<number> {
  const count = await prisma.$transaction(async (tx) => {
    const updated = await tx.userMedia.updateMany({ where: { userId, notInterested: true }, data: { notInterested: false } });
    await tx.mediaSwipeInteraction.deleteMany({ where: { userId, action: "NOT_INTERESTED" } });
    return updated.count;
  });
  await markDirty(userId);
  return count;
}

/** Durch Swipes vorgemerkte Titel, die noch auf der Watchlist stehen. */
export async function getSwipeDiscoveries(userId: string, limit = 20) {
  const swipes = await prisma.mediaSwipeInteraction.findMany({
    where: { userId, action: "INTERESTED", media: { watchlist: { some: { userId } } } },
    orderBy: { createdAt: "desc" },
    distinct: ["mediaId"],
    take: limit,
    include: { media: true },
  });
  return swipes.map(({ media }) => media);
}
