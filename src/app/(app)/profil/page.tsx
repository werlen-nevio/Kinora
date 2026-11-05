import type { Metadata } from "next";
import { AccountPanels } from "@/components/account/account-panels";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { getGenres } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Profil und Einstellungen" };

export default async function ProfilePage() {
  const user = await requireUser();
  const context = await getUserContext(user.id);
  const [movieGenres, tvGenres, genrePrefs] = await Promise.all([
    getGenres("movie", context.language).catch(() => []),
    getGenres("tv", context.language).catch(() => []),
    prisma.userGenrePreference.findMany({ where: { userId: user.id } }),
  ]);
  const genres = [...new Map([...movieGenres, ...tvGenres].map((genre) => [genre.id, genre])).values()].sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <div className="gutter pb-8 pt-24 lg:pt-28">
      <h1 className="font-display text-title-lg font-medium leading-[1.05]">Profil und Einstellungen</h1>
      <AccountPanels
        user={{ name: user.name, email: user.email, image: user.image ?? null }}
        language={context.language}
        region={context.region}
        showWhy={context.showWhy}
        genres={genres}
        genrePrefs={genrePrefs.map(({ genreId, weight }) => ({ genreId, weight }))}
      />
    </div>
  );
}
