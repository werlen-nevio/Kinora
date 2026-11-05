// Episodenfortschritt und Serienstatus, frei von I/O.

import type { SeriesStatus } from "@/generated/prisma/enums";

export interface EpisodeRef {
  seasonNumber: number;
  episodeNumber: number;
  airDate: string | null;
}

export function episodeKey(seasonNumber: number, episodeNumber: number): string {
  return `${seasonNumber}:${episodeNumber}`;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Eine Folge ohne Datum ist nicht angekündigt und zählt deshalb als nicht ausgestrahlt. */
export function hasAired(episode: { airDate: string | null }, today: string): boolean {
  return episode.airDate !== null && episode.airDate <= today;
}

export interface SeriesProgress<E extends EpisodeRef = EpisodeRef> {
  total: number;
  aired: number;
  watched: number;
  percent: number;
  next: E | null;
  /** Alle ausgestrahlten Folgen gesehen, mindestens eine davon existiert. */
  caughtUp: boolean;
}

export function computeProgress<E extends EpisodeRef>(
  episodes: readonly E[],
  watchedKeys: ReadonlySet<string>,
  today: string,
): SeriesProgress<E> {
  const regular = episodes
    .filter((episode) => episode.seasonNumber > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  const aired = regular.filter((episode) => hasAired(episode, today));
  const seen = aired.filter((episode) => watchedKeys.has(episodeKey(episode.seasonNumber, episode.episodeNumber)));

  // Die nächste Folge folgt auf die letzte gesehene. Lücken davor bleiben sichtbar,
  // sind aber nicht das, was jemand als Nächstes schauen will.
  let lastSeenIndex = -1;
  aired.forEach((episode, index) => {
    if (watchedKeys.has(episodeKey(episode.seasonNumber, episode.episodeNumber))) lastSeenIndex = index;
  });
  const next =
    aired.slice(lastSeenIndex + 1)[0] ??
    aired.find((episode) => !watchedKeys.has(episodeKey(episode.seasonNumber, episode.episodeNumber))) ??
    null;

  return {
    total: regular.length,
    aired: aired.length,
    watched: seen.length,
    percent: aired.length === 0 ? 0 : Math.round((seen.length / aired.length) * 100),
    next,
    caughtUp: aired.length > 0 && seen.length === aired.length,
  };
}

/**
 * Anzahl ausgestrahlter Folgen aus den TMDB-Seriendaten, ohne jede Staffel zu laden.
 * Massgeblich ist `last_episode_to_air`; Specials zählen nicht.
 */
export function countAiredEpisodes(
  seasons: readonly { seasonNumber: number; episodeCount: number }[],
  lastEpisode: { seasonNumber: number; episodeNumber: number } | null,
): number {
  if (!lastEpisode) return 0;
  let count = 0;
  for (const season of seasons) {
    if (season.seasonNumber <= 0) continue;
    if (season.seasonNumber < lastEpisode.seasonNumber) count += season.episodeCount;
    else if (season.seasonNumber === lastEpisode.seasonNumber) count += Math.min(lastEpisode.episodeNumber, season.episodeCount);
  }
  return count;
}

export interface DeriveStatusInput {
  watched: number;
  aired: number;
  previous: SeriesStatus | null;
  /** Wurde mit dieser Änderung eine weitere Folge gesehen? Das beendet eine Pause. */
  advanced: boolean;
}

export function deriveSeriesStatus({ watched, aired, previous, advanced }: DeriveStatusInput): SeriesStatus | null {
  if (watched <= 0) return null;
  if (aired > 0 && watched >= aired) return "COMPLETED";
  if (previous === "PAUSED" && !advanced) return "PAUSED";
  return watched === 1 ? "STARTED" : "WATCHING";
}
