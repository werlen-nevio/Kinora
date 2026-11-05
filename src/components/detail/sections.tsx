"use client";

import { ChevronDown, Play, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { VideoDialog } from "@/components/media/actions";
import { Carousel } from "@/components/media/carousel";
import { RowHeading } from "@/components/media/media-row";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Dialog, DialogTrigger } from "@/components/ui/primitives";
import { tmdbOriginalUrl } from "@/lib/tmdb-image";
import type { CastMember, CrewMember, ImageAsset, Video, WatchProvider, WatchProviders } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-title-sm font-medium">{children}</h2>;
}

export function ExpandableText({ text, lines = 4 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 420;
  return (
    <div>
      <p className={cn("max-w-[68ch] text-[15.5px] leading-[1.7] text-screen/90 text-pretty", long && !expanded && "line-clamp-[var(--lines)]")} style={{ "--lines": lines } as React.CSSProperties}>
        {text}
      </p>
      {long ? (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="mt-2 inline-flex items-center gap-1 text-sm text-fog hover:text-screen">
          {expanded ? "Weniger anzeigen" : "Mehr anzeigen"}
          <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
        </button>
      ) : null}
    </div>
  );
}

export function PersonAvatar({ path, name, className }: { path: string | null; name: string; className?: string }) {
  return (
    <span className={cn("relative block overflow-hidden rounded-full bg-ink-overlay", className)}>
      {path ? (
        <TmdbImage path={path} kind="profile" alt="" sizes="160px" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-fog-dim" title={name}>
          <User className="size-1/2" />
        </span>
      )}
    </span>
  );
}

export function CastRow({ cast }: { cast: readonly CastMember[] }) {
  if (cast.length === 0) return null;
  return (
    <section aria-label="Besetzung" className="space-y-2">
      <RowHeading title="Besetzung" />
      <Carousel label="Besetzung">
        {cast.slice(0, 24).map((member) => (
          <Link key={`${member.id}-${member.character}`} href={`/person/${member.id}`} className="group w-[104px] text-center sm:w-[124px]">
            <PersonAvatar path={member.profilePath} name={member.name} className="mx-auto aspect-square w-full ring-1 ring-white/8 transition-[box-shadow] group-hover:ring-white/30" />
            <p className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-tight group-hover:underline">{member.name}</p>
            {member.character ? <p className="mt-1 line-clamp-2 text-xs leading-tight text-fog">{member.character}</p> : null}
          </Link>
        ))}
      </Carousel>
    </section>
  );
}

const CREW_GROUPS: { title: string; jobs: readonly string[] }[] = [
  { title: "Regie", jobs: ["Director"] },
  { title: "Drehbuch", jobs: ["Screenplay", "Writer", "Story", "Novel", "Teleplay"] },
  { title: "Produktion", jobs: ["Producer", "Executive Producer"] },
  { title: "Musik", jobs: ["Original Music Composer", "Music", "Composer"] },
  { title: "Kamera", jobs: ["Director of Photography"] },
  { title: "Schnitt", jobs: ["Editor"] },
];

export function CrewSection({ crew, createdBy = [] }: { crew: readonly CrewMember[]; createdBy?: readonly { id: number; name: string }[] }) {
  const groups = CREW_GROUPS.map((group) => {
    const seen = new Set<number>();
    const people = crew.filter((member) => {
      if (!group.jobs.includes(member.job) || seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    });
    return { title: group.title, people: people.slice(0, 6) };
  }).filter((group) => group.people.length > 0);

  if (groups.length === 0 && createdBy.length === 0) return null;
  return (
    <section className="gutter space-y-5" aria-label="Crew">
      <SectionHeading>Crew</SectionHeading>
      <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {createdBy.length ? (
          <div>
            <dt className="text-sm text-fog">Idee</dt>
            <dd className="mt-1.5 space-y-1">
              {createdBy.map((person) => (
                <Link key={person.id} href={`/person/${person.id}`} className="block text-[15px] hover:underline">
                  {person.name}
                </Link>
              ))}
            </dd>
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.title}>
            <dt className="text-sm text-fog">{group.title}</dt>
            <dd className="mt-1.5 space-y-1">
              {group.people.map((person) => (
                <Link key={person.id} href={`/person/${person.id}`} className="block text-[15px] hover:underline">
                  {person.name}
                </Link>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function MediaGallery({ title, videos, backdrops, posters }: { title: string; videos: readonly Video[]; backdrops: readonly ImageAsset[]; posters: readonly ImageAsset[] }) {
  if (videos.length === 0 && backdrops.length === 0 && posters.length === 0) return null;
  return (
    <section aria-label="Trailer und Medien" className="space-y-2">
      <RowHeading title="Trailer und Medien" />
      <Carousel label="Trailer und Medien">
        {videos.slice(0, 10).map((video) => (
          <Dialog key={video.key}>
            <DialogTrigger className="group w-[260px] text-left outline-none sm:w-[320px]" aria-label={`${video.name} abspielen`}>
              <span className="relative block aspect-video overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/8 transition-[box-shadow] group-hover:ring-white/30 group-focus-visible:ring-2 group-focus-visible:ring-screen">
                {/* eslint-disable-next-line @next/next/no-img-element -- Vorschaubild von YouTube, nicht von TMDB */}
                <img src={`https://i.ytimg.com/vi/${encodeURIComponent(video.key)}/mqdefault.jpg`} alt="" loading="lazy" className="size-full object-cover" />
                <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <span className="glass flex size-12 items-center justify-center rounded-full">
                    <Play className="size-5 translate-x-px" fill="currentColor" />
                  </span>
                </span>
              </span>
              <span className="mt-2 block truncate text-[13px] font-medium">{video.name}</span>
              <span className="block text-xs text-fog">{video.type}</span>
            </DialogTrigger>
            <VideoDialog videoKey={video.key} title={video.name} />
          </Dialog>
        ))}
        {backdrops.slice(0, 12).map((image) => (
          <a key={image.path} href={tmdbOriginalUrl(image.path)} target="_blank" rel="noreferrer" aria-label={`Szenenbild aus ${title} öffnen`} className="relative block aspect-video w-[260px] overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/8 transition-[box-shadow] hover:ring-white/30 sm:w-[320px]">
            <TmdbImage path={image.path} kind="backdrop" alt="" sizes="320px" />
          </a>
        ))}
        {posters.slice(0, 8).map((image) => (
          <a key={image.path} href={tmdbOriginalUrl(image.path)} target="_blank" rel="noreferrer" aria-label={`Plakat von ${title} öffnen`} className="relative block aspect-[2/3] h-[146px] overflow-hidden rounded-[10px] bg-ink-raised ring-1 ring-white/8 transition-[box-shadow] hover:ring-white/30 sm:h-[180px]">
            <TmdbImage path={image.path} kind="poster" alt="" sizes="120px" />
          </a>
        ))}
      </Carousel>
    </section>
  );
}

function ProviderGroup({ title, providers }: { title: string; providers: readonly WatchProvider[] }) {
  if (providers.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-sm text-fog">{title}</p>
      <ul className="flex flex-wrap gap-2">
        {providers.map((provider) => (
          <li key={provider.id} className="flex items-center gap-2 rounded-xl bg-white/6 py-1.5 pl-1.5 pr-3">
            <span className="relative size-8 overflow-hidden rounded-lg bg-ink-overlay">
              {provider.logoPath ? <TmdbImage path={provider.logoPath} kind="logo" alt="" sizes="40px" /> : null}
            </span>
            <span className="text-[13px]">{provider.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const REGION_NAMES: Record<string, string> = { CH: "der Schweiz", DE: "Deutschland", AT: "Österreich", FR: "Frankreich", IT: "Italien", US: "den USA", GB: "Grossbritannien" };

export function ProvidersSection({ providers, region, kindLabel }: { providers: WatchProviders | undefined; region: string; kindLabel: string }) {
  const hasAny = providers && [providers.flatrate, providers.free, providers.ads, providers.rent, providers.buy].some((list) => list.length > 0);
  return (
    <section className="space-y-4" aria-label="Verfügbarkeit">
      <SectionHeading>Wo kann ich {kindLabel} sehen?</SectionHeading>
      {hasAny ? (
        <div className="space-y-4">
          <ProviderGroup title="Im Abo" providers={providers.flatrate} />
          <ProviderGroup title="Kostenlos" providers={[...providers.free, ...providers.ads]} />
          <ProviderGroup title="Leihen" providers={providers.rent} />
          <ProviderGroup title="Kaufen" providers={providers.buy} />
          <p className="text-xs text-fog-dim">
            Angaben für {REGION_NAMES[region] ?? region}, ohne Gewähr, Daten von JustWatch über TMDB.
            {providers.link ? (
              <>
                {" "}
                <a href={providers.link} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-screen">
                  Alle Angebote ansehen
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <p className="text-sm text-fog">Für {REGION_NAMES[region] ?? region} sind bei TMDB keine Anbieter eingetragen.</p>
      )}
    </section>
  );
}

export function FactList({ facts }: { facts: readonly { label: string; value: string | null | undefined }[] }) {
  const visible = facts.filter((fact) => fact.value);
  if (visible.length === 0) return null;
  return (
    <section className="space-y-4" aria-label="Technische Informationen">
      <SectionHeading>Technische Informationen</SectionHeading>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {visible.map((fact) => (
          <div key={fact.label} className="border-t border-white/8 pt-2.5">
            <dt className="text-xs text-fog">{fact.label}</dt>
            <dd className="mt-0.5 text-sm">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
