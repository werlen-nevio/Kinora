import Link from "next/link";
import type { ReactNode } from "react";
import type { MediaCard } from "@/lib/tmdb-types";
import { Carousel } from "./carousel";
import { PosterCard, PosterSkeleton } from "./poster-card";

export function RowHeading({ title, emphasis, href, action }: { title: string; emphasis?: string; href?: string; action?: ReactNode }) {
  // Filmtitel stehen kursiv, wie es die Typografie verlangt.
  const parts = emphasis && title.includes(emphasis) ? title.split(emphasis) : null;
  return (
    <div className="gutter flex items-baseline justify-between gap-4">
      <h2 className="font-display text-title-sm font-medium text-balance">
        {parts ? (
          <>
            {parts[0]}
            <em>{emphasis}</em>
            {parts[1]}
          </>
        ) : (
          title
        )}
      </h2>
      {href ? (
        <Link href={href} className="shrink-0 text-sm text-fog transition-colors hover:text-screen">
          Alle ansehen
        </Link>
      ) : (
        action
      )}
    </div>
  );
}

export function MediaRow({
  title,
  emphasis,
  items,
  href,
  showWhy,
  section,
}: {
  title: string;
  emphasis?: string;
  items: readonly MediaCard[];
  href?: string;
  showWhy?: boolean;
  section?: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="space-y-2">
      <RowHeading title={title} emphasis={emphasis} href={href} />
      <Carousel label={title}>
        {items.map((card) => (
          <PosterCard key={`${card.kind}:${card.tmdbId}`} card={card} showWhy={showWhy} section={section} />
        ))}
      </Carousel>
    </section>
  );
}

export function RowSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="gutter">
        <div className="skeleton h-6 w-56 rounded" />
      </div>
      <div className="reel gap-3 py-2 sm:gap-4">
        {Array.from({ length: 9 }, (_, index) => (
          <PosterSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}
