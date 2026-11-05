"use client";

import { Bookmark, Check } from "lucide-react";
import Link from "next/link";
import { FrameStrip } from "@/components/home/cards";
import { useLibraryState } from "@/components/library/library-provider";
import { Carousel } from "@/components/media/carousel";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { buttonStyles } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { type MediaCard, refKey } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

export interface FranchiseProps {
  id: number;
  name: string;
  parts: readonly MediaCard[];
  today: string;
  currentId?: number;
  showLink?: boolean;
}

function statusOf(item: { watched?: boolean; watchlisted?: boolean } | undefined) {
  if (item?.watched) return "Gesehen";
  if (item?.watchlisted) return "Auf Watchlist";
  return "Noch nicht gesehen";
}

/**
 * Die Filmreihe als Filmstreifen: pro Teil ein Plakat in Veröffentlichungsreihenfolge,
 * darüber ein Band, das sich mit jedem gesehenen Teil füllt. Angekündigte Teile
 * erscheinen, zählen aber nicht zum Fortschritt.
 */
export function FranchiseSection({ id, name, parts, today, currentId, showLink }: FranchiseProps) {
  const state = useLibraryState();
  const released = parts.filter((part) => part.releaseDate !== null && part.releaseDate <= today);
  const isSeen = (part: MediaCard) => state[refKey(part)]?.watched === true;
  const seen = released.filter(isSeen).length;
  const percent = released.length === 0 ? 0 : Math.round((seen / released.length) * 100);
  const next = released.find((part) => !isSeen(part));

  return (
    <section aria-label={name} className="space-y-5">
      <div className="gutter flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="font-display text-title-md font-medium text-balance">
            {showLink ? (
              <Link href={`/filmreihe/${id}`} className="hover:underline underline-offset-4">
                {name}
              </Link>
            ) : (
              name
            )}
          </h2>
          <div className="max-w-xl">
            <FrameStrip seen={seen} total={released.length} label={`${seen} von ${released.length} Filmen gesehen`} />
            <p className="mt-2.5 text-sm text-fog">
              <span className="font-medium text-screen">
                {seen} von {released.length} Filmen gesehen
              </span>
              <span className="ml-3 tabular-nums text-ambient">{percent} %</span>
            </p>
          </div>
        </div>
        {next && next.tmdbId !== currentId ? (
          <Link href={`/film/${next.tmdbId}`} className={cn(buttonStyles({ variant: "secondary" }), "max-w-full self-start lg:self-end")}>
            <span className="truncate">Nächster Teil: {next.title}</span>
          </Link>
        ) : null}
      </div>

      <Carousel label={`Filme der Reihe ${name}`}>
        {parts.map((part, index) => {
          const item = state[refKey(part)];
          const watched = item?.watched === true;
          const unreleased = part.releaseDate === null || part.releaseDate > today;
          const current = part.tmdbId === currentId;
          return (
            <Link
              key={part.tmdbId}
              href={`/film/${part.tmdbId}`}
              aria-current={current ? "page" : undefined}
              className="group w-[132px] sm:w-[156px] 3xl:w-[186px]"
            >
              <span
                className={cn(
                  "relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-raised ring-1 transition-[filter,box-shadow,transform] duration-300 ease-film group-hover:-translate-y-1",
                  current ? "ring-2 ring-ambient" : "ring-white/8 group-hover:ring-white/30",
                  !watched && !current && "brightness-[0.62] saturate-[0.7] group-hover:brightness-100 group-hover:saturate-100",
                )}
              >
                {part.posterPath ? <TmdbImage path={part.posterPath} kind="poster" alt="" sizes="186px" /> : <ImageFallback title={part.title} />}
                {watched ? (
                  <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-seen text-ink">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                ) : item?.watchlisted ? (
                  <span className="absolute left-2 top-2 flex size-6 items-center justify-center rounded-full bg-tungsten text-ink">
                    <Bookmark className="size-3.5" fill="currentColor" />
                  </span>
                ) : null}
              </span>
              <span className="mt-2.5 block text-xs tabular-nums text-fog-dim">Teil {index + 1}</span>
              <span className="mt-0.5 line-clamp-2 block text-[13px] font-medium leading-tight group-hover:underline">{part.title}</span>
              <span className={cn("mt-1 block text-xs", watched ? "text-seen" : item?.watchlisted ? "text-tungsten" : "text-fog")}>
                {unreleased ? (part.releaseDate ? `Ab ${formatDate(part.releaseDate)}` : "Angekündigt") : statusOf(item)}
              </span>
            </Link>
          );
        })}
      </Carousel>
    </section>
  );
}
