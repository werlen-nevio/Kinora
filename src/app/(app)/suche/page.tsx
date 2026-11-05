import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleResults, ResultsGrid, ResultsSkeleton } from "@/components/search/results";
import { SearchFilters } from "@/components/search/filters";
import { parseBrowseParams } from "@/lib/search-params";
import { requireUser } from "@/server/auth/session";
import { runBrowse } from "@/server/detail/browse";
import { getCountries, getGenres, getLanguages, getPerson, getRegionProviders, searchPeople } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Suche" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function Results({ raw, language, region }: { raw: Record<string, string | string[] | undefined>; language: string; region: string }) {
  const params = parseBrowseParams(raw);
  const page = await runBrowse(params, language, region).catch(() => null);
  if (!page) {
    return <p className="py-8 text-danger">Die Suche ist gerade nicht verfügbar, weil TMDB nicht antwortet. Versuche es gleich noch einmal.</p>;
  }
  const query = new URLSearchParams(Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])));
  return <ResultsGrid initial={page} query={query.toString()} hasText={Boolean(params.q)} />;
}

/** Aus den IDs in der URL werden wieder Namen, damit gewählte Personen sichtbar und entfernbar bleiben. */
async function resolvePeople(ids: readonly number[], language: string) {
  const people = await Promise.allSettled(ids.map((id) => getPerson(id, language)));
  return people.flatMap((result) => (result.status === "fulfilled" ? [{ id: result.value.id, name: result.value.name }] : []));
}

async function People({ query, language }: { query: string; language: string }) {
  const people = await searchPeople(query, language).catch(() => []);
  return <PeopleResults people={people.slice(0, 12)} />;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const raw = await searchParams;
  const user = await requireUser();
  const { language, region } = await getUserContext(user.id);
  const params = parseBrowseParams(raw);

  const [movieGenres, tvGenres, languages, countries, providers, initialCast, initialCrew] = await Promise.all([
    getGenres("movie", language).catch(() => []),
    getGenres("tv", language).catch(() => []),
    getLanguages().catch(() => []),
    getCountries(language).catch(() => []),
    getRegionProviders(params.typ, region, language).catch(() => []),
    resolvePeople(params.schauspiel, language),
    resolvePeople(params.regie, language),
  ]);

  return (
    <div className="gutter pb-8 pt-24 lg:pt-28">
      <h1 className="font-display text-title-lg font-medium leading-[1.05]">{params.q ? `Suche: ${params.q}` : "Suche und Filter"}</h1>
      <SearchFilters
        key={`${params.typ}:${params.q ?? ""}`}
        params={params}
        genres={params.typ === "movie" ? movieGenres : tvGenres}
        languages={languages}
        countries={countries}
        providers={providers}
        initialCast={initialCast}
        initialCrew={initialCrew}
      />

      {params.q ? (
        <Suspense>
          <People query={params.q} language={language} />
        </Suspense>
      ) : null}

      <Suspense key={JSON.stringify(raw)} fallback={<ResultsSkeleton />}>
        <Results raw={raw} language={language} region={region} />
      </Suspense>
    </div>
  );
}
