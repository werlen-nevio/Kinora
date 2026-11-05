import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { DELETE as avatarDelete, POST as avatarPost } from "@/app/api/account/avatar/route";
import { PATCH as preferencesPatch } from "@/app/api/account/preferences/route";
import { GET as healthGet } from "@/app/api/health/route";
import { POST as libraryPost } from "@/app/api/library/route";
import { GET as browseGet } from "@/app/api/browse/route";
import { GET as peopleGet } from "@/app/api/people/route";
import { GET as searchGet } from "@/app/api/search/route";
import { GET as providersGet } from "@/app/api/watchlist/providers/route";
import { GET as orderGet } from "@/app/api/watchlist/order/route";
import { getAmbient } from "@/server/ambient";
import { prisma } from "@/server/db";
import { arrangeRelatedRows } from "@/server/detail/related";
import { getRelatedPeople } from "@/server/detail/person";
import { getCompletableCollections, getNewReleases, getTopRatedRow, getTrendingRow, getUpcoming } from "@/server/home/rows";
import { enqueueJob, claimJob, completeJob, failJob } from "@/server/jobs/queue";
import { runNextJob } from "@/server/jobs/worker";
import { getStartedCollections } from "@/server/library/collections";
import { getUserStats } from "@/server/stats/service";
import { discover, getCollection, getEpisode, getMovie, getPerson, getSeason, getTv, searchMulti } from "@/server/tmdb/api";
import { call, ORIGIN, signUp, type TestUser } from "./helpers";

async function act(user: TestUser, body: object) {
  const result = await call(libraryPost, { user, body });
  expect(result.status, JSON.stringify(result.data)).toBe(200);
}

describe("TMDB-Anbindung", () => {
  it("lädt Filmdetails mit einer einzigen Anfrage samt allem Angehängten", async () => {
    const movie = await getMovie(671);
    expect(movie).toMatchObject({ title: "Harry Potter und der Stein der Weisen", originalTitle: "Harry Potter and the Philosopher's Stone", year: 2001, runtime: 152, ageRating: "CH 6" });
    expect(movie.collection?.id).toBe(1241);
    expect(movie.cast[0]).toMatchObject({ name: "Daniel Radcliffe" });
    expect(movie.crew.find((member) => member.job === "Director")?.name).toBe("Chris Columbus");
    expect(movie.videos[0]?.type).toBe("Trailer");
    expect(movie.providersByRegion.CH?.flatrate[0]?.name).toBe("Netflix");
    expect(movie.recommendations.length).toBeGreaterThan(0);
  });

  it("füllt fehlende deutsche Beschreibungen auf Englisch auf", async () => {
    expect((await getMovie(347031)).overview).toContain("hopeless man");
  });

  it("liefert für unbekannte Titel einen klaren Fehler", async () => {
    await expect(getMovie(99999999)).rejects.toMatchObject({ code: "not_found" });
  });

  it("sortiert die acht Harry-Potter-Filme chronologisch", async () => {
    const collection = await getCollection(1241);
    expect(collection.parts).toHaveLength(8);
    expect(collection.parts.map((part) => part.tmdbId)).toEqual([671, 672, 673, 674, 675, 767, 12444, 12445]);
  });

  it("lädt Serien, Staffeln und Episoden", async () => {
    const series = await getTv(1396);
    expect(series).toMatchObject({ title: "Breaking Bad", numberOfSeasons: 5, numberOfEpisodes: 62 });
    expect(series.createdBy[0]?.name).toBe("Vince Gilligan");
    const season = await getSeason(1396, 1);
    expect(season.episodes).toHaveLength(7);
    expect((await getEpisode(1396, 1, 3)).episodeNumber).toBe(3);
  });

  it("lädt Personen mit der gesamten Filmografie", async () => {
    const person = await getPerson(10980);
    expect(person).toMatchObject({ name: "Daniel Radcliffe", birthday: "1989-07-23", knownForDepartment: "Acting" });
    expect(person.credits.filter((credit) => credit.creditType === "cast").length).toBeGreaterThanOrEqual(11);
  });

  it("nennt verwandte Personen nur mit gemeinsamen Produktionen", async () => {
    const related = await getRelatedPeople(await getPerson(10980));
    const emma = related.find((person) => person.name === "Emma Watson");
    expect(emma?.sharedTitles.length).toBeGreaterThanOrEqual(2);
    expect(related.every((person) => person.sharedTitles.length > 0)).toBe(true);
    expect(related.some((person) => person.name === "Daniel Radcliffe")).toBe(false);
  });

  it("speichert Antworten im Datenbank-Cache", async () => {
    await getMovie(603);
    // Das Schreiben blockiert die Antwort nicht und läuft deshalb nach.
    await vi.waitFor(async () => {
      expect(await prisma.tmdbCache.count({ where: { key: { startsWith: "/movie/603" } } })).toBeGreaterThan(0);
    });
  });

  it("filtert über Discover", async () => {
    const page = await discover({ kind: "movie", cast: [10980], sort: "vote_average.desc" });
    expect(page.results.map((card) => card.tmdbId)).toContain(671);
    expect(page.results.every((card) => card.tmdbId !== 27205)).toBe(true);
  });
});

describe("Suche", () => {
  it("findet Filme und Personen in einer Anfrage", async () => {
    const results = await searchMulti("Harry Potter");
    expect(results.media.filter((card) => card.kind === "movie").length).toBe(8);
    const radcliffe = await searchMulti("Radcliffe");
    expect(radcliffe.people[0]?.name).toBe("Daniel Radcliffe");
  });

  it("trennt die Live-Suche nach Filmen, Serien und Personen", async () => {
    const user = await signUp();
    const { data, status } = await call<{ movies: unknown[]; series: unknown[]; people: unknown[] }>(searchGet, { user, path: "/api/search?q=breaking" });
    expect(status).toBe(200);
    expect(data.series).toHaveLength(1);
    expect(data.movies).toHaveLength(0);
  });

  it("lehnt leere Suchen ab und kommt mit leeren Treffern klar", async () => {
    const user = await signUp();
    expect((await call(searchGet, { user, path: "/api/search?q=" })).status).toBe(400);
    const empty = await call<{ totalResults: number }>(searchGet, { user, path: "/api/search?q=gibtesgarnicht" });
    expect(empty.data.totalResults).toBe(0);
  });

  it("wendet in der erweiterten Suche Filter an", async () => {
    const user = await signUp();
    const fantasy = await call<{ results: { genreIds: number[] }[] }>(browseGet, { user, path: "/api/browse?typ=movie&genres=14" });
    expect(fantasy.data.results.length).toBeGreaterThan(0);
    expect(fantasy.data.results.every((card) => card.genreIds.includes(14))).toBe(true);
    const text = await call<{ results: { year: number }[] }>(browseGet, { user, path: "/api/browse?typ=movie&q=Harry&von=2009" });
    expect(text.data.results.length).toBe(3);
  });

  it("findet Personen für die Filter", async () => {
    const user = await signUp();
    const { data } = await call<{ people: { name: string }[] }>(peopleGet, { user, path: "/api/people?q=nolan" });
    expect(data.people[0]?.name).toBe("Christopher Nolan");
  });
});

describe("Startseiten-Reihen", () => {
  it("liefert echte Daten für die allgemeinen Reihen", async () => {
    expect((await getTrendingRow("de-DE")).length).toBeGreaterThan(0);
    expect((await getNewReleases("de-DE", "CH")).length).toBeGreaterThan(0);
    expect((await getUpcoming("de-DE", "CH")).length).toBeGreaterThan(0);
  });

  it("zeigt in «Neu erschienen» und «Demnächst» nur passende Daten", async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await getNewReleases("de-DE", "CH")).every((card) => card.releaseDate! <= today)).toBe(true);
    expect((await getUpcoming("de-DE", "CH")).every((card) => card.releaseDate! > today)).toBe(true);
  });

  it("sortiert die Bestenliste mit Korrektur für wenige Stimmen", async () => {
    const rows = await getTopRatedRow("de-DE");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((card) => (card.voteCount ?? 0) >= 2000)).toBe(true);
  });

  it("zeigt Filmreihen mit Fortschritt und nächstem Teil", async () => {
    const user = await signUp();
    for (const id of [671, 672, 673, 674, 675]) await act(user, { kind: "movie", tmdbId: id, action: "watched", on: true });
    const [row] = await getCompletableCollections(user.id, "de-DE");
    expect(row).toMatchObject({ id: 1241, seen: 5, total: 8, percent: 63, nextHref: "/film/767" });
  });

  it("nimmt abgeschlossene Filmreihen aus der Liste", async () => {
    const user = await signUp();
    for (const id of [120, 121, 122]) await act(user, { kind: "movie", tmdbId: id, action: "watched", on: true });
    expect(await getCompletableCollections(user.id, "de-DE")).toEqual([]);
    expect((await getStartedCollections(user.id)).find((entry) => entry.id === 119)?.complete).toBe(true);
  });
});

describe("Verwandte Reihen auf der Filmseite", () => {
  it("vermeidet Dubletten und zeigt den Film selbst nicht", async () => {
    const movie = await getMovie(671);
    const rows = arrangeRelatedRows(
      [
        { id: "similar", title: "Ähnlich", priority: 5, items: movie.similar },
        { id: "recommendations", title: "Empfehlungen", priority: 4.5, items: movie.recommendations },
      ],
      { exclude: new Set(["movie:671"]) },
    );
    const ids = rows.flatMap((row) => row.items.map((card) => card.tmdbId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(671);
  });
});

describe("Statistiken", () => {
  it("zählt erfasste Sehzeitpunkte, aber nichts ohne Datum in der Zeitachse", async () => {
    const user = await signUp();
    const thisMonth = new Date().toISOString().slice(0, 10);
    await act(user, { kind: "movie", tmdbId: 671, action: "watched", on: true, watchedAt: thisMonth });
    await act(user, { kind: "movie", tmdbId: 672, action: "watched", on: true, watchedAt: null });
    await act(user, { kind: "movie", tmdbId: 120, action: "rating", value: 8 });

    const stats = await getUserStats(user.id);
    expect(stats).toMatchObject({ moviesWatched: 3, datedEvents: 1, undatedEvents: 2, ratingCount: 1, averageRating: 8 });
    expect(stats.months.reduce((sum, month) => sum + month.count, 0)).toBe(1);
    expect(stats.timeline.map((entry) => entry.tmdbId)).toEqual([671]);
    expect(stats.totalMinutes).toBe(152 + 161 + 179);
  });

  it("zählt Erscheinungsjahr nicht als Sehjahr", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 900001, action: "rating", value: 8 });
    const stats = await getUserStats(user.id);
    expect(stats.decades.length).toBe(1);
    expect(stats.months.every((month) => month.count === 0)).toBe(true);
  });

  it("berechnet Genres, Personen und Filmreihen aus der Bibliothek", async () => {
    const user = await signUp();
    for (const id of [120, 121, 122]) await act(user, { kind: "movie", tmdbId: id, action: "rating", value: 9 });
    await act(user, { kind: "tv", tmdbId: 1396, action: "season", seasonNumber: 1, on: true });

    const stats = await getUserStats(user.id);
    expect(stats.collectionsCompleted).toBe(1);
    expect(stats.genres.find((genre) => genre.name === "Fantasy")?.count).toBe(3);
    expect(stats.actors[0]).toMatchObject({ count: 3 });
    expect(stats.directors[0]).toMatchObject({ name: "Peter Jackson", count: 3 });
    expect(stats.episodesWatched).toBe(7);
    expect(stats.topTitles).toHaveLength(3);
    expect(stats.ratings[16]).toEqual({ value: 9, count: 3 });
    expect(stats.tasteSummary).toContain("Abenteuer");
  });

  it("zählt Serien erst als abgeschlossen, wenn alles Ausgestrahlte gesehen ist", async () => {
    const user = await signUp();
    await act(user, { kind: "tv", tmdbId: 66732, action: "season", seasonNumber: 1, on: true });
    expect((await getUserStats(user.id)).seriesCompleted).toBe(1);

    const other = await signUp();
    await act(other, { kind: "tv", tmdbId: 1396, action: "season", seasonNumber: 1, on: true });
    expect((await getUserStats(other.id)).seriesCompleted).toBe(0);
  });
});

describe("Job-Queue", () => {
  it("legt pro dedupeKey nur einen offenen Job an", async () => {
    const key = `test-${Date.now()}`;
    await enqueueJob("cleanup", {}, { dedupeKey: key });
    await enqueueJob("cleanup", {}, { dedupeKey: key });
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(1);
  });

  it("vergibt einen Job nie doppelt und erlaubt danach einen neuen", async () => {
    await prisma.job.deleteMany({ where: { status: "PENDING" } });
    const key = `test-claim-${Date.now()}`;
    await enqueueJob("cleanup", {}, { dedupeKey: key });
    const claims = await Promise.all([claimJob(), claimJob(), claimJob()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await completeJob(claims.find(Boolean)!.id);
    await enqueueJob("cleanup", {}, { dedupeKey: key });
    expect(await prisma.job.count({ where: { dedupeKey: key } })).toBe(2);
  });

  it("wiederholt fehlgeschlagene Jobs und gibt irgendwann auf", async () => {
    const job = { id: "", attempts: 1, maxAttempts: 2 };
    const created = await prisma.job.create({ data: { type: "cleanup", status: "RUNNING" } });
    job.id = created.id;
    await failJob(job, new Error("kaputt"));
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "PENDING", lastError: "kaputt" });
    await failJob({ ...job, attempts: 2 }, new Error("wieder kaputt"));
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
  });

  it("führt die Neuberechnung im Worker aus", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "rating", value: 10 });
    await prisma.job.updateMany({ where: { status: "PENDING", dedupeKey: { startsWith: "recs:", not: `recs:${user.id}` } }, data: { status: "DONE" } });
    await prisma.job.updateMany({ where: { dedupeKey: `recs:${user.id}` }, data: { runAt: new Date(0) } });
    while (await runNextJob()) {
      // Bis die Queue leer ist.
    }
    const state = await prisma.recommendationState.findUniqueOrThrow({ where: { userId: user.id } });
    expect(state.computedAt).not.toBeNull();
    expect(state.signalCount).toBe(1);
  });
});

describe("Profil", () => {
  function avatarRequest(user: TestUser, file: Blob, filename = "bild.png") {
    const form = new FormData();
    form.append("avatar", file, filename);
    return new Request(`${ORIGIN}/api/account/avatar`, { method: "POST", headers: { Cookie: user.cookie, Origin: ORIGIN }, body: form });
  }

  it("kodiert Profilbilder neu und entfernt Metadaten", async () => {
    const user = await signUp();
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#884422" } }).withMetadata({ exif: { IFD0: { Copyright: "Geheim" } } }).png().toBuffer();
    const response = await avatarPost(avatarRequest(user, new Blob([new Uint8Array(png)], { type: "image/png" })));
    expect(response.status).toBe(200);

    const stored = await prisma.userAvatar.findUniqueOrThrow({ where: { userId: user.id } });
    const metadata = await sharp(Buffer.from(stored.data)).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 320, height: 320 });
    expect(metadata.exif).toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).image).toContain("/api/account/avatar");
  });

  it("lehnt SVG und andere Nicht-Bilder ab", async () => {
    const user = await signUp();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    expect((await avatarPost(avatarRequest(user, new Blob([svg], { type: "image/svg+xml" }), "x.svg"))).status).toBe(400);
    expect((await avatarPost(avatarRequest(user, new Blob(["<html>"], { type: "image/png" })))).status).toBe(400);
    expect(await prisma.userAvatar.count({ where: { userId: user.id } })).toBe(0);
  });

  it("begrenzt die Dateigrösse", async () => {
    const user = await signUp();
    const huge = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });
    expect((await avatarPost(avatarRequest(user, huge))).status).toBe(413);
  });

  it("entfernt das Profilbild wieder", async () => {
    const user = await signUp();
    await prisma.userAvatar.create({ data: { userId: user.id, data: Buffer.from("x"), mimeType: "image/webp" } });
    expect((await call(avatarDelete, { user, method: "DELETE" })).status).toBe(200);
    expect(await prisma.userAvatar.count({ where: { userId: user.id } })).toBe(0);
  });

  it("speichert Sprache, Region und Genre-Vorlieben", async () => {
    const user = await signUp();
    const result = await call(preferencesPatch, { user, method: "PATCH", body: { language: "en-US", region: "DE", showRecommendationWhy: false, genres: [{ genreId: 14, weight: 1 }, { genreId: 27, weight: -1 }] } });
    expect(result.status).toBe(200);
    expect(await prisma.userPreference.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ language: "en-US", region: "DE", showRecommendationWhy: false });
    expect(await prisma.userGenrePreference.count({ where: { userId: user.id } })).toBe(2);
  });

  it("lehnt unbekannte Sprachen ab", async () => {
    const user = await signUp();
    expect((await call(preferencesPatch, { user, method: "PATCH", body: { language: "xx-XX" } })).status).toBe(400);
  });
});

describe("Watchlist-Zusatzdaten", () => {
  it("liefert Anbieter der Region je Titel", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "watchlist", on: true });
    const { data } = await call<{ region: string; providers: { name: string }[]; byItem: Record<string, number[]> }>(providersGet, { user });
    expect(data.region).toBe("CH");
    expect(data.providers.map((provider) => provider.name)).toContain("Netflix");
    expect(data.byItem["movie:671"]).toContain(8);
  });

  it("liefert die empfohlene Reihenfolge", async () => {
    const user = await signUp();
    await act(user, { kind: "movie", tmdbId: 671, action: "watchlist", on: true });
    await act(user, { kind: "movie", tmdbId: 238, action: "watchlist", on: true });
    const { data } = await call<{ order: string[] }>(orderGet, { user });
    expect(data.order.sort()).toEqual(["movie:238", "movie:671"]);
  });
});

describe("Ambient-Licht", () => {
  it("berechnet die Farbe aus dem Bild und merkt sie sich", async () => {
    const ambient = await getAmbient("/m671b.jpg");
    expect(ambient?.accent).toMatch(/^oklch/);
    expect(await prisma.tmdbCache.count({ where: { key: "ambient:/m671b.jpg" } })).toBe(1);
    expect(await getAmbient("/m671b.jpg")).toEqual(ambient);
  });

  it("weist unsichere Pfade ab", async () => {
    expect(await getAmbient("/../../etc/passwd")).toBeNull();
    expect(await getAmbient("https://evil.example/a.jpg")).toBeNull();
    expect(await getAmbient(null)).toBeNull();
  });
});

describe("Betrieb", () => {
  it("meldet im Healthcheck den Datenbankzustand", async () => {
    const response = await healthGet();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
