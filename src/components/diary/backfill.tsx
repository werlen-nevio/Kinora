"use client";

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Search, Star, Undo2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FrameStrip } from "@/components/home/cards";
import { apiFetch, useLibraryItem, useLibraryState, useSetLibraryItem } from "@/components/library/library-provider";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { Button, buttonStyles } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives";
import type { DiaryEntryView, DiaryPayload } from "@/lib/diary";
import { localToday } from "@/lib/diary";
import { formatDate, pluralize } from "@/lib/format";
import type { LibraryItem } from "@/lib/library-types";
import { type MediaCard, type PagedResult, refKey } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { RatingScale } from "./rating-scale";
import { DIARY_KEY } from "./use-diary";

const MILESTONE = 25;

type Logged = Record<string, { entryId: string; rating: number | null; date: string | null }>;

interface DiaryResponse {
  entry: DiaryEntryView;
  item: LibraryItem;
}

function withoutKey(state: Logged, key: string): Logged {
  const next = { ...state };
  delete next[key];
  return next;
}

function Tile({
  card,
  logged,
  onLog,
  onChange,
  onRemove,
}: {
  card: MediaCard;
  logged: Logged[string] | undefined;
  onLog: (card: MediaCard) => void;
  onChange: (card: MediaCard, patch: DiaryPayload) => void;
  onRemove: (card: MediaCard) => void;
}) {
  const item = useLibraryItem(card);
  const alreadySeen = item.watched && !logged;
  const today = localToday();

  return (
    <li>
      <button
        type="button"
        disabled={alreadySeen}
        aria-pressed={Boolean(logged)}
        aria-label={logged ? `${card.title}: nachgetragen, rückgängig machen` : alreadySeen ? `${card.title}: bereits gesehen` : `${card.title} als gesehen nachtragen`}
        onClick={() => (logged ? onRemove(card) : onLog(card))}
        className={cn("group relative block aspect-[2/3] w-full overflow-hidden rounded-[10px] bg-ink-raised outline-none ring-1 ring-white/8 transition-[box-shadow,transform] duration-200 focus-visible:ring-2 focus-visible:ring-screen", !alreadySeen && "cursor-pointer hover:ring-white/40 active:scale-[0.98]")}
      >
        {card.posterPath ? <TmdbImage path={card.posterPath} kind="poster" alt="" sizes="(max-width: 640px) 45vw, 180px" /> : <ImageFallback title={card.title} />}
        <span className={cn("absolute inset-0 flex items-center justify-center transition-colors duration-200", logged || alreadySeen ? "bg-ink/70" : "bg-transparent group-hover:bg-ink/30")}>
          {logged || alreadySeen ? (
            <span className="flex size-11 items-center justify-center rounded-full bg-seen text-ink">
              <Check className="size-6" strokeWidth={3} />
            </span>
          ) : null}
        </span>
      </button>
      <p className="mt-2 truncate text-[13.5px] font-medium">{card.title}</p>
      <p className="text-xs text-fog-dim">{alreadySeen ? "Bereits gesehen" : (card.year ?? "")}</p>

      {logged ? (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <Popover>
            <PopoverTrigger aria-label={`${card.title} bewerten`} className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full bg-white/8 text-[13px] tabular-nums transition-colors hover:bg-white/14">
              <Star className={cn("size-3.5 shrink-0", logged.rating !== null && "text-ambient")} fill={logged.rating !== null ? "currentColor" : "none"} />
              {logged.rating ?? "Note"}
            </PopoverTrigger>
            <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]">
              <p className="mb-3 text-sm font-medium">Wie hat dir {card.title} gefallen?</p>
              <RatingScale value={logged.rating} label={`${card.title} bewerten`} onChange={(rating) => onChange(card, { rating })} />
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger aria-label={`Sehdatum für ${card.title}`} className="flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full bg-white/8 text-[13px] transition-colors hover:bg-white/14">
              <CalendarDays className={cn("size-3.5 shrink-0", logged.date && "text-ambient")} />
              <span className="truncate">{logged.date ? logged.date.slice(0, 4) : "Datum"}</span>
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <label className="block text-sm font-medium">
                Wann hast du {card.title} gesehen?
                <input
                  type="date"
                  value={logged.date ?? ""}
                  max={today}
                  onChange={(event) => onChange(card, { watchedAt: event.target.value || null })}
                  className="mt-2 h-10 w-full rounded-xl border border-white/12 bg-white/5 px-3 text-sm font-normal text-screen [color-scheme:dark] outline-none focus:border-screen"
                />
              </label>
              {logged.date ? <p className="mt-2 text-xs text-fog">{formatDate(logged.date)}</p> : null}
            </PopoverContent>
          </Popover>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Nachtragen ohne Dialoge: Ein Klick aufs Plakat speichert den Film als gesehen, ohne Datum und
 * ohne Bewertung. Beides lässt sich direkt darunter ergänzen, muss aber nicht. Sehr schnelles
 * Klicken bleibt flüssig, weil die Oberfläche nicht auf den Server wartet.
 */
export function Backfill() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [logged, setLogged] = useState<Logged>({});
  const [lastKey, setLastKey] = useState<{ card: MediaCard } | null>(null);
  const client = useQueryClient();
  const library = useLibraryState();
  const setItem = useSetLibraryItem();
  const count = Object.keys(logged).length;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: ["backfill-search", debounced],
    enabled: debounced.length > 0,
    queryFn: () => apiFetch<PagedResult<MediaCard>>(`/api/browse?typ=movie&q=${encodeURIComponent(debounced)}`),
    select: (page) => page.results,
  });

  const suggestions = useInfiniteQuery({
    queryKey: ["backfill-suggestions"],
    enabled: debounced.length === 0,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => apiFetch<PagedResult<MediaCard>>(`/api/browse?typ=movie&sortierung=vote_count.desc&seite=${pageParam}`),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 5 * 60_000,
  });

  const cards = debounced ? (results.data ?? []) : (suggestions.data?.pages.flatMap((page) => page.results) ?? []);
  const uniqueCards = [...new Map(cards.map((card) => [refKey(card), card])).values()];
  const loading = debounced ? results.isLoading : suggestions.isLoading;

  const log = (card: MediaCard) => {
    const key = refKey(card);
    // Sofort abgehakt; die Eintrags-ID kommt nach. Bis dahin wartet ein Rückgängig kurz mit.
    setLogged((current) => ({ ...current, [key]: { entryId: "", rating: null, date: null } }));
    setLastKey({ card });
    void apiFetch<DiaryResponse>("/api/diary", { method: "POST", body: JSON.stringify({ kind: card.kind, tmdbId: card.tmdbId }) })
      .then(({ entry, item }) => {
        setItem(card, item);
        setLogged((current) => (current[key] ? { ...current, [key]: { ...current[key], entryId: entry.id } } : current));
      })
      .catch((error: Error) => {
        setLogged((state) => withoutKey(state, key));
        toast.error(`${card.title}: ${error.message}`);
      });
  };

  const change = (card: MediaCard, patch: DiaryPayload) => {
    const key = refKey(card);
    const current = logged[key];
    if (!current?.entryId) return;
    const next = { ...current, ...("rating" in patch ? { rating: patch.rating ?? null } : {}), ...("watchedAt" in patch ? { date: patch.watchedAt ?? null } : {}) };
    setLogged((state) => ({ ...state, [key]: next }));
    void apiFetch<DiaryResponse>("/api/diary", { method: "PATCH", body: JSON.stringify({ id: current.entryId, ...patch }) })
      .then(({ item }) => setItem(card, item))
      .catch((error: Error) => {
        setLogged((state) => ({ ...state, [key]: current }));
        toast.error(error.message);
      });
  };

  const remove = (card: MediaCard) => {
    const key = refKey(card);
    const current = logged[key];
    if (!current?.entryId) return;
    setLogged((state) => withoutKey(state, key));
    void apiFetch<{ item: LibraryItem }>(`/api/diary?id=${encodeURIComponent(current.entryId)}`, { method: "DELETE" })
      .then(({ item }) => setItem(card, item))
      .catch((error: Error) => {
        setLogged((state) => ({ ...state, [key]: current }));
        toast.error(error.message);
      });
  };

  // Das Tagebuch lädt beim nächsten Öffnen neu; pro Klick wäre das unnötige Arbeit.
  useEffect(() => () => void client.invalidateQueries({ queryKey: DIARY_KEY }), [client]);

  const lastLogged = lastKey ? logged[refKey(lastKey.card)] : undefined;
  const milestone = Math.max(MILESTONE, Math.ceil((count + 1) / MILESTONE) * MILESTONE);

  return (
    <div>
      <div className="sticky top-16 z-20 mt-6 border-b border-white/8 bg-ink/90 py-3 backdrop-blur-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Film suchen</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fog" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || query.trim() !== debounced || !debounced) return;
                const first = uniqueCards.find((card) => !logged[refKey(card)] && !library[refKey(card)]?.watched);
                if (!first) return;
                event.preventDefault();
                log(first);
                event.currentTarget.select();
              }}
              placeholder="Film suchen, Enter trägt den ersten Treffer nach"
              className="h-11 w-full rounded-full bg-white/8 pl-10 pr-4 text-sm text-screen outline-none ring-1 ring-white/5 placeholder:text-fog focus:ring-2 focus:ring-screen"
            />
          </label>
          <div className="flex min-w-0 items-center gap-3 sm:w-80">
            <div className="min-w-0 flex-1">
              <p aria-live="polite" className="text-sm font-medium tabular-nums">
                {count === 0 ? "Noch keiner nachgetragen" : `${pluralize(count, "Film", "Filme")} nachgetragen`}
              </p>
              <div className="mt-1.5">
                <FrameStrip seen={count} total={milestone} label={`${count} von ${milestone} Filmen`} />
              </div>
            </div>
            {lastLogged?.entryId && lastKey ? (
              <Button size="icon-sm" aria-label={`${lastKey.card.title} rückgängig machen`} onClick={() => remove(lastKey.card)}>
                <Undo2 />
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {loading ? (
        <ul aria-hidden="true" className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4">
          {Array.from({ length: 12 }, (_, index) => (
            <li key={index} className="skeleton aspect-[2/3] rounded-[10px]" />
          ))}
        </ul>
      ) : uniqueCards.length === 0 ? (
        <p className="mt-8 max-w-md text-fog">{debounced ? `Zu «${debounced}» gibt es keinen Film. Prüfe die Schreibweise oder versuche es mit dem Originaltitel.` : "Die Vorschläge konnten nicht geladen werden. Du kannst trotzdem oben suchen."}</p>
      ) : (
        <>
          {debounced ? null : <p className="mt-6 text-sm text-fog">Bekannte Filme zum Durchklicken. Ein Klick aufs Plakat genügt.</p>}
          <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4">
            {uniqueCards.map((card) => (
              <Tile key={refKey(card)} card={card} logged={logged[refKey(card)]} onLog={log} onChange={change} onRemove={remove} />
            ))}
          </ul>
          {!debounced && suggestions.hasNextPage ? (
            <div className="mt-8 flex justify-center">
              <Button size="lg" disabled={suggestions.isFetchingNextPage} onClick={() => void suggestions.fetchNextPage()}>
                {suggestions.isFetchingNextPage ? "Lädt" : "Mehr Filme laden"}
              </Button>
            </div>
          ) : null}
        </>
      )}

      {count > 0 ? (
        <div className="mt-10">
          <Link href="/tagebuch" className={buttonStyles({ variant: "primary", size: "lg" })}>
            Zum Tagebuch
          </Link>
        </div>
      ) : null}
    </div>
  );
}
