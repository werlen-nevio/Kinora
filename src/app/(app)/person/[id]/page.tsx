import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExpandableText, PersonAvatar, SectionHeading } from "@/components/detail/sections";
import { RowHeading, RowSkeleton } from "@/components/media/media-row";
import { Carousel } from "@/components/media/carousel";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { Filmography, PersonalPersonStats } from "@/components/person/filmography";
import { age, formatDate } from "@/lib/format";
import type { PersonDetail } from "@/lib/tmdb-types";
import { getSession, requireUser } from "@/server/auth/session";
import { getPerson, getRelatedPeople } from "@/server/detail/person";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";

interface PageProps {
  params: Promise<{ id: string }>;
}

const DEPARTMENTS: Record<string, string> = {
  Acting: "Schauspiel",
  Directing: "Regie",
  Writing: "Drehbuch",
  Production: "Produktion",
  Sound: "Musik und Ton",
  Camera: "Kamera",
  Editing: "Schnitt",
  Art: "Szenenbild",
  "Costume & Make-Up": "Kostüm und Maske",
  Crew: "Crew",
  "Visual Effects": "Visuelle Effekte",
  Lighting: "Licht",
};

async function load(id: number, language: string) {
  try {
    return await getPerson(id, language);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const person = await getPerson(Number((await params).id)).catch(() => null);
  return person ? { title: person.name } : {};
}

function knownFor(person: PersonDetail) {
  const seen = new Set<string>();
  const acting = person.knownForDepartment === "Acting" ? "cast" : "crew";
  return person.credits
    .filter((credit) => credit.creditType === acting && credit.posterPath)
    .filter((credit) => !(credit.kind === "tv" && (credit.episodeCount ?? 0) < 4))
    .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
    .filter((credit) => {
      const key = `${credit.kind}:${credit.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function RelatedPeople({ person, language }: { person: PersonDetail; language: string }) {
  const related = await getRelatedPeople(person, language).catch(() => []);
  if (related.length === 0) return null;
  return (
    <section aria-label="Gemeinsame Produktionen" className="space-y-2">
      <RowHeading title="Aus gemeinsamen Produktionen" />
      <Carousel label="Personen aus gemeinsamen Produktionen">
        {related.map((entry) => (
          <Link key={entry.id} href={`/person/${entry.id}`} className="group w-[124px] text-center sm:w-[148px]">
            <PersonAvatar path={entry.profilePath} name={entry.name} className="aspect-square w-full ring-1 ring-white/8 group-hover:ring-white/30" />
            <p className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-tight group-hover:underline">{entry.name}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-tight text-fog">{entry.sharedTitles.slice(0, 2).join(", ")}</p>
          </Link>
        ))}
      </Carousel>
    </section>
  );
}

export default async function PersonPage({ params }: PageProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const person = await load(id, language);

  const birthday = formatDate(person.birthday);
  const deathday = formatDate(person.deathday);
  const years = person.birthday ? age(person.birthday, person.deathday) : null;
  const department = person.knownForDepartment ? (DEPARTMENTS[person.knownForDepartment] ?? person.knownForDepartment) : null;
  const known = knownFor(person);

  return (
    <div className="relative">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[70vh] opacity-70" />

      <header className="gutter grid gap-6 pt-24 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-10 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:pt-28">
        <div className="relative aspect-[2/3] w-44 overflow-hidden rounded-2xl bg-ink-raised shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:w-full">
          {person.profilePath ? <TmdbImage path={person.profilePath} kind="profile" alt={person.name} sizes="320px" preload /> : <ImageFallback title={person.name} />}
        </div>
        <div className="min-w-0 space-y-5">
          <div>
            <h1 className="font-display text-title-xl font-medium leading-[1.02] text-balance">{person.name}</h1>
            {department ? <p className="mt-2 text-fog">{department}</p> : null}
          </div>
          <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
            {birthday ? (
              <div>
                <dt className="text-fog">Geboren</dt>
                <dd className="mt-0.5">
                  {birthday}
                  {years !== null && !deathday ? ` (${years} Jahre)` : ""}
                </dd>
              </div>
            ) : null}
            {deathday ? (
              <div>
                <dt className="text-fog">Gestorben</dt>
                <dd className="mt-0.5">
                  {deathday}
                  {years !== null ? ` (${years} Jahre)` : ""}
                </dd>
              </div>
            ) : null}
            {person.placeOfBirth ? (
              <div>
                <dt className="text-fog">Geburtsort</dt>
                <dd className="mt-0.5">{person.placeOfBirth}</dd>
              </div>
            ) : null}
          </dl>
          {person.biography ? <ExpandableText text={person.biography} lines={6} /> : <p className="text-fog">Zu dieser Person gibt es bei TMDB noch keine Biografie.</p>}
          <PersonalPersonStats credits={person.credits} />
        </div>
      </header>

      <div className="mt-14 space-y-14">
        {known.length ? (
          <section aria-label="Bekannt für" className="space-y-2">
            <RowHeading title="Bekannt für" />
            <Carousel label="Bekannt für">
              {known.map((credit) => (
                <Link key={credit.creditId} href={`/${credit.kind === "movie" ? "film" : "serie"}/${credit.tmdbId}`} className="group w-[132px] sm:w-[156px]">
                  <span className="relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/8 transition-[transform,box-shadow] duration-300 group-hover:-translate-y-1 group-hover:ring-white/30">
                    {credit.posterPath ? <TmdbImage path={credit.posterPath} kind="poster" alt="" sizes="156px" /> : null}
                  </span>
                  <span className="mt-2.5 line-clamp-2 block text-[13px] font-medium leading-tight group-hover:underline">{credit.title}</span>
                  {credit.character ? <span className="mt-1 line-clamp-1 block text-xs text-fog">{credit.character}</span> : null}
                </Link>
              ))}
            </Carousel>
          </section>
        ) : null}

        <section aria-label="Filmografie" className="gutter space-y-5">
          <SectionHeading>Filmografie</SectionHeading>
          <Filmography credits={person.credits} />
        </section>

        <Suspense fallback={<RowSkeleton />}>
          <RelatedPeople person={person} language={language} />
        </Suspense>
      </div>
    </div>
  );
}
