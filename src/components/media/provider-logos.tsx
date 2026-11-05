"use client";

import type { WatchProvider } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { TmdbImage } from "./tmdb-image";

/** Kompakte Logoreihe für Karten und Listen. Besteht aus Spans, weil sie auch innerhalb von Links steht. */
export function ProviderLogos({ providers, max = 4, className }: { providers: readonly WatchProvider[]; max?: number; className?: string }) {
  if (providers.length === 0) return null;
  const hidden = providers.slice(max);
  return (
    <span className={cn("flex items-center gap-1", className)}>
      {providers.slice(0, max).map((provider) => (
        <span key={provider.id} title={provider.name} className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink-overlay text-[11px] font-medium ring-1 ring-white/10">
          {provider.logoPath ? <TmdbImage path={provider.logoPath} kind="logo" alt={provider.name} sizes="24px" /> : <span role="img" aria-label={provider.name}>{provider.name.charAt(0)}</span>}
        </span>
      ))}
      {hidden.length ? (
        <span title={hidden.map((provider) => provider.name).join(", ")} className="pl-0.5 text-xs text-fog">
          +{hidden.length}
        </span>
      ) : null}
    </span>
  );
}
