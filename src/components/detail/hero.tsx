import type { ReactNode } from "react";
import { TmdbImage } from "@/components/media/tmdb-image";
import { ImageFallback } from "@/components/media/tmdb-image";
import { formatCount, formatRating } from "@/lib/format";

export interface DetailHeroProps {
  title: string;
  originalTitle?: string | null;
  tagline?: string | null;
  logoPath: string | null;
  backdropPath: string | null;
  posterPath: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  /** Kurzangaben wie Jahr, Laufzeit, Altersfreigabe; leere Werte fallen weg. */
  meta: readonly (string | number | null | undefined)[];
  genres: readonly string[];
  children?: ReactNode;
  breadcrumb?: ReactNode;
}

export function DetailHero({ title, originalTitle, tagline, logoPath, backdropPath, posterPath, voteAverage, voteCount, meta, genres, children, breadcrumb }: DetailHeroProps) {
  const rating = formatRating(voteAverage);
  const votes = formatCount(voteCount);
  const showOriginal = originalTitle && originalTitle !== title;

  return (
    <section className="relative isolate">
      <div className="absolute inset-x-0 top-0 -z-10 h-[62vh] overflow-hidden sm:h-[78vh] lg:h-[88vh]">
        {backdropPath ? <TmdbImage path={backdropPath} kind="backdrop" alt="" sizes="100vw" preload className="object-[center_20%]" /> : null}
        <div className="scrim-hero absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink to-transparent" />
      </div>
      <div className="ambient-wash absolute inset-x-0 top-[24vh] -z-10 h-[80vh] opacity-60" />

      <div className="gutter grid gap-6 pt-[34vh] sm:pt-[42vh] lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-end lg:gap-10 lg:pt-[38vh] 3xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="relative hidden aspect-[2/3] overflow-hidden rounded-xl bg-ink-raised shadow-2xl shadow-black/70 ring-1 ring-white/10 lg:block">
          {posterPath ? <TmdbImage path={posterPath} kind="poster" alt={`Plakat von ${title}`} sizes="320px" preload /> : <ImageFallback title={title} />}
        </div>

        <div className="min-w-0 space-y-4">
          {breadcrumb}
          {logoPath ? (
            <h1 className="relative h-24 w-[min(30rem,88%)] sm:h-36">
              <TmdbImage path={logoPath} kind="logo" alt={title} sizes="480px" preload className="object-contain object-left-bottom" />
            </h1>
          ) : (
            <h1 className="font-display text-title-lg font-medium leading-[1.05] text-balance">{title}</h1>
          )}
          {showOriginal ? <p className="text-sm text-fog">Originaltitel: {originalTitle}</p> : null}
          {tagline ? <p className="font-display text-lg italic text-screen/85">{tagline}</p> : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-screen/90">
            {rating ? (
              <span>
                <span className="font-semibold text-ambient">{rating}</span>
                {votes ? <span className="text-fog"> aus {votes} Stimmen</span> : null}
              </span>
            ) : null}
            {meta.filter(Boolean).map((entry) => (
              <span key={String(entry)}>{entry}</span>
            ))}
          </div>

          {genres.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {genres.map((genre) => (
                <li key={genre} className="rounded-full bg-white/8 px-3 py-1 text-xs text-screen/85">
                  {genre}
                </li>
              ))}
            </ul>
          ) : null}

          {children}
        </div>
      </div>
    </section>
  );
}
