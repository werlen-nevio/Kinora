"use client";

import { Check, Heart, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch, useLibraryAction, useLibraryState } from "@/components/library/library-provider";
import { RatingScale } from "@/components/diary/rating-scale";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import { type MediaCard, refKey } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

const FIRST_GOAL = 5;
const FULL_GOAL = 10;

export function OnboardingGrid({ titles, alreadyRated, name }: { titles: MediaCard[]; alreadyRated: number; name: string }) {
  const router = useRouter();
  const library = useLibraryState();
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const signals = useMemo(() => Object.values(library).filter((item) => item.rating !== null || item.favorite).length, [library]);
  const visible = titles.filter((card) => !skipped.has(refKey(card)));
  const reachedFirstGoal = signals >= FIRST_GOAL;

  const finish = async () => {
    setFinishing(true);
    try {
      await apiFetch("/api/onboarding", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
      setFinishing(false);
    }
  };

  const message =
    signals === 0
      ? `Bewerte mindestens ${FIRST_GOAL} Titel, dann werden deine Empfehlungen persönlich.`
      : signals < FIRST_GOAL
        ? `Noch ${FIRST_GOAL - signals}, dann sind die ersten Empfehlungen bereit.`
        : signals < FULL_GOAL
          ? "Deine ersten Empfehlungen sind bereit. Jede weitere Bewertung macht sie genauer."
          : "Das reicht für einen guten Start. Du kannst jederzeit weiter bewerten.";

  return (
    <div className="relative pb-32">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-60" />
      <header className="gutter max-w-3xl pt-24 lg:pt-28">
        <h1 className="font-display text-title-lg font-medium leading-[1.05] text-balance">Welche Filme und Serien magst du, {name}?</h1>
        <p className="mt-3 text-fog">Markiere, was du gesehen hast, gib 1 bis 10 Punkte, auch halbe, oder überspringe, was du nicht kennst. Ein Sehdatum brauchst du hier nicht.</p>
      </header>

      {titles.length === 0 ? (
        <div className="gutter mt-8 max-w-xl space-y-4">
          <p className="text-danger">Die Titel konnten nicht geladen werden, weil TMDB nicht antwortet.</p>
          <Button onClick={() => router.refresh()}>Erneut laden</Button>
        </div>
      ) : (
        <ul className="gutter mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-x-4">
          {visible.map((card) => (
            <OnboardingCard key={refKey(card)} card={card} onSkip={() => setSkipped((current) => new Set(current).add(refKey(card)))} />
          ))}
        </ul>
      )}

      <div className="glass fixed inset-x-0 bottom-14 z-30 border-t border-white/8 lg:bottom-0">
        <div className="gutter flex flex-wrap items-center gap-x-5 gap-y-2 py-3">
          <div className="min-w-48 flex-1">
            <p className="text-sm" aria-live="polite">
              {message}
            </p>
            <div aria-hidden="true" className="frame-strip mt-2 max-w-sm">
              {Array.from({ length: FULL_GOAL }, (_, index) => (
                <span key={index} data-on={index < signals} />
              ))}
            </div>
          </div>
          <Button variant={reachedFirstGoal ? "primary" : "ghost"} size="lg" onClick={finish} disabled={finishing}>
            {reachedFirstGoal ? "Zu meinen Empfehlungen" : alreadyRated > 0 ? "Fertig" : "Vorerst überspringen"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OnboardingCard({ card, onSkip }: { card: MediaCard; onSkip: () => void }) {
  const library = useLibraryState();
  const item = library[refKey(card)];
  const action = useLibraryAction({ silent: true });
  const [ratingOpen, setRatingOpen] = useState(false);
  const ref = { kind: card.kind, tmdbId: card.tmdbId };
  // Serien gelten hier nicht episodenweise als gesehen: Dazu fehlt dem Onboarding die Information.
  const seen = card.kind === "movie" ? item?.watched === true : item?.rating != null;

  const markSeen = () => {
    if (card.kind === "movie") action.mutate({ ...ref, action: "watched", on: !item?.watched, watchedAt: null });
    else setRatingOpen(true);
  };

  return (
    <li>
      <div className={cn("relative aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-raised ring-1 transition-[box-shadow] duration-200", item?.rating ? "ring-2 ring-ambient" : "ring-white/8")}>
        {card.posterPath ? <TmdbImage path={card.posterPath} kind="poster" alt="" sizes="(max-width: 640px) 45vw, 220px" /> : <ImageFallback title={card.title} />}
        {item?.rating ? (
          <span className="font-display absolute right-2 top-1 text-title-md font-semibold text-screen drop-shadow-[0_2px_6px_rgb(0_0_0/0.9)]" aria-label={`Bewertet mit ${item.rating} von 10`}>
            {item.rating}
          </span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-ink/95 to-transparent p-2 pt-8">
          <IconAction label={seen ? `${card.title}: gesehen` : `${card.title} als gesehen markieren`} active={seen} activeClass="bg-seen text-ink" onClick={markSeen}>
            <Check strokeWidth={3} />
          </IconAction>
          <IconAction label={`${card.title} als Favorit markieren`} active={item?.favorite === true} activeClass="bg-fav text-ink" onClick={() => action.mutate({ ...ref, action: "favorite", on: !item?.favorite })}>
            <Heart fill={item?.favorite ? "currentColor" : "none"} />
          </IconAction>
          <IconAction label={`${card.title} überspringen`} active={false} activeClass="" onClick={onSkip}>
            <X />
          </IconAction>
        </div>
      </div>
      <p className="mt-2 truncate text-[13.5px] font-medium">{card.title}</p>
      <p className="text-xs text-fog-dim">{[card.year, card.kind === "tv" ? "Serie" : "Film"].filter(Boolean).join(", ")}</p>
      <Popover open={ratingOpen} onOpenChange={setRatingOpen}>
        <PopoverTrigger className="mt-1.5 flex h-9 w-full items-center justify-center rounded-full bg-white/8 text-[13px] transition-colors hover:bg-white/14">
          {item?.rating ? `${item.rating} von 10 ändern` : "Bewerten"}
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
          <p className="mb-3 text-sm font-medium">Wie fandest du {card.title}?</p>
          <RatingScale
            value={item?.rating ?? null}
            label={`${card.title} bewerten`}
            onChange={(value) => action.mutate({ ...ref, action: "rating", value })}
            onCommit={() => setRatingOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </li>
  );
}

function IconAction({ label, active, activeClass, onClick, children }: { label: string; active: boolean; activeClass: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn("flex size-9 items-center justify-center rounded-full transition-colors [&_svg]:size-4", active ? activeClass : "glass text-screen hover:bg-white/20")}
    >
      {children}
    </button>
  );
}
