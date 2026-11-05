import type { Metadata } from "next";
import { WatchlistView } from "@/components/watchlist/watchlist-view";
import { requireUser } from "@/server/auth/session";
import { getWatchlist } from "@/server/library/service";
import { getGenreMap } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Meine Watchlist" };

export default async function WatchlistPage() {
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const [rows, genreMap] = await Promise.all([getWatchlist(user.id), getGenreMap(language).catch(() => new Map<number, string>())]);
  const usedGenres = new Set(rows.flatMap((row) => row.genreIds));
  const genres = [...genreMap.entries()]
    .filter(([id]) => usedGenres.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <div className="gutter pb-8 pt-24 lg:pt-28">
      <h1 className="font-display text-title-lg font-medium leading-[1.05]">Meine Watchlist</h1>
      <WatchlistView rows={rows} genres={genres} />
    </div>
  );
}
