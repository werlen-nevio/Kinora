import { describe, expect, it } from "vitest";
import { findUniverse, UNIVERSES } from "@/data/universes";
import { pickAmbient, rgbToOklch } from "@/lib/ambient-color";
import { age, formatLongDuration, formatRuntime } from "@/lib/format";
import { libraryActionSchema } from "@/lib/library-types";
import { safeNextPath } from "@/lib/safe-path";
import { parseBrowseParams } from "@/lib/search-params";
import { tmdbImageUrl } from "@/lib/tmdb-image";
import { arrangeRelatedRows, type RelatedRow } from "@/server/detail/related";
import { collectionProgress } from "@/server/library/collections";
import { average, decadeDistribution, genreDistribution, monthlyActivity, ratingHistogram } from "@/server/stats/compute";
import { card } from "./fixtures";

describe("Statistik", () => {
  const NOW = new Date("2026-03-15T12:00:00Z");

  it("zählt nur erfasste Sehzeitpunkte, nie Einträge ohne Datum", () => {
    const months = monthlyActivity(
      [
        { watchedAt: new Date("2026-03-01T10:00:00Z"), minutes: 100 },
        { watchedAt: new Date("2026-03-20T10:00:00Z"), minutes: 50 },
        { watchedAt: null, minutes: 999 },
      ],
      NOW,
    );
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toEqual({ month: "2026-03", count: 2, minutes: 150 });
    expect(months.reduce((sum, month) => sum + month.count, 0)).toBe(2);
  });

  it("zeigt lückenlose Monate und lässt ältere Einträge weg", () => {
    const months = monthlyActivity([{ watchedAt: new Date("2020-01-01"), minutes: 10 }], NOW);
    expect(months[0]?.month).toBe("2025-04");
    expect(months.every((month) => month.count === 0)).toBe(true);
  });

  it("baut ein Histogramm über alle 19 Stufen", () => {
    const histogram = ratingHistogram([9, 9, 1, 8.5]);
    expect(histogram).toHaveLength(19);
    expect(histogram[16]).toEqual({ value: 9, count: 2 });
    expect(histogram[15]).toEqual({ value: 8.5, count: 1 });
    expect(histogram[8]).toEqual({ value: 5, count: 0 });
  });

  it("gruppiert Jahrzehnte aufsteigend und überspringt fehlende Jahre", () => {
    expect(decadeDistribution([2001, 2009, 1994, null])).toEqual([
      { decade: 1990, count: 1 },
      { decade: 2000, count: 2 },
    ]);
  });

  it("sortiert Genres nach Häufigkeit und überspringt unbekannte IDs", () => {
    const names = new Map([
      [1, "Fantasy"],
      [2, "Drama"],
    ]);
    expect(genreDistribution([{ genreIds: [1, 2, 99] }, { genreIds: [1] }], names)).toEqual([
      { id: 1, name: "Fantasy", count: 2 },
      { id: 2, name: "Drama", count: 1 },
    ]);
  });

  it("gibt ohne Werte keinen Durchschnitt an", () => {
    expect(average([])).toBeNull();
    expect(average([8, 10])).toBe(9);
  });
});

describe("Filmreihen-Fortschritt", () => {
  const parts = [671, 672, 673, 674, 675, 767, 12444, 12445].map((id, index) => card(id, { releaseDate: `200${index}-01-01` }));
  const collection = { id: 1241, name: "Harry Potter", overview: "", posterPath: null, backdropPath: null, parts };

  it("zeigt 5 von 8 und den nächsten ungesehenen Teil", () => {
    const progress = collectionProgress(collection, new Set([671, 672, 673, 674, 675]), "2026-01-01");
    expect(progress).toMatchObject({ seen: 5, total: 8, percent: 63, complete: false });
    expect(progress.next?.tmdbId).toBe(767);
  });

  it("zählt angekündigte Teile nicht als verpasst", () => {
    const withFuture = { ...collection, parts: [...parts, card(99, { releaseDate: "2099-01-01" })] };
    const progress = collectionProgress(withFuture, new Set(parts.map((part) => part.tmdbId)), "2026-01-01");
    expect(progress).toMatchObject({ seen: 8, total: 8, complete: true, next: null });
  });
});

describe("Verwandte Reihen", () => {
  const row = (id: string, priority: number, ids: number[], genreIds: number[] = []): RelatedRow => ({
    id,
    title: id,
    priority,
    items: ids.map((tmdbId) => card(tmdbId, { genreIds })),
  });

  it("zeigt jeden Titel nur einmal, nach Priorität", () => {
    const rows = arrangeRelatedRows([row("similar", 5, [1, 2, 3, 4]), row("actor", 3, [3, 4, 5, 6, 7])], { exclude: new Set() });
    expect(rows.find((entry) => entry.id === "similar")?.items.map((item) => item.tmdbId)).toEqual([1, 2, 3, 4]);
    expect(rows.find((entry) => entry.id === "actor")?.items.map((item) => item.tmdbId)).toEqual([5, 6, 7]);
  });

  it("zeigt einen Titel auch innerhalb einer Reihe nur einmal", () => {
    // Eine Person mit zwei Aufgaben am selben Titel erscheint in den Credits doppelt.
    const rows = arrangeRelatedRows([row("creator", 4, [1, 1, 2, 2, 3])], { exclude: new Set() });
    expect(rows[0]?.items.map((item) => item.tmdbId)).toEqual([1, 2, 3]);
  });

  it("schliesst den aktuellen Film und zu kurze Reihen aus", () => {
    const rows = arrangeRelatedRows([row("a", 5, [1, 2, 3, 4]), row("b", 4, [1, 2, 5])], { exclude: new Set(["movie:1"]) });
    expect(rows.map((entry) => entry.id)).toEqual(["a"]);
    expect(rows[0]?.items.map((item) => item.tmdbId)).toEqual([2, 3, 4]);
  });

  it("ordnet nach persönlicher Passung um", () => {
    const rows = [row("drama", 4, [1, 2, 3, 4, 5], [18]), row("fantasy", 3.8, [6, 7, 8, 9, 10], [14])];
    expect(arrangeRelatedRows(rows, { exclude: new Set() })[0]?.id).toBe("drama");
    const genreAffinity = new Map([
      [14, 0.9],
      [18, -0.5],
    ]);
    expect(arrangeRelatedRows(rows, { exclude: new Set(), genreAffinity })[0]?.id).toBe("fantasy");
  });
});

describe("Ambient-Farbe", () => {
  const pixels = (r: number, g: number, b: number, count = 100) => Uint8Array.from({ length: count * 3 }, (_, index) => [r, g, b][index % 3]!);

  it("wandelt Farben korrekt nach OKLCH", () => {
    expect(rgbToOklch(255, 255, 255).l).toBeCloseTo(1, 1);
    expect(rgbToOklch(0, 0, 0).l).toBeCloseTo(0, 1);
    expect(rgbToOklch(128, 128, 128).c).toBeLessThan(0.01);
  });

  it("liefert für farbige Bilder eine normierte Farbe", () => {
    const ambient = pickAmbient(pixels(200, 40, 40));
    expect(ambient?.accent).toMatch(/^oklch\(0\.8 /);
    expect(ambient?.glow).toMatch(/^oklch\(0\.42 /);
  });

  it("bleibt bei grauen und schwarzen Bildern neutral, statt eine Farbe zu erfinden", () => {
    expect(pickAmbient(pixels(120, 120, 120))).toBeNull();
    expect(pickAmbient(pixels(0, 0, 0))).toBeNull();
    expect(pickAmbient(new Uint8Array())).toBeNull();
  });

  it("bleibt beim Farbton der Vorlage", () => {
    const hueOf = (value: string | undefined) => Number(value?.split(" ")[2]?.replace(")", ""));
    const red = hueOf(pickAmbient(pixels(200, 40, 40))?.accent);
    const blue = hueOf(pickAmbient(pixels(40, 40, 200))?.accent);
    expect(Math.abs(red - blue)).toBeGreaterThan(90);
  });
});

describe("Hilfsfunktionen", () => {
  it("formatiert Laufzeiten", () => {
    expect(formatRuntime(152)).toBe("2 Std. 32 Min.");
    expect(formatRuntime(45)).toBe("45 Min.");
    expect(formatRuntime(120)).toBe("2 Std.");
    expect(formatRuntime(0)).toBeNull();
    expect(formatRuntime(null)).toBeNull();
  });

  it("zeigt lange Dauer in Tagen", () => {
    expect(formatLongDuration(0)).toBe("0 Std.");
    expect(formatLongDuration(600)).toBe("10 Std.");
    expect(formatLongDuration(60 * 50)).toBe("2 Tage 2 Std.");
  });

  it("rechnet das Alter nach Geburtstag", () => {
    expect(age("2000-06-15", "2026-06-14")).toBe(25);
    expect(age("2000-06-15", "2026-06-15")).toBe(26);
  });

  it("verhindert offene Weiterleitungen", () => {
    expect(safeNextPath("/film/671")).toBe("/film/671");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });

  it("lässt sich nicht mit Steuerzeichen austricksen, die der URL-Parser entfernt", () => {
    for (const attack of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\t\\evil.example", "\t//evil.example"]) {
      expect(safeNextPath(attack), JSON.stringify(attack)).toBe("/");
    }
  });

  it("behält Pfad, Suche und Anker interner Ziele", () => {
    expect(safeNextPath("/suche?q=harry#ergebnisse")).toBe("/suche?q=harry#ergebnisse");
  });

  it("wählt die kleinste ausreichende TMDB-Bildgrösse", () => {
    expect(tmdbImageUrl("/a.jpg", "poster", 300)).toBe("https://image.tmdb.org/t/p/w342/a.jpg");
    expect(tmdbImageUrl("/a.jpg", "backdrop", 3000)).toBe("https://image.tmdb.org/t/p/original/a.jpg");
    expect(tmdbImageUrl("/a.jpg", "profile", 9999)).toBe("https://image.tmdb.org/t/p/h632/a.jpg");
  });

  it("liest Filter robust aus der URL", () => {
    expect(parseBrowseParams({ typ: "tv", genres: "14,12,x", von: "2000", bewertung: "99" })).toMatchObject({ typ: "tv", genres: [14, 12], von: 2000, bewertung: undefined, seite: 1 });
    expect(parseBrowseParams({ typ: "<script>", sortierung: "drop table" })).toMatchObject({ typ: "movie", sortierung: "popularity.desc" });
  });
});

describe("Eingaben", () => {
  it("akzeptiert nur gültige Bibliotheksaktionen", () => {
    const ok = (value: unknown) => libraryActionSchema.safeParse(value).success;
    expect(ok({ kind: "movie", tmdbId: 1, action: "rating", value: 10 })).toBe(true);
    expect(ok({ kind: "movie", tmdbId: 1, action: "rating", value: null })).toBe(true);
    expect(ok({ kind: "movie", tmdbId: 1, action: "rating", value: 11 })).toBe(false);
    expect(ok({ kind: "movie", tmdbId: 1, action: "rating", value: 0 })).toBe(false);
    expect(ok({ kind: "movie", tmdbId: 1, action: "rating", value: 8.25 })).toBe(false);
    expect(ok({ kind: "movie", tmdbId: -1, action: "watchlist", on: true })).toBe(false);
    expect(ok({ kind: "game", tmdbId: 1, action: "watchlist", on: true })).toBe(false);
    expect(ok({ kind: "movie", tmdbId: 1, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true })).toBe(false);
    expect(ok({ kind: "tv", tmdbId: 1, action: "episode", seasonNumber: 1, episodeNumber: 1, on: true })).toBe(true);
    expect(ok({ kind: "movie", tmdbId: 1, action: "watched", on: true, watchedAt: "2999-01-01" })).toBe(false);
    expect(ok({ kind: "movie", tmdbId: 1, action: "watched", on: true, watchedAt: null })).toBe(true);
    expect(ok({ kind: "movie", tmdbId: 1, action: "drop" })).toBe(false);
  });
});

describe("Kuratierte Universen", () => {
  it("führt Harry Potter und Phantastische Tierwesen zusammen", () => {
    expect(findUniverse(1241, 671)?.collectionIds).toContain(435259);
    expect(findUniverse(435259, 259316)?.id).toBe("wizarding-world");
  });

  it("findet auch Einzelfilme ohne eigene Collection", () => {
    expect(findUniverse(null, 330459)?.id).toBe("star-wars");
  });

  it("liefert für andere Titel nichts und hat eindeutige IDs", () => {
    expect(findUniverse(null, 27205)).toBeNull();
    expect(new Set(UNIVERSES.map((universe) => universe.id)).size).toBe(UNIVERSES.length);
  });
});
