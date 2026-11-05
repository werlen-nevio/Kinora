"use client";

import { Bookmark, Check, Heart, Plus } from "lucide-react";
import Link from "next/link";
import { useLibraryAction, useLibraryItem } from "@/components/library/library-provider";
import { formatRating } from "@/lib/format";
import { type MediaCard, mediaHref } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { ImageFallback, TmdbImage } from "./tmdb-image";

export const POSTER_SIZES = "(max-width: 640px) 142px, (max-width: 1280px) 170px, 210px";

interface PosterCardProps {
  card: MediaCard;
  showWhy?: boolean;
  section?: string;
  /** Steuert die Breite von aussen, etwa im Raster. */
  className?: string;
  sizes?: string;
  preload?: boolean;
}

function trackClick(card: MediaCard, section?: string) {
  if (!section) return;
  void fetch("/api/interactions", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "RECOMMENDATION_CLICK", kind: card.kind, tmdbId: card.tmdbId, section }),
  }).catch(() => undefined);
}

export function PosterCard({ card, showWhy, section, className, sizes = POSTER_SIZES, preload }: PosterCardProps) {
  const ref = { kind: card.kind, tmdbId: card.tmdbId };
  const item = useLibraryItem(ref);
  const action = useLibraryAction();
  const rating = formatRating(card.voteAverage);
  const seen = item.watched || (card.kind === "tv" && item.seriesStatus === "COMPLETED");

  return (
    <article className={cn("group/card relative w-[142px] sm:w-[170px] 3xl:w-[210px]", className)}>
      <div className="relative">
        <Link
          href={mediaHref(card)}
          onClick={() => trackClick(card, section)}
          className="relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-raised shadow-lg shadow-black/40 ring-1 ring-white/5 transition-[transform,box-shadow] duration-300 ease-film group-hover/card:-translate-y-1 group-hover/card:shadow-2xl group-hover/card:shadow-black/70 group-hover/card:ring-white/25"
        >
          {card.posterPath ? (
            <TmdbImage path={card.posterPath} kind="poster" alt="" sizes={sizes} preload={preload} />
          ) : (
            <ImageFallback title={card.title} />
          )}
          <span className="sr-only">{card.title}</span>

          <span className="pointer-events-none absolute left-2 top-2 flex gap-1">
            {seen ? <StatusDot label="Gesehen" className="bg-seen text-ink"><Check strokeWidth={3} /></StatusDot> : null}
            {item.watchlisted ? <StatusDot label="Auf der Watchlist" className="bg-tungsten text-ink"><Bookmark fill="currentColor" /></StatusDot> : null}
            {item.favorite ? <StatusDot label="Favorit" className="bg-fav text-ink"><Heart fill="currentColor" /></StatusDot> : null}
          </span>
          {item.rating !== null ? (
            <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-md bg-ink/85 px-1.5 text-xs font-semibold text-screen backdrop-blur-sm" aria-label={`Deine Bewertung: ${item.rating}`}>
              {item.rating}
            </span>
          ) : null}
        </Link>

        {/* Auf Touch-Geräten immer sichtbar: Nichts Wichtiges darf nur per Hover erreichbar sein. */}
        <button
          type="button"
          aria-pressed={item.watchlisted}
          aria-label={item.watchlisted ? `${card.title} von der Watchlist entfernen` : `${card.title} zur Watchlist hinzufügen`}
          onClick={() => action.mutate({ ...ref, action: "watchlist", on: !item.watchlisted })}
          className={cn(
            "glass absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full text-screen ring-1 ring-white/15 transition-opacity duration-200 hover:bg-white/20",
            item.watchlisted ? "opacity-100" : "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/card:opacity-100 [@media(hover:hover)]:group-focus-within/card:opacity-100",
          )}
        >
          {item.watchlisted ? <Bookmark className="size-4 text-tungsten" fill="currentColor" /> : <Plus className="size-4" />}
        </button>
      </div>

      <div className="mt-2.5 px-0.5">
        <h3 className="truncate text-[13.5px] font-medium leading-tight text-screen">
          <Link href={mediaHref(card)} onClick={() => trackClick(card, section)} className="hover:underline underline-offset-2">
            {card.title}
          </Link>
        </h3>
        <p className="mt-1 flex items-center gap-2 text-xs text-fog-dim">
          {card.year ? <span>{card.year}</span> : null}
          {rating ? <span aria-label={`TMDB-Bewertung ${rating}`}>{rating}</span> : null}
          {card.kind === "tv" ? <span>Serie</span> : null}
        </p>
        {showWhy && card.reason ? <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-fog">{card.reason}</p> : null}
      </div>
    </article>
  );
}

function StatusDot({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  return (
    <span role="img" aria-label={label} className={cn("flex size-6 items-center justify-center rounded-full shadow-md shadow-black/50 [&_svg]:size-3.5", className)}>
      {children}
    </span>
  );
}

export function PosterSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("w-[142px] sm:w-[170px] 3xl:w-[210px]", className)} aria-hidden="true">
      <div className="skeleton aspect-[2/3] rounded-[10px]" />
      <div className="skeleton mt-2.5 h-3.5 w-3/4 rounded" />
      <div className="skeleton mt-1.5 h-3 w-1/3 rounded" />
    </div>
  );
}
