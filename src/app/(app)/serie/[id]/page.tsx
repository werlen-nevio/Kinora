import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DetailHero } from "@/components/detail/hero";
import { RelatedSeriesRows } from "@/components/detail/related-rows";
import { CastRow, CrewSection, ExpandableText, FactList, MediaGallery, ProvidersSection, SectionHeading } from "@/components/detail/sections";
import { TrackView } from "@/components/detail/track-view";
import { MediaDiaryPanel } from "@/components/diary/media-diary-panel";
import { FavoriteButton, MoreMenu, PersonalStatus, RatingControl, SeenButton, ShareButton, TrailerButton, WatchlistButton } from "@/components/media/actions";
import { AmbientSync } from "@/components/media/ambient";
import { ambientStyle } from "@/lib/ambient-color";
import { RowSkeleton } from "@/components/media/media-row";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { EpisodeProvider, SeasonProgressLine, SeriesProgressPanel } from "@/components/series/episode-progress";
import { formatDate, formatRuntime, pluralize, tvStatusLabel } from "@/lib/format";
import { todayIso } from "@/lib/series-progress";
import { getAmbient } from "@/server/ambient";
import { getSession, requireUser } from "@/server/auth/session";
import { getWatchedEpisodeKeys } from "@/server/library/service";
import { getEpisodeIndex, getTv } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function load(id: number, language: string, region: string) {
  try {
    return await getTv(id, language, region);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const series = await getTv(Number((await params).id)).catch(() => null);
  return series ? { title: series.title, description: series.overview.slice(0, 160) } : {};
}

export default async function SeriesPage({ params }: PageProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const user = await requireUser();
  const { language, region, showWhy } = await getUserContext(user.id);
  const series = await load(id, language, region);
  const [ambient, episodes, keys] = await Promise.all([
    getAmbient(series.backdropPath),
    getEpisodeIndex(id, language).catch(() => []),
    getWatchedEpisodeKeys(user.id, id),
  ]);

  const ref = { kind: "tv" as const, tmdbId: series.tmdbId };
  const trailer = series.videos.find((video) => video.type === "Trailer");
  const regularSeasons = series.seasons.filter((season) => season.seasonNumber > 0);
  const specials = series.seasons.filter((season) => season.seasonNumber === 0);
  const today = todayIso();

  return (
    <EpisodeProvider tvId={id} today={today} initialKeys={keys}>
      <div style={ambientStyle(ambient)}>
        <AmbientSync ambient={ambient} />
        <TrackView media={ref} />

        <DetailHero
          title={series.title}
          originalTitle={series.originalTitle}
          tagline={series.tagline}
          logoPath={series.logoPath}
          backdropPath={series.backdropPath}
          posterPath={series.posterPath}
          voteAverage={series.voteAverage}
          voteCount={series.voteCount}
          meta={[
            series.year,
            series.numberOfSeasons ? pluralize(series.numberOfSeasons, "Staffel", "Staffeln") : null,
            formatRuntime(series.episodeRuntime),
            series.ageRating,
            tvStatusLabel(series.status),
          ]}
          genres={series.genres.map((genre) => genre.name)}
        >
          <PersonalStatus media={ref} />
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <WatchlistButton media={ref} />
            <RatingControl media={ref} title={series.title} />
            <SeenButton media={{ ...ref, title: series.title, posterPath: series.posterPath, year: series.year }} />
            {trailer ? <TrailerButton videoKey={trailer.key} title={series.title} /> : null}
            <FavoriteButton media={ref} />
            <ShareButton title={series.title} />
            <MoreMenu media={ref} title={series.title} />
          </div>
          {series.overview ? <p className="line-clamp-3 max-w-[68ch] pt-1 text-[15px] leading-relaxed text-screen/85 text-pretty">{series.overview}</p> : null}
        </DetailHero>

        <div className="mt-12 space-y-14 lg:mt-16">
          <div className="gutter grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="space-y-10">
              <SeriesProgressPanel episodes={episodes} />
              <MediaDiaryPanel media={{ ...ref, title: series.title, posterPath: series.posterPath, year: series.year }} />
            </div>
            <ProvidersSection providers={series.providersByRegion[region]} region={region} kindLabel="diese Serie" />
          </div>

          {regularSeasons.length ? (
            <section className="gutter space-y-5" aria-label="Staffeln">
              <SectionHeading>Staffeln</SectionHeading>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {[...regularSeasons, ...specials].map((season) => (
                  <li key={season.seasonNumber} className="flex gap-4 rounded-xl bg-ink-raised p-3 ring-1 ring-white/6 transition-[box-shadow] hover:ring-white/20">
                    <Link href={`/serie/${id}/staffel/${season.seasonNumber}`} className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-ink-overlay">
                      {season.posterPath ? <TmdbImage path={season.posterPath} kind="poster" alt="" sizes="90px" /> : <ImageFallback title={season.name} className="p-2 text-xs" />}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
                      <div>
                        <Link href={`/serie/${id}/staffel/${season.seasonNumber}`} className="block truncate text-[15px] font-medium hover:underline">
                          {season.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-fog">
                          {pluralize(season.episodeCount, "Episode", "Episoden")}
                          {season.airDate ? `, ${season.airDate.slice(0, 4)}` : ""}
                        </p>
                      </div>
                      {season.seasonNumber > 0 ? <SeasonProgressLine seasonNumber={season.seasonNumber} episodes={episodes} /> : <p className="text-xs text-fog">Specials zählen nicht zum Fortschritt</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="gutter grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {series.overview ? (
              <section className="space-y-3" aria-label="Handlung">
                <SectionHeading>Handlung</SectionHeading>
                <ExpandableText text={series.overview} />
              </section>
            ) : null}
            <FactList
              facts={[
                { label: "Status", value: tvStatusLabel(series.status) },
                { label: "Erstausstrahlung", value: formatDate(series.firstAirDate) },
                { label: "Letzte Ausstrahlung", value: formatDate(series.lastAirDate) },
                { label: "Nächste Episode", value: formatDate(series.nextEpisode?.airDate) },
                { label: "Episodenlänge", value: formatRuntime(series.episodeRuntime) },
                { label: "Sender und Dienste", value: series.networks.map((network) => network.name).join(", ") },
                { label: "Sprachen", value: series.spokenLanguages.join(", ") },
                { label: "Produktionsland", value: series.productionCountries.join(", ") },
                { label: "Produktionsfirmen", value: series.productionCompanies.slice(0, 5).map((company) => company.name).join(", ") },
              ]}
            />
          </div>

          <CastRow cast={series.cast} />
          <CrewSection crew={series.crew} createdBy={series.createdBy} />
          <MediaGallery title={series.title} videos={series.videos} backdrops={series.backdrops} posters={series.posters} />

          <Suspense fallback={<RowSkeleton />}>
            <RelatedSeriesRows userId={user.id} series={series} language={language} showWhy={showWhy} />
          </Suspense>
        </div>
      </div>
    </EpisodeProvider>
  );
}
