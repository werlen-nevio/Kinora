// TMDB liefert feste Bildgrössen. Der Loader wählt die kleinste, die reicht,
// damit der eigene Server keine Bilder umrechnen muss.

export type TmdbImageKind = "poster" | "backdrop" | "profile" | "still" | "logo";

const SIZES: Record<TmdbImageKind, readonly (readonly [number, string])[]> = {
  poster: [[92, "w92"], [154, "w154"], [185, "w185"], [342, "w342"], [500, "w500"], [780, "w780"]],
  backdrop: [[300, "w300"], [780, "w780"], [1280, "w1280"], [3840, "original"]],
  profile: [[45, "w45"], [185, "w185"], [632, "h632"]],
  still: [[92, "w92"], [185, "w185"], [300, "w300"], [1280, "original"]],
  logo: [[92, "w92"], [154, "w154"], [185, "w185"], [300, "w300"], [500, "w500"]],
};

export const TMDB_IMAGE_BASE = (process.env.NEXT_PUBLIC_TMDB_IMAGE_BASE_URL ?? "https://image.tmdb.org/t/p").replace(/\/$/, "");

export function tmdbImageUrl(path: string, kind: TmdbImageKind, width: number): string {
  const sizes = SIZES[kind];
  const match = sizes.find(([limit]) => limit >= width) ?? sizes[sizes.length - 1];
  return `${TMDB_IMAGE_BASE}/${match?.[1] ?? "original"}${path}`;
}

export function tmdbOriginalUrl(path: string): string {
  return `${TMDB_IMAGE_BASE}/original${path}`;
}
