"use client";

import { Segments } from "@/components/person/filmography";
import { Select, Switch } from "@/components/ui/primitives";
import { Chip } from "@/components/watchlist/watchlist-view";
import { DISCOVERY_MODES, type DiscoveryFilters, type DiscoveryModeName, MODE_LABELS } from "@/lib/discovery";
import type { Genre, WatchProvider } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

export interface DiscoveryOptions {
  genres: Genre[];
  providers: WatchProvider[];
  languages: { code: string; name: string }[];
}

const ANY = "egal";
const MAX_PROVIDERS = 14;

const RATING_OPTIONS = [
  { value: ANY, label: "Egal" },
  ...[6, 7, 7.5, 8].map((value) => ({ value: String(value), label: `Ab ${value}` })),
];
const RUNTIME_OPTIONS = [
  { value: ANY, label: "Egal" },
  ...[90, 120, 150, 180].map((value) => ({ value: String(value), label: `Bis ${value} Min.` })),
];

function toggled(list: readonly number[], id: number) {
  return list.includes(id) ? list.filter((other) => other !== id) : [...list, id];
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function YearField({ label, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-fog">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={1870}
        max={2100}
        placeholder="Jahr"
        value={value ?? ""}
        onChange={(event) => {
          const year = Number(event.target.value);
          onChange(event.target.value && year >= 1870 && year <= 2100 ? year : null);
        }}
        className="h-10 w-24 rounded-full bg-white/8 px-4 text-sm tabular-nums text-screen outline-none placeholder:text-fog-dim focus:ring-2 focus:ring-screen"
      />
    </label>
  );
}

export function ModePicker({ value, onChange }: { value: DiscoveryModeName; onChange: (mode: DiscoveryModeName) => void }) {
  return (
    <div role="radiogroup" aria-label="Modus" className="space-y-1.5">
      {DISCOVERY_MODES.map((mode) => {
        const selected = mode === value;
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(mode)}
            className={cn("block w-full rounded-xl px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-screen", selected ? "bg-screen text-ink" : "bg-white/5 hover:bg-white/10")}
          >
            <span className="block font-medium">{MODE_LABELS[mode].title}</span>
            <span className={cn("mt-0.5 block text-sm", selected ? "text-ink/70" : "text-fog")}>{MODE_LABELS[mode].description}</span>
          </button>
        );
      })}
    </div>
  );
}

export function FilterFields({ value, onChange, options }: { value: DiscoveryFilters; onChange: (filters: DiscoveryFilters) => void; options: DiscoveryOptions }) {
  const set = (patch: Partial<DiscoveryFilters>) => onChange({ ...value, ...patch });
  const nullableNumber = (raw: string) => (raw === ANY ? null : Number(raw));

  return (
    <div className="space-y-5">
      <Group label="Was möchtest du sehen?">
        <Segments
          label="Art"
          value={value.kinds}
          onChange={(kinds) => set({ kinds })}
          options={[
            { value: "all", label: "Filme und Serien" },
            { value: "movie", label: "Nur Filme" },
            { value: "tv", label: "Nur Serien" },
          ]}
        />
      </Group>

      {options.genres.length ? (
        <Group label="Genres">
          <div className="flex flex-wrap gap-1.5">
            {options.genres.map((genre) => (
              <Chip key={genre.id} active={value.genres.includes(genre.id)} onClick={() => set({ genres: toggled(value.genres, genre.id) })}>
                {genre.name}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}

      <Group label="Veröffentlichungszeitraum">
        <div className="flex flex-wrap gap-3">
          <YearField label="Von" value={value.yearFrom} onChange={(yearFrom) => set({ yearFrom })} />
          <YearField label="Bis" value={value.yearTo} onChange={(yearTo) => set({ yearTo })} />
        </div>
      </Group>

      <div className="flex flex-wrap gap-x-6 gap-y-5">
        <Group label="Mindestbewertung">
          <Select label="Mindestbewertung" value={value.ratingMin === null ? ANY : String(value.ratingMin)} onValueChange={(raw) => set({ ratingMin: nullableNumber(raw) })} options={RATING_OPTIONS} />
        </Group>
        <Group label="Maximale Laufzeit">
          <Select label="Maximale Laufzeit" value={value.runtimeMax === null ? ANY : String(value.runtimeMax)} onValueChange={(raw) => set({ runtimeMax: nullableNumber(raw) })} options={RUNTIME_OPTIONS} />
        </Group>
        {options.languages.length ? (
          <Group label="Originalsprache">
            <Select
              label="Originalsprache"
              value={value.language ?? ANY}
              onValueChange={(raw) => set({ language: raw === ANY ? null : raw })}
              options={[{ value: ANY, label: "Egal" }, ...options.languages.map((language) => ({ value: language.code, label: language.name }))]}
            />
          </Group>
        ) : null}
      </div>

      {options.providers.length ? (
        <Group label="Nur bei diesen Streaminganbietern">
          <div className="flex flex-wrap gap-1.5">
            {options.providers.slice(0, MAX_PROVIDERS).map((provider) => (
              <Chip key={provider.id} active={value.providers.includes(provider.id)} onClick={() => set({ providers: toggled(value.providers, provider.id) })}>
                {provider.name}
              </Chip>
            ))}
          </div>
        </Group>
      ) : null}

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4 text-sm">
          Bereits Gesehenes ausschliessen
          <Switch checked={value.excludeSeen} onCheckedChange={(excludeSeen) => set({ excludeSeen })} />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          Titel auf der Watchlist ausschliessen
          <Switch checked={value.excludeWatchlist} onCheckedChange={(excludeWatchlist) => set({ excludeWatchlist })} />
        </label>
      </div>
    </div>
  );
}
