import { describe, expect, it, vi } from "vitest";
import { POST as libraryPost } from "@/app/api/library/route";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { enqueueJob } from "@/server/jobs/queue";
import { runNextJob } from "@/server/jobs/worker";
import { call, signUp, type TestUser } from "./helpers";

// Der Testserver läuft in einem eigenen Prozess; ein Ausfall lässt sich nur hier nachstellen.
const tmdb = vi.hoisted(() => ({ down: false }));
vi.mock("@/server/tmdb/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/tmdb/api")>();
  return {
    ...actual,
    getDetail: (...args: Parameters<typeof actual.getDetail>) => {
      if (tmdb.down) throw new Error("TMDB nicht erreichbar");
      return actual.getDetail(...args);
    },
  };
});

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const isRecent = (date: Date) => date.getTime() > Date.now() - 60_000;

// IDs, die der Testserver nicht kennt: Würde so ein Titel aufgefrischt, verlöre er sein Plakat.
let lastId = 90_000_000 + (Date.now() % 1_000_000);
const nextId = () => (lastId += 1);

function createMedia(data: Partial<Prisma.MediaCreateInput> = {}) {
  return prisma.media.create({ data: { type: "MOVIE", tmdbId: nextId(), title: "Erfundener Titel", posterPath: "/alt.jpg", voteAverage: 7, ...data } });
}

async function act(user: TestUser, body: object) {
  const result = await call(libraryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
}

async function runRefresh() {
  await prisma.job.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
  await enqueueJob("refresh_tmdb_data");
  while (await runNextJob()) {
    // Bis die Queue leer ist.
  }
}

describe("Speicherdauer von TMDB-Daten", () => {
  it("holt alte Titel aus der Bibliothek neu, auch Filme und ungesehene Serien", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "rating", value: 9 });
    await act(user, { kind: "tv", tmdbId: 1396, action: "watchlist", on: true });
    const old = { title: "Veraltet", createdAt: daysAgo(400), fetchedAt: daysAgo(130) };
    await prisma.media.update({ where: { type_tmdbId: { type: "MOVIE", tmdbId: 671 } }, data: old });
    await prisma.media.update({ where: { type_tmdbId: { type: "TV", tmdbId: 1396 } }, data: old });

    await runRefresh();

    const movie = await prisma.media.findUniqueOrThrow({ where: { type_tmdbId: { type: "MOVIE", tmdbId: 671 } } });
    expect(movie.title).toBe("Harry Potter und der Stein der Weisen");
    expect(isRecent(movie.fetchedAt)).toBe(true);
    const series = await prisma.media.findUniqueOrThrow({ where: { type_tmdbId: { type: "TV", tmdbId: 1396 } } });
    expect(series.title).not.toBe("Veraltet");
    expect(isRecent(series.fetchedAt)).toBe(true);
    expect(await prisma.rating.count({ where: { userId: user.id, mediaId: movie.id } })).toBe(1);
  });

  it("führt bekannte Personen beim Auffrischen nach", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "rating", value: 9 });
    await prisma.person.update({ where: { tmdbId: 10980 }, data: { name: "Alter Name", profilePath: null } });
    await prisma.media.update({ where: { type_tmdbId: { type: "MOVIE", tmdbId: 671 } }, data: { createdAt: daysAgo(400), fetchedAt: daysAgo(130) } });

    await runRefresh();

    expect(await prisma.person.findUniqueOrThrow({ where: { tmdbId: 10980 } })).toMatchObject({ name: "Daniel Radcliffe", profilePath: "/p10980.jpg" });
  });

  it("lässt junge Titel und frische schlanke Zeilen in Ruhe", async () => {
    const young = await createMedia({ createdAt: daysAgo(400), fetchedAt: daysAgo(30) });
    const slim = await createMedia({ fetchedAt: new Date(0) });

    await runRefresh();

    expect(await prisma.media.findUniqueOrThrow({ where: { id: young.id } })).toMatchObject({ posterPath: "/alt.jpg", fetchedAt: young.fetchedAt });
    expect(await prisma.media.findUniqueOrThrow({ where: { id: slim.id } })).toMatchObject({ posterPath: "/alt.jpg", fetchedAt: new Date(0) });
  });

  it("löscht alte Titel und Personen, an denen nichts hängt", async () => {
    const unused = await createMedia({ createdAt: daysAgo(130), fetchedAt: new Date(0) });
    const orphan = await prisma.person.create({ data: { tmdbId: nextId(), name: "Niemand" } });
    const kept = await createMedia({ fetchedAt: daysAgo(10) });
    const credited = await prisma.person.create({ data: { tmdbId: nextId(), name: "Jemand" } });
    await prisma.mediaPerson.create({ data: { mediaId: kept.id, personId: credited.id, role: "ACTOR" } });

    await runRefresh();

    expect(await prisma.media.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await prisma.person.findUnique({ where: { id: orphan.id } })).toBeNull();
    expect(await prisma.person.findUnique({ where: { id: credited.id } })).not.toBeNull();
  });

  it("behält von einem bei TMDB entfernten Titel nur den Namen und die persönlichen Daten", async () => {
    const user = await signUp();
    const removed = await createMedia({ title: "Entfernter Film", backdropPath: "/alt-b.jpg", createdAt: daysAgo(200), fetchedAt: daysAgo(200) });
    const person = await prisma.person.create({ data: { tmdbId: nextId(), name: "Besetzung" } });
    await prisma.mediaPerson.create({ data: { mediaId: removed.id, personId: person.id, role: "ACTOR" } });
    await prisma.watchlistEntry.create({ data: { userId: user.id, mediaId: removed.id } });

    await runRefresh();

    const media = await prisma.media.findUniqueOrThrow({ where: { id: removed.id }, include: { credits: true } });
    expect(media).toMatchObject({ title: "Entfernter Film", posterPath: null, backdropPath: null, voteAverage: null, credits: [] });
    expect(isRecent(media.fetchedAt)).toBe(true);
    expect(await prisma.watchlistEntry.count({ where: { userId: user.id, mediaId: removed.id } })).toBe(1);
  });

  it("löscht alte Swipe-Sessions, behält aber die Entscheidungen und neue Sessions", async () => {
    const user = await signUp();
    const swiped = await createMedia();
    const onlyInOldSession = await createMedia({ createdAt: daysAgo(130), fetchedAt: new Date(0) });
    const inNewSession = await createMedia();
    const oldSession = await prisma.discoverySession.create({ data: { userId: user.id, mode: "FOR_YOU", state: "ABANDONED", createdAt: daysAgo(130) } });
    const newSession = await prisma.discoverySession.create({ data: { userId: user.id, mode: "FOR_YOU" } });
    await prisma.discoverySessionItem.createMany({
      data: [
        { sessionId: oldSession.id, mediaId: swiped.id, position: 0, recommendationScore: 1, card: { title: "Alt" } },
        { sessionId: oldSession.id, mediaId: onlyInOldSession.id, position: 1, recommendationScore: 1, card: { title: "Alt" } },
        { sessionId: newSession.id, mediaId: inNewSession.id, position: 0, recommendationScore: 1, card: { title: "Neu" } },
      ],
    });
    await prisma.mediaSwipeInteraction.create({ data: { userId: user.id, mediaId: swiped.id, action: "INTERESTED" } });

    await runRefresh();

    expect(await prisma.discoverySession.findUnique({ where: { id: oldSession.id } })).toBeNull();
    expect(await prisma.discoverySessionItem.count({ where: { sessionId: oldSession.id } })).toBe(0);
    expect(await prisma.discoverySessionItem.count({ where: { sessionId: newSession.id } })).toBe(1);
    expect(await prisma.mediaSwipeInteraction.count({ where: { userId: user.id, mediaId: swiped.id } })).toBe(1);
    // Hing nur an der alten Session und wird im selben Lauf frei.
    expect(await prisma.media.findUnique({ where: { id: onlyInOldSession.id } })).toBeNull();
  });

  it("löscht Empfehlungen inaktiver Konten, ohne die erneute Berechnung zu verhindern", async () => {
    const inactive = await signUp();
    const active = await signUp();
    const computedAt = daysAgo(130);
    const row = { section: "for_you", mediaType: "MOVIE", tmdbId: 671, rank: 0, score: 1, breakdown: {}, reasons: [], card: { title: "Karte" } } as const;
    await prisma.recommendationCache.create({ data: { ...row, userId: inactive.id, computedAt, expiresAt: daysAgo(129) } });
    await prisma.recommendationCache.create({ data: { ...row, userId: active.id, expiresAt: new Date(Date.now() + DAY_MS) } });
    await prisma.recommendationState.update({ where: { userId: inactive.id }, data: { computedAt, sections: [{ id: "for_you", title: "Für dich" }] } });
    await prisma.recommendationState.update({ where: { userId: active.id }, data: { computedAt: new Date(), sections: [{ id: "for_you", title: "Für dich" }] } });

    await runRefresh();

    expect(await prisma.recommendationCache.count({ where: { userId: inactive.id } })).toBe(0);
    expect(await prisma.recommendationCache.count({ where: { userId: active.id } })).toBe(1);
    const state = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: inactive.id } });
    expect(state.sections).toBeNull();
    // Bleibt gesetzt: Nur so gilt der Stand beim nächsten Besuch als veraltet und wird neu berechnet.
    expect(state.computedAt).toEqual(computedAt);
    expect((await prisma.recommendationState.findUniqueOrThrow({ where: { userId: active.id } })).sections).not.toBeNull();
  });

  it("bricht bei einem TMDB-Ausfall ab, ohne Daten anzufassen, und meldet den Fehler", async () => {
    const user = await signUp();
    const due = await createMedia({ createdAt: daysAgo(200), fetchedAt: daysAgo(200) });
    await prisma.watchlistEntry.create({ data: { userId: user.id, mediaId: due.id } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    tmdb.down = true;
    try {
      await runRefresh();
    } finally {
      tmdb.down = false;
      errors.mockRestore();
    }

    expect(await prisma.media.findUniqueOrThrow({ where: { id: due.id } })).toMatchObject({ posterPath: "/alt.jpg", voteAverage: 7, fetchedAt: due.fetchedAt });
    const job = await prisma.job.findFirstOrThrow({ where: { type: "refresh_tmdb_data" }, orderBy: { createdAt: "desc" } });
    expect(job.status).not.toBe("DONE");
    expect(job.lastError).toBe("TMDB nicht erreichbar");

    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE" } });
    await prisma.media.delete({ where: { id: due.id } });
  });
});
