const LOCALE = "de-CH";

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} Min.`;
  return rest === 0 ? `${hours} Std.` : `${hours} Std. ${rest} Min.`;
}

/** Lange Dauer als Tage und Stunden, etwa für die gesamte Sehzeit. */
export function formatLongDuration(minutes: number): string {
  if (minutes <= 0) return "0 Std.";
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} Std.`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} Tage` : `${days} Tage ${rest} Std.`;
}

function parseIso(date: string): Date | null {
  // Reine Datumswerte als UTC lesen, sonst rutscht der Tag je nach Zeitzone.
  const parsed = new Date(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const parsed = parseIso(date);
  if (!parsed) return null;
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function formatMonth(month: string, style: "short" | "long" = "short"): string {
  const parsed = parseIso(`${month}-01`);
  if (!parsed) return month;
  return new Intl.DateTimeFormat(LOCALE, { month: style, timeZone: "UTC" }).format(parsed);
}

export function formatRating(value: number | null | undefined): string | null {
  if (value === null || value === undefined || value <= 0) return null;
  return value.toFixed(1);
}

export function formatCount(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return new Intl.NumberFormat(LOCALE).format(value);
}

export function formatMoney(value: number | null | undefined): string | null {
  if (!value) return null;
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function age(birthday: string, deathday?: string | null): number | null {
  const start = parseIso(birthday);
  const end = deathday ? parseIso(deathday) : new Date();
  if (!start || !end) return null;
  const years = end.getUTCFullYear() - start.getUTCFullYear();
  const beforeBirthday =
    end.getUTCMonth() < start.getUTCMonth() ||
    (end.getUTCMonth() === start.getUTCMonth() && end.getUTCDate() < start.getUTCDate());
  return beforeBirthday ? years - 1 : years;
}

const TV_STATUS: Record<string, string> = {
  "Returning Series": "Laufende Serie",
  Ended: "Beendet",
  Canceled: "Abgesetzt",
  "In Production": "In Produktion",
  Planned: "Geplant",
  Pilot: "Pilot",
};

const MOVIE_STATUS: Record<string, string> = {
  Released: "Veröffentlicht",
  "Post Production": "In der Postproduktion",
  "In Production": "In Produktion",
  Planned: "Geplant",
  Rumored: "Gerücht",
  Canceled: "Abgebrochen",
};

export function tvStatusLabel(status: string | null): string | null {
  return status ? (TV_STATUS[status] ?? status) : null;
}

export function movieStatusLabel(status: string | null): string | null {
  return status ? (MOVIE_STATUS[status] ?? status) : null;
}

export function pluralize(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}
