"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronLeft, ChevronRight, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/components/library/library-provider";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { Segments } from "@/components/person/filmography";
import { Button, buttonStyles } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { type DiaryEntryView, type DiaryFilters, type DiaryPersonOption, EMPTY_DIARY_FILTERS, filterDiary, groupDiary, localToday, monthGrid, shiftMonth } from "@/lib/diary";
import { formatDate, formatMonth, pluralize } from "@/lib/format";
import type { Genre } from "@/lib/tmdb-types";
import { mediaHref } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { DiaryEntryEditor } from "./diary-dialog";
import { DIARY_KEY, useDeleteDiaryEntry, useUpdateDiaryEntry } from "./use-diary";

type SortOrder = "newest" | "oldest" | "rating";
type ViewMode = "journal" | "calendar";

const ALL = "alle";
const RATING_OPTIONS = [9, 8, 7, 6, 5].map((value) => ({ value: String(value), label: `Ab ${value} von 10` }));
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function dayParts(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return {
    day: parsed.getUTCDate(),
    weekday: new Intl.DateTimeFormat("de-CH", { weekday: "short", timeZone: "UTC" }).format(parsed),
  };
}

function EntryRow({ entry, onEdit }: { entry: DiaryEntryView; onEdit: (entry: DiaryEntryView) => void }) {
  return (
    <article className="flex gap-4 py-3 [content-visibility:auto] [contain-intrinsic-size:auto_6.5rem]">
      <Link href={mediaHref(entry)} className="relative aspect-[2/3] w-[58px] shrink-0 overflow-hidden rounded-md bg-ink-raised ring-1 ring-white/8 transition-[box-shadow] hover:ring-white/30 sm:w-[66px]">
        {entry.posterPath ? <TmdbImage path={entry.posterPath} kind="poster" alt="" sizes="70px" /> : <ImageFallback title="" />}
        <span className="sr-only">{entry.title}</span>
      </Link>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium leading-snug">
          <Link href={mediaHref(entry)} className="hover:underline underline-offset-2">
            {entry.title}
          </Link>
          {entry.year ? <span className="ml-2 text-sm font-normal text-fog">{entry.year}</span> : null}
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
          {entry.rating !== null ? (
            <span className="font-semibold text-ambient">{entry.rating}/10</span>
          ) : (
            <span className="text-fog-dim">Ohne Bewertung</span>
          )}
          {entry.watchedTime ? <span className="text-fog">{entry.watchedTime} Uhr</span> : null}
          {entry.isRewatch ? <span className="text-fog">Erneut angesehen</span> : null}
          {entry.kind === "tv" ? <span className="text-fog">Serie</span> : null}
        </p>
        {entry.review ? <p className="mt-1.5 line-clamp-3 max-w-[65ch] whitespace-pre-line text-sm leading-relaxed text-screen/85">{entry.review}</p> : null}
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={`Eintrag zu ${entry.title} bearbeiten`} onClick={() => onEdit(entry)}>
        <Pencil />
      </Button>
    </article>
  );
}

function Journal({ entries, sort, onEdit }: { entries: readonly DiaryEntryView[]; sort: SortOrder; onEdit: (entry: DiaryEntryView) => void }) {
  const groups = useMemo(() => groupDiary([...entries]), [entries]);

  if (sort === "rating") {
    const ordered = [...entries].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.watchedDate ?? "").localeCompare(a.watchedDate ?? ""));
    return (
      <div className="max-w-4xl divide-y divide-white/6">
        {ordered.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />
        ))}
      </div>
    );
  }

  const direction = <T,>(list: readonly T[]) => (sort === "oldest" ? [...list].reverse() : list);

  return (
    <div className="max-w-4xl space-y-14">
      {direction(groups.years).map((year) => (
        <section key={year.year} aria-label={`Jahr ${year.year}`}>
          <header className="sticky top-16 z-10 -mx-2 flex items-baseline justify-between gap-4 bg-ink/85 px-2 py-2 backdrop-blur-md">
            <h2 className="font-display text-title-md font-medium">{year.year}</h2>
            <p className="text-sm tabular-nums text-fog">{pluralize(year.count, "Eintrag", "Einträge")}</p>
          </header>
          <div className="mt-4 space-y-9">
            {direction(year.months).map((month) => (
              <section key={month.month} aria-label={formatMonth(month.month, "long")}>
                <h3 className="text-sm font-semibold text-screen">{formatMonth(month.month, "long")}</h3>
                <div className="mt-2 divide-y divide-white/6 border-t border-white/8">
                  {direction(month.days).map((day) => {
                    const { day: number, weekday } = dayParts(day.date);
                    return (
                      <div key={day.date} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
                        <time dateTime={day.date} className="pt-3 text-center">
                          <span className="block text-xl font-semibold tabular-nums leading-none sm:text-2xl">{number}</span>
                          <span className="mt-1 block text-xs text-fog-dim">{weekday}</span>
                        </time>
                        <div className="divide-y divide-white/6">
                          {day.entries.map((entry) => (
                            <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </section>
      ))}

      <UndatedSection entries={groups.undated} onEdit={onEdit} />
    </div>
  );
}

function UndatedSection({ entries, onEdit }: { entries: readonly DiaryEntryView[]; onEdit: (entry: DiaryEntryView) => void }) {
  if (entries.length === 0) return null;
  return (
    <section id="datum-unbekannt" aria-label="Datum unbekannt">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-title-md font-medium">Datum unbekannt</h2>
        <p className="text-sm tabular-nums text-fog">{pluralize(entries.length, "Eintrag", "Einträge")}</p>
      </div>
      <p className="mt-1 max-w-prose text-sm text-fog">Diese Filme hast du gesehen, nur das Wann fehlt. Sie zählen deshalb in keinem Monat und keinem Jahr.</p>
      <div className="mt-3 divide-y divide-white/6 border-t border-white/8">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />
        ))}
      </div>
    </section>
  );
}

function CalendarView({ entries, onEdit }: { entries: readonly DiaryEntryView[]; onEdit: (entry: DiaryEntryView) => void }) {
  const dated = useMemo(() => entries.filter((entry) => entry.watchedDate), [entries]);
  const newestMonth = dated[0]?.watchedDate?.slice(0, 7);
  const [month, setMonth] = useState(newestMonth ?? localToday().slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const byDate = useMemo(() => {
    const map = new Map<string, DiaryEntryView[]>();
    for (const entry of dated) {
      const date = entry.watchedDate as string;
      map.set(date, [...(map.get(date) ?? []), entry]);
    }
    return map;
  }, [dated]);
  const undated = useMemo(() => entries.filter((entry) => !entry.watchedDate), [entries]);
  const today = localToday();
  const selectedEntries = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,44rem)_minmax(0,1fr)] lg:gap-14">
      <section aria-label="Kalender">
        <div className="flex items-center justify-between gap-3">
          <Button size="icon" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft />
          </Button>
          <h2 aria-live="polite" className="font-display text-title-sm font-medium">
            {formatMonth(month, "long")} {month.slice(0, 4)}
          </h2>
          <Button size="icon" aria-label="Nächster Monat" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight />
          </Button>
        </div>

        <div role="grid" className="mt-4">
          <div role="row" className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEKDAYS.map((day) => (
              <span key={day} role="columnheader" className="pb-1 text-center text-xs text-fog-dim">
                {day}
              </span>
            ))}
          </div>
          {monthGrid(month).map((week) => (
            <div key={week[0]?.date} role="row" className="mb-1 grid grid-cols-7 gap-1 sm:mb-1.5 sm:gap-1.5">
              {week.map((cell) => {
                const list = byDate.get(cell.date) ?? [];
                const [first] = list;
                const label = `${formatDate(cell.date)}${list.length ? `: ${list.map((entry) => entry.title).join(", ")}` : ""}`;
                return (
                  <div key={cell.date} role="gridcell">
                    <button
                      type="button"
                      disabled={list.length === 0}
                      aria-label={label}
                      aria-pressed={selected === cell.date}
                      onClick={() => setSelected(selected === cell.date ? null : cell.date)}
                      className={cn(
                        "relative block aspect-[2/3] w-full overflow-hidden rounded-md bg-white/4 text-left outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-screen",
                        !cell.inMonth && "opacity-35",
                        list.length > 0 && "cursor-pointer hover:ring-1 hover:ring-white/40",
                        selected === cell.date && "ring-2 ring-screen",
                      )}
                    >
                      {first?.posterPath ? <TmdbImage path={first.posterPath} kind="poster" alt="" sizes="(max-width: 640px) 14vw, 140px" /> : null}
                      <span className={cn("absolute left-1 top-1 text-[11px] tabular-nums leading-none", first?.posterPath ? "rounded bg-ink/80 px-1 py-0.5 text-screen" : "text-fog-dim", cell.date === today && "font-bold text-screen")}>{cell.day}</span>
                      {list.length > 1 ? <span className="absolute bottom-1 right-1 rounded bg-screen px-1 text-[11px] font-semibold tabular-nums text-ink">{list.length}</span> : null}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

      </section>

      <div className="min-w-0 space-y-12">
        {selected && selectedEntries.length ? (
          <div>
            <h3 className="text-sm font-semibold">{formatDate(selected)}</h3>
            <div className="mt-2 divide-y divide-white/6 border-t border-white/8">
              {selectedEntries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />
              ))}
            </div>
          </div>
        ) : dated.length ? (
          <p className="text-sm text-fog">Wähle einen Tag mit Plakat, um die Einträge dazu zu sehen.</p>
        ) : null}
        <UndatedSection entries={undated} onEdit={onEdit} />
      </div>
    </div>
  );
}

interface DiaryData {
  entries: DiaryEntryView[];
  people: DiaryPersonOption[];
}

export function DiaryView({ initial, genres }: { initial: DiaryData; genres: Genre[] }) {
  const client = useQueryClient();
  const [mountedAt] = useState(() => Date.now());
  // Der Cache lebt im Layout: Änderungen auf anderen Seiten sind hier sofort sichtbar.
  const { data = initial } = useQuery<DiaryData>({
    queryKey: DIARY_KEY,
    queryFn: () => apiFetch<DiaryData>("/api/diary"),
    initialData: initial,
    initialDataUpdatedAt: mountedAt,
    staleTime: 15_000,
  });
  const { entries, people } = data;
  const setEntries = (next: (current: DiaryEntryView[]) => DiaryEntryView[]) => client.setQueryData<DiaryData>(DIARY_KEY, (current) => ({ ...(current ?? initial), entries: next((current ?? initial).entries) }));
  const [filters, setFilters] = useState<DiaryFilters>(EMPTY_DIARY_FILTERS);
  const [personId, setPersonId] = useState<string>(ALL);
  const [sort, setSort] = useState<SortOrder>("newest");
  const [view, setView] = useState<ViewMode>("journal");
  const [editing, setEditing] = useState<DiaryEntryView | null>(null);
  const update = useUpdateDiaryEntry();
  const remove = useDeleteDiaryEntry();

  const years = useMemo(() => [...new Set(entries.flatMap((entry) => (entry.watchedDate ? [entry.watchedDate.slice(0, 4)] : [])))].sort((a, b) => b.localeCompare(a)), [entries]);
  const genreOptions = useMemo(() => {
    const used = new Set(entries.flatMap((entry) => entry.genreIds));
    return genres.filter((genre) => used.has(genre.id)).map((genre) => ({ value: String(genre.id), label: genre.name }));
  }, [entries, genres]);

  const personKeys = useMemo(() => {
    const person = people.find((option) => String(option.tmdbId) === personId);
    return person ? new Set(person.mediaKeys) : null;
  }, [people, personId]);

  const visible = useMemo(() => filterDiary(entries, { ...filters, personMediaKeys: personKeys }), [entries, filters, personKeys]);
  const active = filters.year !== null || filters.genreId !== null || filters.ratingMin !== null || personKeys !== null || filters.viewing !== "all" || filters.missing !== "none";

  const set = (patch: Partial<DiaryFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const reset = () => {
    setFilters(EMPTY_DIARY_FILTERS);
    setPersonId(ALL);
  };

  const refOf = (entry: DiaryEntryView) => ({ kind: entry.kind, tmdbId: entry.tmdbId });

  const deleteEntry = (entry: DiaryEntryView) => {
    setEntries((current) => current.filter((other) => other.id !== entry.id));
    remove.mutate(
      { ref: refOf(entry), id: entry.id },
      {
        onError: () => setEntries((current) => [entry, ...current]),
        onSuccess: () => {
          toast.success("Eintrag gelöscht", {
            action: {
              label: "Rückgängig",
              onClick: () =>
                void apiFetch<{ entry: DiaryEntryView }>("/api/diary", {
                  method: "POST",
                  body: JSON.stringify({
                    kind: entry.kind,
                    tmdbId: entry.tmdbId,
                    rating: entry.rating,
                    watchedAt: entry.watchedDate,
                    watchedTime: entry.watchedTime,
                    review: entry.review,
                    isRewatch: entry.isRewatch,
                  }),
                })
                  .then(({ entry: restored }) => setEntries((current) => [restored, ...current]))
                  .catch((error: Error) => toast.error(error.message)),
            },
          });
        },
      },
    );
  };

  if (entries.length === 0) {
    return (
      <div className="flex min-h-[50dvh] flex-col items-start justify-center gap-5">
        <BookOpen className="size-9 text-ambient" strokeWidth={1.4} />
        <div>
          <h2 className="font-display text-title-md font-medium">Dein Tagebuch ist noch leer</h2>
          <p className="mt-2 max-w-xl text-fog">Trage nach, was du schon gesehen hast, oder markiere den nächsten Film als gesehen. Bewertung und Datum sind freiwillig.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link href="/tagebuch/nachtragen" className={buttonStyles({ variant: "primary", size: "lg" })}>
            Filme nachtragen
          </Link>
          <Link href="/swipe" className={buttonStyles({ size: "lg" })}>
            Neues entdecken
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segments
          label="Ansicht"
          value={view}
          onChange={setView}
          options={[
            { value: "journal", label: "Journal" },
            { value: "calendar", label: "Kalender" },
          ]}
        />
        <Link href="/tagebuch/nachtragen" className={buttonStyles()}>
          <Plus /> Filme nachtragen
        </Link>
      </div>

      <div aria-label="Filter" role="group" className="reel -mx-[var(--gutter)] mt-5 items-center gap-2 lg:flex-wrap">
        <Select label="Jahr" value={filters.year === null ? ALL : String(filters.year)} onValueChange={(value) => set({ year: value === ALL ? null : Number(value) })} options={[{ value: ALL, label: "Alle Jahre" }, ...years.map((year) => ({ value: year, label: year }))]} />
        <Select label="Genre" value={filters.genreId === null ? ALL : String(filters.genreId)} onValueChange={(value) => set({ genreId: value === ALL ? null : Number(value) })} options={[{ value: ALL, label: "Alle Genres" }, ...genreOptions]} />
        <Select label="Bewertung" value={filters.ratingMin === null ? ALL : String(filters.ratingMin)} onValueChange={(value) => set({ ratingMin: value === ALL ? null : Number(value) })} options={[{ value: ALL, label: "Jede Bewertung" }, ...RATING_OPTIONS]} />
        {people.length ? (
          <Select label="Schauspiel" value={personId} onValueChange={setPersonId} options={[{ value: ALL, label: "Alle Personen" }, ...people.map((person) => ({ value: String(person.tmdbId), label: person.name }))]} />
        ) : null}
        <Select
          label="Sehvorgang"
          value={filters.viewing}
          onValueChange={(value) => set({ viewing: value as DiaryFilters["viewing"] })}
          options={[
            { value: "all", label: "Erstmalig und Rewatch" },
            { value: "first", label: "Nur erstmalig" },
            { value: "rewatch", label: "Nur Rewatch" },
          ]}
        />
        <Select
          label="Fehlende Angaben"
          value={filters.missing}
          onValueChange={(value) => set({ missing: value as DiaryFilters["missing"] })}
          options={[
            { value: "none", label: "Alle Einträge" },
            { value: "date", label: "Ohne Sehdatum" },
            { value: "rating", label: "Ohne Bewertung" },
          ]}
        />
        {view === "journal" ? (
          <Select
            label="Sortierung"
            value={sort}
            onValueChange={(value) => setSort(value as SortOrder)}
            options={[
              { value: "newest", label: "Neueste zuerst" },
              { value: "oldest", label: "Älteste zuerst" },
              { value: "rating", label: "Beste Bewertung" },
            ]}
          />
        ) : null}
        {active ? (
          <Button variant="ghost" onClick={reset}>
            Filter zurücksetzen
          </Button>
        ) : null}
      </div>

      <p className="mt-4 text-sm tabular-nums text-fog" aria-live="polite">
        {active ? `${pluralize(visible.length, "Eintrag", "Einträge")} von ${entries.length}` : pluralize(entries.length, "Eintrag", "Einträge")}
      </p>

      <div className="mt-8">
        {visible.length === 0 ? (
          <div className="max-w-md space-y-3">
            <p className="text-fog">Kein Eintrag passt zu diesen Filtern.</p>
            <Button onClick={reset}>Filter zurücksetzen</Button>
          </div>
        ) : view === "journal" ? (
          <Journal entries={visible} sort={sort} onEdit={setEditing} />
        ) : (
          <CalendarView entries={visible} onEdit={setEditing} />
        )}
      </div>

      {editing ? (
        <DiaryEntryEditor
          key={editing.id}
          entry={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={(payload) =>
            update.mutate(
              { ref: refOf(editing), input: { id: editing.id, ...payload } },
              {
                onSuccess: ({ entry }) => {
                  setEntries((current) => current.map((other) => (other.id === entry.id ? entry : other)));
                  toast.success("Eintrag gespeichert");
                },
              },
            )
          }
          onDelete={() => deleteEntry(editing)}
        />
      ) : null}
    </div>
  );
}
