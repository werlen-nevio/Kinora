import type { Metadata } from "next";
import { OnboardingGrid } from "@/components/onboarding/onboarding-grid";
import type { MediaCard } from "@/lib/tmdb-types";
import { refKey } from "@/lib/tmdb-types";
import { requireUser } from "@/server/auth/session";
import { getLibraryState } from "@/server/library/service";
import { bayesianRating } from "@/server/recommender/scoring";
import { discover, getPopular, getTopRated, getTrending } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Was magst du?" };

const TARGET = 60;

/**
 * Bekannte Titel aus verschiedenen Jahrzehnten und Genres. Das braucht viele Stimmen,
 * sonst kennt die Titel niemand, und Streuung, sonst lernt das Profil nur ein Genre.
 */
async function loadTitles(language: string): Promise<MediaCard[]> {
  const sources = await Promise.allSettled([
    getTopRated("movie", language),
    getPopular("movie", language),
    getTopRated("tv", language),
    getPopular("tv", language),
    getTrending("all", "week", language),
    discover({ kind: "movie", yearTo: 1999, voteCountMin: 5000, sort: "vote_count.desc" }, language),
    discover({ kind: "movie", yearFrom: 2000, yearTo: 2012, voteCountMin: 5000, sort: "vote_count.desc" }, language),
    discover({ kind: "movie", yearFrom: 2013, voteCountMin: 5000, sort: "vote_count.desc" }, language),
    discover({ kind: "tv", voteCountMin: 3000, sort: "vote_count.desc" }, language),
  ]);
  const seen = new Set<string>();
  const merged: MediaCard[] = [];
  for (const source of sources) {
    if (source.status !== "fulfilled") continue;
    for (const card of source.value.results) {
      if (!card.posterPath || (card.voteCount ?? 0) < 800 || seen.has(refKey(card))) continue;
      seen.add(refKey(card));
      merged.push(card);
    }
  }
  return merged
    .sort((a, b) => (b.voteCount ?? 0) * bayesianRating(b.voteAverage, b.voteCount) - (a.voteCount ?? 0) * bayesianRating(a.voteAverage, a.voteCount))
    .slice(0, TARGET);
}

export default async function OnboardingPage() {
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const [titles, library] = await Promise.all([loadTitles(language), getLibraryState(user.id)]);
  const alreadyRated = Object.values(library).filter((item) => item.rating !== null).length;
  return <OnboardingGrid titles={titles} alreadyRated={alreadyRated} name={user.name} />;
}
