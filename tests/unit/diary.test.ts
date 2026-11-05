import { describe, expect, it } from "vitest";
import {
  combineWatchedAt,
  createDiaryEntrySchema,
  type DiaryEntryView,
  EMPTY_DIARY_FILTERS,
  filterDiary,
  groupDiary,
  isInFuture,
  latestRatedEntry,
  localToday,
  monthGrid,
  RATING_VALUES,
  type RatedEntry,
  ratingSchema,
  resolveOverallRating,
  shiftMonth,
  updateDiaryEntrySchema,
} from "@/lib/diary";
import { dailyActivity, monthlyActivity, yearlyActivity } from "@/server/stats/compute";

function entry(id: string, patch: Partial<DiaryEntryView> = {}): DiaryEntryView {
  return {
    id,
    kind: "movie",
    tmdbId: 1,
    title: `Film ${id}`,
    year: 2001,
    posterPath: null,
    backdropPath: null,
    runtime: 120,
    genreIds: [],
    watchedDate: null,
    watchedTime: null,
    rating: null,
    review: null,
    isRewatch: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function rated(id: string, rating: number | null, watchedAt: string | null, createdAt = "2026-01-01"): RatedEntry {
  return { id, rating, watchedAt: watchedAt ? new Date(watchedAt) : null, createdAt: new Date(createdAt) };
}

describe("Bewertungsskala", () => {
  it("kennt 19 Stufen von 1 bis 10", () => {
    expect(RATING_VALUES).toHaveLength(19);
    expect(RATING_VALUES[0]).toBe(1);
    expect(RATING_VALUES[1]).toBe(1.5);
    expect(RATING_VALUES.at(-1)).toBe(10);
  });

  it("nimmt halbe Punkte an und lehnt alles andere ab", () => {
    for (const value of [1, 1.5, 8.5, 10]) expect(ratingSchema.safeParse(value).success).toBe(true);
    for (const value of [0, 0.5, 8.25, 10.5, Number.NaN]) expect(ratingSchema.safeParse(value).success).toBe(false);
  });
});

describe("Sehzeitpunkt", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("legt Ortszeit unverändert ab", () => {
    expect(combineWatchedAt("2024-03-12", "20:15").toISOString()).toBe("2024-03-12T20:15:00.000Z");
    expect(combineWatchedAt("2024-03-12").toISOString()).toBe("2024-03-12T00:00:00.000Z");
  });

  it("erkennt die Zukunft, lässt aber Zeitzonen östlich von UTC durch", () => {
    expect(isInFuture("2026-06-15", null, NOW)).toBe(false);
    expect(isInFuture("2026-06-16", "01:00", NOW)).toBe(false);
    expect(isInFuture("2026-06-17", null, NOW)).toBe(true);
  });

  it("bestimmt das heutige Datum in der Zeitzone des Browsers", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("Eingaben", () => {
  const base = { kind: "movie", tmdbId: 671 };

  it("erlaubt einen Eintrag ganz ohne Angaben", () => {
    expect(createDiaryEntrySchema.safeParse(base).success).toBe(true);
  });

  it("verlangt für eine Uhrzeit ein Datum", () => {
    expect(createDiaryEntrySchema.safeParse({ ...base, watchedTime: "20:00" }).success).toBe(false);
    expect(createDiaryEntrySchema.safeParse({ ...base, watchedAt: "2024-01-01", watchedTime: "20:00" }).success).toBe(true);
  });

  it("lehnt zukünftige und ungültige Zeitpunkte ab", () => {
    expect(createDiaryEntrySchema.safeParse({ ...base, watchedAt: "2999-01-01" }).success).toBe(false);
    expect(createDiaryEntrySchema.safeParse({ ...base, watchedAt: "2024-13-01" }).success).toBe(false);
    expect(createDiaryEntrySchema.safeParse({ ...base, watchedAt: "2024-01-01", watchedTime: "25:00" }).success).toBe(false);
  });

  it("begrenzt die Länge der Notiz", () => {
    expect(createDiaryEntrySchema.safeParse({ ...base, review: "x".repeat(2000) }).success).toBe(true);
    expect(createDiaryEntrySchema.safeParse({ ...base, review: "x".repeat(2001) }).success).toBe(false);
  });

  it("wendet die Regeln auch beim Bearbeiten an", () => {
    expect(updateDiaryEntrySchema.safeParse({ id: "a", rating: 8.25 }).success).toBe(false);
    expect(updateDiaryEntrySchema.safeParse({ id: "a", watchedAt: null, rating: null }).success).toBe(true);
  });
});

describe("Gesamtbewertung und Sehvorgänge", () => {
  it("findet den jüngsten bewerteten Sehvorgang; ohne Datum gilt als ältester", () => {
    const entries = [rated("alt", 7, "2020-01-01"), rated("neu", 9, "2025-01-01"), rated("ohne", 5, null), rated("unbewertet", null, "2026-01-01")];
    expect(latestRatedEntry(entries)?.id).toBe("neu");
    expect(latestRatedEntry([rated("ohne", 5, null)])?.id).toBe("ohne");
    expect(latestRatedEntry([rated("unbewertet", null, "2026-01-01")])).toBeNull();
  });

  it("übernimmt die erste Bewertung", () => {
    const changed = rated("a", 8, "2024-01-01");
    expect(resolveOverallRating({ current: null, entries: [changed], changed })).toBe(8);
  });

  it("lässt nur den jüngsten Sehvorgang die Gesamtbewertung bewegen", () => {
    const old = rated("alt", 9, "2024-03-12");
    const fresh = rated("neu", 9.5, "2025-12-24");
    expect(resolveOverallRating({ current: 9, entries: [old, fresh], changed: fresh })).toBe(9.5);
    // Nachgetragen, aber älter: Das ändert nicht, was die Person heute denkt.
    const backfilled = rated("nachtrag", 4, "2010-01-01");
    expect(resolveOverallRating({ current: 9.5, entries: [old, fresh, backfilled], changed: backfilled })).toBe(9.5);
  });

  it("behält die Gesamtbewertung, wenn ein Sehvorgang ohne Bewertung dazukommt", () => {
    const changed = rated("a", null, "2026-01-01");
    expect(resolveOverallRating({ current: 7, entries: [changed], changed })).toBe(7);
  });

  it("löscht die Gesamtbewertung nie, wenn eine Eintragsbewertung entfernt wird", () => {
    const changed = rated("a", null, "2026-01-01");
    expect(resolveOverallRating({ current: 7, entries: [changed], changed, previousEntryRating: 7 })).toBe(7);
  });

  it("bewegt die Gesamtbewertung nicht, wenn nur Notiz oder Datum geändert wurden", () => {
    const old = rated("alt", 5, "2019-01-01");
    const fresh = rated("neu", 9, "2024-01-01");
    // Die Gesamtbewertung wurde bewusst entfernt und kommt nicht durch die Hintertür zurück.
    expect(resolveOverallRating({ current: null, entries: [old, fresh], changed: fresh, previousEntryRating: 9 })).toBeNull();
    expect(resolveOverallRating({ current: 7, entries: [fresh], changed: fresh, previousEntryRating: 9 })).toBe(7);
  });

  it("lässt auch ohne Gesamtbewertung nur den jüngsten Sehvorgang sie setzen", () => {
    const old = rated("alt", 5, "2019-01-01");
    const fresh = rated("neu", 9, "2024-01-01");
    expect(resolveOverallRating({ current: null, entries: [old, fresh], changed: old, previousEntryRating: 4 })).toBeNull();
    expect(resolveOverallRating({ current: null, entries: [old, fresh], changed: fresh, previousEntryRating: 8 })).toBe(9);
  });

  it("lässt eine von Hand geänderte Gesamtbewertung beim Bearbeiten stehen", () => {
    const changed = rated("a", 8, "2026-01-01");
    expect(resolveOverallRating({ current: 10, entries: [changed], changed, previousEntryRating: 6 })).toBe(10);
    expect(resolveOverallRating({ current: 6, entries: [changed], changed, previousEntryRating: 6 })).toBe(8);
  });
});

describe("Journal", () => {
  it("gruppiert nach Jahr, Monat und Tag, neueste zuerst", () => {
    const { years } = groupDiary([
      entry("a", { watchedDate: "2024-03-12" }),
      entry("b", { watchedDate: "2025-12-24" }),
      entry("c", { watchedDate: "2025-12-24", watchedTime: "21:00" }),
      entry("d", { watchedDate: "2025-01-02" }),
    ]);
    expect(years.map((year) => year.year)).toEqual([2025, 2024]);
    expect(years[0]?.count).toBe(3);
    expect(years[0]?.months.map((month) => month.month)).toEqual(["2025-12", "2025-01"]);
    expect(years[0]?.months[0]?.days[0]?.entries.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("legt Einträge ohne Datum ausschliesslich in den Bereich «Datum unbekannt»", () => {
    const { years, undated } = groupDiary([entry("a"), entry("b", { watchedDate: "2024-01-01" })]);
    expect(undated.map((item) => item.id)).toEqual(["a"]);
    expect(years.flatMap((year) => year.months.flatMap((month) => month.days.flatMap((day) => day.entries.map((item) => item.id))))).toEqual(["b"]);
  });

  it("filtert nach allen Kriterien", () => {
    const entries = [
      entry("a", { watchedDate: "2024-03-12", rating: 9, genreIds: [14], tmdbId: 1 }),
      entry("b", { watchedDate: "2025-12-24", rating: 6, genreIds: [27], isRewatch: true, tmdbId: 2 }),
      entry("c", { rating: null, genreIds: [14], tmdbId: 3 }),
    ];
    const ids = (filters: Partial<typeof EMPTY_DIARY_FILTERS>) => filterDiary(entries, { ...EMPTY_DIARY_FILTERS, ...filters }).map((item) => item.id);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ year: 2024 })).toEqual(["a"]);
    expect(ids({ genreId: 14 })).toEqual(["a", "c"]);
    expect(ids({ ratingMin: 8 })).toEqual(["a"]);
    expect(ids({ viewing: "rewatch" })).toEqual(["b"]);
    expect(ids({ viewing: "first" })).toEqual(["a", "c"]);
    expect(ids({ missing: "date" })).toEqual(["c"]);
    expect(ids({ missing: "rating" })).toEqual(["c"]);
    expect(ids({ personMediaKeys: new Set(["movie:2"]) })).toEqual(["b"]);
  });

  it("ordnet einen Eintrag ohne Datum keinem Jahr zu", () => {
    expect(filterDiary([entry("a")], { ...EMPTY_DIARY_FILTERS, year: 2024 })).toEqual([]);
  });
});

describe("Kalender", () => {
  it("baut vollständige Wochen, Montag zuerst", () => {
    const grid = monthGrid("2026-03");
    expect(grid.every((week) => week.length === 7)).toBe(true);
    // Der 1. März 2026 ist ein Sonntag, die Woche beginnt also im Februar.
    expect(grid[0]?.[0]).toEqual({ date: "2026-02-23", day: 23, inMonth: false });
    expect(grid[0]?.[6]).toEqual({ date: "2026-03-01", day: 1, inMonth: true });
    expect(grid.flat().filter((cell) => cell.inMonth)).toHaveLength(31);
  });

  it("wechselt über Jahresgrenzen", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});

describe("Statistik aus dem Tagebuch", () => {
  const NOW = new Date("2026-06-15T12:00:00Z");

  it("zählt Einträge ohne Datum in keinem Monat", () => {
    const months = monthlyActivity(
      [
        { watchedAt: new Date("2026-06-01"), minutes: 100 },
        { watchedAt: null, minutes: 100 },
      ],
      NOW,
    );
    expect(months.reduce((sum, month) => sum + month.count, 0)).toBe(1);
    expect(months.at(-1)).toEqual({ month: "2026-06", count: 1, minutes: 100 });
  });

  it("füllt Jahre ohne Film auf und endet im aktuellen Jahr", () => {
    expect(yearlyActivity([new Date("2023-05-01"), new Date("2025-01-01"), new Date("2025-02-01")], NOW)).toEqual([
      { year: 2023, count: 1 },
      { year: 2024, count: 0 },
      { year: 2025, count: 2 },
      { year: 2026, count: 0 },
    ]);
    expect(yearlyActivity([], NOW)).toEqual([]);
  });

  it("liefert lückenlose Tage ab einem Montag bis heute", () => {
    const days = dailyActivity([new Date("2026-06-15T20:00:00Z"), new Date("2026-06-15T22:00:00Z"), new Date("2020-01-01")], NOW);
    expect(new Date(`${days[0]?.date}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(days.at(-1)).toEqual({ date: "2026-06-15", count: 2 });
    expect(days.reduce((sum, day) => sum + day.count, 0)).toBe(2);
    expect(days.length).toBeGreaterThan(52 * 7);
  });
});
