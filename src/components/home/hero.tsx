"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TrailerButton, WatchlistButton } from "@/components/media/actions";
import { AmbientSync } from "@/components/media/ambient";
import { TmdbImage } from "@/components/media/tmdb-image";
import { buttonStyles } from "@/components/ui/button";
import { formatRating, formatRuntime } from "@/lib/format";
import { mediaHref } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import type { HeroItem } from "@/server/home/rows";

const ADVANCE_MS = 9_000;
const EASE = [0.22, 0.8, 0.26, 1] as const;

export function HomeHero({ items }: { items: HeroItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = items[index];

  useEffect(() => {
    if (paused || reducedMotion || items.length < 2) return;
    timer.current = setTimeout(() => setIndex((value) => (value + 1) % items.length), ADVANCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [index, paused, reducedMotion, items.length]);

  if (!current) return null;
  const ref = { kind: current.kind, tmdbId: current.tmdbId };
  const runtime = formatRuntime(current.runtime);
  const rating = formatRating(current.voteAverage);

  return (
    <section
      aria-roledescription="Karussell"
      aria-label="Empfehlungen"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative isolate flex min-h-[86svh] flex-col justify-end overflow-hidden pb-10 pt-24 lg:min-h-[92svh]"
    >
      <AmbientSync ambient={current.ambient} />

      <AnimatePresence initial={false}>
        <motion.div
          key={`${current.kind}:${current.tmdbId}`}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: EASE }}
          className="absolute inset-0 -z-20"
        >
          <TmdbImage path={current.backdropPath} kind="backdrop" alt="" sizes="100vw" preload={index === 0} className="object-[center_20%]" />
        </motion.div>
      </AnimatePresence>
      <div className="scrim-hero absolute inset-0 -z-10" />
      <div className="ambient-wash absolute inset-x-0 bottom-0 -z-10 h-3/4 opacity-50" />

      <div className="gutter">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${current.kind}:${current.tmdbId}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="max-w-2xl"
          >
            {current.logoPath ? (
              <h2 className="relative mb-5 h-24 w-[min(26rem,80%)] sm:h-32">
                <TmdbImage path={current.logoPath} kind="logo" alt={current.title} sizes="420px" className="object-contain object-left-bottom" />
              </h2>
            ) : (
              <h2 className="font-display mb-4 text-title-lg font-medium leading-[1.05] text-balance">{current.title}</h2>
            )}

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-screen/90">
              {rating ? <span className="font-semibold text-ambient">{rating}</span> : null}
              {current.year ? <span>{current.year}</span> : null}
              {runtime && current.kind === "movie" ? <span>{runtime}</span> : null}
              {current.seasons ? <span>{current.seasons === 1 ? "1 Staffel" : `${current.seasons} Staffeln`}</span> : null}
              {current.genres.length ? <span className="text-fog">{current.genres.join(", ")}</span> : null}
            </p>

            {current.overview ? <p className="mt-3 line-clamp-3 max-w-xl text-[15px] leading-relaxed text-screen/85 text-pretty">{current.overview}</p> : null}
            {current.reason ? <p className="mt-3 text-sm text-ambient">{current.reason}</p> : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href={mediaHref(ref)} className={buttonStyles({ variant: "primary", size: "lg" })}>
                Details ansehen
              </Link>
              <WatchlistButton media={ref} />
              {current.trailerKey ? <TrailerButton videoKey={current.trailerKey} title={current.title} /> : null}
            </div>
          </motion.div>
        </AnimatePresence>

        {items.length > 1 ? (
          <div role="tablist" aria-label="Empfehlung wählen" className="mt-8 flex max-w-sm gap-1.5">
            {items.map((item, position) => (
              <button
                key={`${item.kind}:${item.tmdbId}`}
                type="button"
                role="tab"
                aria-selected={position === index}
                aria-label={`${position + 1} von ${items.length}: ${item.title}`}
                onClick={() => setIndex(position)}
                className="group flex h-6 flex-1 items-center outline-none"
              >
                <span className="relative block h-[3px] w-full overflow-hidden rounded-full bg-white/20 group-hover:bg-white/35 group-focus-visible:ring-2 group-focus-visible:ring-screen">
                  <span
                    key={position === index ? `run-${index}` : "idle"}
                    className={cn("absolute inset-0 origin-left rounded-full bg-screen", position < index && "scale-x-100", position > index && "scale-x-0")}
                    style={
                      position === index
                        ? { animation: `hero-progress ${reducedMotion ? 1 : ADVANCE_MS}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }
                        : undefined
                    }
                  />
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative flex min-h-[86svh] flex-col justify-end overflow-hidden pb-10 lg:min-h-[92svh]" aria-hidden="true">
      <div className="skeleton absolute inset-0 opacity-50" />
      <div className="gutter relative space-y-4">
        <div className="skeleton h-16 w-80 max-w-full rounded-lg" />
        <div className="skeleton h-4 w-64 max-w-full rounded" />
        <div className="skeleton h-16 w-[32rem] max-w-full rounded" />
      </div>
    </div>
  );
}
