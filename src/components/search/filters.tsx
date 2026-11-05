"use client";

import { Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { apiFetch } from "@/components/library/library-provider";
import { Segments } from "@/components/person/filmography";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { Chip } from "@/components/watchlist/watchlist-view";
import type { BrowseParams } from "@/lib/search-params";
import type { Genre, MediaKind, PersonSearchResult, WatchProvider } from "@/lib/tmdb-types";

interface PickedPerson {
  id: number;
  name: string;
}

const SORTS = [
  { value: "popularity.desc", label: "Beliebtheit" },
  { value: "vote_average.desc", label: "Beste Bewertung" },
  { value: "primary_release_date.desc", label: "Neueste zuerst" },
  { value: "primary_release_date.asc", label: "Älteste zuerst" },
];

const ANY = "alle";

export function SearchFilters({
  params,
  genres,
  languages,
  countries,
  providers,
  initialCast,
  initialCrew,
}: {
  params: BrowseParams;
  genres: Genre[];
  languages: { code: string; name: string }[];
  countries: { code: string; name: string }[];
  providers: WatchProvider[];
  initialCast: PickedPerson[];
  initialCrew: PickedPerson[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(!params.q);
  const [text, setText] = useState(params.q ?? "");
  const [draft, setDraft] = useState(params);
  const [appliedParams, setAppliedParams] = useState(params);
  const [cast, setCast] = useState(initialCast);
  const [crew, setCrew] = useState(initialCrew);

  // Neue URL, etwa nach «Zurück»: Der Entwurf folgt dem, was gerade gilt.
  if (appliedParams !== params) {
    setAppliedParams(params);
    setDraft(params);
  }

  const apply = (next: BrowseParams, peopleCast = cast, peopleCrew = crew, query = text) => {
    const search = new URLSearchParams();
    const set = (key: string, value: string | number | undefined) => {
      if (value !== undefined && value !== "") search.set(key, String(value));
    };
    set("q", query.trim() || undefined);
    set("typ", next.typ);
    set("genres", next.genres.join(",") || undefined);
    set("von", next.von);
    set("bis", next.bis);
    set("bewertung", next.bewertung);
    set("sprache", next.sprache);
    set("land", next.land);
    set("laufzeitMin", next.laufzeitMin);
    set("laufzeitMax", next.laufzeitMax);
    set("schauspiel", peopleCast.map((person) => person.id).join(",") || undefined);
    set("regie", peopleCrew.map((person) => person.id).join(",") || undefined);
    set("anbieter", next.anbieter.join(",") || undefined);
    if (next.sortierung !== "popularity.desc") set("sortierung", next.sortierung);
    startTransition(() => router.push(`/suche?${search}`));
  };

  const update = (patch: Partial<BrowseParams>) => setDraft((current) => ({ ...current, ...patch }));
  const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
  const switchKind = (typ: MediaKind) => {
    // Genres und Anbieter unterscheiden sich je Medientyp, also neu beginnen.
    apply({ ...draft, typ, genres: [], anbieter: [], schauspiel: [], regie: [] }, [], []);
    setCast([]);
    setCrew([]);
  };
  const reset = () => {
    setCast([]);
    setCrew([]);
    setText("");
    startTransition(() => router.push(`/suche?typ=${draft.typ}`));
  };

  const numberInput = "mt-1.5 h-10 w-full rounded-xl border border-white/12 bg-white/5 px-3 text-sm font-normal outline-none focus:border-screen";

  return (
    <div className="mt-6 space-y-4">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply(draft);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fog" />
          <input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Titel suchen"
            placeholder="Titel suchen"
            maxLength={120}
            className="h-11 w-full rounded-full border border-white/12 bg-white/5 pl-10 pr-4 text-[15px] outline-none focus:border-screen"
          />
        </div>
        <Segments
          label="Medientyp"
          value={draft.typ}
          onChange={switchKind}
          options={[
            { value: "movie", label: "Filme" },
            { value: "tv", label: "Serien" },
          ]}
        />
        <Button aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <SlidersHorizontal /> Filter
        </Button>
        <Button type="submit" variant="primary">
          {isPending ? <Loader2 className="animate-spin" /> : null}
          Suchen
        </Button>
      </form>

      {params.q ? (
        <p className="text-xs text-fog-dim">TMDB kann Freitext nicht mit allen Filtern kombinieren. Bei einer Textsuche wirken Genre, Zeitraum, Bewertung und Sprache; die übrigen nur ohne Suchtext.</p>
      ) : null}

      {open ? (
        <div className="space-y-5 rounded-2xl bg-ink-raised p-5 ring-1 ring-white/6">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Genre</legend>
            <div className="flex flex-wrap gap-1.5">
              {genres.map((genre) => (
                <Chip key={genre.id} active={draft.genres.includes(genre.id)} onClick={() => update({ genres: toggle(draft.genres, genre.id) })}>
                  {genre.name}
                </Chip>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <label className="text-sm font-medium">
              Jahr von
              <input type="number" min={1870} max={2100} value={draft.von ?? ""} onChange={(event) => update({ von: event.target.value ? Number(event.target.value) : undefined })} className={numberInput} />
            </label>
            <label className="text-sm font-medium">
              Jahr bis
              <input type="number" min={1870} max={2100} value={draft.bis ?? ""} onChange={(event) => update({ bis: event.target.value ? Number(event.target.value) : undefined })} className={numberInput} />
            </label>
            <label className="text-sm font-medium">
              Bewertung ab
              <input type="number" min={0} max={10} step={0.5} value={draft.bewertung ?? ""} onChange={(event) => update({ bewertung: event.target.value ? Number(event.target.value) : undefined })} className={numberInput} />
            </label>
            <label className="text-sm font-medium">
              Laufzeit ab (Min.)
              <input type="number" min={0} max={1000} value={draft.laufzeitMin ?? ""} onChange={(event) => update({ laufzeitMin: event.target.value ? Number(event.target.value) : undefined })} className={numberInput} />
            </label>
            <label className="text-sm font-medium">
              Laufzeit bis (Min.)
              <input type="number" min={0} max={1000} value={draft.laufzeitMax ?? ""} onChange={(event) => update({ laufzeitMax: event.target.value ? Number(event.target.value) : undefined })} className={numberInput} />
            </label>
            <div className="text-sm font-medium">
              Sortierung
              <Select label="Sortierung" className="mt-1.5 w-full font-normal" value={draft.sortierung} onValueChange={(value) => update({ sortierung: value as BrowseParams["sortierung"] })} options={SORTS} />
            </div>
            <div className="text-sm font-medium">
              Sprache
              <Select
                label="Originalsprache"
                className="mt-1.5 w-full font-normal"
                value={draft.sprache ?? ANY}
                onValueChange={(value) => update({ sprache: value === ANY ? undefined : value })}
                options={[{ value: ANY, label: "Alle Sprachen" }, ...languages.map((entry) => ({ value: entry.code, label: entry.name }))]}
              />
            </div>
            <div className="text-sm font-medium">
              Ursprungsland
              <Select
                label="Ursprungsland"
                className="mt-1.5 w-full font-normal"
                value={draft.land ?? ANY}
                onValueChange={(value) => update({ land: value === ANY ? undefined : value })}
                options={[{ value: ANY, label: "Alle Länder" }, ...countries.map((entry) => ({ value: entry.code, label: entry.name }))]}
              />
            </div>
          </div>

          {draft.typ === "movie" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <PersonPicker label="Schauspieler" people={cast} onChange={setCast} />
              <PersonPicker label="Regisseur" people={crew} onChange={setCrew} />
            </div>
          ) : (
            <p className="text-xs text-fog-dim">Für Serien bietet TMDB keinen Filter nach Schauspiel oder Regie an.</p>
          )}

          {providers.length ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Streaminganbieter</legend>
              <div className="flex flex-wrap gap-1.5">
                {providers.slice(0, 20).map((provider) => (
                  <Chip key={provider.id} active={draft.anbieter.includes(provider.id)} onClick={() => update({ anbieter: toggle(draft.anbieter, provider.id) })}>
                    {provider.name}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className="flex gap-2">
            <Button variant="primary" onClick={() => apply(draft)}>
              Filter anwenden
            </Button>
            <Button variant="ghost" onClick={reset}>
              Zurücksetzen
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonPicker({ label, people, onChange }: { label: string; people: PickedPerson[]; onChange: (people: PickedPerson[]) => void }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; people: PersonSearchResult[] } | null>(null);
  const trimmed = query.trim();
  const results = trimmed ? (answer?.people ?? []) : [];
  const loading = trimmed !== "" && answer?.query !== trimmed;

  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiFetch<{ people: PersonSearchResult[] }>(`/api/people?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((data) => setAnswer({ query: trimmed, people: data.people }))
        .catch(() => {
          if (!controller.signal.aborted) setAnswer({ query: trimmed, people: [] });
        });
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div>
      <label className="text-sm font-medium">
        {label}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name eingeben" className="mt-1.5 h-10 w-full rounded-xl border border-white/12 bg-white/5 px-3 text-sm font-normal outline-none focus:border-screen" />
      </label>
      {people.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-1.5 rounded-full bg-screen py-1 pl-3 pr-1.5 text-[13px] font-medium text-ink">
              {person.name}
              <button type="button" aria-label={`${person.name} entfernen`} onClick={() => onChange(people.filter((entry) => entry.id !== person.id))}>
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {loading ? <p className="mt-2 text-xs text-fog">Wird gesucht.</p> : null}
      {results.length ? (
        <ul className="mt-2 max-h-40 overflow-y-auto rounded-xl bg-white/4 p-1">
          {results.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => {
                  if (!people.some((entry) => entry.id === person.id)) onChange([...people, { id: person.id, name: person.name }]);
                  setQuery("");
                }}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-white/10"
              >
                {person.name}
                {person.knownFor.length ? <span className="ml-2 text-xs text-fog">{person.knownFor[0]}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
