// Normalisierte TMDB-Typen, die Server und Client gemeinsam nutzen.

export type MediaKind = "movie" | "tv";

export interface MediaRef {
  kind: MediaKind;
  tmdbId: number;
}

export function refKey(ref: MediaRef): string {
  return `${ref.kind}:${ref.tmdbId}`;
}

export function mediaHref(ref: MediaRef): string {
  return ref.kind === "movie" ? `/film/${ref.tmdbId}` : `/serie/${ref.tmdbId}`;
}

export interface Genre {
  id: number;
  name: string;
}

export interface MediaCard {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  genreIds: number[];
  overview: string;
  originalLanguage: string | null;
  /** Begründung einer Empfehlung, nur wenn sie aus echten Signalen stammt. */
  reason?: string;
}

export interface CastMember {
  id: number;
  name: string;
  character: string | null;
  profilePath: string | null;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profilePath: string | null;
}

export interface Video {
  key: string;
  name: string;
  type: string;
  official: boolean;
  publishedAt: string | null;
  language: string | null;
}

export interface ImageAsset {
  path: string;
  width: number;
  height: number;
  language: string | null;
}

export interface WatchProvider {
  id: number;
  name: string;
  logoPath: string | null;
  priority: number;
}

export interface WatchProviders {
  region: string;
  link: string | null;
  flatrate: WatchProvider[];
  free: WatchProvider[];
  ads: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

/** Ein Anbieter kann in mehreren Listen stehen, etwa zum Leihen und zum Kaufen. */
export function uniqueProviders(...lists: readonly (readonly WatchProvider[])[]): WatchProvider[] {
  const byId = new Map(lists.flat().map((provider) => [provider.id, provider]));
  return [...byId.values()].sort((a, b) => a.priority - b.priority);
}

/** Läuft ohne Einzelkauf: im Abo, kostenlos oder mit Werbung. */
export function streamingProviders(regional: WatchProviders | undefined): WatchProvider[] {
  return regional ? uniqueProviders(regional.flatrate, regional.free, regional.ads) : [];
}

export interface Keyword {
  id: number;
  name: string;
}

export interface NamedEntity {
  id: number;
  name: string;
  logoPath?: string | null;
}

interface DetailBase {
  tmdbId: number;
  title: string;
  originalTitle: string | null;
  tagline: string | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  logoPath: string | null;
  genres: Genre[];
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
  originalLanguage: string | null;
  spokenLanguages: string[];
  productionCountries: string[];
  productionCompanies: NamedEntity[];
  homepage: string | null;
  status: string | null;
  ageRating: string | null;
  cast: CastMember[];
  crew: CrewMember[];
  videos: Video[];
  backdrops: ImageAsset[];
  posters: ImageAsset[];
  keywords: Keyword[];
  providersByRegion: Record<string, WatchProviders>;
  recommendations: MediaCard[];
  similar: MediaCard[];
}

export interface MovieDetail extends DetailBase {
  kind: "movie";
  releaseDate: string | null;
  regionalReleaseDate: string | null;
  year: number | null;
  runtime: number | null;
  budget: number | null;
  revenue: number | null;
  collection: { id: number; name: string; posterPath: string | null; backdropPath: string | null } | null;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  overview: string;
  posterPath: string | null;
  airDate: string | null;
  episodeCount: number;
}

export interface EpisodeSummary {
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview: string;
  stillPath: string | null;
  airDate: string | null;
  runtime: number | null;
  voteAverage: number | null;
}

export interface TvDetail extends DetailBase {
  kind: "tv";
  firstAirDate: string | null;
  lastAirDate: string | null;
  year: number | null;
  episodeRuntime: number | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  inProduction: boolean;
  type: string | null;
  networks: NamedEntity[];
  createdBy: { id: number; name: string; profilePath: string | null }[];
  seasons: SeasonSummary[];
  lastEpisode: EpisodeSummary | null;
  nextEpisode: EpisodeSummary | null;
}

export type MediaDetail = MovieDetail | TvDetail;

export interface SeasonDetail {
  tvId: number;
  seasonNumber: number;
  name: string;
  overview: string;
  posterPath: string | null;
  airDate: string | null;
  episodes: EpisodeSummary[];
}

export interface EpisodeDetail extends EpisodeSummary {
  tvId: number;
  guestStars: CastMember[];
  crew: CrewMember[];
}

export interface CollectionDetail {
  id: number;
  name: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  /** Nach Veröffentlichung aufsteigend; Teile ohne Datum stehen am Ende. */
  parts: MediaCard[];
}

export interface PersonCredit extends MediaCard {
  creditId: string;
  creditType: "cast" | "crew";
  character: string | null;
  job: string | null;
  department: string | null;
  episodeCount: number | null;
}

export interface PersonDetail {
  id: number;
  name: string;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  profilePath: string | null;
  knownForDepartment: string | null;
  popularity: number | null;
  homepage: string | null;
  credits: PersonCredit[];
  profiles: ImageAsset[];
}

export interface PersonSearchResult {
  id: number;
  name: string;
  profilePath: string | null;
  knownForDepartment: string | null;
  knownFor: string[];
}

export interface PagedResult<T> {
  page: number;
  totalPages: number;
  totalResults: number;
  results: T[];
}
