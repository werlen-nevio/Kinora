"use client";

import Link from "next/link";
import { Carousel } from "@/components/media/carousel";
import { RowHeading } from "@/components/media/media-row";
import { PosterCard } from "@/components/media/poster-card";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { type MediaCard, refKey } from "@/lib/tmdb-types";
import type { ContinueItem, FranchiseRowItem } from "@/server/home/rows";

const LANDSCAPE_WIDTH = "w-[260px] sm:w-[320px] 3xl:w-[380px]";
const LANDSCAPE_SIZES = "(max-width: 640px) 260px, 380px";

export function FrameStrip({ seen, total, label }: { seen: number; total: number; label: string }) {
  // Lange Serien als Band, sonst würden Hunderte Felder unlesbar.
  if (total > 40) {
    return (
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={seen} className="h-1.5 overflow-hidden rounded-full bg-white/14">
        <div className="h-full rounded-full bg-ambient" style={{ width: `${total === 0 ? 0 : (seen / total) * 100}%` }} />
      </div>
    );
  }
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={seen} className="frame-strip">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} data-on={index < seen} />
      ))}
    </div>
  );
}

export function ContinueRow({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Weiterschauen" className="space-y-2">
      <RowHeading title="Weiterschauen" />
      <Carousel label="Weiterschauen">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className={`group/card block ${LANDSCAPE_WIDTH}`}>
            <div className="relative aspect-video overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/5 transition-[box-shadow] duration-300 group-hover/card:ring-white/25">
              {item.backdropPath ? <TmdbImage path={item.backdropPath} kind="backdrop" alt="" sizes={LANDSCAPE_SIZES} /> : <ImageFallback title={item.title} />}
              {item.paused ? <span className="glass absolute right-2 top-2 rounded-md px-2 py-0.5 text-xs">Pausiert</span> : null}
            </div>
            <div className="mt-2.5">
              <FrameStrip seen={item.watched} total={item.total} label={`${item.watched} von ${item.total} gesehen`} />
              <h3 className="mt-2 truncate text-sm font-medium">{item.title}</h3>
              <p className="mt-0.5 truncate text-xs text-fog">{item.label}</p>
            </div>
          </Link>
        ))}
      </Carousel>
    </section>
  );
}

export function FranchiseRow({ items }: { items: FranchiseRowItem[] }) {
  if (items.length === 0) return null;
  const title = "Filmreihen, die du vervollständigen kannst";
  return (
    <section aria-label={title} className="space-y-2">
      <RowHeading title={title} />
      <Carousel label={title}>
        {items.map((item) => (
          <Link key={item.id} href={`/filmreihe/${item.id}`} className={`group/card block ${LANDSCAPE_WIDTH}`}>
            <div className="relative aspect-video overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/5 transition-[box-shadow] duration-300 group-hover/card:ring-white/25">
              {item.backdropPath ? <TmdbImage path={item.backdropPath} kind="backdrop" alt="" sizes={LANDSCAPE_SIZES} /> : <ImageFallback title={item.name} />}
              <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/20 to-transparent" />
              <h3 className="font-display absolute inset-x-3 bottom-2.5 text-lg font-medium leading-tight">{item.name}</h3>
            </div>
            <div className="mt-2.5">
              <FrameStrip seen={item.seen} total={item.total} label={`${item.seen} von ${item.total} Filmen gesehen`} />
              <p className="mt-2 flex justify-between gap-3 text-xs text-fog">
                <span className="truncate">{item.nextTitle ? `Als Nächstes: ${item.nextTitle}` : null}</span>
                <span className="shrink-0 tabular-nums">
                  {item.seen} von {item.total}
                </span>
              </p>
            </div>
          </Link>
        ))}
      </Carousel>
    </section>
  );
}

/** Eine echte Rangliste, deshalb tragen die Karten hier sichtbare Plätze. */
export function RankedRow({ title, items }: { title: string; items: MediaCard[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <RowHeading title={title} />
      <Carousel label={title} gap="gap-1">
        {items.slice(0, 10).map((card, index) => (
          <div key={refKey(card)} className="relative flex items-start pl-11 sm:pl-14">
            <span aria-hidden="true" className="font-display absolute bottom-[3.2rem] left-0 z-0 select-none text-[6.5rem] font-semibold italic leading-none text-white/14 sm:text-[8.5rem]">
              {index + 1}
            </span>
            <PosterCard card={card} className="relative z-10" />
          </div>
        ))}
      </Carousel>
    </section>
  );
}

