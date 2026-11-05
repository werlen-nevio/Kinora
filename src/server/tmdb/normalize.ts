// Wandelt TMDB-Antworten in die eigenen Typen um. TMDB liefert Felder je nach
// Titel leer oder gar nicht; hier wird daraus konsequent `null`, damit die UI
// fehlende Angaben weglässt, statt etwas zu erfinden.

import type {
  CastMember,
  CollectionDetail,
  CrewMember,
  EpisodeDetail,
  EpisodeSummary,
  Genre,
  ImageAsset,
  MediaCard,
  MediaKind,
  MovieDetail,
  NamedEntity,
  PagedResult,
  PersonCredit,
  PersonDetail,
  PersonSearchResult,
  SeasonDetail,
  SeasonSummary,
  TvDetail,
  Video,
  WatchProvider,
  WatchProviders,
} from "@/lib/tmdb-types";

/* eslint-disable @typescript-eslint/no-explicit-any -- TMDB-Rohdaten, Absicherung erfolgt feldweise. */
type Raw = any;

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const positive = (value: unknown): number | null => {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
};
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value : []);

function yearOf(date: string | null): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

interface Translated {
  title: string | null;
  overview: string | null;
  tagline: string | null;
  biography: string | null;
}

function translation(raw: Raw, language: string): Translated | null {
  const [iso639, iso3166] = language.split("-");
  const entries = list(raw?.translations?.translations);
  const match =
    entries.find((entry) => entry.iso_639_1 === iso639 && entry.iso_3166_1 === iso3166) ??
    entries.find((entry) => entry.iso_639_1 === iso639);
  if (!match?.data) return null;
  return {
    title: str(match.data.title) ?? str(match.data.name),
    overview: str(match.data.overview),
    tagline: str(match.data.tagline),
    biography: str(match.data.biography),
  };
}

/** Fehlt eine Übersetzung, greift Englisch, nie ein erfundener Text. */
function withFallback(raw: Raw, language: string) {
  const english = language.startsWith("en") ? null : translation(raw, "en-US");
  const localized = translation(raw, language);
  const originalTitle = str(raw?.original_title) ?? str(raw?.original_name);
  const rawTitle = str(raw?.title) ?? str(raw?.name);
  // TMDB füllt fehlende Titel mit dem Originaltitel; bei fremder Schrift hilft der englische mehr.
  const titleIsUntranslated = !localized?.title && rawTitle === originalTitle;
  const title = titleIsUntranslated ? (english?.title ?? rawTitle) : rawTitle;
  return {
    title: title ?? originalTitle ?? "Ohne Titel",
    overview: str(raw?.overview) ?? english?.overview ?? "",
    tagline: str(raw?.tagline) ?? english?.tagline ?? null,
    biography: str(raw?.biography) ?? english?.biography ?? "",
  };
}

export function normalizeCard(raw: Raw, kindOverride?: MediaKind): MediaCard | null {
  const kind: MediaKind | null =
    kindOverride ?? (raw?.media_type === "movie" || raw?.media_type === "tv" ? raw.media_type : null);
  const tmdbId = num(raw?.id);
  if (!kind || tmdbId === null || raw?.adult === true) return null;
  const releaseDate = str(raw.release_date) ?? str(raw.first_air_date);
  return {
    kind,
    tmdbId,
    title: str(raw.title) ?? str(raw.name) ?? str(raw.original_title) ?? str(raw.original_name) ?? "Ohne Titel",
    posterPath: str(raw.poster_path),
    backdropPath: str(raw.backdrop_path),
    releaseDate,
    year: yearOf(releaseDate),
    voteAverage: positive(raw.vote_average),
    voteCount: positive(raw.vote_count),
    popularity: num(raw.popularity),
    genreIds: list(raw.genre_ids).filter((id): id is number => typeof id === "number"),
    overview: str(raw.overview) ?? "",
    originalLanguage: str(raw.original_language),
  };
}

export function normalizePage(raw: Raw, kind?: MediaKind): PagedResult<MediaCard> {
  return {
    page: num(raw?.page) ?? 1,
    totalPages: num(raw?.total_pages) ?? 1,
    totalResults: num(raw?.total_results) ?? 0,
    results: list(raw?.results)
      .map((item) => normalizeCard(item, kind))
      .filter((card): card is MediaCard => card !== null),
  };
}

function normalizeCast(raw: Raw): CastMember | null {
  const id = num(raw?.id);
  const name = str(raw?.name);
  if (id === null || !name) return null;
  const roles = list(raw.roles);
  return {
    id,
    name,
    character: str(raw.character) ?? str(roles[0]?.character),
    profilePath: str(raw.profile_path),
    order: num(raw.order) ?? 999,
  };
}

function normalizeCrew(raw: Raw): CrewMember | null {
  const id = num(raw?.id);
  const name = str(raw?.name);
  if (id === null || !name) return null;
  const jobs = list(raw.jobs);
  return {
    id,
    name,
    job: str(raw.job) ?? str(jobs[0]?.job) ?? "",
    department: str(raw.department) ?? "",
    profilePath: str(raw.profile_path),
  };
}

function normalizeVideos(raw: Raw): Video[] {
  const typeOrder = ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes"];
  return list(raw?.results)
    .filter((video) => video?.site === "YouTube" && str(video?.key))
    .map((video) => ({
      key: video.key as string,
      name: str(video.name) ?? "Video",
      type: str(video.type) ?? "Video",
      official: video.official === true,
      publishedAt: str(video.published_at),
      language: str(video.iso_639_1),
    }))
    .sort((a, b) => {
      const rank = (type: string) => {
        const index = typeOrder.indexOf(type);
        return index === -1 ? typeOrder.length : index;
      };
      return rank(a.type) - rank(b.type) || Number(b.official) - Number(a.official);
    });
}

function normalizeImages(rawList: unknown): ImageAsset[] {
  return list(rawList)
    .filter((image) => str(image?.file_path))
    .map((image) => ({
      path: image.file_path as string,
      width: num(image.width) ?? 0,
      height: num(image.height) ?? 0,
      language: str(image.iso_639_1),
    }));
}

function pickLogo(rawImages: Raw, language: string): string | null {
  const iso = language.split("-")[0];
  const logos = list(rawImages?.logos).filter((logo) => str(logo?.file_path));
  // PNG und SVG behalten die Transparenz; nach Sprache, dann nach Community-Bewertung.
  const ranked = [...logos].sort((a, b) => {
    const score = (logo: Raw) => (logo.iso_639_1 === iso ? 2 : logo.iso_639_1 === "en" ? 1 : 0);
    return score(b) - score(a) || (num(b.vote_average) ?? 0) - (num(a.vote_average) ?? 0);
  });
  const best = ranked[0];
  if (!best) return null;
  // Ein Logo in einer fremden Sprache wäre für den Titel irreführend.
  if (best.iso_639_1 && best.iso_639_1 !== iso && best.iso_639_1 !== "en") return null;
  return best.file_path as string;
}

function normalizeProvider(raw: Raw): WatchProvider | null {
  const id = num(raw?.provider_id);
  const name = str(raw?.provider_name);
  if (id === null || !name) return null;
  return { id, name, logoPath: str(raw.logo_path), priority: num(raw.display_priority) ?? 999 };
}

function providerList(rawList: unknown): WatchProvider[] {
  return list(rawList)
    .map(normalizeProvider)
    .filter((provider): provider is WatchProvider => provider !== null)
    .sort((a, b) => a.priority - b.priority);
}

function normalizeProviders(raw: Raw): Record<string, WatchProviders> {
  const results = raw?.results ?? {};
  const out: Record<string, WatchProviders> = {};
  for (const [region, value] of Object.entries<Raw>(results)) {
    out[region] = {
      region,
      link: str(value?.link),
      flatrate: providerList(value?.flatrate),
      free: providerList(value?.free),
      ads: providerList(value?.ads),
      rent: providerList(value?.rent),
      buy: providerList(value?.buy),
    };
  }
  return out;
}

function namedEntities(rawList: unknown): NamedEntity[] {
  return list(rawList)
    .filter((entity) => num(entity?.id) !== null && str(entity?.name))
    .map((entity) => ({ id: entity.id as number, name: entity.name as string, logoPath: str(entity.logo_path) }));
}

/** Länder und Sprachen liefert TMDB unabhängig von der Anfrage auf Englisch; Intl kennt sie übersetzt. */
function displayName(language: string, type: "language" | "region", code: unknown): string | null {
  const value = str(code);
  if (!value) return null;
  try {
    const name = new Intl.DisplayNames([language], { type, fallback: "none" }).of(value);
    return name ?? null;
  } catch {
    return null;
  }
}

function detailBase(raw: Raw, language: string, kind: MediaKind) {
  const text = withFallback(raw, language);
  const genres: Genre[] = list(raw.genres)
    .filter((genre) => num(genre?.id) !== null && str(genre?.name))
    .map((genre) => ({ id: genre.id as number, name: genre.name as string }));
  const rawCast = kind === "tv" ? (raw.aggregate_credits?.cast ?? raw.credits?.cast) : raw.credits?.cast;
  const rawCrew = kind === "tv" ? (raw.aggregate_credits?.crew ?? raw.credits?.crew) : raw.credits?.crew;
  return {
    tmdbId: raw.id as number,
    title: text.title,
    originalTitle: str(raw.original_title) ?? str(raw.original_name),
    tagline: text.tagline,
    overview: text.overview,
    posterPath: str(raw.poster_path),
    backdropPath: str(raw.backdrop_path),
    logoPath: pickLogo(raw.images, language),
    genres,
    voteAverage: positive(raw.vote_average),
    voteCount: positive(raw.vote_count),
    popularity: num(raw.popularity),
    originalLanguage: str(raw.original_language),
    spokenLanguages: list(raw.spoken_languages)
      .map((entry) => displayName(language, "language", entry?.iso_639_1) ?? str(entry?.name) ?? str(entry?.english_name))
      .filter((name): name is string => name !== null),
    productionCountries: list(raw.production_countries)
      .map((entry) => displayName(language, "region", entry?.iso_3166_1) ?? str(entry?.name))
      .filter((name): name is string => name !== null),
    productionCompanies: namedEntities(raw.production_companies),
    homepage: str(raw.homepage),
    status: str(raw.status),
    cast: list(rawCast)
      .map(normalizeCast)
      .filter((member): member is CastMember => member !== null)
      .sort((a, b) => a.order - b.order),
    crew: list(rawCrew)
      .map(normalizeCrew)
      .filter((member): member is CrewMember => member !== null),
    videos: normalizeVideos(raw.videos),
    backdrops: normalizeImages(raw.images?.backdrops),
    posters: normalizeImages(raw.images?.posters),
    keywords: list(raw.keywords?.keywords ?? raw.keywords?.results)
      .filter((keyword) => num(keyword?.id) !== null && str(keyword?.name))
      .map((keyword) => ({ id: keyword.id as number, name: keyword.name as string })),
    providersByRegion: normalizeProviders(raw["watch/providers"]),
    recommendations: normalizePage(raw.recommendations, kind).results,
    similar: normalizePage(raw.similar, kind).results,
  };
}

const RATING_FALLBACK_REGIONS = ["DE", "AT", "US"];

function movieRating(raw: Raw, region: string): { rating: string | null; date: string | null } {
  const entries = list(raw.release_dates?.results);
  const forRegion = (code: string) => entries.find((entry) => entry.iso_3166_1 === code);
  const dates = list(forRegion(region)?.release_dates);
  // Kinostart bevorzugen (Typ 3), sonst der erste vorhandene Eintrag.
  const regional = dates.find((entry) => entry.type === 3) ?? dates[0];
  const date = str(regional?.release_date)?.slice(0, 10) ?? null;

  for (const code of [region, ...RATING_FALLBACK_REGIONS]) {
    const certified = list(forRegion(code)?.release_dates).find((entry) => str(entry?.certification));
    if (certified) return { rating: `${code} ${str(certified.certification)}`, date };
  }
  return { rating: null, date };
}

export function normalizeMovie(raw: Raw, language: string, region: string): MovieDetail {
  const releaseDate = str(raw.release_date);
  const { rating, date } = movieRating(raw, region);
  const collection = raw.belongs_to_collection;
  return {
    kind: "movie",
    ...detailBase(raw, language, "movie"),
    ageRating: rating,
    releaseDate,
    regionalReleaseDate: date,
    year: yearOf(releaseDate),
    runtime: positive(raw.runtime),
    budget: positive(raw.budget),
    revenue: positive(raw.revenue),
    collection:
      num(collection?.id) !== null
        ? {
            id: collection.id as number,
            name: str(collection.name) ?? "",
            posterPath: str(collection.poster_path),
            backdropPath: str(collection.backdrop_path),
          }
        : null,
  };
}

function normalizeEpisode(raw: Raw): EpisodeSummary | null {
  const seasonNumber = num(raw?.season_number);
  const episodeNumber = num(raw?.episode_number);
  if (seasonNumber === null || episodeNumber === null) return null;
  return {
    seasonNumber,
    episodeNumber,
    name: str(raw.name) ?? `Episode ${episodeNumber}`,
    overview: str(raw.overview) ?? "",
    stillPath: str(raw.still_path),
    airDate: str(raw.air_date),
    runtime: positive(raw.runtime),
    voteAverage: positive(raw.vote_average),
  };
}

function normalizeSeasonSummary(raw: Raw): SeasonSummary | null {
  const seasonNumber = num(raw?.season_number);
  if (seasonNumber === null) return null;
  return {
    seasonNumber,
    name: str(raw.name) ?? `Staffel ${seasonNumber}`,
    overview: str(raw.overview) ?? "",
    posterPath: str(raw.poster_path),
    airDate: str(raw.air_date),
    episodeCount: num(raw.episode_count) ?? 0,
  };
}

function tvRating(raw: Raw, region: string): string | null {
  const entries = list(raw.content_ratings?.results);
  for (const code of [region, ...RATING_FALLBACK_REGIONS]) {
    const match = entries.find((entry) => entry.iso_3166_1 === code && str(entry.rating));
    if (match) return `${code} ${str(match.rating)}`;
  }
  return null;
}

export function normalizeTv(raw: Raw, language: string, region: string): TvDetail {
  const firstAirDate = str(raw.first_air_date);
  const runtimes = list(raw.episode_run_time).filter((value): value is number => typeof value === "number" && value > 0);
  const last = raw.last_episode_to_air ? normalizeEpisode(raw.last_episode_to_air) : null;
  return {
    kind: "tv",
    ...detailBase(raw, language, "tv"),
    ageRating: tvRating(raw, region),
    firstAirDate,
    lastAirDate: str(raw.last_air_date),
    year: yearOf(firstAirDate),
    episodeRuntime: runtimes[0] ?? last?.runtime ?? null,
    numberOfSeasons: num(raw.number_of_seasons),
    numberOfEpisodes: num(raw.number_of_episodes),
    inProduction: raw.in_production === true,
    type: str(raw.type),
    networks: namedEntities(raw.networks),
    createdBy: list(raw.created_by)
      .filter((person) => num(person?.id) !== null && str(person?.name))
      .map((person) => ({ id: person.id as number, name: person.name as string, profilePath: str(person.profile_path) })),
    seasons: list(raw.seasons)
      .map(normalizeSeasonSummary)
      .filter((season): season is SeasonSummary => season !== null)
      .sort((a, b) => a.seasonNumber - b.seasonNumber),
    lastEpisode: last,
    nextEpisode: raw.next_episode_to_air ? normalizeEpisode(raw.next_episode_to_air) : null,
  };
}

export function normalizeSeason(raw: Raw, tvId: number): SeasonDetail {
  const seasonNumber = num(raw.season_number) ?? 0;
  return {
    tvId,
    seasonNumber,
    name: str(raw.name) ?? `Staffel ${seasonNumber}`,
    overview: str(raw.overview) ?? "",
    posterPath: str(raw.poster_path),
    airDate: str(raw.air_date),
    episodes: list(raw.episodes)
      .map(normalizeEpisode)
      .filter((episode): episode is EpisodeSummary => episode !== null)
      .sort((a, b) => a.episodeNumber - b.episodeNumber),
  };
}

export function normalizeEpisodeDetail(raw: Raw, tvId: number): EpisodeDetail | null {
  const summary = normalizeEpisode(raw);
  if (!summary) return null;
  const crew = raw.crew ?? raw.credits?.crew;
  const guests = raw.guest_stars ?? raw.credits?.guest_stars;
  return {
    ...summary,
    tvId,
    guestStars: list(guests)
      .map(normalizeCast)
      .filter((member): member is CastMember => member !== null),
    crew: list(crew)
      .map(normalizeCrew)
      .filter((member): member is CrewMember => member !== null),
  };
}

export function normalizeCollection(raw: Raw, language: string): CollectionDetail {
  const text = withFallback(raw, language);
  const parts = list(raw.parts)
    .map((part) => normalizeCard(part, "movie"))
    .filter((card): card is MediaCard => card !== null)
    .sort((a, b) => {
      if (a.releaseDate && b.releaseDate) return a.releaseDate.localeCompare(b.releaseDate);
      if (a.releaseDate) return -1;
      if (b.releaseDate) return 1;
      return a.tmdbId - b.tmdbId;
    });
  return {
    id: raw.id as number,
    name: str(raw.name) ?? "Filmreihe",
    overview: text.overview,
    posterPath: str(raw.poster_path),
    backdropPath: str(raw.backdrop_path),
    parts,
  };
}

function normalizeCredit(raw: Raw, creditType: "cast" | "crew"): PersonCredit | null {
  const card = normalizeCard(raw);
  if (!card) return null;
  return {
    ...card,
    creditId: str(raw.credit_id) ?? `${card.kind}-${card.tmdbId}-${creditType}`,
    creditType,
    character: str(raw.character),
    job: str(raw.job),
    department: str(raw.department),
    episodeCount: num(raw.episode_count),
  };
}

export function normalizePerson(raw: Raw, language: string): PersonDetail {
  const text = withFallback(raw, language);
  const credits = raw.combined_credits ?? {};
  return {
    id: raw.id as number,
    name: str(raw.name) ?? "Unbekannt",
    biography: text.biography,
    birthday: str(raw.birthday),
    deathday: str(raw.deathday),
    placeOfBirth: str(raw.place_of_birth),
    profilePath: str(raw.profile_path),
    knownForDepartment: str(raw.known_for_department),
    popularity: num(raw.popularity),
    homepage: str(raw.homepage),
    credits: [
      ...list(credits.cast).map((credit) => normalizeCredit(credit, "cast")),
      ...list(credits.crew).map((credit) => normalizeCredit(credit, "crew")),
    ].filter((credit): credit is PersonCredit => credit !== null),
    profiles: normalizeImages(raw.images?.profiles),
  };
}

export function normalizePersonResult(raw: Raw): PersonSearchResult | null {
  const id = num(raw?.id);
  const name = str(raw?.name);
  if (id === null || !name || raw?.adult === true) return null;
  return {
    id,
    name,
    profilePath: str(raw.profile_path),
    knownForDepartment: str(raw.known_for_department),
    knownFor: list(raw.known_for)
      .map((item) => str(item?.title) ?? str(item?.name))
      .filter((title): title is string => title !== null)
      .slice(0, 3),
  };
}

export function normalizeRegionProviders(raw: Raw): WatchProvider[] {
  return providerList(raw?.results);
}

export function normalizeProvidersByRegion(raw: Raw): Record<string, WatchProviders> {
  return normalizeProviders(raw);
}
