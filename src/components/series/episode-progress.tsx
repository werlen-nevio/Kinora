"use client";

import { Check, ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { FrameStrip } from "@/components/home/cards";
import { useLibraryAction } from "@/components/library/library-provider";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Button } from "@/components/ui/button";
import { formatDate, formatRuntime } from "@/lib/format";
import { computeProgress, episodeKey, hasAired } from "@/lib/series-progress";
import type { EpisodeSummary } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

interface EpisodeContextValue {
  tvId: number;
  today: string;
  watched: ReadonlySet<string>;
  isWatched: (season: number, episode: number) => boolean;
  toggleEpisode: (season: number, episode: number, on: boolean) => void;
  toggleSeason: (season: number, episodes: readonly EpisodeSummary[], on: boolean) => void;
}

const EpisodeContext = createContext<EpisodeContextValue | null>(null);

function useEpisodes() {
  const value = useContext(EpisodeContext);
  if (!value) throw new Error("EpisodeProvider fehlt");
  return value;
}

export function EpisodeProvider({ tvId, today, initialKeys, children }: { tvId: number; today: string; initialKeys: readonly string[]; children: ReactNode }) {
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set(initialKeys));
  const action = useLibraryAction({ silent: true });

  const toggleEpisode = useCallback(
    (season: number, episode: number, on: boolean) => {
      const key = episodeKey(season, episode);
      setWatched((current) => {
        const next = new Set(current);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
      action.mutate(
        { kind: "tv", tmdbId: tvId, action: "episode", seasonNumber: season, episodeNumber: episode, on },
        {
          onError: () =>
            setWatched((current) => {
              const next = new Set(current);
              if (on) next.delete(key);
              else next.add(key);
              return next;
            }),
        },
      );
    },
    [action, tvId],
  );

  const toggleSeason = useCallback(
    (season: number, episodes: readonly EpisodeSummary[], on: boolean) => {
      const keys = episodes.filter((episode) => !on || hasAired(episode, today)).map((episode) => episodeKey(episode.seasonNumber, episode.episodeNumber));
      let before: ReadonlySet<string> = new Set();
      setWatched((current) => {
        before = current;
        const next = new Set(current);
        keys.forEach((key) => (on ? next.add(key) : next.delete(key)));
        return next;
      });
      action.mutate({ kind: "tv", tmdbId: tvId, action: "season", seasonNumber: season, on }, { onError: () => setWatched(before) });
    },
    [action, tvId, today],
  );

  const value = useMemo<EpisodeContextValue>(
    () => ({
      tvId,
      today,
      watched,
      isWatched: (season, episode) => watched.has(episodeKey(season, episode)),
      toggleEpisode,
      toggleSeason,
    }),
    [tvId, today, watched, toggleEpisode, toggleSeason],
  );

  return <EpisodeContext.Provider value={value}>{children}</EpisodeContext.Provider>;
}

export function SeriesProgressPanel({ episodes }: { episodes: readonly EpisodeSummary[] }) {
  const { tvId, today, watched, toggleEpisode } = useEpisodes();
  const progress = useMemo(() => computeProgress(episodes, watched, today), [episodes, watched, today]);
  const upcoming = progress.total - progress.aired;

  if (progress.aired === 0) {
    return <p className="text-sm text-fog">Von dieser Serie ist noch keine Episode ausgestrahlt.</p>;
  }

  return (
    <section aria-label="Dein Fortschritt" className="ambient-light space-y-4 self-start rounded-2xl bg-ink-raised p-5 ring-1 ring-white/8 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <p className="text-[15px] font-medium">
          {progress.watched} von {progress.aired} Episoden gesehen
        </p>
        <p className="text-title-sm font-semibold tabular-nums text-ambient">{progress.percent} %</p>
      </div>
      <FrameStrip seen={progress.watched} total={progress.aired} label={`${progress.watched} von ${progress.aired} Episoden gesehen`} />
      {upcoming > 0 ? <p className="text-xs text-fog">{upcoming === 1 ? "1 weitere Episode ist angekündigt und zählt nicht als offen." : `${upcoming} weitere Episoden sind angekündigt und zählen nicht als offen.`}</p> : null}

      {progress.next ? (
        <div className="flex flex-col gap-3 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href={`/serie/${tvId}/staffel/${progress.next.seasonNumber}/episode/${progress.next.episodeNumber}`} className="group flex min-w-0 items-center gap-3">
            <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-ink-overlay">
              {progress.next.stillPath ? <TmdbImage path={progress.next.stillPath} kind="still" alt="" sizes="120px" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-xs text-fog">
                Als Nächstes: Staffel {progress.next.seasonNumber}, Episode {progress.next.episodeNumber}
              </span>
              <span className="block truncate text-sm font-medium group-hover:underline">{progress.next.name}</span>
            </span>
          </Link>
          <Button variant="primary" onClick={() => progress.next && toggleEpisode(progress.next.seasonNumber, progress.next.episodeNumber, true)}>
            <Check strokeWidth={3} /> Als gesehen markieren
          </Button>
        </div>
      ) : (
        <p className="border-t border-white/8 pt-4 text-sm text-seen">Alle ausgestrahlten Episoden gesehen.</p>
      )}
    </section>
  );
}

export function SeasonProgressLine({ seasonNumber, episodes }: { seasonNumber: number; episodes: readonly EpisodeSummary[] }) {
  const { today, watched } = useEpisodes();
  const inSeason = episodes.filter((episode) => episode.seasonNumber === seasonNumber);
  const progress = computeProgress(inSeason, watched, today);
  if (progress.aired === 0) return <p className="text-xs text-fog">Noch nicht ausgestrahlt</p>;
  return (
    <div className="space-y-1.5">
      <FrameStrip seen={progress.watched} total={progress.aired} label={`${progress.watched} von ${progress.aired} Episoden gesehen`} />
      <p className="text-xs tabular-nums text-fog">
        {progress.watched} von {progress.aired}
      </p>
    </div>
  );
}

export function SeasonToggle({ seasonNumber, episodes }: { seasonNumber: number; episodes: readonly EpisodeSummary[] }) {
  const { today, isWatched, toggleSeason } = useEpisodes();
  const aired = episodes.filter((episode) => hasAired(episode, today));
  const complete = aired.length > 0 && aired.every((episode) => isWatched(episode.seasonNumber, episode.episodeNumber));
  if (aired.length === 0) return null;
  return (
    <Button size="lg" aria-pressed={complete} onClick={() => toggleSeason(seasonNumber, episodes, !complete)}>
      {complete ? <Check className="text-seen" strokeWidth={3} /> : null}
      {complete ? "Staffel gesehen" : "Staffel als gesehen markieren"}
    </Button>
  );
}

export function EpisodeToggle({ episode, variant = "icon" }: { episode: EpisodeSummary; variant?: "icon" | "button" }) {
  const { today, isWatched, toggleEpisode } = useEpisodes();
  const aired = hasAired(episode, today);
  const watched = isWatched(episode.seasonNumber, episode.episodeNumber);
  const name = `Staffel ${episode.seasonNumber}, Episode ${episode.episodeNumber}`;

  if (!aired) {
    return variant === "button" ? (
      <p className="text-sm text-fog">{episode.airDate ? `Wird am ${formatDate(episode.airDate)} ausgestrahlt.` : "Noch nicht angekündigt."}</p>
    ) : (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-fog-dim" title="Noch nicht ausgestrahlt">
        <Lock className="size-4" />
        <span className="sr-only">{name}: noch nicht ausgestrahlt</span>
      </span>
    );
  }

  if (variant === "button") {
    return (
      <Button size="lg" variant={watched ? "secondary" : "primary"} aria-pressed={watched} onClick={() => toggleEpisode(episode.seasonNumber, episode.episodeNumber, !watched)}>
        <Check className={cn(watched && "text-seen")} strokeWidth={3} />
        {watched ? "Gesehen" : "Als gesehen markieren"}
      </Button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={`${name} ${watched ? "nicht mehr als gesehen markieren" : "als gesehen markieren"}`}
      onClick={() => toggleEpisode(episode.seasonNumber, episode.episodeNumber, !watched)}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
        watched ? "bg-seen text-ink" : "bg-white/8 text-fog hover:bg-white/16 hover:text-screen",
      )}
    >
      <Check className="size-4" strokeWidth={3} />
    </button>
  );
}

export function EpisodeList({ tvId, episodes }: { tvId: number; episodes: readonly EpisodeSummary[] }) {
  const { today, isWatched } = useEpisodes();
  return (
    <ol className="space-y-2">
      {episodes.map((episode) => {
        const aired = hasAired(episode, today);
        const watched = isWatched(episode.seasonNumber, episode.episodeNumber);
        const runtime = formatRuntime(episode.runtime);
        const date = formatDate(episode.airDate);
        return (
          <li key={episode.episodeNumber} className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/4 sm:gap-4 sm:p-3">
            <Link href={`/serie/${tvId}/staffel/${episode.seasonNumber}/episode/${episode.episodeNumber}`} className="group flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
              <span className={cn("relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-ink-raised sm:w-44", !aired && "opacity-50")}>
                {episode.stillPath ? <TmdbImage path={episode.stillPath} kind="still" alt="" sizes="(max-width: 640px) 100px, 180px" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs tabular-nums text-fog-dim">Episode {episode.episodeNumber}</span>
                <span className={cn("mt-0.5 block text-[15px] font-medium leading-snug group-hover:underline", watched && "text-fog")}>{episode.name}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-fog">
                  {date ? <span>{date}</span> : <span>Noch kein Termin</span>}
                  {runtime ? <span>{runtime}</span> : null}
                </span>
                {episode.overview ? <span className="mt-1.5 hidden max-w-[72ch] text-sm leading-relaxed text-fog sm:line-clamp-2">{episode.overview}</span> : null}
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-fog-dim sm:hidden" />
            </Link>
            <EpisodeToggle episode={episode} />
          </li>
        );
      })}
    </ol>
  );
}
