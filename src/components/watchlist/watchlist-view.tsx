"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark, Check, Heart, Loader2, Rows3, SlidersHorizontal, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { apiFetch, useLibraryState, useReplaceLibraryState } from "@/components/library/library-provider";
import { PosterCard } from "@/components/media/poster-card";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Segments } from "@/components/person/filmography";
import { Button, buttonStyles } from "@/components/ui/button";
import { Checkbox, Popover, PopoverContent, PopoverTrigger, Select } from "@/components/ui/primitives";
import { formatRating, formatRuntime } from "@/lib/format";
import type { LibraryState } from "@/lib/library-types";
import { type MediaCard, mediaHref, refKey, type WatchProvider } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import type { WatchlistRow } from "@/server/library/service";

type Sort = "added" | "title" | "year" | "tmdb" | "personal" | "recommended" | "release";
type KindFilter = "all" | "movie" | "tv";
type SeenFilter = "all" | "seen" | "unseen";
type View = "grid" | "list";

const SORTS = [
  { value: "added", label: "Kürzlich hinzugefügt" },
  { value: "recommended", label: "Empfohlene Reihenfolge" },
  { value: "title", label: "Titel" },
  { value: "year", label: "Erscheinungsjahr" },
  { value: "release", label: "Erscheinungsdatum" },
  { value: "tmdb", label: "TMDB-Bewertung" },
  { value: "personal", label: "Persönliche Bewertung" },
] as const;

interface ProvidersData {
  region: string;
  providers: WatchProvider[];
  byItem: Record<string, number[]>;
}

interface Filters {
  kind: KindFilter;
  seen: SeenFilter;
  genres: number[];
  yearFrom: string;
  yearTo: string;
  ratingMin: string;
  runtimeMax: string;
  releasedOnly: boolean;
  providers: number[];
}

const EMPTY_FILTERS: Filters = { kind: "all", seen: "all", genres: [], yearFrom: "", yearTo: "", ratingMin: "", runtimeMax: "", releasedOnly: false, providers: [] };

function toCard(row: WatchlistRow): MediaCard {
  return {
    kind: row.kind,
    tmdbId: row.tmdbId,
    title: row.title,
    posterPath: row.posterPath,
    backdropPath: row.backdropPath,
    releaseDate: row.releaseDate,
    year: row.year,
    voteAverage: row.voteAverage,
    voteCount: null,
    popularity: null,
    genreIds: row.genreIds,
    overview: "",
    originalLanguage: null,
  };
}

function countActive(filters: Filters) {
  return [
    filters.genres.length > 0,
    Boolean(filters.yearFrom || filters.yearTo),
    Boolean(filters.ratingMin),
    Boolean(filters.runtimeMax),
    filters.releasedOnly,
    filters.providers.length > 0,
  ].filter(Boolean).length;
}

export function WatchlistView({ rows, genres }: { rows: WatchlistRow[]; genres: { id: number; name: string }[] }) {
  const router = useRouter();
  const library = useLibraryState();
  const replaceLibrary = useReplaceLibraryState();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>("added");
  const [view, setView] = useState<View>("grid");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [providersRequested, setProvidersRequested] = useState(false);

  const providers = useQuery<ProvidersData>({
    queryKey: ["watchlist-providers", rows.length],
    queryFn: () => apiFetch<ProvidersData>("/api/watchlist/providers"),
    enabled: providersRequested,
    staleTime: 3600_000,
  });

  const order = useQuery<{ order: string[]; reasons: Record<string, string> }>({
    queryKey: ["watchlist-order", rows.length],
    queryFn: () => apiFetch("/api/watchlist/order"),
    enabled: sort === "recommended",
    staleTime: 60_000,
  });

  const today = new Date().toISOString().slice(0, 10);

  // Karten bleiben sichtbar, solange sie laut Bibliothek auf der Watchlist stehen.
  const active = useMemo(() => rows.filter((row) => library[refKey(row)]?.watchlisted !== false), [rows, library]);

  const visible = useMemo(() => {
    const yearFrom = Number(filters.yearFrom) || 0;
    const yearTo = Number(filters.yearTo) || 9999;
    const ratingMin = Number(filters.ratingMin) || 0;
    const runtimeMax = Number(filters.runtimeMax) || Infinity;
    const filtered = active.filter((row) => {
      const item = library[refKey(row)];
      const seen = item?.watched === true;
      if (filters.kind !== "all" && row.kind !== filters.kind) return false;
      if (filters.seen === "seen" && !seen) return false;
      if (filters.seen === "unseen" && seen) return false;
      if (filters.genres.length && !filters.genres.some((id) => row.genreIds.includes(id))) return false;
      if (row.year !== null ? row.year < yearFrom || row.year > yearTo : yearFrom > 0 || yearTo < 9999) return false;
      if (ratingMin && (row.voteAverage ?? 0) < ratingMin) return false;
      if (filters.runtimeMax && (row.runtime === null || row.runtime > runtimeMax)) return false;
      if (filters.releasedOnly && (!row.releaseDate || row.releaseDate > today)) return false;
      if (filters.providers.length && !providers.data?.byItem[refKey(row)]?.some((id) => filters.providers.includes(id))) return false;
      return true;
    });

    const orderIndex = new Map(order.data?.order.map((key, index) => [key, index]));
    return filtered.sort((a, b) => {
      switch (sort) {
        case "title":
          return a.title.localeCompare(b.title, "de");
        case "year":
          return (b.year ?? 0) - (a.year ?? 0);
        case "release":
          return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
        case "tmdb":
          return (b.voteAverage ?? 0) - (a.voteAverage ?? 0);
        case "personal":
          return (library[refKey(b)]?.rating ?? 0) - (library[refKey(a)]?.rating ?? 0);
        case "recommended":
          return (orderIndex.get(refKey(a)) ?? Infinity) - (orderIndex.get(refKey(b)) ?? Infinity);
        default:
          return b.addedAt.localeCompare(a.addedAt);
      }
    });
  }, [active, filters, library, order.data, providers.data, sort, today]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const toggleSelection = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const exitSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const runBulk = async (action: "watched" | "watchlist-remove" | "favorite", successMessage: string) => {
    const items = visible.filter((row) => selected.has(refKey(row))).map((row) => ({ kind: row.kind, tmdbId: row.tmdbId }));
    if (items.length === 0) return;
    setBulkPending(true);
    try {
      const result = await apiFetch<{ results: { ok: boolean }[]; state: LibraryState }>("/api/library/bulk", {
        method: "POST",
        body: JSON.stringify({ items, action }),
      });
      replaceLibrary(result.state);
      const failed = result.results.filter((entry) => !entry.ok).length;
      if (failed > 0) toast.error(`${failed} von ${items.length} Titeln liessen sich nicht ändern.`);
      else toast.success(successMessage);
      exitSelecting();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
    } finally {
      setBulkPending(false);
    }
  };

  if (active.length === 0) {
    return (
      <div className="mt-10 flex max-w-xl flex-col items-start gap-5">
        <p className="text-fog">Noch nichts vorgemerkt. Füge Filme und Serien mit dem Plus auf jedem Plakat hinzu, dann findest du sie hier wieder.</p>
        <Link href="/entdecken" className={buttonStyles({ variant: "primary", size: "lg" })}>
          Filme entdecken
        </Link>
      </div>
    );
  }

  const activeCount = countActive(filters);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(refKey(row)));

  return (
    <div className="mt-6 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segments
          label="Medientyp"
          value={filters.kind}
          onChange={(kind) => update({ kind })}
          options={[
            { value: "all", label: "Alle" },
            { value: "movie", label: "Filme" },
            { value: "tv", label: "Serien" },
          ]}
        />
        <Segments
          label="Sehstatus"
          value={filters.seen}
          onChange={(seen) => update({ seen })}
          options={[
            { value: "all", label: "Alle" },
            { value: "unseen", label: "Noch nicht gesehen" },
            { value: "seen", label: "Bereits gesehen" },
          ]}
        />

        <Popover onOpenChange={(open) => open && setProvidersRequested(true)}>
          <PopoverTrigger className={buttonStyles({ variant: "secondary" })}>
            <SlidersHorizontal /> Filter{activeCount ? ` (${activeCount})` : ""}
          </PopoverTrigger>
          <PopoverContent className="max-h-[75dvh] w-[min(24rem,calc(100vw-2rem))] space-y-5 overflow-y-auto">
            <FilterPanel filters={filters} update={update} genres={genres} providers={providers} />
            {activeCount ? (
              <Button variant="ghost" size="sm" onClick={() => setFilters({ ...EMPTY_FILTERS, kind: filters.kind, seen: filters.seen })}>
                Filter zurücksetzen
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select label="Sortierung" value={sort} onValueChange={(value) => setSort(value as Sort)} options={SORTS} className="w-56" />
          <Segments
            label="Darstellung"
            value={view}
            onChange={setView}
            options={[
              { value: "grid", label: "Raster" },
              { value: "list", label: "Liste" },
            ]}
          />
          <Button variant={selecting ? "primary" : "secondary"} onClick={() => (selecting ? exitSelecting() : setSelecting(true))} aria-pressed={selecting}>
            {selecting ? <X /> : <Rows3 />}
            {selecting ? "Auswahl beenden" : "Auswählen"}
          </Button>
        </div>
      </div>

      <p className="text-sm text-fog" aria-live="polite">
        {visible.length === active.length ? `${active.length} Titel` : `${visible.length} von ${active.length} Titeln`}
        {sort === "recommended" && order.isFetching ? <Loader2 className="ml-2 inline size-3.5 animate-spin" /> : null}
      </p>

      {visible.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="text-fog">Kein Titel passt zu diesen Filtern.</p>
          <Button onClick={() => setFilters(EMPTY_FILTERS)}>Alle Filter zurücksetzen</Button>
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-4">
          {visible.map((row) => {
            const key = refKey(row);
            const card: MediaCard = { ...toCard(row), reason: sort === "recommended" ? order.data?.reasons[key] : undefined };
            return (
              <li key={key} className="relative">
                <PosterCard card={card} className="w-full sm:w-full 3xl:w-full" sizes="(max-width: 640px) 45vw, 220px" showWhy={sort === "recommended"} />
                {selecting ? <SelectOverlay checked={selected.has(key)} title={row.title} onToggle={() => toggleSelection(key)} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-white/6">
          {visible.map((row) => (
            <ListRow key={refKey(row)} row={row} library={library} reason={sort === "recommended" ? order.data?.reasons[refKey(row)] : undefined} selecting={selecting} checked={selected.has(refKey(row))} onToggle={() => toggleSelection(refKey(row))} />
          ))}
        </ul>
      )}

      {selecting ? (
        <div className="fixed inset-x-3 bottom-[4.5rem] z-30 mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-2xl bg-ink-overlay p-3 shadow-2xl shadow-black/60 ring-1 ring-white/10 lg:bottom-6">
          <p className="mr-auto px-2 text-sm" aria-live="polite">
            {selected.size === 1 ? "1 Titel ausgewählt" : `${selected.size} Titel ausgewählt`}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((row) => refKey(row))))}
          >
            {allVisibleSelected ? "Keine auswählen" : "Alle auswählen"}
          </Button>
          <Button size="sm" disabled={selected.size === 0 || bulkPending} onClick={() => runBulk("watched", "Als gesehen markiert")}>
            <Check /> Als gesehen markieren
          </Button>
          <Button size="sm" disabled={selected.size === 0 || bulkPending} onClick={() => runBulk("favorite", "Als Favoriten markiert")}>
            <Heart /> Als Favorit markieren
          </Button>
          <Button size="sm" variant="danger" disabled={selected.size === 0 || bulkPending} onClick={() => runBulk("watchlist-remove", "Von der Watchlist entfernt")}>
            <Trash2 /> Entfernen
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SelectOverlay({ checked, title, onToggle }: { checked: boolean; title: string; onToggle: () => void }) {
  return (
    <label className={cn("absolute inset-0 z-20 flex cursor-pointer items-start justify-end rounded-[10px] p-2", checked ? "bg-screen/15 ring-2 ring-screen" : "bg-ink/25 hover:bg-ink/10")}>
      <span className="sr-only">{title} auswählen</span>
      <Checkbox checked={checked} onCheckedChange={onToggle} />
    </label>
  );
}

function ListRow({
  row,
  library,
  reason,
  selecting,
  checked,
  onToggle,
}: {
  row: WatchlistRow;
  library: LibraryState;
  reason?: string;
  selecting: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  const item = library[refKey(row)];
  const rating = formatRating(row.voteAverage);
  const runtime = formatRuntime(row.runtime);
  return (
    <li className="flex items-center gap-3 py-2.5">
      {selecting ? <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`${row.title} auswählen`} /> : null}
      <Link href={mediaHref(row)} className="group flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span className="relative aspect-[2/3] w-12 shrink-0 overflow-hidden rounded-md bg-ink-raised">
          {row.posterPath ? <TmdbImage path={row.posterPath} kind="poster" alt="" sizes="52px" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium group-hover:underline">{row.title}</span>
          <span className="flex flex-wrap gap-x-3 text-xs text-fog">
            {row.year ? <span>{row.year}</span> : null}
            <span>{row.kind === "tv" ? "Serie" : "Film"}</span>
            {runtime ? <span>{runtime}</span> : null}
            {reason ? <span className="text-screen/80">{reason}</span> : null}
          </span>
        </span>
        {item?.watched ? (
          <span role="img" aria-label="Gesehen" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-seen text-ink">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        ) : (
          <Bookmark className="size-4 shrink-0 text-tungsten" fill="currentColor" aria-hidden="true" />
        )}
        {item?.rating ? <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums">{item.rating}</span> : null}
        {rating ? <span className="hidden w-9 shrink-0 text-right text-sm tabular-nums text-fog sm:block">{rating}</span> : null}
      </Link>
    </li>
  );
}

function FilterPanel({
  filters,
  update,
  genres,
  providers,
}: {
  filters: Filters;
  update: (patch: Partial<Filters>) => void;
  genres: { id: number; name: string }[];
  providers: { data?: ProvidersData; isLoading: boolean; isError: boolean };
}) {
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
  const numberInput = "h-10 w-full rounded-xl border border-white/12 bg-white/5 px-3 text-sm outline-none focus:border-screen";

  return (
    <>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Genre</legend>
        <div className="flex flex-wrap gap-1.5">
          {genres.map((genre) => (
            <Chip key={genre.id} active={filters.genres.includes(genre.id)} onClick={() => update({ genres: toggle(filters.genres, genre.id) })}>
              {genre.name}
            </Chip>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">
          Jahr von
          <input inputMode="numeric" value={filters.yearFrom} onChange={(event) => update({ yearFrom: event.target.value.replace(/\D/g, "").slice(0, 4) })} className={cn(numberInput, "mt-1.5 font-normal")} placeholder="1990" />
        </label>
        <label className="text-sm font-medium">
          Jahr bis
          <input inputMode="numeric" value={filters.yearTo} onChange={(event) => update({ yearTo: event.target.value.replace(/\D/g, "").slice(0, 4) })} className={cn(numberInput, "mt-1.5 font-normal")} placeholder="2026" />
        </label>
        <label className="text-sm font-medium">
          Bewertung ab
          <input inputMode="decimal" value={filters.ratingMin} onChange={(event) => update({ ratingMin: event.target.value.replace(/[^\d.]/g, "").slice(0, 3) })} className={cn(numberInput, "mt-1.5 font-normal")} placeholder="7.5" />
        </label>
        <label className="text-sm font-medium">
          Laufzeit bis (Min.)
          <input inputMode="numeric" value={filters.runtimeMax} onChange={(event) => update({ runtimeMax: event.target.value.replace(/\D/g, "").slice(0, 3) })} className={cn(numberInput, "mt-1.5 font-normal")} placeholder="120" />
        </label>
      </div>

      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox checked={filters.releasedOnly} onCheckedChange={(value) => update({ releasedOnly: value === true })} />
        Nur bereits erschienene Titel
      </label>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Streaminganbieter</legend>
        {providers.isLoading ? <p className="text-sm text-fog">Anbieter werden geladen.</p> : null}
        {providers.isError ? <p className="text-sm text-danger">Anbieter liessen sich nicht laden. Versuche es später noch einmal.</p> : null}
        {providers.data && providers.data.providers.length === 0 ? <p className="text-sm text-fog">Für deine Titel sind keine Anbieter eingetragen.</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {providers.data?.providers.slice(0, 24).map((provider) => (
            <Chip key={provider.id} active={filters.providers.includes(provider.id)} onClick={() => update({ providers: toggle(filters.providers, provider.id) })}>
              {provider.name}
            </Chip>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded-full px-3 py-1.5 text-[13px] transition-colors", active ? "bg-screen font-medium text-ink" : "bg-white/8 text-screen/85 hover:bg-white/14")}
    >
      {children}
    </button>
  );
}

