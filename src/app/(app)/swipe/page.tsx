import type { Metadata } from "next";
import { SwipeDeck } from "@/components/discovery/swipe-deck";
import { requireUser } from "@/server/auth/session";
import { getDiscoveryState } from "@/server/discovery/service";
import { getGenres, getLanguages, getRegionProviders } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Swipe" };

export default async function SwipePage() {
  const user = await requireUser();
  const { language, region } = await getUserContext(user.id);
  const [state, movieGenres, tvGenres, providers, languages] = await Promise.all([
    getDiscoveryState(user.id),
    getGenres("movie", language).catch(() => []),
    getGenres("tv", language).catch(() => []),
    getRegionProviders("movie", region, language).catch(() => []),
    getLanguages().catch(() => []),
  ]);
  const genres = [...new Map([...movieGenres, ...tvGenres].map((genre) => [genre.id, genre])).values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return <SwipeDeck initial={state} options={{ genres, providers, languages }} />;
}
