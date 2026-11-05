import { z } from "zod";
import { isInFuture, ratingSchema } from "./diary";

export type SeriesStatusValue = "STARTED" | "WATCHING" | "PAUSED" | "COMPLETED";

/** Der persönliche Stand eines Titels, wie ihn jede Karte im Client kennt. */
export interface LibraryItem {
  watched: boolean;
  watchlisted: boolean;
  favorite: boolean;
  rating: number | null;
  notInterested: boolean;
  watchCount: number;
  lastWatchedAt: string | null;
  seriesStatus: SeriesStatusValue | null;
  episodesWatched: number;
  airedEpisodes: number | null;
}

export const EMPTY_ITEM: LibraryItem = {
  watched: false,
  watchlisted: false,
  favorite: false,
  rating: null,
  notInterested: false,
  watchCount: 0,
  lastWatchedAt: null,
  seriesStatus: null,
  episodesWatched: 0,
  airedEpisodes: null,
};

export type LibraryState = Record<string, LibraryItem>;

export const refSchema = z.object({
  kind: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive().max(100_000_000),
});

/** ISO-Datum, nicht in der Zukunft. `null` heisst: Zeitpunkt unbekannt. */
const watchedAtSchema = z.iso
  .date()
  .refine((value) => !isInFuture(value), "Das Datum liegt in der Zukunft.")
  .nullable()
  .optional();

const season = z.number().int().min(0).max(1000);
const episode = z.number().int().min(0).max(100_000);

export const libraryActionSchema = z.discriminatedUnion("action", [
  refSchema.extend({ action: z.literal("watchlist"), on: z.boolean() }),
  refSchema.extend({ action: z.literal("watched"), on: z.boolean(), watchedAt: watchedAtSchema }),
  refSchema.extend({ action: z.literal("favorite"), on: z.boolean() }),
  refSchema.extend({ action: z.literal("rating"), value: ratingSchema.nullable() }),
  refSchema.extend({ action: z.literal("notInterested"), on: z.boolean() }),
  refSchema.extend({
    kind: z.literal("tv"),
    action: z.literal("episode"),
    seasonNumber: season,
    episodeNumber: episode,
    on: z.boolean(),
  }),
  refSchema.extend({ kind: z.literal("tv"), action: z.literal("season"), seasonNumber: season, on: z.boolean() }),
  refSchema.extend({ kind: z.literal("tv"), action: z.literal("pause"), on: z.boolean() }),
]);

export type LibraryAction = z.infer<typeof libraryActionSchema>;

export const bulkActionSchema = z.object({
  items: z.array(refSchema).min(1).max(100),
  action: z.enum(["watchlist-remove", "watched", "unwatched", "favorite"]),
});

export type BulkAction = z.infer<typeof bulkActionSchema>;
