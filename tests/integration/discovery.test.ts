import { describe, expect, it } from "vitest";
import { POST as diaryPost } from "@/app/api/diary/route";
import { POST as libraryPost, GET as libraryGet } from "@/app/api/library/route";
import { DELETE as rejectedDelete, GET as rejectedGet } from "@/app/api/discovery/rejected/route";
import { GET as discoveryGet, POST as discoveryPost } from "@/app/api/discovery/route";
import { POST as swipePost } from "@/app/api/discovery/swipe/route";
import { POST as undoPost } from "@/app/api/discovery/undo/route";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_DISCOVERY_FILTERS, type DiscoveryFilters, type DiscoveryModeName, type DiscoverySessionView } from "@/lib/discovery";
import type { LibraryItem, LibraryState } from "@/lib/library-types";
import { prisma } from "@/server/db";
import { getRecommendationSections, recomputeRecommendations } from "@/server/recommender/service";
import { loadProfile, loadUserSignals } from "@/server/recommender/signals";
import { call, signUp, type TestUser } from "./helpers";

interface SwipeResult {
  session: DiscoverySessionView;
  item: LibraryItem;
}

async function start(user: TestUser, mode: DiscoveryModeName = "FOR_YOU", filters: Partial<DiscoveryFilters> = {}) {
  const result = await call<{ session: DiscoverySessionView }>(discoveryPost, { user, body: { mode, filters: { ...DEFAULT_DISCOVERY_FILTERS, ...filters } } });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data.session;
}

async function swipe(user: TestUser, session: DiscoverySessionView, action: "interested" | "not_interested" | "watched", diary?: object, index = 0) {
  const card = session.queue[index]?.card;
  if (!card) throw new Error("Keine Karte mehr in der Warteschlange");
  const result = await call<SwipeResult>(swipePost, { user, body: { sessionId: session.id, kind: card.kind, tmdbId: card.tmdbId, action, ...(diary ? { diary } : {}) } });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return { ...result.data, card };
}

async function undo(user: TestUser, session: DiscoverySessionView) {
  const result = await call<SwipeResult>(undoPost, { user, body: { sessionId: session.id } });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
  return result.data;
}

const stateOf = async (user: TestUser) => (await call<LibraryState>(libraryGet, { user })).data;
const rate = (user: TestUser, tmdbId: number, value: number) => call(libraryPost, { user, body: { kind: "movie", tmdbId, action: "rating", value } });
const allKeys = async (sessionId: string) =>
  (await prisma.discoverySessionItem.findMany({ where: { sessionId }, include: { media: { select: { type: true, tmdbId: true } } } })).map((item) => `${item.media.type}:${item.media.tmdbId}`);

describe("Session", () => {
  it("stellt aus echten Daten Karten ohne Wiederholung zusammen", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    const session = await start(user);
    expect(session.state).toBe("ACTIVE");
    expect(session.total).toBeGreaterThan(5);
    expect(session.queue.length).toBeGreaterThan(0);
    const keys = await allKeys(session.id);
    expect(new Set(keys).size).toBe(keys.length);
    const [card] = session.queue.map((item) => item.card);
    expect(card?.title).toBeTruthy();
    expect(card?.genres.length).toBeGreaterThan(0);
    expect(session.counts).toEqual({ interested: 0, notInterested: 0, watched: 0 });
    expect(session.canUndo).toBe(false);
  });

  it("schliesst Gesehenes, Abgelehntes und Vorgemerktes aus", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    await call(libraryPost, { user, body: { kind: "movie", tmdbId: 672, action: "notInterested", on: true } });
    await call(libraryPost, { user, body: { kind: "movie", tmdbId: 673, action: "watchlist", on: true } });
    const session = await start(user);
    const keys = await allKeys(session.id);
    for (const tmdbId of [671, 672, 673]) expect(keys).not.toContain(`MOVIE:${tmdbId}`);
  });

  it("zeigt Abgelehntes auch dann nicht, wenn Gesehenes erlaubt ist", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    await call(libraryPost, { user, body: { kind: "movie", tmdbId: 672, action: "notInterested", on: true } });
    const session = await start(user, "FOR_YOU", { excludeSeen: false, excludeWatchlist: false });
    expect(await allKeys(session.id)).not.toContain("MOVIE:672");
  });

  it("beschränkt sich auf die gewählte Art und das gewählte Genre", async () => {
    const user = await signUp();
    const movies = await start(user, "FOR_YOU", { kinds: "movie", genres: [878] });
    const movieCards = await prisma.discoverySessionItem.findMany({ where: { sessionId: movies.id }, include: { media: true } });
    expect(movieCards.length).toBeGreaterThan(0);
    for (const item of movieCards) {
      expect(item.media.type).toBe("MOVIE");
      expect(item.media.genreIds).toContain(878);
    }
    const series = await start(user, "FOR_YOU", { kinds: "tv" });
    const seriesCards = await prisma.discoverySessionItem.findMany({ where: { sessionId: series.id }, include: { media: true } });
    expect(seriesCards.length).toBeGreaterThan(0);
    expect(seriesCards.every((item) => item.media.type === "TV")).toBe(true);
  });

  it("beachtet Zeitraum, Mindestbewertung und Laufzeit", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie", yearFrom: 2000, yearTo: 2010, ratingMin: 7.5, runtimeMax: 170 });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, select: { card: true } });
    expect(items.length).toBeGreaterThan(0);
    for (const { card } of items) {
      const value = card as unknown as { year: number; voteAverage: number; runtime: number };
      expect(value.year).toBeGreaterThanOrEqual(2000);
      expect(value.year).toBeLessThanOrEqual(2010);
      expect(value.voteAverage).toBeGreaterThanOrEqual(7.5);
      expect(value.runtime).toBeLessThanOrEqual(170);
    }
  });

  it("meldet leere Filter verständlich und lässt die laufende Session in Ruhe", async () => {
    const user = await signUp();
    const running = await start(user);
    const result = await call<{ error: { code: string; message: string } }>(discoveryPost, {
      user,
      body: { mode: "FOR_YOU", filters: { ...DEFAULT_DISCOVERY_FILTERS, yearFrom: 2099, yearTo: 2100 } },
    });
    expect(result.status).toBe(422);
    expect(result.data.error.code).toBe("discovery_empty");
    expect((await prisma.discoverySession.findUniqueOrThrow({ where: { id: running.id } })).state).toBe("ACTIVE");
  });

  it("merkt sich Modus und Filter und erlaubt nur eine aktive Session", async () => {
    const user = await signUp();
    const first = await start(user);
    const second = await start(user, "TOP_RATED", { kinds: "movie" });
    expect((await prisma.discoverySession.findUniqueOrThrow({ where: { id: first.id } })).state).toBe("ABANDONED");
    expect(await prisma.discoverySession.count({ where: { userId: user.id, state: "ACTIVE" } })).toBe(1);
    const state = await call<{ session: DiscoverySessionView; mode: string; filters: DiscoveryFilters }>(discoveryGet, { user });
    expect(state.data.session.id).toBe(second.id);
    expect(state.data.mode).toBe("TOP_RATED");
    expect(state.data.filters.kinds).toBe("movie");
  });

  it("macht nach einer Navigation genau dort weiter, wo sie aufgehört hat", async () => {
    const user = await signUp();
    const session = await start(user);
    const first = await swipe(user, session, "interested");
    const second = await swipe(user, first.session, "not_interested");

    // Ein neuer Seitenaufruf kennt nur die Datenbank.
    const { data } = await call<{ session: DiscoverySessionView }>(discoveryGet, { user });
    expect(data.session.id).toBe(session.id);
    expect(data.session.done).toBe(2);
    expect(data.session.queue[0]?.card.tmdbId).toBe(second.session.queue[0]?.card.tmdbId);
    const titles = data.session.queue.map((item) => item.card.tmdbId);
    expect(titles).not.toContain(first.card.tmdbId);
    expect(titles).not.toContain(second.card.tmdbId);
  });

  it("schliesst nach der letzten Karte ab und liefert jede Karte nur einmal", async () => {
    const user = await signUp();
    let session = await start(user, "FOR_YOU", { kinds: "tv" });
    const seen = new Set<string>();
    while (session.queue.length) {
      const result = await swipe(user, session, "not_interested");
      expect(seen.has(`${result.card.kind}:${result.card.tmdbId}`)).toBe(false);
      seen.add(`${result.card.kind}:${result.card.tmdbId}`);
      session = result.session;
    }
    expect(session.state).toBe("COMPLETED");
    expect(session.done).toBe(session.total);
    expect((await call<{ session: DiscoverySessionView | null }>(discoveryGet, { user })).data.session).toBeNull();
  });
});

describe("Rechts swipen", () => {
  it("setzt den Titel auf die Watchlist und speichert ein leicht positives Signal", async () => {
    const user = await signUp();
    const session = await start(user);
    const { card, item, session: next } = await swipe(user, session, "interested");

    expect(item.watchlisted).toBe(true);
    expect((await stateOf(user))[`${card.kind}:${card.tmdbId}`]?.watchlisted).toBe(true);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id, action: "INTERESTED" } })).toBe(1);
    expect(next.counts.interested).toBe(1);
    expect(next.queue.map((entry) => entry.card.tmdbId)).not.toContain(card.tmdbId);

    const signal = (await loadUserSignals(user.id)).find((entry) => entry.features.tmdbId === card.tmdbId);
    expect(signal?.weight).toBeCloseTo(0.15);
    expect(signal?.swipe).toBe("interested");
  });

  it("legt für den Titel vollständige Daten an, sobald jemand ihn wählt", async () => {
    const user = await signUp();
    const first = await start(user, "FOR_YOU", { kinds: "movie" });
    const { card } = await swipe(user, first, "interested");
    // Vor der Aktion ist es nur ein schlanker Eintrag, danach ein voller Snapshot.
    const media = await prisma.media.findFirstOrThrow({ where: { type: "MOVIE", tmdbId: card.tmdbId } });
    expect(media.fetchedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(media.keywordIds.length + media.genreIds.length).toBeGreaterThan(0);
    const other = await prisma.discoverySessionItem.findFirstOrThrow({ where: { sessionId: first.id, status: "PENDING" }, include: { media: true } });
    expect(other.media.fetchedAt.getTime()).toBe(0);
  });

  it("zählt einen doppelt gesendeten Swipe nur einmal", async () => {
    const user = await signUp();
    const session = await start(user);
    const card = session.queue[0]?.card;
    const body = { sessionId: session.id, kind: card?.kind, tmdbId: card?.tmdbId, action: "interested" };
    const results = await Promise.all([call(swipePost, { user, body }), call(swipePost, { user, body })]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id } })).toBe(1);
    const repeated = await call<SwipeResult>(swipePost, { user, body });
    expect(repeated.status).toBe(200);
    expect(repeated.data.session.counts.interested).toBe(1);
  });
});

describe("Links swipen", () => {
  it("speichert ein negatives Signal und schlägt den Titel nicht mehr vor", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const { card, item } = await swipe(user, session, "not_interested");

    expect(item).toMatchObject({ notInterested: true, watchlisted: false });
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id, action: "NOT_INTERESTED" } })).toBe(1);
    const signal = (await loadUserSignals(user.id)).find((entry) => entry.features.tmdbId === card.tmdbId);
    expect(signal?.weight).toBeCloseTo(-0.5);

    const again = await start(user, "FOR_YOU", { kinds: "movie" });
    expect(await allKeys(again.id)).not.toContain(`MOVIE:${card.tmdbId}`);
    await recomputeRecommendations(user.id);
    const recommended = (await getRecommendationSections(user.id)).flatMap((section) => section.items).map((entry) => entry.tmdbId);
    expect(recommended).not.toContain(card.tmdbId);
  });

  it("zeigt Abgelehntes im Profil und lässt es einzeln und gesammelt zurücksetzen", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const first = await swipe(user, session, "not_interested");
    const second = await swipe(user, first.session, "not_interested");

    const listed = await call<{ titles: { tmdbId: number; title: string }[] }>(rejectedGet, { user });
    expect(listed.data.titles.map((title) => title.tmdbId).sort()).toEqual([first.card.tmdbId, second.card.tmdbId].sort());

    await call(libraryPost, { user, body: { kind: "movie", tmdbId: first.card.tmdbId, action: "notInterested", on: false } });
    expect((await loadUserSignals(user.id)).find((entry) => entry.features.tmdbId === first.card.tmdbId)?.weight).toBe(0);

    const reset = await call<{ reset: number }>(rejectedDelete, { user, method: "DELETE" });
    expect(reset.data.reset).toBe(1);
    expect((await call<{ titles: unknown[] }>(rejectedGet, { user })).data.titles).toEqual([]);
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id, action: "NOT_INTERESTED" } })).toBe(0);
    expect((await stateOf(user))[`movie:${second.card.tmdbId}`]?.notInterested).toBe(false);
  });
});

describe("Nach oben swipen", () => {
  it("speichert den Tagebucheintrag mit den Angaben aus dem Dialog", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const { card, item, session: next } = await swipe(user, session, "watched", { rating: 8.5, watchedAt: "2023-02-03", review: "Stark" });

    expect(item).toMatchObject({ watched: true, rating: 8.5, watchCount: 1, watchlisted: false });
    const entry = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(entry).toMatchObject({ rating: 8.5, review: "Stark" });
    expect(entry.watchedAt?.toISOString().slice(0, 10)).toBe("2023-02-03");
    expect(next.counts.watched).toBe(1);
    expect(next.queue.map((entryItem) => entryItem.card.tmdbId)).not.toContain(card.tmdbId);
  });

  it("speichert ohne Angaben NULL statt des heutigen Datums", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    await swipe(user, session, "watched", {});
    const entry = await prisma.watchDiaryEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(entry.watchedAt).toBeNull();
    expect(entry.rating).toBeNull();
  });

  it("speichert bei ungültigen Angaben nichts", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const card = session.queue[0]?.card;
    const result = await call(swipePost, { user, body: { sessionId: session.id, kind: card?.kind, tmdbId: card?.tmdbId, action: "watched", diary: { watchedAt: "2999-01-01" } } });
    expect(result.status).toBe(400);
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(0);
    const state = await call<{ session: DiscoverySessionView }>(discoveryGet, { user });
    expect(state.data.session.done).toBe(0);
  });

  it("markiert bei Serien alle Episoden", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "tv" });
    const { item } = await swipe(user, session, "watched", {});
    expect(item.episodesWatched).toBeGreaterThan(0);
  });
});

describe("Rückgängig", () => {
  it("nimmt einen Rechts-Swipe vollständig zurück", async () => {
    const user = await signUp();
    const session = await start(user);
    const { card, session: after } = await swipe(user, session, "interested");
    expect(after.canUndo).toBe(true);

    const { session: restored, item } = await undo(user, session);
    expect(item.watchlisted).toBe(false);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id } })).toBe(0);
    expect(restored.queue[0]?.card.tmdbId).toBe(card.tmdbId);
    expect(restored.done).toBe(0);
    expect(restored.counts.interested).toBe(0);
    expect(restored.canUndo).toBe(false);
  });

  it("nimmt einen Links-Swipe zurück und stellt die Watchlist wieder her", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { excludeWatchlist: false });
    const card = session.queue[0]?.card;
    await call(libraryPost, { user, body: { kind: card?.kind, tmdbId: card?.tmdbId, action: "watchlist", on: true } });
    const { item: rejected } = await swipe(user, session, "not_interested");
    expect(rejected).toMatchObject({ notInterested: true, watchlisted: false });

    const { item } = await undo(user, session);
    expect(item).toMatchObject({ notInterested: false, watchlisted: true });
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id } })).toBe(0);
  });

  it("entfernt einen Rechts-Swipe nicht von der Watchlist, wenn der Titel schon dort stand", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { excludeWatchlist: false });
    const card = session.queue[0]?.card;
    await call(libraryPost, { user, body: { kind: card?.kind, tmdbId: card?.tmdbId, action: "watchlist", on: true } });
    await swipe(user, session, "interested");
    const { item } = await undo(user, session);
    expect(item.watchlisted).toBe(true);
  });

  it("nimmt einen Gesehen-Swipe samt Tagebucheintrag und Bewertung zurück", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    await swipe(user, session, "watched", { rating: 9, watchedAt: "2024-01-01" });
    const { item } = await undo(user, session);
    expect(item).toMatchObject({ watched: false, rating: null, watchCount: 0 });
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.rating.count({ where: { userId: user.id } })).toBe(0);
  });

  it("stellt die alte Gesamtbewertung wieder her, wenn der Titel schon gesehen war", async () => {
    const user = await signUp();
    await rate(user, 671, 6);
    const session = await start(user, "FOR_YOU", { kinds: "movie", excludeSeen: false, genres: [14] });
    const index = session.queue.findIndex((entry) => entry.card.tmdbId === 671);
    if (index === -1) return;
    // Karten vor Film 671 wegwischen, damit er an der Reihe ist.
    let current = session;
    for (let step = 0; step < index; step += 1) current = (await swipe(user, current, "interested")).session;
    await swipe(user, current, "watched", { rating: 9.5, watchedAt: "2025-01-01" });
    const { item } = await undo(user, session);
    expect(item).toMatchObject({ watched: true, rating: 6, watchCount: 1 });
  });

  it("stellt bei Serien den Episodenstand wieder her", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "tv" });
    const { item: watched } = await swipe(user, session, "watched", {});
    expect(watched.episodesWatched).toBeGreaterThan(0);
    const { item } = await undo(user, session);
    expect(item.episodesWatched).toBe(0);
    expect(await prisma.episodeProgress.count({ where: { userId: user.id } })).toBe(0);
  });

  it("geht Schritt für Schritt zurück", async () => {
    const user = await signUp();
    const session = await start(user);
    const first = await swipe(user, session, "interested");
    const second = await swipe(user, first.session, "not_interested");
    const third = await swipe(user, second.session, "interested");

    expect((await undo(user, session)).session.queue[0]?.card.tmdbId).toBe(third.card.tmdbId);
    expect((await undo(user, session)).session.queue[0]?.card.tmdbId).toBe(second.card.tmdbId);
    const last = await undo(user, session);
    expect(last.session.queue[0]?.card.tmdbId).toBe(first.card.tmdbId);
    expect(last.session.canUndo).toBe(false);
    expect((await call(undoPost, { user, body: { sessionId: session.id } })).status).toBe(409);
  });

  it("holt eine abgeschlossene Session wieder zurück", async () => {
    const user = await signUp();
    let session = await start(user, "FOR_YOU", { kinds: "tv" });
    while (session.queue.length) session = (await swipe(user, session, "not_interested")).session;
    expect(session.state).toBe("COMPLETED");
    const { session: restored } = await undo(user, session);
    expect(restored.state).toBe("ACTIVE");
    expect(restored.queue).toHaveLength(1);
  });

  it("stört keine neue Session, wenn eine alte zurückgeholt werden soll", async () => {
    const user = await signUp();
    let old = await start(user, "FOR_YOU", { kinds: "tv" });
    while (old.queue.length) old = (await swipe(user, old, "not_interested")).session;
    const fresh = await start(user, "FOR_YOU", { kinds: "movie" });
    expect((await call(undoPost, { user, body: { sessionId: old.id } })).status).toBe(409);
    expect((await prisma.discoverySession.findUniqueOrThrow({ where: { id: fresh.id } })).state).toBe("ACTIVE");
  });
});

describe("Rückgängig stellt genau wieder her, was der Swipe verändert hat", () => {
  const libraryAct = (user: TestUser, body: object) => call(libraryPost, { user, body });

  it("lässt eine Ablehnung bestehen, die nicht von diesem Swipe stammt", async () => {
    const user = await signUp();
    const session = await start(user);
    const card = session.queue[0]?.card;
    await libraryAct(user, { kind: card?.kind, tmdbId: card?.tmdbId, action: "notInterested", on: true });
    await swipe(user, session, "not_interested");
    const { item } = await undo(user, session);
    expect(item.notInterested).toBe(true);
  });

  it("stellt eine Ablehnung wieder her, die ein Rechts-Swipe aufgehoben hat", async () => {
    const user = await signUp();
    const session = await start(user);
    const card = session.queue[0]?.card;
    await libraryAct(user, { kind: card?.kind, tmdbId: card?.tmdbId, action: "notInterested", on: true });
    const { item: swiped } = await swipe(user, session, "interested");
    expect(swiped).toMatchObject({ notInterested: false, watchlisted: true });
    const { item } = await undo(user, session);
    expect(item).toMatchObject({ notInterested: true, watchlisted: false });
  });

  it("lässt später Erfasstes stehen: neuer Sehvorgang, neue Bewertung, keine alte Watchlist", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie", excludeWatchlist: false });
    const card = session.queue[0]?.card;
    const ref = { kind: card?.kind, tmdbId: card?.tmdbId };
    await libraryAct(user, { ...ref, action: "watchlist", on: true });
    await swipe(user, session, "watched", { rating: 9, watchedAt: "2024-01-01" });
    expect((await call(diaryPost, { user, body: { ...ref, rating: 7, watchedAt: "2025-01-01" } })).status).toBe(200);

    const { item } = await undo(user, session);
    expect(item).toMatchObject({ watched: true, watchCount: 1, rating: 7, watchlisted: false });
    expect(await prisma.watchDiaryEntry.count({ where: { userId: user.id } })).toBe(1);
  });

  it("behält den Platz auf der Watchlist", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { excludeWatchlist: false });
    const card = session.queue[0]?.card;
    await libraryAct(user, { kind: card?.kind, tmdbId: card?.tmdbId, action: "watchlist", on: true });
    const original = await prisma.watchlistEntry.findFirstOrThrow({ where: { userId: user.id } });
    await swipe(user, session, "not_interested");
    await undo(user, session);
    const restored = await prisma.watchlistEntry.findFirstOrThrow({ where: { userId: user.id } });
    expect(restored.createdAt.toISOString()).toBe(original.createdAt.toISOString());
  });

  it("stellt eine pausierte Serie samt Episodenstand wieder her", async () => {
    const user = await signUp();
    await libraryAct(user, { kind: "tv", tmdbId: 1396, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true });
    await libraryAct(user, { kind: "tv", tmdbId: 1396, action: "pause", on: true });
    const session = await start(user, "FOR_YOU", { kinds: "tv", excludeSeen: false, excludeWatchlist: false });

    let current = session;
    while (current.queue[0] && current.queue[0].card.tmdbId !== 1396) current = (await swipe(user, current, "not_interested")).session;
    expect(current.queue[0]?.card.tmdbId).toBe(1396);

    const { item: watched } = await swipe(user, current, "watched", {});
    expect(watched.seriesStatus).toBe("COMPLETED");
    const { item } = await undo(user, session);
    expect(item).toMatchObject({ seriesStatus: "PAUSED", episodesWatched: 1 });
  });

  it("hängt nicht an einer Karte ohne Aufzeichnung fest und löscht keine fremden Swipes", async () => {
    const user = await signUp();
    const session = await start(user);
    const first = await swipe(user, session, "interested");
    const second = await swipe(user, first.session, "interested");
    const media = await prisma.media.findFirstOrThrow({ where: { type: second.card.kind === "movie" ? "MOVIE" : "TV", tmdbId: second.card.tmdbId } });
    await prisma.discoverySessionItem.update({ where: { sessionId_mediaId: { sessionId: session.id, mediaId: media.id } }, data: { effect: Prisma.DbNull } });

    expect((await undo(user, session)).session.queue[0]?.card.tmdbId).toBe(second.card.tmdbId);
    // Ohne Prüfung hätte eine fehlende Swipe-ID alle Swipes dieser Person gelöscht.
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id } })).toBe(2);
    expect((await undo(user, session)).session.queue[0]?.card.tmdbId).toBe(first.card.tmdbId);
  });
});

describe("Anderswo entschiedene Karten", () => {
  const libraryAct = (user: TestUser, body: object) => call(libraryPost, { user, body });
  const currentSession = async (user: TestUser) => (await call<{ session: DiscoverySessionView | null }>(discoveryGet, { user })).data.session;

  it("nimmt einen auf der Detailseite abgelehnten Titel aus dem Stapel", async () => {
    const user = await signUp();
    const session = await start(user);
    const card = session.queue[0]?.card;
    await libraryAct(user, { kind: card?.kind, tmdbId: card?.tmdbId, action: "notInterested", on: true });

    const state = await currentSession(user);
    expect(state?.queue.map((item) => item.card.tmdbId)).not.toContain(card?.tmdbId);
    expect(state?.done).toBe(1);
    // Das war keine Swipe-Entscheidung, also gibt es nichts rückgängig zu machen.
    expect(state?.canUndo).toBe(false);
  });

  it("beachtet dabei die Filter der Session", async () => {
    const user = await signUp();
    const strict = await start(user);
    const card = strict.queue[0]?.card;
    await libraryAct(user, { kind: card?.kind, tmdbId: card?.tmdbId, action: "watchlist", on: true });
    expect((await currentSession(user))?.queue.map((item) => item.card.tmdbId)).not.toContain(card?.tmdbId);

    const loose = await start(user, "FOR_YOU", { excludeWatchlist: false });
    const other = loose.queue[0]?.card;
    await libraryAct(user, { kind: other?.kind, tmdbId: other?.tmdbId, action: "watchlist", on: true });
    expect((await currentSession(user))?.queue.map((item) => item.card.tmdbId)).toContain(other?.tmdbId);
  });

  it("schliesst die Session ab, wenn nichts mehr offen ist", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "tv" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, include: { media: true } });
    for (const { media } of items) await libraryAct(user, { kind: "tv", tmdbId: media.tmdbId, action: "notInterested", on: true });
    expect(await currentSession(user)).toBeNull();
    expect((await prisma.discoverySession.findUniqueOrThrow({ where: { id: session.id } })).state).toBe("COMPLETED");
  });
});

describe("Empfehlungen", () => {
  it("rechnet nach Bewertungen und Swipes neu und reagiert auf beides", async () => {
    const user = await signUp();
    for (const [id, value] of [[671, 9], [120, 9], [672, 8]] as const) await rate(user, id, value);
    await recomputeRecommendations(user.id);
    const before = (await loadProfile(user.id)).profile;
    const fantasyBefore = before.genres.get(14)?.score ?? 0;
    const thrillerBefore = before.genres.get(53)?.score ?? 0;

    const session = await start(user, "FOR_YOU", { kinds: "movie", genres: [53], excludeWatchlist: false });
    let current = session;
    let rejected = 0;
    while (current.queue.length && rejected < 3) {
      current = (await swipe(user, current, "not_interested")).session;
      rejected += 1;
    }
    expect(rejected).toBeGreaterThan(0);

    const state = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.dirtyAt).not.toBeNull();

    const after = (await loadProfile(user.id)).profile;
    expect(after.genres.get(53)?.score ?? 0).toBeLessThan(thrillerBefore);
    expect(after.negatives.length).toBeGreaterThanOrEqual(rejected);
    expect(after.genres.get(14)?.score).toBeCloseTo(fantasyBefore, 5);

    await recomputeRecommendations(user.id);
    const sections = await getRecommendationSections(user.id);
    const recommended = sections.flatMap((section) => section.items).map((item) => item.tmdbId);
    const rejectedIds = (await prisma.mediaSwipeInteraction.findMany({ where: { userId: user.id }, include: { media: true } })).map((row) => row.media.tmdbId);
    for (const id of rejectedIds) expect(recommended).not.toContain(id);
  });

  it("lässt wiederholtes Swipen nicht stärker wirken als einen einzelnen Swipe", async () => {
    const user = await signUp();
    const first = await start(user, "FOR_YOU", { kinds: "movie" });
    const { card } = await swipe(user, first, "interested");
    const weight = (await loadUserSignals(user.id)).find((entry) => entry.features.tmdbId === card.tmdbId)?.weight;

    const media = await prisma.media.findFirstOrThrow({ where: { type: "MOVIE", tmdbId: card.tmdbId } });
    await prisma.mediaSwipeInteraction.createMany({ data: Array.from({ length: 5 }, () => ({ userId: user.id, mediaId: media.id, action: "INTERESTED" as const })) });
    expect((await loadUserSignals(user.id)).find((entry) => entry.features.tmdbId === card.tmdbId)?.weight).toBe(weight);
  });

  it("lässt Detailseitenaufrufe nicht ins Profil einfliessen", async () => {
    const user = await signUp();
    const media = await prisma.media.findFirst({ where: { type: "MOVIE" } });
    if (media) await prisma.userInteraction.create({ data: { userId: user.id, mediaId: media.id, type: "DETAIL_VIEW" } });
    expect(await loadUserSignals(user.id)).toEqual([]);
  });

  it("begründet nur mit echten Daten und nennt die Note", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, select: { card: true } });
    const reasons = items.map(({ card }) => (card as unknown as { reason: string | null }).reason).filter((reason): reason is string => reason !== null);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.some((reason) => /mit 9\/10 bewertet hast/.test(reason))).toBe(true);
    for (const reason of reasons) expect(reason).not.toMatch(/gesehen hast/);
  });

  it("behauptet ohne Daten keine Vorliebe", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "movie" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, select: { card: true } });
    for (const { card } of items) expect((card as unknown as { reason: string | null }).reason ?? "").not.toMatch(/Weil du|Lieblingsgenre/);
  });
});

describe("Modi", () => {
  it("führt in «Filmreihen entdecken» durch ungesehene Reihen in der richtigen Reihenfolge", async () => {
    const user = await signUp();
    await rate(user, 603, 9);
    await rate(user, 27205, 9);
    await rate(user, 2270, 8);
    const session = await start(user, "FRANCHISES");
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" }, select: { card: true } });
    const cards = items.map(({ card }) => card as unknown as { collectionId: number | null; year: number; reason: string });
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.every((card) => card.collectionId !== null)).toBe(true);
    // Innerhalb einer Reihe chronologisch, die Reihen selbst bleiben zusammen.
    const byCollection = new Map<number, number[]>();
    for (const card of cards) byCollection.set(card.collectionId as number, [...(byCollection.get(card.collectionId as number) ?? []), card.year]);
    for (const years of byCollection.values()) expect(years).toEqual([...years].sort((a, b) => a - b));
    const blocks = cards.map((card) => card.collectionId).filter((id, index, list) => id !== list[index - 1]);
    expect(new Set(blocks).size).toBe(blocks.length);
    expect(cards[0]?.reason).toMatch(/^Teil 1 von \d+/);
  });

  it("überspringt nach einer Ablehnung den Rest der Reihe und holt ihn beim Rückgängig zurück", async () => {
    const user = await signUp();
    await rate(user, 2270, 8);
    await rate(user, 603, 8);
    const session = await start(user, "FRANCHISES");
    const pendingBefore = session.total - session.done;
    const { session: after } = await swipe(user, session, "not_interested");
    const skipped = await prisma.discoverySessionItem.count({ where: { sessionId: session.id, status: "SKIPPED" } });
    expect(skipped).toBeGreaterThan(0);
    expect(after.done).toBe(1 + skipped);
    const { session: restored } = await undo(user, session);
    expect(restored.total - restored.done).toBe(pendingBefore);
    expect(await prisma.discoverySessionItem.count({ where: { sessionId: session.id, status: "SKIPPED" } })).toBe(0);
  });

  it("zeigt in «Verborgene Schätze» nur statistisch abgesicherte, weniger bekannte Titel", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    const session = await start(user, "HIDDEN_GEMS", { kinds: "movie" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, select: { card: true } });
    expect(items.length).toBeGreaterThan(0);
    for (const { card } of items) {
      const value = card as unknown as { voteCount: number; voteAverage: number; exploration: boolean };
      expect(value.voteCount).toBeGreaterThanOrEqual(100);
    }
  });

  it("zeigt in «Top bewertet» die anerkannten Titel weit vorne", async () => {
    const user = await signUp();
    const session = await start(user, "TOP_RATED", { kinds: "movie" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, orderBy: { position: "asc" }, select: { card: true } });
    const top = items.slice(0, 5).map(({ card }) => (card as unknown as { voteAverage: number }).voteAverage);
    expect(Math.min(...top)).toBeGreaterThanOrEqual(8);
  });

  it("bringt in «Überrasch mich» echte Abwechslung", async () => {
    const user = await signUp();
    await rate(user, 671, 9);
    await rate(user, 120, 9);
    const session = await start(user, "SURPRISE", { kinds: "movie" });
    const items = await prisma.discoverySessionItem.findMany({ where: { sessionId: session.id }, select: { card: true } });
    const genres = new Set(items.flatMap(({ card }) => (card as unknown as { genreIds: number[] }).genreIds));
    expect(genres.size).toBeGreaterThan(4);
  });
});

describe("Benutzerisolierung", () => {
  it("lässt fremde Sessions wie nicht vorhanden aussehen", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    const session = await start(anna);
    const card = session.queue[0]?.card;

    expect((await call(swipePost, { user: ben, body: { sessionId: session.id, kind: card?.kind, tmdbId: card?.tmdbId, action: "interested" } })).status).toBe(404);
    expect((await call(undoPost, { user: ben, body: { sessionId: session.id } })).status).toBe(404);
    expect((await call<{ session: unknown }>(discoveryGet, { user: ben })).data.session).toBeNull();
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: ben.id } })).toBe(0);
    expect(await prisma.watchlistEntry.count({ where: { userId: ben.id } })).toBe(0);

    // Annas Karte ist unverändert noch dran.
    const { data } = await call<{ session: DiscoverySessionView }>(discoveryGet, { user: anna });
    expect(data.session.done).toBe(0);
  });

  it("trennt Swipes und abgelehnte Titel zweier Personen", async () => {
    const anna = await signUp("Anna");
    const ben = await signUp("Ben");
    const session = await start(anna, "FOR_YOU", { kinds: "movie" });
    const { card } = await swipe(anna, session, "not_interested");

    expect((await call<{ titles: unknown[] }>(rejectedGet, { user: ben })).data.titles).toEqual([]);
    expect(await loadUserSignals(ben.id)).toEqual([]);
    const benSession = await start(ben, "FOR_YOU", { kinds: "movie" });
    expect((await stateOf(ben))[`movie:${card.tmdbId}`]?.notInterested ?? false).toBe(false);
    expect(benSession.id).not.toBe(session.id);
  });

  it("verlangt für alle Endpunkte eine Anmeldung", async () => {
    expect((await call(discoveryGet, {})).status).toBe(401);
    expect((await call(discoveryPost, { body: { mode: "FOR_YOU", filters: DEFAULT_DISCOVERY_FILTERS } })).status).toBe(401);
    expect((await call(swipePost, { body: { sessionId: "x", kind: "movie", tmdbId: 1, action: "interested" } })).status).toBe(401);
    expect((await call(undoPost, { body: { sessionId: "x" } })).status).toBe(401);
    expect((await call(rejectedGet, {})).status).toBe(401);
  });

  it("lehnt Titel ab, die nicht zur Session gehören", async () => {
    const user = await signUp();
    const session = await start(user, "FOR_YOU", { kinds: "tv" });
    const result = await call(swipePost, { user, body: { sessionId: session.id, kind: "movie", tmdbId: 671, action: "interested" } });
    expect(result.status).toBe(404);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id } })).toBe(0);
  });
});
