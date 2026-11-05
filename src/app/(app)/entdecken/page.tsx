import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MediaRow, RowSkeleton } from "@/components/media/media-row";
import { buttonStyles } from "@/components/ui/button";
import type { MediaCard } from "@/lib/tmdb-types";
import { requireUser } from "@/server/auth/session";
import { getSectionsCached, sectionById } from "@/server/home/rows";
import { discover, getGenres, getTrending } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Entdecken" };

async function LoadedRow({ title, load, href }: { title: string; load: () => Promise<MediaCard[]>; href?: string }) {
  const items = await load().catch(() => []);
  return <MediaRow title={title} items={items} href={href} />;
}

async function NewGenresRow({ userId, showWhy }: { userId: string; showWhy: boolean }) {
  const sections = await getSectionsCached(userId).catch(() => []);
  const section = sectionById(sections, "new_genres") ?? sectionById(sections, "hidden_gems");
  if (!section) return null;
  return <MediaRow title={section.title} items={section.items} showWhy={showWhy} section={section.id} />;
}

export default async function DiscoverPage() {
  const user = await requireUser();
  const { language, showWhy } = await getUserContext(user.id);
  const genres = await getGenres("movie", language).catch(() => []);
  const year = new Date().getFullYear();

  return (
    <div className="pb-8 pt-24 lg:pt-28">
      <header className="gutter max-w-3xl">
        <h1 className="font-display text-title-lg font-medium leading-[1.05]">Entdecken</h1>
        <p className="mt-3 text-fog">Stöbere nach Genre, Stimmung oder Jahrzehnt. Für alles Genauere gibt es die Filter.</p>
        <Link href="/suche" className={`${buttonStyles({ variant: "secondary" })} mt-5`}>
          Suche und Filter öffnen
        </Link>
      </header>

      {genres.length ? (
        <nav aria-label="Genres" className="gutter mt-8 flex flex-wrap gap-2">
          {genres.map((genre) => (
            <Link key={genre.id} href={`/suche?typ=movie&genres=${genre.id}`} className="rounded-full bg-white/8 px-4 py-2 text-sm transition-colors hover:bg-white/16">
              {genre.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-10 space-y-10">
        <Suspense fallback={<RowSkeleton />}>
          <LoadedRow title="Heute im Gespräch" load={async () => (await getTrending("all", "day", language)).results} />
        </Suspense>
        <Suspense fallback={<RowSkeleton />}>
          <NewGenresRow userId={user.id} showWhy={showWhy} />
        </Suspense>
        <Suspense fallback={<RowSkeleton />}>
          <LoadedRow
            title={`Das Beste aus ${year - 1} und ${year}`}
            load={async () => (await discover({ kind: "movie", yearFrom: year - 1, yearTo: year, voteCountMin: 300, sort: "vote_average.desc" }, language)).results}
            href={`/suche?typ=movie&von=${year - 1}&bis=${year}&sortierung=vote_average.desc`}
          />
        </Suspense>
        <Suspense fallback={<RowSkeleton />}>
          <LoadedRow
            title="Klassiker der 80er"
            load={async () => (await discover({ kind: "movie", yearFrom: 1980, yearTo: 1989, voteCountMin: 1000, sort: "vote_average.desc" }, language)).results}
            href="/suche?typ=movie&von=1980&bis=1989&sortierung=vote_average.desc"
          />
        </Suspense>
        <Suspense fallback={<RowSkeleton />}>
          <LoadedRow
            title="Unter 100 Minuten"
            load={async () => (await discover({ kind: "movie", runtimeMax: 100, voteCountMin: 1500, sort: "vote_average.desc" }, language)).results}
            href="/suche?typ=movie&laufzeitMax=100&sortierung=vote_average.desc"
          />
        </Suspense>
        <Suspense fallback={<RowSkeleton />}>
          <LoadedRow
            title="Aus der Schweiz"
            load={async () => (await discover({ kind: "movie", originCountry: "CH", voteCountMin: 10, sort: "vote_average.desc" }, language)).results}
            href="/suche?typ=movie&land=CH&sortierung=vote_average.desc"
          />
        </Suspense>
      </div>
    </div>
  );
}
