import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpandableText } from "@/components/detail/sections";
import { AmbientSync } from "@/components/media/ambient";
import { ambientStyle } from "@/lib/ambient-color";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { EpisodeList, EpisodeProvider, SeasonProgressLine, SeasonToggle } from "@/components/series/episode-progress";
import { formatDate, pluralize } from "@/lib/format";
import { todayIso } from "@/lib/series-progress";
import { getAmbient } from "@/server/ambient";
import { getSession, requireUser } from "@/server/auth/session";
import { getWatchedEpisodeKeys } from "@/server/library/service";
import { getSeason, getTv } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";

interface PageProps {
  params: Promise<{ id: string; season: string }>;
}

async function load(tvId: number, seasonNumber: number, language: string) {
  try {
    return await Promise.all([getTv(tvId, language), getSeason(tvId, seasonNumber, language)]);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const { id, season } = await params;
  const [series, detail] = await Promise.all([getTv(Number(id)).catch(() => null), getSeason(Number(id), Number(season)).catch(() => null)]);
  return series && detail ? { title: `${detail.name}: ${series.title}` } : {};
}

export default async function SeasonPage({ params }: PageProps) {
  const { id, season } = await params;
  const tvId = Number(id);
  const seasonNumber = Number(season);
  if (!Number.isInteger(tvId) || !Number.isInteger(seasonNumber) || tvId <= 0 || seasonNumber < 0) notFound();

  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const [series, detail] = await load(tvId, seasonNumber, language);
  const [ambient, keys] = await Promise.all([getAmbient(series.backdropPath), getWatchedEpisodeKeys(user.id, tvId)]);

  const neighbours = series.seasons.map((entry) => entry.seasonNumber);
  const position = neighbours.indexOf(seasonNumber);
  const previous = position > 0 ? neighbours[position - 1] : undefined;
  const next = position >= 0 && position < neighbours.length - 1 ? neighbours[position + 1] : undefined;
  const firstAir = formatDate(detail.airDate);

  return (
    <EpisodeProvider tvId={tvId} today={todayIso()} initialKeys={keys}>
      <div style={ambientStyle(ambient)} className="relative">
        <AmbientSync ambient={ambient} />
        <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[60vh] opacity-60" />

        <header className="gutter grid gap-6 pt-24 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8 lg:pt-28">
          <div className="relative aspect-[2/3] w-32 overflow-hidden rounded-xl bg-ink-raised shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:w-48 lg:w-56">
            {detail.posterPath ? <TmdbImage path={detail.posterPath} kind="poster" alt={`Plakat von ${detail.name}`} sizes="224px" preload /> : <ImageFallback title={detail.name} />}
          </div>
          <div className="min-w-0 space-y-3 self-end">
            <Link href={`/serie/${tvId}`} className="text-sm text-fog hover:text-screen">
              {series.title}
            </Link>
            <h1 className="font-display text-title-lg font-medium leading-[1.05]">{detail.name}</h1>
            <p className="flex flex-wrap gap-x-4 text-sm text-fog">
              <span>{pluralize(detail.episodes.length, "Episode", "Episoden")}</span>
              {firstAir ? <span>Ab {firstAir}</span> : null}
            </p>
            {detail.overview ? <ExpandableText text={detail.overview} lines={3} /> : null}
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <SeasonToggle seasonNumber={seasonNumber} episodes={detail.episodes} />
              {seasonNumber > 0 ? (
                <div className="w-48">
                  <SeasonProgressLine seasonNumber={seasonNumber} episodes={detail.episodes} />
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <section aria-label="Episoden" className="gutter mt-12">
          {detail.episodes.length ? <EpisodeList tvId={tvId} episodes={detail.episodes} /> : <p className="text-fog">Zu dieser Staffel sind bei TMDB noch keine Episoden eingetragen.</p>}
        </section>

        <nav aria-label="Staffeln" className="gutter mt-10 flex justify-between gap-4 text-sm">
          {previous !== undefined ? (
            <Link href={`/serie/${tvId}/staffel/${previous}`} className="text-fog hover:text-screen">
              {previous === 0 ? "Specials" : `Staffel ${previous}`}
            </Link>
          ) : (
            <span />
          )}
          {next !== undefined ? (
            <Link href={`/serie/${tvId}/staffel/${next}`} className="text-fog hover:text-screen">
              {next === 0 ? "Specials" : `Staffel ${next}`}
            </Link>
          ) : null}
        </nav>
      </div>
    </EpisodeProvider>
  );
}
