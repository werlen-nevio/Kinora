import Link from "next/link";
import { TmdbImage } from "@/components/media/tmdb-image";
import { buttonStyles } from "@/components/ui/button";
import { formatLongDuration, pluralize } from "@/lib/format";
import { mediaHref } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import type { DiscoveryTeaser, FilmYear } from "@/server/home/rows";

export function FilmYearCard({ data }: { data: FilmYear }) {
  return (
    <section aria-label="Dein Filmjahr" className="ambient-light relative overflow-hidden rounded-2xl bg-ink-raised p-6 ring-1 ring-white/8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-title-sm font-medium">Dein Filmjahr {data.year}</h2>
        <Link href="/tagebuch" className="text-sm text-fog hover:text-screen hover:underline">
          Zum Tagebuch
        </Link>
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dd className="text-title-md font-semibold leading-none">{data.count}</dd>
          <dt className="mt-1.5 text-sm text-fog">{data.count === 1 ? "Film" : "Filme"}</dt>
        </div>
        {data.minutes ? (
          <div>
            <dd className="text-title-md font-semibold leading-none">{formatLongDuration(data.minutes)}</dd>
            <dt className="mt-1.5 text-sm text-fog">Sehzeit</dt>
          </div>
        ) : null}
        {data.averageRating !== null ? (
          <div>
            <dd className="text-title-md font-semibold leading-none">{data.averageRating.toFixed(1)}</dd>
            <dt className="mt-1.5 text-sm text-fog">im Schnitt</dt>
          </div>
        ) : null}
      </dl>
      <ul className="mt-5 flex gap-2 overflow-hidden">
        {data.posters.map((poster) => (
          <li key={`${poster.kind}:${poster.tmdbId}`} className="w-[17%] min-w-14 max-w-20 shrink-0">
            <Link href={mediaHref(poster)} aria-label={poster.title} className="relative block aspect-[2/3] overflow-hidden rounded-md bg-ink-overlay ring-1 ring-white/10 transition-[box-shadow] hover:ring-white/40">
              <TmdbImage path={poster.posterPath} kind="poster" alt="" sizes="90px" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DiscoveryEntry({ teaser, wide }: { teaser: DiscoveryTeaser; wide: boolean }) {
  const running = teaser.remaining > 0;
  return (
    <section aria-label="Was schaust du als Nächstes?" className={cn("ambient-light relative flex items-center gap-6 overflow-hidden rounded-2xl bg-ink-raised p-6 ring-1 ring-white/8", wide && "lg:col-span-2")}>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-title-sm font-medium">Was schaust du als Nächstes?</h2>
        <p className="mt-2 max-w-md text-sm text-fog">
          {running ? `Deine Session wartet auf dich: noch ${pluralize(teaser.remaining, "Karte", "Karten")}.` : "Wische durch Vorschläge, die zu dir passen. Jede Entscheidung macht die nächsten genauer."}
        </p>
        <Link href="/swipe" className={cn(buttonStyles({ variant: "primary" }), "mt-4")}>
          {running ? "Weiter swipen" : "Swipe starten"}
        </Link>
      </div>
      {teaser.posters.length ? (
        <div aria-hidden="true" className="relative hidden h-40 w-36 shrink-0 sm:block">
          {teaser.posters.map((poster, index) => {
            // Ein aufgefächerter Stapel, die vorderste Karte zuoberst.
            const fan = [
              "z-30 rotate-[-3deg]",
              "z-20 translate-x-6 rotate-[5deg] brightness-75",
              "z-10 translate-x-11 rotate-[12deg] brightness-50",
            ];
            return (
              <span key={poster} className={cn("absolute left-0 top-0 block aspect-[2/3] h-full overflow-hidden rounded-lg bg-ink-overlay shadow-xl shadow-black/50 ring-1 ring-white/10", fan[index])}>
                <TmdbImage path={poster} kind="poster" alt="" sizes="120px" />
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
