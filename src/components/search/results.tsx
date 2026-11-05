"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PersonAvatar } from "@/components/detail/sections";
import { apiFetch } from "@/components/library/library-provider";
import { Carousel } from "@/components/media/carousel";
import { RowHeading } from "@/components/media/media-row";
import { PosterCard, PosterSkeleton } from "@/components/media/poster-card";
import { Button } from "@/components/ui/button";
import { type MediaCard, type PagedResult, type PersonSearchResult, refKey } from "@/lib/tmdb-types";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-4";

export function ResultsGrid({ initial, query, hasText }: { initial: PagedResult<MediaCard>; query: string; hasText: boolean }) {
  const [items, setItems] = useState(initial.results);
  const [page, setPage] = useState(initial.page);
  const [totalPages, setTotalPages] = useState(initial.totalPages);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async () => {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("seite", String(page + 1));
      const next = await apiFetch<PagedResult<MediaCard>>(`/api/browse?${params}`);
      // TMDB verschiebt Titel zwischen Seiten; ohne diesen Filter gäbe es Dubletten.
      setItems((current) => {
        const known = new Set(current.map(refKey));
        return [...current, ...next.results.filter((card) => !known.has(refKey(card)))];
      });
      setPage(next.page);
      setTotalPages(next.totalPages);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Das hat nicht geklappt.");
    } finally {
      setPending(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="py-10">
        <p className="text-fog">
          {hasText
            ? "Dazu gibt es keine Treffer. Prüfe die Schreibweise, versuche es mit dem Originaltitel oder lockere die Filter."
            : "Kein Titel passt zu diesen Filtern. Lockere sie, zum Beispiel beim Zeitraum oder bei der Bewertung."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      <p className="text-sm text-fog" aria-live="polite">
        {initial.totalResults === 1 ? "1 Ergebnis" : `${new Intl.NumberFormat("de-CH").format(initial.totalResults)} Ergebnisse`}
      </p>
      <ul className={GRID}>
        {items.map((card) => (
          <li key={refKey(card)}>
            <PosterCard card={card} className="w-full sm:w-full 3xl:w-full" sizes="(max-width: 640px) 45vw, 220px" />
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {page < totalPages ? (
        <div className="flex justify-center">
          <Button onClick={loadMore} disabled={pending} size="lg">
            {pending ? <Loader2 className="animate-spin" /> : null}
            Weitere Titel laden
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <ul className={`${GRID} mt-8`} aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <li key={index}>
          <PosterSkeleton className="w-full sm:w-full 3xl:w-full" />
        </li>
      ))}
    </ul>
  );
}

export function PeopleResults({ people }: { people: readonly PersonSearchResult[] }) {
  if (people.length === 0) return null;
  return (
    <section aria-label="Personen" className="-mx-[var(--gutter)] mt-8 space-y-2">
      <RowHeading title="Personen" />
      <Carousel label="Personen">
        {people.map((person) => (
          <Link key={person.id} href={`/person/${person.id}`} className="group w-[104px] text-center sm:w-[124px]">
            <PersonAvatar path={person.profilePath} name={person.name} className="aspect-square w-full ring-1 ring-white/8 group-hover:ring-white/30" />
            <p className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-tight group-hover:underline">{person.name}</p>
          </Link>
        ))}
      </Carousel>
    </section>
  );
}
