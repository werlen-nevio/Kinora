import Link from "next/link";
import { Suspense } from "react";
import { MediaRow, RowSkeleton } from "@/components/media/media-row";
import type { Genre, MediaCard, MediaKind } from "@/lib/tmdb-types";
import { discover, getGenres, getPopular, getTopRated, getTrending } from "@/server/tmdb/api";

async function LoadedRow({ title, load, href }: { title: string; load: () => Promise<MediaCard[]>; href?: string }) {
  const items = await load().catch(() => []);
  return <MediaRow title={title} items={items} href={href} />;
}

function Row(props: { title: string; load: () => Promise<MediaCard[]>; href?: string }) {
  return (
    <Suspense fallback={<RowSkeleton />}>
      <LoadedRow {...props} />
    </Suspense>
  );
}

const MOVIE_GENRE_ROWS = [878, 18, 35, 53];
const TV_GENRE_ROWS = [18, 10765, 35, 80];

/** Gemeinsame Übersichtsseite für Filme und Serien, damit beide gleich funktionieren. */
export async function KindHub({ kind, title, language }: { kind: MediaKind; title: string; language: string }) {
  const genres = await getGenres(kind, language).catch((): Genre[] => []);
  const featured = (kind === "movie" ? MOVIE_GENRE_ROWS : TV_GENRE_ROWS).flatMap((id) => {
    const genre = genres.find((entry) => entry.id === id);
    return genre ? [genre] : [];
  });
  const nameOfKind = kind === "movie" ? "Filme" : "Serien";

  return (
    <div className="pb-8 pt-24 lg:pt-28">
      <header className="gutter">
        <h1 className="font-display text-title-lg font-medium leading-[1.05]">{title}</h1>
      </header>

      {genres.length ? (
        <nav aria-label="Genres" className="gutter mt-6 flex flex-wrap gap-2">
          {genres.map((genre) => (
            <Link key={genre.id} href={`/suche?typ=${kind}&genres=${genre.id}`} className="rounded-full bg-white/8 px-3.5 py-1.5 text-[13px] transition-colors hover:bg-white/16">
              {genre.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="mt-10 space-y-10">
        <Row title="Beliebt diese Woche" load={async () => (await getTrending(kind, "week", language)).results} />
        <Row title={`Gerade beliebte ${nameOfKind}`} load={async () => (await getPopular(kind, language)).results} href={`/suche?typ=${kind}`} />
        <Row title={`Top-bewertete ${nameOfKind}`} load={async () => (await getTopRated(kind, language)).results} href={`/suche?typ=${kind}&sortierung=vote_average.desc`} />
        {featured.map((genre) => (
          <Row
            key={genre.id}
            title={genre.name}
            load={async () => (await discover({ kind, genres: [genre.id], voteCountMin: 500, sort: "vote_average.desc" }, language)).results}
            href={`/suche?typ=${kind}&genres=${genre.id}&sortierung=vote_average.desc`}
          />
        ))}
      </div>
    </div>
  );
}
