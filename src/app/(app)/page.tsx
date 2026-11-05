import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ContinueRow, FranchiseRow, RankedRow } from "@/components/home/cards";
import { DiscoveryEntry, FilmYearCard } from "@/components/home/diary-blocks";
import { HeroSkeleton, HomeHero } from "@/components/home/hero";
import { TmdbNotice } from "@/components/layout/tmdb-notice";
import { MediaRow, RowSkeleton } from "@/components/media/media-row";
import { buttonStyles } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import type { MediaCard } from "@/lib/tmdb-types";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import {
  getCompletableCollections,
  getContinueWatching,
  getDiscoveryTeaser,
  getFilmYear,
  getHeroItems,
  getNewReleases,
  getSectionsCached,
  getTopRatedRow,
  getTrendingRow,
  getUpcoming,
  getWatchlistRow,
  sectionById,
} from "@/server/home/rows";
import { getRecentWatches } from "@/server/diary/service";
import { getSwipeDiscoveries } from "@/server/discovery/service";
import { toKind } from "@/server/library/media";
import { getUserContext, type UserContext } from "@/server/user";

export const metadata: Metadata = { title: "Home" };

interface RowProps {
  userId: string;
  context: UserContext;
}

async function HeroBlock({ userId, context }: RowProps) {
  const items = await getHeroItems(userId, context.language, context.region).catch(() => []);
  if (items.length === 0) return <div className="h-24" />;
  return <HomeHero items={items} />;
}

async function PersonalRow({ userId, context, id }: RowProps & { id: string }) {
  const sections = await getSectionsCached(userId).catch(() => []);
  const section = sectionById(sections, id);
  if (!section) return null;
  return <MediaRow title={section.title} emphasis={section.emphasis} items={section.items} showWhy={context.showWhy} section={section.id} />;
}

async function BecauseRows({ userId }: { userId: string }) {
  const sections = await getSectionsCached(userId).catch(() => []);
  return (
    <>
      {sections
        .filter((section) => section.id.startsWith("because:"))
        .map((section) => (
          // Die Überschrift nennt den Grund schon; unter jeder Karte wäre er nur Wiederholung.
          <MediaRow key={section.id} title={section.title} emphasis={section.emphasis} items={section.items} section={section.id} />
        ))}
    </>
  );
}

async function ContinueBlock({ userId, context }: RowProps) {
  const items = await getContinueWatching(userId, context.language).catch(() => []);
  return <ContinueRow items={items} />;
}

async function WatchlistBlock({ userId }: { userId: string }) {
  const items = await getWatchlistRow(userId);
  return <MediaRow title="Deine Watchlist" items={items} href="/watchlist" />;
}

async function FranchiseBlock({ userId, context }: RowProps) {
  const items = await getCompletableCollections(userId, context.language).catch(() => []);
  return <FranchiseRow items={items} />;
}

async function LoadedRow({ title, load, href }: { title: string; load: () => Promise<MediaCard[]>; href?: string }) {
  const items = await load().catch(() => []);
  return <MediaRow title={title} items={items} href={href} />;
}

async function TrendingBlock({ language }: { language: string }) {
  const items = await getTrendingRow(language).catch(() => []);
  return <RankedRow title="Beliebt diese Woche" items={items} />;
}

async function DiaryBlocks({ userId }: { userId: string }) {
  const [filmYear, teaser] = await Promise.all([getFilmYear(userId), getDiscoveryTeaser(userId)]);
  return (
    <section className="gutter grid gap-4 lg:grid-cols-2">
      {filmYear ? <FilmYearCard data={filmYear} /> : null}
      <DiscoveryEntry teaser={teaser} wide={!filmYear} />
    </section>
  );
}

async function RecentWatchesRow({ userId }: { userId: string }) {
  const recent = await getRecentWatches(userId, 18);
  const items: MediaCard[] = recent.map((entry) => ({
    kind: entry.kind,
    tmdbId: entry.tmdbId,
    title: entry.title,
    posterPath: entry.posterPath,
    backdropPath: entry.backdropPath,
    releaseDate: null,
    year: entry.year,
    voteAverage: entry.voteAverage,
    voteCount: null,
    popularity: null,
    genreIds: entry.genreIds,
    overview: "",
    originalLanguage: null,
    reason: `${formatDate(entry.watchedDate)}${entry.rating !== null ? `, ${entry.rating}/10` : ""}`,
  }));
  return <MediaRow title="Zuletzt gesehen" items={items} href="/tagebuch" showWhy />;
}

async function SwipeDiscoveriesRow({ userId }: { userId: string }) {
  const media = await getSwipeDiscoveries(userId);
  const items: MediaCard[] = media.map((row) => ({
    kind: toKind(row.type),
    tmdbId: row.tmdbId,
    title: row.title,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    releaseDate: row.releaseDate?.toISOString().slice(0, 10) ?? null,
    year: row.releaseDate?.getUTCFullYear() ?? null,
    voteAverage: row.voteAverage,
    voteCount: row.voteCount,
    popularity: row.popularity,
    genreIds: row.genreIds,
    overview: "",
    originalLanguage: row.originalLanguage,
  }));
  return <MediaRow title="Deine neuen Entdeckungen" items={items} href="/watchlist" />;
}

async function OnboardingNudge({ userId }: { userId: string }) {
  const count = await prisma.rating.count({ where: { userId } });
  if (count >= 5) return null;
  return (
    <section className="gutter">
      <div className="ambient-light flex flex-col gap-4 rounded-2xl bg-ink-raised p-6 ring-1 ring-white/8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-title-sm">Was magst du?</h2>
          <p className="mt-1 max-w-xl text-sm text-fog">
            {count === 0
              ? "Bewerte ein paar Filme und Serien, dann werden diese Reihen persönlich."
              : `Du hast ${count} von 5 Titeln bewertet. Noch ein paar, dann passen die Empfehlungen deutlich besser.`}
          </p>
        </div>
        <Link href="/onboarding" className={buttonStyles({ variant: "primary" })}>
          Titel bewerten
        </Link>
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<RowSkeleton />}>{children}</Suspense>;
}

export default async function HomePage() {
  const user = await requireUser();
  const context = await getUserContext(user.id);
  const props: RowProps = { userId: user.id, context };
  const { language, region } = context;

  return (
    <>
      <TmdbNotice />
      <Suspense fallback={<HeroSkeleton />}>
        <HeroBlock {...props} />
      </Suspense>

      <div className="relative z-10 space-y-10 lg:space-y-12">
        <Suspense>
          <ContinueBlock {...props} />
        </Suspense>
        <Suspense>
          <OnboardingNudge userId={user.id} />
        </Suspense>
        <Suspense>
          <DiaryBlocks userId={user.id} />
        </Suspense>
        <Row>
          <PersonalRow {...props} id="for_you" />
        </Row>
        <Suspense>
          <SwipeDiscoveriesRow userId={user.id} />
        </Suspense>
        <Suspense>
          <RecentWatchesRow userId={user.id} />
        </Suspense>
        <Suspense>
          <BecauseRows userId={user.id} />
        </Suspense>
        <Suspense>
          <WatchlistBlock userId={user.id} />
        </Suspense>
        <Row>
          <TrendingBlock language={language} />
        </Row>
        <Row>
          <LoadedRow title="Neu erschienen" load={() => getNewReleases(language, region)} />
        </Row>
        <Suspense>
          <PersonalRow {...props} id="favorite_actors" />
        </Suspense>
        <Suspense>
          <PersonalRow {...props} id="hidden_gems" />
        </Suspense>
        <Suspense>
          <FranchiseBlock {...props} />
        </Suspense>
        <Suspense>
          <PersonalRow {...props} id="next_franchise" />
        </Suspense>
        <Suspense>
          <PersonalRow {...props} id="similar_to_favorites" />
        </Suspense>
        <Row>
          <LoadedRow title="Top-bewertete Titel" load={() => getTopRatedRow(language)} />
        </Row>
        <Suspense>
          <PersonalRow {...props} id="new_genres" />
        </Suspense>
        <Suspense>
          <PersonalRow {...props} id="nostalgia" />
        </Suspense>
        <Row>
          <LoadedRow title="Demnächst im Kino" load={() => getUpcoming(language, region)} />
        </Row>
      </div>
    </>
  );
}
