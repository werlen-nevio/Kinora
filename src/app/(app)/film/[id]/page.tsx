import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FranchiseSection } from "@/components/detail/franchise";
import { DetailHero } from "@/components/detail/hero";
import { RelatedMovieRows } from "@/components/detail/related-rows";
import { CastRow, CrewSection, ExpandableText, FactList, MediaGallery, ProvidersSection, SectionHeading } from "@/components/detail/sections";
import { TrackView } from "@/components/detail/track-view";
import { MediaDiaryPanel } from "@/components/diary/media-diary-panel";
import { FavoriteButton, MoreMenu, PersonalStatus, RatingControl, SeenButton, ShareButton, TrailerButton, WatchlistButton } from "@/components/media/actions";
import { AmbientSync } from "@/components/media/ambient";
import { ambientStyle } from "@/lib/ambient-color";
import { RowSkeleton } from "@/components/media/media-row";
import { todayIso } from "@/lib/series-progress";
import { formatDate, formatMoney, formatRuntime, movieStatusLabel } from "@/lib/format";
import { getAmbient } from "@/server/ambient";
import { getSession, requireUser } from "@/server/auth/session";
import { getCollection, getMovie } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";
import Link from "next/link";

interface PageProps {
  params: Promise<{ id: string }>;
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function load(id: number, language: string, region: string) {
  try {
    return await getMovie(id, language, region);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const id = parseId((await params).id);
  if (!id) return {};
  const movie = await getMovie(id).catch(() => null);
  return movie ? { title: movie.title, description: movie.overview.slice(0, 160) } : {};
}

async function FranchiseBlock({ collectionId, currentId, language }: { collectionId: number; currentId: number; language: string }) {
  const collection = await getCollection(collectionId, language).catch(() => null);
  if (!collection || collection.parts.length < 2) return null;
  return <FranchiseSection id={collection.id} name={collection.name} parts={collection.parts} today={todayIso()} currentId={currentId} showLink />;
}

export default async function MoviePage({ params }: PageProps) {
  const id = parseId((await params).id);
  if (!id) notFound();

  const user = await requireUser();
  const { language, region, showWhy } = await getUserContext(user.id);
  const movie = await load(id, language, region);
  const ambient = await getAmbient(movie.backdropPath);

  const ref = { kind: "movie" as const, tmdbId: movie.tmdbId };
  const trailer = movie.videos.find((video) => video.type === "Trailer");
  const directors = movie.crew.filter((member) => member.job === "Director");
  const leads = movie.cast.slice(0, 4);

  return (
    <div style={ambientStyle(ambient)}>
      <AmbientSync ambient={ambient} />
      <TrackView media={ref} />

      <DetailHero
        title={movie.title}
        originalTitle={movie.originalTitle}
        tagline={movie.tagline}
        logoPath={movie.logoPath}
        backdropPath={movie.backdropPath}
        posterPath={movie.posterPath}
        voteAverage={movie.voteAverage}
        voteCount={movie.voteCount}
        meta={[movie.year, formatRuntime(movie.runtime), movie.ageRating, movie.productionCountries.slice(0, 2).join(", ")]}
        genres={movie.genres.map((genre) => genre.name)}
      >
        <PersonalStatus media={ref} />
        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <SeenButton media={{ ...ref, title: movie.title, posterPath: movie.posterPath, year: movie.year }} />
          <WatchlistButton media={ref} />
          <RatingControl media={ref} title={movie.title} />
          {trailer ? <TrailerButton videoKey={trailer.key} title={movie.title} /> : null}
          <FavoriteButton media={ref} />
          <ShareButton title={movie.title} />
          <MoreMenu media={ref} title={movie.title} />
        </div>
        {movie.overview ? <p className="line-clamp-3 max-w-[68ch] pt-1 text-[15px] leading-relaxed text-screen/85 text-pretty">{movie.overview}</p> : null}
        <dl className="flex flex-wrap gap-x-8 gap-y-2 pt-1 text-sm">
          {directors.length ? (
            <div>
              <dt className="text-fog">Regie</dt>
              <dd className="mt-0.5">
                {directors.map((person, index) => (
                  <span key={person.id}>
                    {index > 0 ? ", " : ""}
                    <Link href={`/person/${person.id}`} className="hover:underline">
                      {person.name}
                    </Link>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
          {leads.length ? (
            <div>
              <dt className="text-fog">Mit</dt>
              <dd className="mt-0.5">
                {leads.map((person, index) => (
                  <span key={person.id}>
                    {index > 0 ? ", " : ""}
                    <Link href={`/person/${person.id}`} className="hover:underline">
                      {person.name}
                    </Link>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </DetailHero>

      <div className="mt-12 space-y-14 lg:mt-16">
        <div className="gutter empty:hidden">
          <MediaDiaryPanel media={{ ...ref, title: movie.title, posterPath: movie.posterPath, year: movie.year }} />
        </div>

        {movie.collection ? (
          <Suspense fallback={<RowSkeleton />}>
            <FranchiseBlock collectionId={movie.collection.id} currentId={movie.tmdbId} language={language} />
          </Suspense>
        ) : null}

        <div className="gutter grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-12">
            {movie.overview ? (
              <section className="space-y-3" aria-label="Handlung">
                <SectionHeading>Handlung</SectionHeading>
                <ExpandableText text={movie.overview} />
              </section>
            ) : null}
            <FactList
              facts={[
                { label: "Laufzeit", value: formatRuntime(movie.runtime) },
                { label: "Veröffentlichung", value: formatDate(movie.releaseDate) },
                { label: `Kinostart ${region}`, value: movie.regionalReleaseDate !== movie.releaseDate ? formatDate(movie.regionalReleaseDate) : null },
                { label: "Status", value: movieStatusLabel(movie.status) },
                { label: "Budget", value: formatMoney(movie.budget) },
                { label: "Einspielergebnis", value: formatMoney(movie.revenue) },
                { label: "Sprachen", value: movie.spokenLanguages.join(", ") },
                { label: "Produktionsland", value: movie.productionCountries.join(", ") },
                { label: "Produktionsfirmen", value: movie.productionCompanies.slice(0, 5).map((company) => company.name).join(", ") },
              ]}
            />
          </div>
          <ProvidersSection providers={movie.providersByRegion[region]} region={region} kindLabel="diesen Film" />
        </div>

        <CastRow cast={movie.cast} />
        <CrewSection crew={movie.crew} />
        <MediaGallery title={movie.title} videos={movie.videos} backdrops={movie.backdrops} posters={movie.posters} />

        <Suspense fallback={<RowSkeleton />}>
          <RelatedMovieRows userId={user.id} movie={movie} language={language} showWhy={showWhy} />
        </Suspense>
      </div>
    </div>
  );
}
