import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CastRow, CrewSection, ExpandableText } from "@/components/detail/sections";
import { TmdbImage } from "@/components/media/tmdb-image";
import { EpisodeProvider, EpisodeToggle } from "@/components/series/episode-progress";
import { formatDate, formatRating, formatRuntime } from "@/lib/format";
import { todayIso } from "@/lib/series-progress";
import { getSession, requireUser } from "@/server/auth/session";
import { getWatchedEpisodeKeys } from "@/server/library/service";
import { getEpisode, getSeason, getTv } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";

interface PageProps {
  params: Promise<{ id: string; season: string; episode: string }>;
}

async function load(tvId: number, season: number, episode: number, language: string) {
  try {
    return await Promise.all([getTv(tvId, language), getSeason(tvId, season, language), getEpisode(tvId, season, episode, language)]);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const { id, season, episode } = await params;
  const detail = await getEpisode(Number(id), Number(season), Number(episode)).catch(() => null);
  return detail ? { title: detail.name } : {};
}

export default async function EpisodePage({ params }: PageProps) {
  const raw = await params;
  const tvId = Number(raw.id);
  const seasonNumber = Number(raw.season);
  const episodeNumber = Number(raw.episode);
  if (![tvId, seasonNumber, episodeNumber].every((value) => Number.isInteger(value) && value >= 0) || tvId === 0) notFound();

  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const [series, season, episode] = await load(tvId, seasonNumber, episodeNumber, language);
  const keys = await getWatchedEpisodeKeys(user.id, tvId);

  const index = season.episodes.findIndex((entry) => entry.episodeNumber === episodeNumber);
  const previous = index > 0 ? season.episodes[index - 1] : undefined;
  const next = index >= 0 ? season.episodes[index + 1] : undefined;
  const rating = formatRating(episode.voteAverage);
  const runtime = formatRuntime(episode.runtime);
  const date = formatDate(episode.airDate);
  const image = episode.stillPath ?? series.backdropPath;

  return (
    <EpisodeProvider tvId={tvId} today={todayIso()} initialKeys={keys}>
      <article>
        <div className="relative aspect-video max-h-[70vh] w-full overflow-hidden bg-ink-raised">
          {image ? <TmdbImage path={image} kind={episode.stillPath ? "still" : "backdrop"} alt="" sizes="100vw" preload /> : null}
          <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink to-transparent" />
        </div>
        <div className="gutter relative -mt-16 space-y-4 sm:-mt-28">
          <p className="flex flex-wrap gap-x-2 text-sm text-fog">
            <Link href={`/serie/${tvId}`} className="hover:text-screen">
              {series.title}
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={`/serie/${tvId}/staffel/${seasonNumber}`} className="hover:text-screen">
              {season.name}
            </Link>
          </p>
          <h1 className="font-display text-title-lg font-medium leading-[1.05] text-balance">{episode.name}</h1>
          <p className="flex flex-wrap gap-x-4 text-sm text-screen/90">
            <span>
              Staffel {seasonNumber}, Episode {episodeNumber}
            </span>
            {date ? <span>{date}</span> : null}
            {runtime ? <span>{runtime}</span> : null}
            {rating ? <span className="font-semibold text-ambient">{rating}</span> : null}
          </p>
          <EpisodeToggle episode={episode} variant="button" />
          {episode.overview ? <ExpandableText text={episode.overview} /> : <p className="text-fog">Zu dieser Episode gibt es bei TMDB noch keine Beschreibung.</p>}
        </div>

        <nav aria-label="Episoden" className="gutter mt-10 flex justify-between gap-4 text-sm">
          {previous ? (
            <Link href={`/serie/${tvId}/staffel/${seasonNumber}/episode/${previous.episodeNumber}`} className="min-w-0 truncate text-fog hover:text-screen">
              Vorherige: {previous.name}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/serie/${tvId}/staffel/${seasonNumber}/episode/${next.episodeNumber}`} className="min-w-0 truncate text-right text-fog hover:text-screen">
              Nächste: {next.name}
            </Link>
          ) : null}
        </nav>

        <div className="mt-12 space-y-12">
          {episode.guestStars.length ? <CastRow cast={episode.guestStars} /> : null}
          <CrewSection crew={episode.crew} />
        </div>
      </article>
    </EpisodeProvider>
  );
}
