// Regeln und Typen des Filmtagebuchs, frei von I/O.

import { z } from "zod";
import type { MediaKind } from "./tmdb-types";

const RATING_MESSAGE = "Bewertungen gehen von 1 bis 10 in halben Punkten.";

export const ratingSchema = z
  .number({ error: RATING_MESSAGE })
  .min(1, RATING_MESSAGE)
  .max(10, RATING_MESSAGE)
  .refine((value) => Number.isInteger(value * 2), RATING_MESSAGE);

export const RATING_VALUES: readonly number[] = Array.from({ length: 19 }, (_, index) => 1 + index / 2);

// Zeitpunkte gelten als Ortszeit der Person. Der Server kennt die Zeitzone nicht und lässt
// deshalb den Vorsprung der östlichsten Zeitzone zu; die Oberfläche prüft auf den Tag genau.
const FUTURE_GRACE_MS = 14 * 3600 * 1000;

/** Baut den gespeicherten Zeitpunkt. Ortszeit wird unverändert als UTC abgelegt. */
export function combineWatchedAt(date: string, time?: string | null): Date {
  return new Date(`${date}T${time ?? "00:00"}:00.000Z`);
}

export function isInFuture(date: string, time?: string | null, now: Date = new Date()): boolean {
  return combineWatchedAt(date, time).getTime() > now.getTime() + FUTURE_GRACE_MS;
}

const dateField = z.iso.date("Das Datum ist ungültig.").nullable().optional();
const timeField = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Die Uhrzeit ist ungültig.")
  .nullable()
  .optional();

export const diaryFields = {
  rating: ratingSchema.nullable().optional(),
  watchedAt: dateField,
  watchedTime: timeField,
  review: z.string().trim().max(2000, "Die Notiz darf höchstens 2000 Zeichen lang sein.").nullable().optional(),
  isRewatch: z.boolean().optional(),
};

const diaryPayloadSchema = z.object(diaryFields);
export type DiaryPayload = z.infer<typeof diaryPayloadSchema>;

function refineWhen(value: { watchedAt?: string | null; watchedTime?: string | null }, context: z.RefinementCtx) {
  if (value.watchedTime && !value.watchedAt) {
    context.addIssue({ code: "custom", message: "Eine Uhrzeit braucht ein Datum.", path: ["watchedTime"] });
  }
  if (value.watchedAt && isInFuture(value.watchedAt, value.watchedTime)) {
    context.addIssue({ code: "custom", message: "Der Sehzeitpunkt darf nicht in der Zukunft liegen.", path: ["watchedAt"] });
  }
}

export const diaryPayload = diaryPayloadSchema.superRefine(refineWhen);

export const createDiaryEntrySchema = z
  .object({
    kind: z.enum(["movie", "tv"]),
    tmdbId: z.number().int().positive().max(100_000_000),
    ...diaryFields,
  })
  .superRefine(refineWhen);

export const updateDiaryEntrySchema = z
  .object({
    id: z.string().min(1).max(64),
    ...diaryFields,
  })
  .superRefine(refineWhen);

export type CreateDiaryEntry = z.infer<typeof createDiaryEntrySchema>;
export type UpdateDiaryEntry = z.infer<typeof updateDiaryEntrySchema>;

export interface DiaryEntryView {
  id: string;
  kind: MediaKind;
  tmdbId: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  runtime: number | null;
  genreIds: number[];
  /** YYYY-MM-DD, `null` bei unbekanntem Datum. */
  watchedDate: string | null;
  /** HH:MM, nur wenn eine Uhrzeit erfasst wurde. */
  watchedTime: string | null;
  rating: number | null;
  review: string | null;
  isRewatch: boolean;
  createdAt: string;
}

export interface DiaryPersonOption {
  tmdbId: number;
  name: string;
  count: number;
  /** Schlüssel der Titel im Tagebuch, an denen die Person mitgewirkt hat. */
  mediaKeys: string[];
}

// ---------------------------------------------------------------------------
// Gesamtbewertung
// ---------------------------------------------------------------------------

export interface RatedEntry {
  id: string;
  rating: number | null;
  watchedAt: Date | null;
  createdAt: Date;
}

function isNewer(a: RatedEntry, b: RatedEntry): boolean {
  const aTime = a.watchedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const bTime = b.watchedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  if (aTime !== bTime) return aTime > bTime;
  return a.createdAt.getTime() > b.createdAt.getTime();
}

/** Der jüngste Sehvorgang mit Bewertung. Einträge ohne Datum gelten als die ältesten. */
export function latestRatedEntry<E extends RatedEntry>(entries: readonly E[]): E | null {
  let latest: E | null = null;
  for (const entry of entries) {
    if (entry.rating !== null && (!latest || isNewer(entry, latest))) latest = entry;
  }
  return latest;
}

export interface OverallRatingInput {
  /** Die aktuelle Gesamtbewertung. */
  current: number | null;
  /** Alle Einträge des Titels im neuen Stand, inklusive des geänderten. */
  entries: readonly RatedEntry[];
  changed: RatedEntry;
  /** Bewertung des Eintrags vor der Änderung; bei neuen Einträgen weglassen. */
  previousEntryRating?: number | null;
}

/**
 * Die Gesamtbewertung ist die aktuelle Meinung, Eintragsbewertungen halten einen einzelnen
 * Sehvorgang fest. Nur der jüngste Sehvorgang darf die Gesamtbewertung bewegen: Wer einen alten
 * Film mit Datum von 2019 nachträgt, ändert damit nicht, was die Person heute denkt. Wurde die
 * Gesamtbewertung inzwischen von Hand geändert, bleibt sie auch beim Bearbeiten bestehen.
 */
export function resolveOverallRating({ current, entries, changed, previousEntryRating }: OverallRatingInput): number | null {
  if (changed.rating === null) return current;
  // Eine geänderte Notiz oder ein ergänztes Datum sagen nichts über die Meinung aus.
  if (previousEntryRating === changed.rating) return current;
  if (latestRatedEntry(entries)?.id !== changed.id) return current;
  if (current === null) return changed.rating;
  const independentlyChanged = previousEntryRating !== undefined && previousEntryRating !== null && previousEntryRating !== current;
  return independentlyChanged ? current : changed.rating;
}

// ---------------------------------------------------------------------------
// Gruppieren und Filtern
// ---------------------------------------------------------------------------

export interface DiaryDayGroup {
  date: string;
  entries: DiaryEntryView[];
}

export interface DiaryMonthGroup {
  /** YYYY-MM */
  month: string;
  days: DiaryDayGroup[];
}

export interface DiaryYearGroup {
  year: number;
  count: number;
  months: DiaryMonthGroup[];
}

export interface DiaryGroups {
  years: DiaryYearGroup[];
  /** Einträge ohne Datum erscheinen ausschliesslich hier. */
  undated: DiaryEntryView[];
}

function byNewestWatch(a: DiaryEntryView, b: DiaryEntryView): number {
  const left = `${a.watchedDate ?? ""}T${a.watchedTime ?? ""}`;
  const right = `${b.watchedDate ?? ""}T${b.watchedTime ?? ""}`;
  return right.localeCompare(left) || b.createdAt.localeCompare(a.createdAt);
}

export function groupDiary(entries: readonly DiaryEntryView[]): DiaryGroups {
  const undated = entries.filter((entry) => !entry.watchedDate).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const years = new Map<number, Map<string, Map<string, DiaryEntryView[]>>>();

  for (const entry of entries) {
    const date = entry.watchedDate;
    if (!date) continue;
    const year = Number(date.slice(0, 4));
    const months = years.get(year) ?? new Map<string, Map<string, DiaryEntryView[]>>();
    const month = date.slice(0, 7);
    const days = months.get(month) ?? new Map<string, DiaryEntryView[]>();
    days.set(date, [...(days.get(date) ?? []), entry]);
    months.set(month, days);
    years.set(year, months);
  }

  return {
    undated,
    years: [...years.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, months]) => {
        const monthGroups = [...months.entries()]
          .sort(([a], [b]) => b.localeCompare(a))
          .map(([month, days]) => ({
            month,
            days: [...days.entries()]
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, list]) => ({ date, entries: [...list].sort(byNewestWatch) })),
          }));
        const count = monthGroups.reduce((sum, month) => sum + month.days.reduce((inner, day) => inner + day.entries.length, 0), 0);
        return { year, count, months: monthGroups };
      }),
  };
}

export interface DiaryFilters {
  year: number | null;
  genreId: number | null;
  /** Mindestbewertung; Einträge ohne Bewertung fallen dann heraus. */
  ratingMin: number | null;
  personMediaKeys: ReadonlySet<string> | null;
  viewing: "all" | "first" | "rewatch";
  missing: "none" | "date" | "rating";
}

export const EMPTY_DIARY_FILTERS: DiaryFilters = {
  year: null,
  genreId: null,
  ratingMin: null,
  personMediaKeys: null,
  viewing: "all",
  missing: "none",
};

export function filterDiary(entries: readonly DiaryEntryView[], filters: DiaryFilters): DiaryEntryView[] {
  return entries.filter((entry) => {
    if (filters.year !== null && Number(entry.watchedDate?.slice(0, 4)) !== filters.year) return false;
    if (filters.genreId !== null && !entry.genreIds.includes(filters.genreId)) return false;
    if (filters.ratingMin !== null && (entry.rating === null || entry.rating < filters.ratingMin)) return false;
    if (filters.personMediaKeys && !filters.personMediaKeys.has(`${entry.kind}:${entry.tmdbId}`)) return false;
    if (filters.viewing === "first" && entry.isRewatch) return false;
    if (filters.viewing === "rewatch" && !entry.isRewatch) return false;
    if (filters.missing === "date" && entry.watchedDate) return false;
    if (filters.missing === "rating" && entry.rating !== null) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Kalender
// ---------------------------------------------------------------------------

export interface CalendarCell {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  inMonth: boolean;
}

/** Wochen eines Monats, Montag zuerst, jeweils vollständig mit Tagen der Nachbarmonate. */
export function monthGrid(month: string): CalendarCell[][] {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const index = Number(monthPart) - 1;
  const first = new Date(Date.UTC(year, index, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));

  const weeks: CalendarCell[][] = [];
  const cursor = new Date(start);
  do {
    const week: CalendarCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      week.push({ date: cursor.toISOString().slice(0, 10), day: cursor.getUTCDate(), inMonth: cursor.getUTCMonth() === index });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === index);
  return weeks;
}

export function shiftMonth(month: string, delta: number): string {
  const [yearPart, monthPart] = month.split("-");
  const date = new Date(Date.UTC(Number(yearPart), Number(monthPart) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

/** Heutiges Datum in der Zeitzone des Browsers; toISOString würde nachts den Tag verschieben. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
