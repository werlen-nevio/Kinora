"use client";

import { Bookmark, Check } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useLibraryState } from "@/components/library/library-provider";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Select } from "@/components/ui/primitives";
import { formatRating } from "@/lib/format";
import { mediaHref, type PersonCredit, refKey } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

type Sort = "newest" | "oldest" | "rating" | "popularity";
type KindFilter = "all" | "movie" | "tv";
type RoleFilter = "all" | "cast" | "crew";

const SORTS = [
  { value: "newest", label: "Neueste zuerst" },
  { value: "oldest", label: "Älteste zuerst" },
  { value: "rating", label: "Beste Bewertung" },
  { value: "popularity", label: "Popularität" },
] as const;

interface MergedCredit extends PersonCredit {
  roles: string[];
  isCast: boolean;
  isCrew: boolean;
}

/** Pro Titel ein Eintrag, auch wenn jemand dort mehrere Aufgaben hatte. */
function mergeCredits(credits: readonly PersonCredit[]): MergedCredit[] {
  const merged = new Map<string, MergedCredit>();
  for (const credit of credits) {
    const key = refKey(credit);
    const role = credit.creditType === "cast" ? credit.character : credit.job;
    const entry = merged.get(key) ?? { ...credit, roles: [], isCast: false, isCrew: false };
    if (role && !entry.roles.includes(role)) entry.roles.push(role);
    if (credit.creditType === "cast") entry.isCast = true;
    else entry.isCrew = true;
    merged.set(key, entry);
  }
  return [...merged.values()];
}

const dateValue = (credit: PersonCredit) => credit.releaseDate ?? "";

/** Was diese Person mit deiner eigenen Bibliothek verbindet. */
export function PersonalPersonStats({ credits }: { credits: readonly PersonCredit[] }) {
  const library = useLibraryState();
  const stats = useMemo(() => {
    const unique = mergeCredits(credits);
    const seen = unique.filter((credit) => {
      const item = library[refKey(credit)];
      return item?.watched || (item?.episodesWatched ?? 0) > 0;
    });
    const onWatchlist = unique.filter((credit) => library[refKey(credit)]?.watchlisted);
    const ratings = seen.map((credit) => library[refKey(credit)]?.rating).filter((rating): rating is number => typeof rating === "number");
    return {
      seen: seen.length,
      watchlist: onWatchlist,
      average: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
    };
  }, [credits, library]);

  if (stats.seen === 0 && stats.watchlist.length === 0) return null;
  return (
    <section aria-label="Deine Bibliothek" className="rounded-2xl bg-white/4 p-4 ring-1 ring-white/8">
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <div>
          <dt className="text-xs text-fog">Von dir gesehen</dt>
          <dd className="mt-0.5 text-title-sm font-semibold tabular-nums">{stats.seen}</dd>
        </div>
        {stats.average !== null ? (
          <div>
            <dt className="text-xs text-fog">Deine Durchschnittsbewertung</dt>
            <dd className="mt-0.5 text-title-sm font-semibold tabular-nums text-ambient">{stats.average.toFixed(1)}</dd>
          </div>
        ) : null}
        {stats.watchlist.length ? (
          <div className="min-w-0">
            <dt className="text-xs text-fog">Auf deiner Watchlist</dt>
            <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {stats.watchlist.slice(0, 6).map((credit) => (
                <Link key={refKey(credit)} href={mediaHref(credit)} className="hover:underline">
                  {credit.title}
                </Link>
              ))}
              {stats.watchlist.length > 6 ? <span className="text-fog">und {stats.watchlist.length - 6} weitere</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export function Filmography({ credits }: { credits: readonly PersonCredit[] }) {
  const library = useLibraryState();
  const [sort, setSort] = useState<Sort>("newest");
  const [kind, setKind] = useState<KindFilter>("all");
  const [role, setRole] = useState<RoleFilter>("all");

  const merged = useMemo(() => mergeCredits(credits), [credits]);
  const hasCrew = merged.some((credit) => credit.isCrew);
  const hasCast = merged.some((credit) => credit.isCast);

  const visible = useMemo(() => {
    const filtered = merged.filter((credit) => {
      if (kind !== "all" && credit.kind !== kind) return false;
      if (role === "cast" && !credit.isCast) return false;
      if (role === "crew" && !credit.isCrew) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case "oldest":
          // Titel ohne Datum ans Ende, sie sind meist noch nicht erschienen.
          if (!a.releaseDate) return 1;
          if (!b.releaseDate) return -1;
          return dateValue(a).localeCompare(dateValue(b));
        case "rating":
          return (b.voteCount ?? 0) >= 20 === ((a.voteCount ?? 0) >= 20)
            ? (b.voteAverage ?? 0) - (a.voteAverage ?? 0)
            : (b.voteCount ?? 0) >= 20
              ? 1
              : -1;
        case "popularity":
          return (b.popularity ?? 0) - (a.popularity ?? 0);
        default:
          if (!a.releaseDate) return -1;
          if (!b.releaseDate) return 1;
          return dateValue(b).localeCompare(dateValue(a));
      }
    });
  }, [merged, kind, role, sort]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segments
          label="Medientyp"
          value={kind}
          onChange={setKind}
          options={[
            { value: "all", label: "Alle" },
            { value: "movie", label: "Filme" },
            { value: "tv", label: "Serien" },
          ]}
        />
        {hasCast && hasCrew ? (
          <Segments
            label="Rolle"
            value={role}
            onChange={setRole}
            options={[
              { value: "all", label: "Alle Rollen" },
              { value: "cast", label: "Schauspiel" },
              { value: "crew", label: "Regie, Produktion, Crew" },
            ]}
          />
        ) : null}
        <div className="ml-auto">
          <Select label="Sortierung" value={sort} onValueChange={(value) => setSort(value as Sort)} options={SORTS} className="w-48" />
        </div>
      </div>

      <p className="text-sm text-fog" aria-live="polite">
        {visible.length === 1 ? "1 Titel" : `${visible.length} Titel`}
      </p>

      {visible.length === 0 ? (
        <p className="py-8 text-fog">Für diese Auswahl gibt es keine Einträge. Wähle einen anderen Filter.</p>
      ) : (
        <ul className="divide-y divide-white/6">
          {visible.map((credit) => {
            const item = library[refKey(credit)];
            const watched = item?.watched || (item?.episodesWatched ?? 0) > 0;
            const rating = formatRating(credit.voteAverage);
            return (
              <li key={refKey(credit)}>
                <Link href={mediaHref(credit)} className="group flex items-center gap-3 py-2.5 sm:gap-4">
                  <span className="w-11 shrink-0 text-right text-sm tabular-nums text-fog-dim">{credit.year ?? ""}</span>
                  <span className="relative aspect-[2/3] w-10 shrink-0 overflow-hidden rounded bg-ink-raised">
                    {credit.posterPath ? <TmdbImage path={credit.posterPath} kind="poster" alt="" sizes="44px" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[15px] font-medium group-hover:underline", watched && "text-fog")}>{credit.title}</span>
                    <span className="block truncate text-xs text-fog">
                      {credit.kind === "tv" ? "Serie" : "Film"}
                      {credit.roles.length ? `, ${credit.roles.slice(0, 2).join(", ")}` : ""}
                    </span>
                  </span>
                  {watched ? (
                    <span role="img" aria-label="Gesehen" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-seen text-ink">
                      <Check className="size-3.5" strokeWidth={3} />
                    </span>
                  ) : item?.watchlisted ? (
                    <span role="img" aria-label="Auf der Watchlist" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tungsten text-ink">
                      <Bookmark className="size-3.5" fill="currentColor" />
                    </span>
                  ) : null}
                  {rating ? <span className="hidden w-9 shrink-0 text-right text-sm tabular-nums text-fog sm:block">{rating}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Segments<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (value: T) => void; options: readonly { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full bg-white/6 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("rounded-full px-3.5 py-1.5 text-[13px] transition-colors", value === option.value ? "bg-screen font-medium text-ink" : "text-fog hover:text-screen")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
