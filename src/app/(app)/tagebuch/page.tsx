import type { Metadata } from "next";
import { DiaryView } from "@/components/diary/diary-view";
import { requireUser } from "@/server/auth/session";
import { getDiary } from "@/server/diary/service";
import { getGenres } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Tagebuch" };

export default async function DiaryPage() {
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const [diary, movieGenres, tvGenres] = await Promise.all([
    getDiary(user.id),
    getGenres("movie", language).catch(() => []),
    getGenres("tv", language).catch(() => []),
  ]);
  const genres = [...new Map([...movieGenres, ...tvGenres].map((genre) => [genre.id, genre])).values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <div className="gutter relative pb-8 pt-24 lg:pt-28">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-60" />
      <h1 className="font-display text-title-lg font-medium leading-[1.05]">Tagebuch</h1>
      <div className="mt-6">
        <DiaryView initial={diary} genres={genres} />
      </div>
    </div>
  );
}
