import "server-only";
import { cache } from "react";
import type {
  CollectionDetail,
  EpisodeDetail,
  EpisodeSummary,
  Genre,
  MediaCard,
  MediaDetail,
  MediaKind,
  MediaRef,
  MovieDetail,
  PagedResult,
  PersonDetail,
  PersonSearchResult,
  SeasonDetail,
  TvDetail,
  WatchProvider,
  WatchProviders,
} from "@/lib/tmdb-types";
import { DEFAULT_LANGUAGE, DEFAULT_REGION } from "@/lib/locale";
import type { CachePolicy } from "./client";
import { TmdbError } from "./client";
import { tmdb } from "./instance";
import {
  normalizeCollection,
  normalizeEpisodeDetail,
  normalizeMovie,
  normalizePage,
  normalizePerson,
  normalizePersonResult,
  normalizeProvidersByRegion,
  normalizeRegionProviders,
  normalizeSeason,
  normalizeTv,
} from "./normalize";

const HOUR = 3600;
const DAY = 24 * HOUR;

// TTL je Datentyp. Das Stale-Fenster bestimmt, wie lange ein Eintrag bei einem
// TMDB-Ausfall oder während der Hintergrunderneuerung noch ausgeliefert wird.
export const POLICY = {
  trending: { ttl: 1 * HOUR, stale: 1 * DAY },
  lists: { ttl: 6 * HOUR, stale: 3 * DAY },
  details: { ttl: 1 * DAY, stale: 14 * DAY },
  season: { ttl: 12 * HOUR, stale: 7 * DAY },
  person: { ttl: 7 * DAY, stale: 30 * DAY },
  collection: { ttl: 7 * DAY, stale: 30 * DAY },
  reference: { ttl: 30 * DAY, stale: 90 * DAY },
  search: { ttl: 15 * 60, stale: 1 * HOUR },
  providers: { ttl: 1 * DAY, stale: 7 * DAY },
} satisfies Record<string, CachePolicy>;

const DETAIL_APPEND = [
  "videos",
  "images",
  "keywords",
  "watch/providers",
  "recommendations",
  "similar",
  "translations",
];

/** Bildsprachen: Deutsch, Englisch und sprachneutral, plus die gewählte Sprache. */
function imageLanguages(language: string) {
  const iso = language.split("-")[0];
  return Array.from(new Set([iso, "de", "en", "null"])).join(",");
}

function videoLanguages(language: string) {
  const iso = language.split("-")[0];
  return Array.from(new Set([iso, "de", "en"])).join(",");
}

export const getMovie = cache(
  async (id: number, language: string = DEFAULT_LANGUAGE, region: string = DEFAULT_REGION): Promise<MovieDetail> => {
    const raw = await tmdb.get<unknown>(
      `/movie/${id}`,
      {
        language,
        append_to_response: [...DETAIL_APPEND, "credits", "release_dates"].join(","),
        include_image_language: imageLanguages(language),
        include_video_language: videoLanguages(language),
      },
      POLICY.details,
    );
    return normalizeMovie(raw, language, region);
  },
);

export const getTv = cache(
  async (id: number, language: string = DEFAULT_LANGUAGE, region: string = DEFAULT_REGION): Promise<TvDetail> => {
    const raw = await tmdb.get<unknown>(
      `/tv/${id}`,
      {
        language,
        append_to_response: [...DETAIL_APPEND, "aggregate_credits", "content_ratings"].join(","),
        include_image_language: imageLanguages(language),
        include_video_language: videoLanguages(language),
      },
      POLICY.details,
    );
    return normalizeTv(raw, language, region);
  },
);

export function getDetail(ref: MediaRef, language: string = DEFAULT_LANGUAGE, region: string = DEFAULT_REGION): Promise<MediaDetail> {
  return ref.kind === "movie" ? getMovie(ref.tmdbId, language, region) : getTv(ref.tmdbId, language, region);
}

export const getSeason = cache(
  async (tvId: number, seasonNumber: number, language: string = DEFAULT_LANGUAGE): Promise<SeasonDetail> => {
    const raw = await tmdb.get<unknown>(`/tv/${tvId}/season/${seasonNumber}`, { language }, POLICY.season);
    const season = normalizeSeason(raw, tvId);
    if (language.startsWith("en") || !season.episodes.some((episode) => !episode.overview)) return season;

    // Einzelne Folgen sind oft nicht übersetzt: Beschreibung auf Englisch nachziehen.
    const english = normalizeSeason(
      await tmdb.get<unknown>(`/tv/${tvId}/season/${seasonNumber}`, { language: "en-US" }, POLICY.season),
      tvId,
    );
    const byNumber = new Map(english.episodes.map((episode) => [episode.episodeNumber, episode]));
    return {
      ...season,
      overview: season.overview || english.overview,
      episodes: season.episodes.map((episode) => ({
        ...episode,
        overview: episode.overview || byNumber.get(episode.episodeNumber)?.overview || "",
      })),
    };
  },
);

export const getEpisode = cache(
  async (tvId: number, season: number, episode: number, language: string = DEFAULT_LANGUAGE): Promise<EpisodeDetail> => {
    const raw = await tmdb.get<unknown>(
      `/tv/${tvId}/season/${season}/episode/${episode}`,
      { language, append_to_response: "credits" },
      POLICY.season,
    );
    const detail = normalizeEpisodeDetail(raw, tvId);
    if (!detail) throw new TmdbError("not_found", "Episode nicht gefunden.", 404);
    if (detail.overview || language.startsWith("en")) return detail;
    const english = normalizeEpisodeDetail(
      await tmdb.get<unknown>(`/tv/${tvId}/season/${season}/episode/${episode}`, { language: "en-US" }, POLICY.season),
      tvId,
    );
    return { ...detail, overview: english?.overview ?? "" };
  },
);

const APPEND_LIMIT = 20;

/**
 * Alle Episoden einer Serie in möglichst wenigen Anfragen, über
 * `append_to_response=season/1,season/2,…` (höchstens 20 pro Anfrage).
 * Das ist die Grundlage für Fortschritt und «alles gesehen». Specials (Staffel 0)
 * fehlen bewusst, weil sie nicht zum regulären Fortschritt zählen.
 */
export const getEpisodeIndex = cache(async (tvId: number, language: string = DEFAULT_LANGUAGE): Promise<EpisodeSummary[]> => {
  const seasons = (await getTv(tvId, language)).seasons.filter((season) => season.seasonNumber > 0);
  const episodes: EpisodeSummary[] = [];
  for (let index = 0; index < seasons.length; index += APPEND_LIMIT) {
    const batch = seasons.slice(index, index + APPEND_LIMIT);
    const append = batch.map((season) => `season/${season.seasonNumber}`).join(",");
    const raw = await tmdb.get<Record<string, unknown>>(`/tv/${tvId}`, { language, append_to_response: append }, POLICY.season);
    for (const season of batch) {
      const rawSeason = raw[`season/${season.seasonNumber}`];
      if (rawSeason) episodes.push(...normalizeSeason(rawSeason, tvId).episodes);
    }
  }
  return episodes;
});

export const getCollection = cache(async (id: number, language: string = DEFAULT_LANGUAGE): Promise<CollectionDetail> => {
  const raw = await tmdb.get<unknown>(
    `/collection/${id}`,
    { language, append_to_response: "translations" },
    POLICY.collection,
  );
  return normalizeCollection(raw, language);
});

export const getPerson = cache(async (id: number, language: string = DEFAULT_LANGUAGE): Promise<PersonDetail> => {
  const raw = await tmdb.get<unknown>(
    `/person/${id}`,
    { language, append_to_response: "combined_credits,images,translations" },
    POLICY.person,
  );
  return normalizePerson(raw, language);
});

/** Watch-Provider einzeln, ohne die grosse Detailantwort (Filter der Watchlist). */
export const getWatchProviders = cache(async (ref: MediaRef): Promise<Record<string, WatchProviders>> => {
  const raw = await tmdb.get<unknown>(`/${ref.kind}/${ref.tmdbId}/watch/providers`, {}, POLICY.providers);
  return normalizeProvidersByRegion(raw);
});

export const getRegionProviders = cache(async (kind: MediaKind, region: string, language: string = DEFAULT_LANGUAGE): Promise<WatchProvider[]> => {
  const raw = await tmdb.get<unknown>(`/watch/providers/${kind}`, { language, watch_region: region }, POLICY.reference);
  return normalizeRegionProviders(raw);
});

export const getGenres = cache(async (kind: MediaKind, language: string = DEFAULT_LANGUAGE): Promise<Genre[]> => {
  const raw = await tmdb.get<{ genres?: Genre[] }>(`/genre/${kind}/list`, { language }, POLICY.reference);
  return raw.genres ?? [];
});

export const getGenreMap = cache(async (language: string = DEFAULT_LANGUAGE): Promise<Map<number, string>> => {
  const [movie, tv] = await Promise.all([getGenres("movie", language), getGenres("tv", language)]);
  return new Map([...movie, ...tv].map((genre) => [genre.id, genre.name]));
});

export const getLanguages = cache(async (): Promise<{ code: string; name: string }[]> => {
  const raw = await tmdb.get<{ iso_639_1: string; english_name: string; name: string }[]>(
    "/configuration/languages",
    {},
    POLICY.reference,
  );
  return raw
    .map((entry) => ({ code: entry.iso_639_1, name: entry.name || entry.english_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
});

export const getCountries = cache(async (language: string = DEFAULT_LANGUAGE): Promise<{ code: string; name: string }[]> => {
  const raw = await tmdb.get<{ iso_3166_1: string; english_name: string; native_name: string }[]>(
    "/configuration/countries",
    { language },
    POLICY.reference,
  );
  return raw
    .map((entry) => ({ code: entry.iso_3166_1, name: entry.native_name || entry.english_name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
});

export async function getTrending(kind: MediaKind | "all", window: "day" | "week" = "week", language: string = DEFAULT_LANGUAGE, page = 1) {
  const raw = await tmdb.get<unknown>(`/trending/${kind}/${window}`, { language, page }, POLICY.trending);
  return normalizePage(raw, kind === "all" ? undefined : kind);
}

export async function getPopular(kind: MediaKind, language: string = DEFAULT_LANGUAGE, page = 1) {
  const raw = await tmdb.get<unknown>(`/${kind}/popular`, { language, page, region: DEFAULT_REGION }, POLICY.lists);
  return normalizePage(raw, kind);
}

export async function getTopRated(kind: MediaKind, language: string = DEFAULT_LANGUAGE, page = 1) {
  const raw = await tmdb.get<unknown>(`/${kind}/top_rated`, { language, page }, POLICY.lists);
  return normalizePage(raw, kind);
}

export interface DiscoverFilters {
  kind: MediaKind;
  page?: number;
  genres?: number[];
  genresMode?: "all" | "any";
  withoutGenres?: number[];
  yearFrom?: number;
  yearTo?: number;
  releaseFrom?: string;
  releaseTo?: string;
  ratingMin?: number;
  voteCountMin?: number;
  voteCountMax?: number;
  language?: string;
  originCountry?: string;
  runtimeMin?: number;
  runtimeMax?: number;
  cast?: number[];
  crew?: number[];
  providers?: number[];
  keywords?: number[];
  region?: string;
  releaseTypes?: number[];
  sort?: string;
}

export function discoverParams(filters: DiscoverFilters, uiLanguage: string): Record<string, string | number | boolean | undefined> {
  const dateField = filters.kind === "movie" ? "primary_release_date" : "first_air_date";
  const from = filters.releaseFrom ?? (filters.yearFrom ? `${filters.yearFrom}-01-01` : undefined);
  const to = filters.releaseTo ?? (filters.yearTo ? `${filters.yearTo}-12-31` : undefined);
  const providerRegion = filters.region ?? DEFAULT_REGION;
  return {
    language: uiLanguage,
    include_adult: false,
    include_video: filters.kind === "movie" ? false : undefined,
    page: filters.page ?? 1,
    sort_by: filters.sort ?? "popularity.desc",
    with_genres: filters.genres?.length ? filters.genres.join(filters.genresMode === "any" ? "|" : ",") : undefined,
    without_genres: filters.withoutGenres?.length ? filters.withoutGenres.join(",") : undefined,
    [`${dateField}.gte`]: from,
    [`${dateField}.lte`]: to,
    "vote_average.gte": filters.ratingMin,
    "vote_count.gte": filters.voteCountMin,
    "vote_count.lte": filters.voteCountMax,
    with_original_language: filters.language,
    with_origin_country: filters.originCountry,
    "with_runtime.gte": filters.runtimeMin,
    "with_runtime.lte": filters.runtimeMax,
    // TMDB bietet with_cast und with_crew nur für Filme an.
    with_cast: filters.kind === "movie" && filters.cast?.length ? filters.cast.join(",") : undefined,
    with_crew: filters.kind === "movie" && filters.crew?.length ? filters.crew.join(",") : undefined,
    with_keywords: filters.keywords?.length ? filters.keywords.join("|") : undefined,
    with_watch_providers: filters.providers?.length ? filters.providers.join("|") : undefined,
    watch_region: filters.providers?.length ? providerRegion : undefined,
    region: filters.kind === "movie" && filters.releaseTypes?.length ? providerRegion : undefined,
    with_release_type: filters.kind === "movie" && filters.releaseTypes?.length ? filters.releaseTypes.join("|") : undefined,
  };
}

export async function discover(filters: DiscoverFilters, language: string = DEFAULT_LANGUAGE): Promise<PagedResult<MediaCard>> {
  const raw = await tmdb.get<unknown>(`/discover/${filters.kind}`, discoverParams(filters, language), POLICY.lists);
  return normalizePage(raw, filters.kind);
}

export async function searchMulti(query: string, language: string = DEFAULT_LANGUAGE, page = 1) {
  const raw = await tmdb.get<{ results?: unknown[]; page?: number; total_pages?: number; total_results?: number }>(
    "/search/multi",
    { query, language, page, include_adult: false },
    POLICY.search,
  );
  const results = raw.results ?? [];
  const isPerson = (item: unknown) => (item as { media_type?: string })?.media_type === "person";
  return {
    page: raw.page ?? 1,
    totalPages: raw.total_pages ?? 1,
    totalResults: raw.total_results ?? 0,
    media: normalizePage({ results: results.filter((item) => !isPerson(item)) }).results,
    people: results
      .filter(isPerson)
      .map(normalizePersonResult)
      .filter((person): person is PersonSearchResult => person !== null),
  };
}

export async function searchPeople(query: string, language: string = DEFAULT_LANGUAGE, page = 1): Promise<PersonSearchResult[]> {
  const raw = await tmdb.get<{ results?: unknown[] }>(
    "/search/person",
    { query, language, page, include_adult: false },
    POLICY.search,
  );
  return (raw.results ?? [])
    .map(normalizePersonResult)
    .filter((person): person is PersonSearchResult => person !== null);
}

export async function searchByKind(kind: MediaKind, query: string, language: string = DEFAULT_LANGUAGE, page = 1, year?: number) {
  const raw = await tmdb.get<unknown>(
    `/search/${kind}`,
    {
      query,
      language,
      page,
      include_adult: false,
      primary_release_year: kind === "movie" ? year : undefined,
      first_air_date_year: kind === "tv" ? year : undefined,
    },
    POLICY.search,
  );
  return normalizePage(raw, kind);
}
