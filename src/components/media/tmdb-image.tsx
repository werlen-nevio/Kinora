"use client";

import Image from "next/image";
import { tmdbImageUrl, tmdbOriginalUrl, type TmdbImageKind } from "@/lib/tmdb-image";
import { cn } from "@/lib/utils";

interface TmdbImageProps {
  path: string;
  kind: TmdbImageKind;
  alt: string;
  sizes: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  preload?: boolean;
}

export function TmdbImage({ path, kind, alt, sizes, className, fill = true, width, height, preload }: TmdbImageProps) {
  // Viele Logos bei TMDB sind SVG. Die gibt es nur in Originalgrösse, und next/image
  // würde sie ohne Optimierung direkt vom eigenen Server laden wollen.
  if (path.endsWith(".svg")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- siehe oben; in <img> laufen keine Skripte aus dem SVG
      <img
        src={tmdbOriginalUrl(path)}
        alt={alt}
        width={fill ? undefined : width}
        height={fill ? undefined : height}
        loading={preload ? "eager" : "lazy"}
        className={cn("object-contain", fill && "absolute inset-0 size-full", className)}
      />
    );
  }
  return (
    <Image
      loader={({ width: requested }) => tmdbImageUrl(path, kind, requested)}
      src={path}
      alt={alt}
      sizes={sizes}
      fill={fill}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      preload={preload}
      loading={preload ? undefined : "lazy"}
      className={cn("object-cover", className)}
    />
  );
}

/** Ersetzt ein fehlendes Bild durch den Titel selbst, nicht durch ein Platzhalterfoto. */
export function ImageFallback({ title, className }: { title: string; className?: string }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-end bg-gradient-to-br from-ink-overlay to-ink-raised p-3 font-display text-base leading-tight text-fog",
        className,
      )}
    >
      {title}
    </div>
  );
}
