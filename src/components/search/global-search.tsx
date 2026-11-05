"use client";

import { ArrowUpRight, Clock, Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/components/library/library-provider";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { type MediaCard, mediaHref, type PersonSearchResult } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

interface QuickResults {
  movies: MediaCard[];
  series: MediaCard[];
  people: PersonSearchResult[];
  totalResults: number;
}

type Option =
  | { type: "media"; id: string; href: string; card: MediaCard }
  | { type: "person"; id: string; href: string; person: PersonSearchResult }
  | { type: "recent"; id: string; query: string }
  | { type: "all"; id: string; href: string; query: string };

const DEBOUNCE_MS = 220;

export function useGlobalSearchShortcut(open: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "");
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
}

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Suche"
        hideTitle
        className="top-4 max-w-2xl translate-y-0 overflow-hidden p-0 sm:top-[10vh]"
      >
        {open ? <SearchPanel onNavigate={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SearchPanel({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQueryState] = useState("");
  const [answer, setAnswer] = useState<{ query: string; data?: QuickResults; error?: string } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();

  const setQuery = (value: string) => {
    setQueryState(value);
    setActive(-1);
  };

  // Während neue Treffer laden, bleiben die alten stehen, damit die Liste nicht flackert.
  const results = trimmed ? (answer?.data ?? null) : null;
  const settled = answer?.query === trimmed;
  const status: "idle" | "loading" | "error" = !trimmed || (settled && !answer?.error) ? "idle" : settled ? "error" : "loading";
  const errorMessage = settled ? (answer?.error ?? "") : "";

  useEffect(() => {
    void apiFetch<{ queries: string[] }>("/api/search/history")
      .then((data) => setRecent(data.queries))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<QuickResults>(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((data) => setAnswer({ query: trimmed, data }))
        .catch((error: Error) => {
          // Eine überholte Anfrage ist kein Fehler; die neuere läuft schon.
          if (!controller.signal.aborted) setAnswer({ query: trimmed, error: error.message });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const allResultsHref = `/suche?q=${encodeURIComponent(trimmed)}`;

  const options = useMemo<Option[]>(() => {
    if (!trimmed) return recent.map((entry) => ({ type: "recent", id: `recent-${entry}`, query: entry }));
    if (!results) return [];
    const media = (card: MediaCard): Option => ({ type: "media", id: `${card.kind}-${card.tmdbId}`, href: mediaHref(card), card });
    return [
      ...results.movies.map(media),
      ...results.series.map(media),
      ...results.people.map((person): Option => ({ type: "person", id: `person-${person.id}`, href: `/person/${person.id}`, person })),
      ...(results.totalResults > 0 ? [{ type: "all", id: "all", href: allResultsHref, query: trimmed } as Option] : []),
    ];
  }, [trimmed, results, recent, allResultsHref]);

  const remember = useCallback((value: string) => {
    void apiFetch("/api/search", { method: "POST", body: JSON.stringify({ query: value }) }).catch(() => undefined);
  }, []);

  const go = useCallback(
    (href: string) => {
      if (trimmed) remember(trimmed);
      onNavigate();
      router.push(href);
    },
    [trimmed, remember, onNavigate, router],
  );

  const choose = (option: Option) => {
    if (option.type === "recent") setQuery(option.query);
    else go(option.href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + delta + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = options[active];
      if (selected) choose(selected);
      else if (trimmed) go(allResultsHref);
    }
  };

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const activeId = options[active] ? `${listId}-${options[active].id}` : undefined;
  const indexOf = (id: string) => options.findIndex((option) => option.id === id);
  const optionProps = (id: string) => {
    const index = indexOf(id);
    return {
      id: `${listId}-${id}`,
      role: "option" as const,
      "aria-selected": active === index,
      "data-index": index,
      onMouseEnter: () => setActive(index),
    };
  };
  const rowClass = (id: string) =>
    cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors", active === indexOf(id) && "bg-white/10");

  const clearHistory = () => {
    setRecent([]);
    void apiFetch("/api/search/history", { method: "DELETE" }).catch(() => undefined);
  };

  const showEmpty = trimmed && settled && results && results.totalResults === 0;

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-white/10 px-4">
        {status === "loading" ? <Loader2 className="size-5 shrink-0 animate-spin text-fog" /> : <Search className="size-5 shrink-0 text-fog" />}
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Filme, Serien und Personen suchen"
          placeholder="Filme, Serien, Personen"
          maxLength={120}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-screen outline-none placeholder:text-fog-dim"
        />
        {query ? (
          <button type="button" onClick={() => setQuery("")} aria-label="Eingabe löschen" className="text-fog hover:text-screen">
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div ref={listRef} id={listId} role="listbox" aria-label="Suchergebnisse" className="max-h-[65dvh] overflow-y-auto p-2">
        {!trimmed && recent.length > 0 ? (
          <div>
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-xs font-medium text-fog-dim">Zuletzt gesucht</p>
              <button type="button" onClick={clearHistory} className="text-xs text-fog-dim hover:text-screen">
                Verlauf löschen
              </button>
            </div>
            {recent.map((entry) => {
              const id = `recent-${entry}`;
              return (
                <button key={id} type="button" {...optionProps(id)} onClick={() => setQuery(entry)} className={rowClass(id)}>
                  <Clock className="size-4 text-fog-dim" />
                  <span className="truncate text-sm">{entry}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {!trimmed && recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-fog">Tippe einen Titel oder einen Namen ein, etwa Harry Potter oder Daniel Radcliffe.</p>
        ) : null}

        {status === "error" ? <p className="px-3 py-6 text-center text-sm text-danger">{errorMessage}</p> : null}

        {showEmpty ? (
          <p className="px-3 py-6 text-center text-sm text-fog">
            Zu «{trimmed}» gibt es keine Treffer. Prüfe die Schreibweise oder versuche es mit dem Originaltitel.
          </p>
        ) : null}

        {trimmed && results && status !== "error" ? (
          <>
            <ResultGroup title="Filme" hidden={results.movies.length === 0}>
              {results.movies.map((card) => (
                <MediaOption key={card.tmdbId} card={card} extra={optionProps(`movie-${card.tmdbId}`)} className={rowClass(`movie-${card.tmdbId}`)} onNavigate={() => go(mediaHref(card))} />
              ))}
            </ResultGroup>
            <ResultGroup title="Serien" hidden={results.series.length === 0}>
              {results.series.map((card) => (
                <MediaOption key={card.tmdbId} card={card} extra={optionProps(`tv-${card.tmdbId}`)} className={rowClass(`tv-${card.tmdbId}`)} onNavigate={() => go(mediaHref(card))} />
              ))}
            </ResultGroup>
            <ResultGroup title="Personen" hidden={results.people.length === 0}>
              {results.people.map((person) => (
                <Link
                  key={person.id}
                  href={`/person/${person.id}`}
                  {...optionProps(`person-${person.id}`)}
                  onClick={(event) => {
                    event.preventDefault();
                    go(`/person/${person.id}`);
                  }}
                  className={rowClass(`person-${person.id}`)}
                >
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-ink-raised">
                    {person.profilePath ? <TmdbImage path={person.profilePath} kind="profile" alt="" sizes="44px" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{person.name}</span>
                    {person.knownFor.length ? <span className="block truncate text-xs text-fog">{person.knownFor.join(", ")}</span> : null}
                  </span>
                </Link>
              ))}
            </ResultGroup>
            {results.totalResults > 0 ? (
              <button type="button" {...optionProps("all")} onClick={() => go(allResultsHref)} className={cn(rowClass("all"), "mt-1 justify-between text-sm text-fog")}>
                Alle {results.totalResults} Ergebnisse ansehen
                <ArrowUpRight className="size-4" />
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function ResultGroup({ title, hidden, children }: { title: string; hidden: boolean; children: React.ReactNode }) {
  if (hidden) return null;
  return (
    <div role="group" aria-label={title} className="mb-1">
      <p className="px-3 py-2 text-xs font-medium text-fog-dim">{title}</p>
      {children}
    </div>
  );
}

function MediaOption({
  card,
  extra,
  className,
  onNavigate,
}: {
  card: MediaCard;
  extra: object;
  className: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={mediaHref(card)}
      {...extra}
      onClick={(event) => {
        event.preventDefault();
        onNavigate();
      }}
      className={className}
    >
      <span className="relative aspect-[2/3] w-9 shrink-0 overflow-hidden rounded bg-ink-raised">
        {card.posterPath ? <TmdbImage path={card.posterPath} kind="poster" alt="" sizes="40px" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{card.title}</span>
        <span className="block text-xs text-fog">{[card.year, card.kind === "tv" ? "Serie" : "Film"].filter(Boolean).join(", ")}</span>
      </span>
    </Link>
  );
}
