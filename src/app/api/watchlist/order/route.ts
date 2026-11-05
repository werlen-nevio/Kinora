import { refKey } from "@/lib/tmdb-types";
import type { MediaCard } from "@/lib/tmdb-types";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { getWatchlist } from "@/server/library/service";
import { rankForUser } from "@/server/recommender/service";

/** Reihenfolge der Watchlist nach persönlicher Passung, mit Begründung je Titel. */
export const GET = withUser(async ({ user }) => {
  const rows = await getWatchlist(user.id);
  if (rows.length === 0) return { order: [], reasons: {} };
  const ranked = await rankForUser(
    user.id,
    rows.map((row) => {
      const card: MediaCard = {
        kind: row.kind,
        tmdbId: row.tmdbId,
        title: row.title,
        posterPath: row.posterPath,
        backdropPath: row.backdropPath,
        releaseDate: row.releaseDate,
        year: row.year,
        voteAverage: row.voteAverage,
        voteCount: null,
        popularity: null,
        genreIds: row.genreIds,
        overview: "",
        originalLanguage: null,
      };
      return { kind: row.kind, tmdbId: row.tmdbId, card };
    }),
  );
  return {
    order: ranked.map((item) => refKey(item)),
    reasons: Object.fromEntries(ranked.filter((item) => item.reason).map((item) => [refKey(item), item.reason])),
  };
}, { rateLimit: RATE_LIMITS.watchlistExtras });
