import type { Metadata } from "next";
import Link from "next/link";
import { PersonAvatar, SectionHeading } from "@/components/detail/sections";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { ActivityCalendar, BarList, ColumnChart, type Datum } from "@/components/stats/charts";
import { buttonStyles } from "@/components/ui/button";
import { formatCount, formatDate, formatLongDuration, formatMonth, formatRuntime, pluralize } from "@/lib/format";
import { mediaHref } from "@/lib/tmdb-types";
import { requireUser } from "@/server/auth/session";
import { getUserStats, type PersonStat } from "@/server/stats/service";
import { getUserContext } from "@/server/user";

export const metadata: Metadata = { title: "Statistiken" };

function undatedNote(count: number, one: string, many: string) {
  return `${pluralize(count, one, many)} ohne Datum ${count === 1 ? "zählt" : "zählen"} hier nicht mit.`;
}

function Figure({ value, label, note }: { value: string; label: string; note?: string }) {
  return (
    <div className="border-t border-white/10 pt-3">
      <dd className="text-title-md font-semibold leading-none">{value}</dd>
      <dt className="mt-2 text-sm text-fog">{label}</dt>
      {note ? <p className="mt-1 text-xs text-fog-dim">{note}</p> : null}
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4">
      <div>
        <SectionHeading>{title}</SectionHeading>
        {description ? <p className="mt-1 max-w-prose text-sm text-fog">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PeopleList({ people }: { people: readonly PersonStat[] }) {
  if (people.length === 0) return <p className="text-sm text-fog">Sobald du Titel als gesehen markierst, erscheinen hier die Namen.</p>;
  return (
    <ol className="space-y-1">
      {people.map((person, index) => (
        <li key={person.tmdbId}>
          <Link href={`/person/${person.tmdbId}`} className="group flex items-center gap-3 rounded-lg py-1.5 transition-colors hover:bg-white/4">
            <span className="w-5 text-right text-xs tabular-nums text-fog-dim">{index + 1}</span>
            <PersonAvatar path={person.profilePath} name={person.name} className="size-9 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm group-hover:underline">{person.name}</span>
            <span className="text-xs tabular-nums text-fog">{person.count === 1 ? "1 Titel" : `${person.count} Titel`}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default async function StatsPage() {
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const stats = await getUserStats(user.id, language);

  const isEmpty = stats.moviesWatched === 0 && stats.episodesWatched === 0 && stats.ratingCount === 0;
  if (isEmpty) {
    return (
      <div className="gutter flex min-h-[70dvh] flex-col items-start justify-center gap-5 pt-24">
        <h1 className="font-display text-title-lg font-medium">Deine Statistik beginnt mit dem ersten Titel</h1>
        <p className="max-w-xl text-fog">Markiere Filme als gesehen, bewerte sie oder hake Episoden ab. Alle Zahlen hier entstehen aus deinen eigenen Einträgen.</p>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/tagebuch/nachtragen" className={buttonStyles({ variant: "primary", size: "lg" })}>
            Filme nachtragen
          </Link>
          <Link href="/onboarding" className={buttonStyles({ size: "lg" })}>
            Erste Titel bewerten
          </Link>
        </div>
      </div>
    );
  }

  const genreData: Datum[] = stats.genres.slice(0, 10).map((genre) => ({ key: String(genre.id), label: genre.name, value: genre.count }));
  const ratingData: Datum[] = stats.ratings.map((entry) => ({ key: String(entry.value), label: String(entry.value), value: entry.count }));
  const movieMonthData: Datum[] = stats.movieMonths.map((entry) => ({
    key: entry.month,
    label: formatMonth(entry.month),
    value: entry.count,
    detail: entry.minutes ? (formatRuntime(entry.minutes) ?? undefined) : undefined,
  }));
  const movieYearData: Datum[] = stats.movieYears.map((entry) => ({ key: String(entry.year), label: String(entry.year), value: entry.count }));
  const decadeData: Datum[] = stats.decades.map((entry) => ({ key: String(entry.decade), label: `${entry.decade}er`, value: entry.count }));
  const monthData: Datum[] = stats.months.map((entry) => ({
    key: entry.month,
    label: formatMonth(entry.month),
    value: entry.count,
    detail: entry.minutes ? (formatRuntime(entry.minutes) ?? undefined) : undefined,
  }));
  const titles = { one: "Titel", many: "Titel" };

  return (
    <div className="gutter relative pb-8 pt-24 lg:pt-28">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-60" />
      <header className="max-w-3xl">
        <h1 className="font-display text-title-lg font-medium leading-[1.05]">Deine Statistiken</h1>
        {stats.tasteSummary ? <p className="mt-4 text-title-sm text-screen/90 text-balance">{stats.tasteSummary}</p> : null}
      </header>

      <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-7 md:grid-cols-4 2xl:grid-cols-7">
        <Figure value={formatCount(stats.moviesWatched) ?? "0"} label="Filme gesehen" />
        <Figure value={formatCount(stats.episodesWatched) ?? "0"} label="Episoden gesehen" />
        <Figure value={formatCount(stats.seriesCompleted) ?? "0"} label="Serien abgeschlossen" />
        <Figure value={formatCount(stats.collectionsCompleted) ?? "0"} label="Filmreihen abgeschlossen" />
        <Figure
          value={formatLongDuration(stats.totalMinutes)}
          label="Geschätzte Sehzeit"
          note={stats.unknownRuntimeCount ? `${stats.unknownRuntimeCount} Einträge ohne Laufzeit nicht mitgezählt` : undefined}
        />
        <Figure value={formatLongDuration(stats.documentedMinutes)} label="Dokumentierte Sehzeit" note="Nur Einträge mit Sehdatum" />
        <Figure value={stats.averageRating?.toFixed(1) ?? "–"} label="Deine Durchschnittsbewertung" note={stats.ratingCount ? pluralize(stats.ratingCount, "Bewertung", "Bewertungen") : "Noch keine Bewertung"} />
      </dl>

      {stats.datedEvents > 0 ? (
        <section aria-label="Sehkalender" className="mt-16 space-y-4">
          <div>
            <SectionHeading>Sehkalender</SectionHeading>
            <p className="mt-1 max-w-prose text-sm text-fog">Jedes Feld ist ein Tag der letzten zwölf Monate, Filme und Episoden zusammen. Einträge ohne Datum erscheinen hier nie.</p>
          </div>
          <ActivityCalendar days={stats.activity} />
        </section>
      ) : null}

      <div className="mt-16 grid gap-x-14 gap-y-14 lg:grid-cols-2">
        <Panel
          title="Filme pro Monat"
          description={
            stats.undatedMovieEntries > 0
              ? undatedNote(stats.undatedMovieEntries, "Sehvorgang", "Sehvorgänge")
              : "Sehvorgänge von Filmen in den letzten zwölf Monaten."
          }
        >
          {movieMonthData.some((entry) => entry.value > 0) ? (
            <ColumnChart data={movieMonthData} caption="Sehvorgänge von Filmen pro Monat in den letzten zwölf Monaten" valueLabel="Filme" unit={{ one: "Film", many: "Filme" }} labelLast />
          ) : (
            <p className="text-sm text-fog">In den letzten zwölf Monaten gibt es keinen Filmeintrag mit Datum.</p>
          )}
        </Panel>

        <Panel title="Filme pro Jahr" description="Alle Sehvorgänge von Filmen mit bekanntem Datum.">
          {movieYearData.length ? (
            <ColumnChart data={movieYearData} caption="Sehvorgänge von Filmen pro Jahr" valueLabel="Filme" unit={{ one: "Film", many: "Filme" }} labelLast labelEvery={Math.max(1, Math.ceil(movieYearData.length / 10))} />
          ) : (
            <p className="text-sm text-fog">Noch keine Filmeinträge mit Datum.</p>
          )}
        </Panel>

        <Panel
          title="Sehaktivität nach Monaten"
          description={
            stats.undatedEvents > 0
              ? `Nur Einträge mit erfasstem Datum. ${undatedNote(stats.undatedEvents, "Eintrag", "Einträge")}`
              : "Filme und Episoden der letzten zwölf Monate."
          }
        >
          {stats.datedEvents > 0 ? (
            <ColumnChart data={monthData} caption="Gesehene Titel pro Monat in den letzten zwölf Monaten" valueLabel="Gesehen" unit={titles} labelLast />
          ) : (
            <p className="text-sm text-fog">Noch keine Einträge mit Datum. Sobald du etwas als gesehen markierst, erscheint es hier.</p>
          )}
        </Panel>

        <Panel title="Lieblingsgenres" description="Wie oft ein Genre unter deinen gesehenen Titeln vorkommt.">
          {genreData.length ? <BarList data={genreData} caption="Gesehene Titel je Genre" valueLabel="Titel" /> : <p className="text-sm text-fog">Noch keine Daten.</p>}
        </Panel>

        <Panel title="Deine Bewertungen" description="Deine aktuellen Gesamtbewertungen, von 1 bis 10 in halben Punkten.">
          {stats.ratingCount ? (
            <ColumnChart data={ratingData} caption="Anzahl deiner Bewertungen je Punktzahl" valueLabel="Bewertungen" unit={{ one: "Bewertung", many: "Bewertungen" }} labelEvery={2} />
          ) : (
            <p className="text-sm text-fog">Noch keine Bewertungen.</p>
          )}
        </Panel>

        <Panel title="Veröffentlichungsjahrzehnte" description="Aus welcher Zeit deine gesehenen Titel stammen.">
          {decadeData.length ? <ColumnChart data={decadeData} caption="Gesehene Titel je Veröffentlichungsjahrzehnt" valueLabel="Titel" unit={titles} /> : <p className="text-sm text-fog">Noch keine Daten.</p>}
        </Panel>

        {stats.rewatched.length ? (
          <Panel title="Am häufigsten wieder geschaut" description="Filme mit mehr als einem Sehvorgang.">
            <ol className="space-y-1">
              {stats.rewatched.map((title, index) => (
                <li key={title.tmdbId}>
                  <Link href={mediaHref(title)} className="group flex items-center gap-3 rounded-lg py-1.5 transition-colors hover:bg-white/4">
                    <span className="w-5 text-right text-xs tabular-nums text-fog-dim">{index + 1}</span>
                    <span className="relative aspect-[2/3] w-8 shrink-0 overflow-hidden rounded bg-ink-raised">
                      {title.posterPath ? <TmdbImage path={title.posterPath} kind="poster" alt="" sizes="40px" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm group-hover:underline">{title.title}</span>
                    <span className="text-xs tabular-nums text-fog">{title.count} Mal</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Panel>
        ) : null}

        <Panel title="Meistgesehene Schauspielerinnen und Schauspieler">
          <PeopleList people={stats.actors} />
        </Panel>

        <Panel title="Meistgesehene Regie">
          <PeopleList people={stats.directors} />
        </Panel>
      </div>

      {stats.topTitles.length ? (
        <section aria-label="Deine Top 10" className="mt-16 space-y-5">
          <SectionHeading>Deine Top 10</SectionHeading>
          <ol className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-5">
            {stats.topTitles.map((title, index) => (
              <li key={`${title.kind}:${title.tmdbId}`}>
                <Link href={mediaHref(title)} className="group block">
                  <span className="relative block aspect-[2/3] overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/8 transition-[box-shadow,transform] duration-300 group-hover:-translate-y-1 group-hover:ring-white/30">
                    {title.posterPath ? <TmdbImage path={title.posterPath} kind="poster" alt="" sizes="(max-width: 768px) 45vw, 240px" /> : <ImageFallback title={title.title} />}
                  </span>
                  <span className="mt-2.5 flex gap-2 text-sm">
                    <span className="font-display tabular-nums text-fog">{index + 1}</span>
                    <span className="min-w-0 font-medium leading-tight group-hover:underline">{title.title}</span>
                  </span>
                  <span className="mt-1 block text-xs text-fog">
                    {[title.year, title.rating ? `${title.rating} von 10` : null, title.favorite ? "Favorit" : null].filter(Boolean).join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {stats.timeline.length ? (
        <section aria-label="Sehverlauf" className="mt-16 space-y-5">
          <SectionHeading>Sehverlauf</SectionHeading>
          <ol className="max-w-2xl space-y-1 border-l border-white/10 pl-5">
            {stats.timeline.map((entry) => (
              <li key={`${entry.kind}:${entry.tmdbId}:${entry.watchedAt}`} className="relative">
                <span aria-hidden="true" className="absolute -left-[25px] top-1/2 size-2 -translate-y-1/2 rounded-full bg-ambient ring-2 ring-ink" />
                <Link href={mediaHref(entry)} className="group flex items-center gap-3 rounded-lg py-1.5">
                  <span className="relative aspect-[2/3] w-8 shrink-0 overflow-hidden rounded bg-ink-raised">
                    {entry.posterPath ? <TmdbImage path={entry.posterPath} kind="poster" alt="" sizes="40px" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm group-hover:underline">{entry.title}</span>
                  {entry.rewatch ? <span className="text-xs text-fog">Wiederholung</span> : null}
                  <time dateTime={entry.watchedAt} className="shrink-0 text-xs text-fog">
                    {formatDate(entry.watchedAt)}
                  </time>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
