// Reine Berechnungen für die Statistikseite.

export interface WatchEvent {
  /** Erfasster Zeitpunkt; `null` zählt für Summen, nie für Zeitachsen. */
  watchedAt: Date | null;
  minutes: number;
}

export interface MonthBucket {
  month: string;
  count: number;
  minutes: number;
}

/**
 * Sehaktivität pro Monat, lückenlos für die letzten `months` Monate. Einträge ohne
 * Datum bleiben draussen: «2026 gesehen» darf nur aus erfassten Zeitpunkten folgen.
 */
export function monthlyActivity(events: readonly WatchEvent[], now: Date, months = 12): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  const index = new Map<string, MonthBucket>();
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    const month = date.toISOString().slice(0, 7);
    const bucket = { month, count: 0, minutes: 0 };
    buckets.push(bucket);
    index.set(month, bucket);
  }
  for (const event of events) {
    if (!event.watchedAt) continue;
    const bucket = index.get(event.watchedAt.toISOString().slice(0, 7));
    if (bucket) {
      bucket.count += 1;
      bucket.minutes += event.minutes;
    }
  }
  return buckets;
}

/** Filme pro Jahr, nur aus Einträgen mit Datum. Jahre ohne Film dazwischen bleiben sichtbar. */
export function yearlyActivity(dates: readonly Date[], now: Date): { year: number; count: number }[] {
  if (dates.length === 0) return [];
  const counts = new Map<number, number>();
  for (const date of dates) counts.set(date.getUTCFullYear(), (counts.get(date.getUTCFullYear()) ?? 0) + 1);
  const first = Math.min(...counts.keys());
  const last = Math.max(now.getUTCFullYear(), ...counts.keys());
  return Array.from({ length: last - first + 1 }, (_, index) => ({ year: first + index, count: counts.get(first + index) ?? 0 }));
}

export interface DayBucket {
  /** YYYY-MM-DD */
  date: string;
  count: number;
}

const DAY_MS = 24 * 3600 * 1000;

/** Lückenlose Tage der letzten Wochen, beginnend an einem Montag. Für den Aktivitätskalender. */
export function dailyActivity(dates: readonly Date[], now: Date, weeks = 53): DayBucket[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - (weeks - 1) * 7 * DAY_MS - weekday * DAY_MS;
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const days: DayBucket[] = [];
  for (let time = start; time <= today; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    days.push({ date, count: counts.get(date) ?? 0 });
  }
  return days;
}

/** Eine Säule pro Bewertungsstufe, also 19 von 1 bis 10 in halben Punkten. */
export function ratingHistogram(values: readonly number[]): { value: number; count: number }[] {
  return Array.from({ length: 19 }, (_, index) => {
    const step = 1 + index / 2;
    return { value: step, count: values.filter((value) => value === step).length };
  });
}

export function decadeDistribution(years: readonly (number | null)[]): { decade: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const year of years) {
    if (year === null) continue;
    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) ?? 0) + 1);
  }
  return [...counts.entries()].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade);
}

export function genreDistribution(items: readonly { genreIds: readonly number[] }[], names: ReadonlyMap<number, string>) {
  const counts = new Map<number, number>();
  for (const item of items) {
    for (const id of item.genreIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .flatMap(([id, count]) => {
      const name = names.get(id);
      return name ? [{ id, name, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
}

export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
