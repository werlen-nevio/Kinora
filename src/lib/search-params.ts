// Filter der erweiterten Suche als URL-Parameter: teilbar, zurücknavigierbar und
// auf Server und Client gleich ausgewertet.

import { z } from "zod";

const csvNumbers = z
  .string()
  .optional()
  .transform((value) =>
    value
      ? value
          .split(",")
          .map(Number)
          .filter((entry) => Number.isInteger(entry) && entry > 0)
          .slice(0, 12)
      : [],
  );

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : Number(value)),
    z.number().min(min).max(max).optional().catch(undefined),
  );

export const browseSchema = z.object({
  q: z.string().trim().max(120).optional(),
  typ: z.enum(["movie", "tv"]).catch("movie").default("movie"),
  genres: csvNumbers,
  von: optionalNumber(1870, 2100),
  bis: optionalNumber(1870, 2100),
  bewertung: optionalNumber(0, 10),
  stimmen: optionalNumber(0, 1_000_000),
  sprache: z.string().regex(/^[a-z]{2}$/).optional().catch(undefined),
  land: z.string().regex(/^[A-Z]{2}$/).optional().catch(undefined),
  laufzeitMin: optionalNumber(0, 1000),
  laufzeitMax: optionalNumber(0, 1000),
  schauspiel: csvNumbers,
  regie: csvNumbers,
  anbieter: csvNumbers,
  sortierung: z
    .enum(["popularity.desc", "vote_average.desc", "vote_count.desc", "primary_release_date.desc", "primary_release_date.asc"])
    .catch("popularity.desc")
    .default("popularity.desc"),
  seite: z.preprocess((value) => (value === undefined ? 1 : Number(value)), z.number().int().min(1).max(500).catch(1)),
});

export type BrowseParams = z.infer<typeof browseSchema>;

export function parseBrowseParams(input: Record<string, string | string[] | undefined>): BrowseParams {
  const flat = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  return browseSchema.parse(flat);
}
