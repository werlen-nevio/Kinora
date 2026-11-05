// Nachbau der benötigten TMDB-Endpunkte für Tests, im Antwortformat der offiziellen
// API. Bewusst ausserhalb von `src`: Die Anwendung erreicht ihn nur, wenn
// TMDB_API_BASE_URL ausdrücklich auf ihn zeigt.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import sharp from "sharp";
import { COLLECTIONS, GENRES, KEYWORDS, MOVIES, type MockMovie, type MockSeries, PEOPLE, relativeMovies, SERIES } from "./data";

export const MOCK_TOKEN = "kinora-test-token";

const DAY = 86_400_000;
const today = () => new Date();
const allMovies = () => [...MOVIES, ...relativeMovies(today())];
const offsetDate = (days: number) => new Date(today().getTime() + days * DAY).toISOString().slice(0, 10);

const person = (id: number) => PEOPLE.find((entry) => entry.id === id);

function movieCard(movie: MockMovie, lang: string) {
  return {
    id: movie.id,
    title: lang.startsWith("en") ? movie.en : movie.title,
    original_title: movie.original ?? movie.en,
    overview: lang.startsWith("en") ? (movie.overviewEn ?? movie.overview ?? "") : (movie.overview ?? ""),
    poster_path: `/m${movie.id}p.jpg`,
    backdrop_path: `/m${movie.id}b.jpg`,
    release_date: movie.date,
    genre_ids: movie.genres,
    vote_average: movie.vote,
    vote_count: movie.votes,
    popularity: movie.popularity,
    original_language: movie.language ?? "en",
    adult: false,
    video: false,
  };
}

function seriesCard(series: MockSeries, lang: string) {
  return {
    id: series.id,
    name: lang.startsWith("en") ? series.en : series.title,
    original_name: series.en,
    overview: series.overview,
    poster_path: `/t${series.id}p.jpg`,
    backdrop_path: `/t${series.id}b.jpg`,
    first_air_date: series.date,
    genre_ids: series.genres,
    vote_average: series.vote,
    vote_count: series.votes,
    popularity: series.popularity,
    origin_country: ["US"],
    original_language: "en",
    adult: false,
  };
}

const page = (results: unknown[], pageNumber = 1) => ({ page: pageNumber, results, total_pages: pageNumber, total_results: results.length });

function overlap(a: readonly number[], b: readonly number[]) {
  return a.filter((value) => b.includes(value)).length;
}

function relatedMovies(movie: MockMovie) {
  return allMovies()
    .filter((other) => other.id !== movie.id && other.date <= offsetDate(0))
    .map((other) => ({ other, score: overlap(movie.genres, other.genres) * 2 + overlap(movie.keywords, other.keywords) * 3 + overlap(movie.cast, other.cast) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.other.popularity - a.other.popularity || a.other.id - b.other.id)
    .map(({ other }) => other);
}

function relatedSeries(series: MockSeries) {
  return SERIES.filter((other) => other.id !== series.id)
    .sort((a, b) => overlap(series.genres, b.genres) - overlap(series.genres, a.genres) || a.id - b.id);
}

function creditsOf(cast: readonly number[], crew: { id: number; job: string; department: string }[]) {
  return {
    cast: cast.flatMap((id, order) => {
      const entry = person(id);
      return entry ? [{ id, name: entry.name, character: `Rolle von ${entry.name}`, order, profile_path: `/p${id}.jpg`, known_for_department: entry.department }] : [];
    }),
    crew: crew.flatMap((member) => {
      const entry = person(member.id);
      return entry ? [{ id: member.id, name: entry.name, job: member.job, department: member.department, profile_path: `/p${member.id}.jpg` }] : [];
    }),
  };
}

// Bei TMDB sind Logos PNG oder SVG; beide Wege müssen funktionieren.
const LOGOS: Record<string, { file_path: string; iso_639_1: string; vote_average: number }[]> = {
  m27205: [{ file_path: "/m27205logo.svg", iso_639_1: "en", vote_average: 5 }],
  m157336: [{ file_path: "/m157336logo.png", iso_639_1: "en", vote_average: 5 }],
};

function imagesFor(prefix: string, id: number) {
  return {
    backdrops: [{ file_path: `/${prefix}${id}b.jpg`, width: 1920, height: 1080, iso_639_1: null, vote_average: 5 }, { file_path: `/${prefix}${id}b2.jpg`, width: 1920, height: 1080, iso_639_1: null, vote_average: 4 }],
    posters: [{ file_path: `/${prefix}${id}p.jpg`, width: 780, height: 1170, iso_639_1: "de", vote_average: 5 }],
    logos: LOGOS[`${prefix}${id}`] ?? [],
  };
}

const VIDEOS = {
  results: [{ iso_639_1: "de", key: "dQw4w9WgXcQ", name: "Offizieller Trailer", site: "YouTube", type: "Trailer", official: true, published_at: "2020-01-01T00:00:00.000Z" }],
};

const PROVIDERS = {
  results: {
    CH: {
      link: "https://www.themoviedb.org/movie/watch?locale=CH",
      flatrate: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/provider8.jpg", display_priority: 1 }],
      rent: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/provider2.jpg", display_priority: 2 }],
      buy: [{ provider_id: 2, provider_name: "Apple TV", logo_path: "/provider2.jpg", display_priority: 2 }],
    },
  },
};

function translationsFor(de: { title: string; overview: string }, en: { title: string; overview: string }) {
  return {
    translations: [
      { iso_3166_1: "DE", iso_639_1: "de", name: "Deutsch", english_name: "German", data: { title: de.title, overview: de.overview, tagline: "" } },
      { iso_3166_1: "US", iso_639_1: "en", name: "English", english_name: "English", data: { title: en.title, overview: en.overview, tagline: "" } },
    ],
  };
}

function appended(append: string, entries: Record<string, () => unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of append.split(",").filter(Boolean)) {
    const value = entries[key];
    if (value) out[key] = value();
  }
  return out;
}

function movieDetail(movie: MockMovie, lang: string, append: string) {
  const collection = movie.collection ? COLLECTIONS[movie.collection] : undefined;
  const related = relatedMovies(movie);
  const crew = [
    ...movie.director.map((id) => ({ id, job: "Director", department: "Directing" })),
    ...movie.director.slice(0, 1).map((id) => ({ id, job: "Screenplay", department: "Writing" })),
  ];
  return {
    ...movieCard(movie, lang),
    genres: movie.genres.map((id) => ({ id, name: genreName(id) })),
    runtime: movie.runtime,
    status: movie.date > offsetDate(0) ? "Post Production" : "Released",
    tagline: "",
    budget: 100_000_000,
    revenue: 500_000_000,
    homepage: "",
    spoken_languages: [{ english_name: "English", name: "English", iso_639_1: "en" }],
    production_countries: [{ iso_3166_1: "GB", name: "Vereinigtes Königreich" }],
    production_companies: [{ id: 1, name: "Beispiel Pictures", logo_path: null, origin_country: "GB" }],
    belongs_to_collection: movie.collection && collection
      ? { id: movie.collection, name: collection.name, poster_path: `/c${movie.collection}p.jpg`, backdrop_path: `/c${movie.collection}b.jpg` }
      : null,
    ...appended(append, {
      credits: () => creditsOf(movie.cast, crew),
      videos: () => VIDEOS,
      images: () => imagesFor("m", movie.id),
      keywords: () => ({ keywords: KEYWORDS.filter((keyword) => movie.keywords.includes(keyword.id)) }),
      "watch/providers": () => PROVIDERS,
      recommendations: () => page(related.slice(0, 8).map((other) => ({ ...movieCard(other, lang), media_type: "movie" }))),
      similar: () => page(related.slice(4, 14).map((other) => movieCard(other, lang))),
      translations: () => translationsFor({ title: movie.title, overview: movie.overview ?? "" }, { title: movie.en, overview: movie.overviewEn ?? movie.overview ?? "" }),
      release_dates: () => ({
        results: [
          {
            iso_3166_1: "CH",
            release_dates: [{ certification: movie.certification ?? "12", release_date: `${movie.date}T00:00:00.000Z`, type: 3 }],
          },
        ],
      }),
    }),
  };
}

function episodesOf(series: MockSeries, seasonNumber: number) {
  const season = series.seasons.find((entry) => entry.number === seasonNumber);
  if (!season) return [];
  return Array.from({ length: season.episodes }, (_, index) => ({
    id: series.id * 10_000 + seasonNumber * 100 + index + 1,
    season_number: seasonNumber,
    episode_number: index + 1,
    name: `Episode ${index + 1} der Staffel ${seasonNumber}`,
    overview: `Handlung von Episode ${index + 1}.`,
    still_path: `/e${series.id}s${seasonNumber}e${index + 1}.jpg`,
    air_date: offsetDate(season.startOffsetDays + index * (season.stepDays ?? 7)),
    runtime: series.runtime,
    vote_average: 8.1,
    vote_count: 120,
    crew: [],
    guest_stars: [],
  }));
}

function seasonDetail(series: MockSeries, seasonNumber: number) {
  return {
    id: series.id * 100 + seasonNumber,
    season_number: seasonNumber,
    name: `Staffel ${seasonNumber}`,
    overview: `Die ${seasonNumber}. Staffel von ${series.title}.`,
    poster_path: `/t${series.id}s${seasonNumber}.jpg`,
    air_date: offsetDate(series.seasons.find((entry) => entry.number === seasonNumber)?.startOffsetDays ?? 0),
    episodes: episodesOf(series, seasonNumber),
  };
}

function seriesDetail(series: MockSeries, lang: string, append: string) {
  const all = series.seasons.flatMap((season) => episodesOf(series, season.number));
  const now = offsetDate(0);
  const aired = all.filter((episode) => episode.air_date <= now);
  const future = all.filter((episode) => episode.air_date > now);
  const related = relatedSeries(series);
  const seasonAppends: Record<string, () => unknown> = Object.fromEntries(series.seasons.map((season) => [`season/${season.number}`, () => seasonDetail(series, season.number)]));
  return {
    ...seriesCard(series, lang),
    genres: series.genres.map((id) => ({ id, name: genreName(id) })),
    status: series.status,
    tagline: "",
    type: "Scripted",
    in_production: series.status === "Returning Series",
    number_of_seasons: series.seasons.length,
    number_of_episodes: all.length,
    episode_run_time: [series.runtime],
    last_air_date: aired[aired.length - 1]?.air_date ?? null,
    last_episode_to_air: aired[aired.length - 1] ?? null,
    next_episode_to_air: future[0] ?? null,
    networks: [{ id: 1, name: "Beispiel TV", logo_path: null }],
    created_by: series.creator.flatMap((id) => {
      const entry = person(id);
      return entry ? [{ id, name: entry.name, profile_path: `/p${id}.jpg` }] : [];
    }),
    seasons: series.seasons.map((season) => ({
      season_number: season.number,
      name: `Staffel ${season.number}`,
      overview: "",
      poster_path: `/t${series.id}s${season.number}.jpg`,
      air_date: offsetDate(season.startOffsetDays),
      episode_count: season.episodes,
    })),
    spoken_languages: [{ english_name: "English", name: "English", iso_639_1: "en" }],
    production_countries: [{ iso_3166_1: "US", name: "Vereinigte Staaten" }],
    production_companies: [{ id: 2, name: "Beispiel Studios", logo_path: null }],
    homepage: "",
    ...appended(append, {
      aggregate_credits: () => ({
        cast: series.cast.flatMap((id, order) => {
          const entry = person(id);
          return entry ? [{ id, name: entry.name, order, profile_path: `/p${id}.jpg`, roles: [{ character: `Rolle von ${entry.name}`, episode_count: 40 }] }] : [];
        }),
        crew: [],
      }),
      videos: () => VIDEOS,
      images: () => imagesFor("t", series.id),
      keywords: () => ({ results: KEYWORDS.filter((keyword) => series.keywords.includes(keyword.id)) }),
      "watch/providers": () => PROVIDERS,
      recommendations: () => page(related.slice(0, 3).map((other) => ({ ...seriesCard(other, lang), media_type: "tv" }))),
      similar: () => page(related.slice(0, 3).map((other) => seriesCard(other, lang))),
      translations: () => translationsFor({ title: series.title, overview: series.overview }, { title: series.en, overview: series.overview }),
      content_ratings: () => ({ results: [{ iso_3166_1: "DE", rating: "16" }] }),
      ...seasonAppends,
    }),
  };
}

function genreName(id: number) {
  for (const list of [GENRES.movie, GENRES.tv]) {
    const match = list.find(([genre]) => genre === id);
    if (match) return match[1];
  }
  return "Genre";
}

function collectionDetail(id: number, lang: string) {
  const collection = COLLECTIONS[id];
  if (!collection) return null;
  return {
    id,
    name: collection.name,
    overview: collection.overview,
    poster_path: `/c${id}p.jpg`,
    backdrop_path: `/c${id}b.jpg`,
    // TMDB liefert die Teile nicht zwingend chronologisch; die Anwendung muss sortieren.
    parts: allMovies().filter((movie) => movie.collection === id).reverse().map((movie) => ({ ...movieCard(movie, lang), media_type: "movie" })),
  };
}

function personDetail(id: number, lang: string, append: string) {
  const entry = person(id);
  if (!entry) return null;
  const movieCast = allMovies().filter((movie) => movie.cast.includes(id));
  const seriesCast = SERIES.filter((series) => series.cast.includes(id));
  const movieCrew = allMovies().filter((movie) => movie.director.includes(id));
  const seriesCrew = SERIES.filter((series) => series.creator.includes(id));
  return {
    id,
    name: entry.name,
    biography: entry.biography ?? "",
    birthday: entry.birthday ?? null,
    deathday: null,
    place_of_birth: entry.place ?? null,
    profile_path: `/p${id}.jpg`,
    known_for_department: entry.department,
    popularity: 40,
    homepage: null,
    adult: false,
    ...appended(append, {
      combined_credits: () => ({
        cast: [
          ...movieCast.map((movie) => ({ ...movieCard(movie, lang), media_type: "movie", credit_id: `c${movie.id}${id}`, character: `Rolle von ${entry.name}`, order: 0 })),
          ...seriesCast.map((series) => ({ ...seriesCard(series, lang), media_type: "tv", credit_id: `c${series.id}${id}`, character: `Rolle von ${entry.name}`, episode_count: 40 })),
        ],
        crew: [
          ...movieCrew.map((movie) => ({ ...movieCard(movie, lang), media_type: "movie", credit_id: `d${movie.id}${id}`, job: "Director", department: "Directing" })),
          ...seriesCrew.map((series) => ({ ...seriesCard(series, lang), media_type: "tv", credit_id: `d${series.id}${id}`, job: "Creator", department: "Writing", episode_count: 40 })),
        ],
      }),
      images: () => ({ profiles: [{ file_path: `/p${id}.jpg`, width: 500, height: 750, iso_639_1: null }] }),
      translations: () => ({ translations: [{ iso_3166_1: "DE", iso_639_1: "de", data: { biography: entry.biography ?? "" } }] }),
    }),
  };
}

function discoverMovies(params: URLSearchParams, lang: string) {
  const withGenres = params.get("with_genres");
  const anyGenre = withGenres?.includes("|");
  const genreList = withGenres?.split(/[|,]/).map(Number) ?? [];
  const from = params.get("primary_release_date.gte");
  const to = params.get("primary_release_date.lte");
  const min = Number(params.get("vote_average.gte") ?? 0);
  const countMin = Number(params.get("vote_count.gte") ?? 0);
  const countMax = Number(params.get("vote_count.lte") ?? Infinity);
  const cast = params.get("with_cast")?.split(",").map(Number);
  const crew = params.get("with_crew")?.split(",").map(Number);
  const runtimeMax = Number(params.get("with_runtime.lte") ?? Infinity);
  const language = params.get("with_original_language");
  const sort = params.get("sort_by") ?? "popularity.desc";
  const results = allMovies().filter((movie) => {
    if (withGenres && !(anyGenre ? genreList.some((id) => movie.genres.includes(id)) : genreList.every((id) => movie.genres.includes(id)))) return false;
    if (from && movie.date < from) return false;
    if (to && movie.date > to) return false;
    if (movie.vote < min || movie.votes < countMin || movie.votes > countMax) return false;
    if (cast && !cast.some((id) => movie.cast.includes(id))) return false;
    if (crew && !crew.some((id) => movie.director.includes(id))) return false;
    if (movie.runtime > runtimeMax) return false;
    if (language && (movie.language ?? "en") !== language) return false;
    return true;
  });
  results.sort((a, b) => {
    if (sort.startsWith("vote_average")) return b.vote - a.vote || a.id - b.id;
    if (sort.startsWith("vote_count")) return b.votes - a.votes || a.id - b.id;
    if (sort.startsWith("primary_release_date.asc")) return a.date.localeCompare(b.date);
    if (sort.startsWith("primary_release_date")) return b.date.localeCompare(a.date);
    return b.popularity - a.popularity || a.id - b.id;
  });
  return page(results.slice(0, 20).map((movie) => movieCard(movie, lang)));
}

function discoverSeries(params: URLSearchParams, lang: string) {
  const genres = params.get("with_genres")?.split(/[|,]/).map(Number);
  const countMin = Number(params.get("vote_count.gte") ?? 0);
  const results = SERIES.filter((series) => (!genres || genres.some((id) => series.genres.includes(id))) && series.votes >= countMin);
  return page(results.map((series) => seriesCard(series, lang)));
}

function matches(text: string, query: string) {
  return text.toLowerCase().includes(query.toLowerCase());
}

function route(url: URL): unknown | null {
  const path = url.pathname.replace(/^\/3/, "");
  const params = url.searchParams;
  const lang = params.get("language") ?? "en-US";
  const append = params.get("append_to_response") ?? "";
  const parts = path.split("/").filter(Boolean);
  const pageNumber = Number(params.get("page") ?? 1);

  if (pageNumber > 1) return { page: pageNumber, results: [], total_pages: 1, total_results: 0 };

  if (parts[0] === "genre") return { genres: GENRES[parts[1] as "movie" | "tv"].map(([id, name]) => ({ id, name })) };

  if (parts[0] === "configuration") {
    if (parts[1] === "languages") return [{ iso_639_1: "de", english_name: "German", name: "Deutsch" }, { iso_639_1: "en", english_name: "English", name: "English" }, { iso_639_1: "ja", english_name: "Japanese", name: "日本語" }];
    if (parts[1] === "countries") return [{ iso_3166_1: "CH", english_name: "Switzerland", native_name: "Schweiz" }, { iso_3166_1: "US", english_name: "United States", native_name: "USA" }];
  }

  if (parts[0] === "watch") return { results: [{ provider_id: 8, provider_name: "Netflix", logo_path: "/provider8.jpg", display_priority: 1 }, { provider_id: 2, provider_name: "Apple TV", logo_path: "/provider2.jpg", display_priority: 2 }] };

  if (parts[0] === "trending") {
    const kind = parts[1];
    const movies = allMovies().filter((movie) => movie.date <= offsetDate(0)).sort((a, b) => b.popularity - a.popularity).slice(0, 14).map((movie) => ({ ...movieCard(movie, lang), media_type: "movie" }));
    const series = [...SERIES].sort((a, b) => b.popularity - a.popularity).map((entry) => ({ ...seriesCard(entry, lang), media_type: "tv" }));
    if (kind === "movie") return page(movies);
    if (kind === "tv") return page(series);
    return page([...movies.slice(0, 12), ...series.slice(0, 4)].sort((a, b) => b.popularity - a.popularity));
  }

  if (parts[0] === "discover") return parts[1] === "movie" ? discoverMovies(params, lang) : discoverSeries(params, lang);

  if (parts[0] === "search") {
    const query = params.get("query") ?? "";
    const movies = allMovies().filter((movie) => matches(movie.title, query) || matches(movie.en, query));
    const series = SERIES.filter((entry) => matches(entry.title, query));
    const people = PEOPLE.filter((entry) => matches(entry.name, query)).map((entry) => ({
      id: entry.id,
      name: entry.name,
      profile_path: `/p${entry.id}.jpg`,
      known_for_department: entry.department,
      popularity: 40,
      adult: false,
      media_type: "person",
      known_for: allMovies().filter((movie) => movie.cast.includes(entry.id)).slice(0, 3).map((movie) => movieCard(movie, lang)),
    }));
    if (parts[1] === "movie") return page(movies.map((movie) => movieCard(movie, lang)));
    if (parts[1] === "tv") return page(series.map((entry) => seriesCard(entry, lang)));
    if (parts[1] === "person") return page(people);
    return page([
      ...movies.map((movie) => ({ ...movieCard(movie, lang), media_type: "movie" })),
      ...series.map((entry) => ({ ...seriesCard(entry, lang), media_type: "tv" })),
      ...people,
    ]);
  }

  if (parts[0] === "collection") return collectionDetail(Number(parts[1]), lang);
  if (parts[0] === "person") return personDetail(Number(parts[1]), lang, append);

  if (parts[0] === "movie") {
    if (parts[1] === "popular") return page(allMovies().filter((movie) => movie.date <= offsetDate(0)).sort((a, b) => b.popularity - a.popularity).slice(0, 20).map((movie) => movieCard(movie, lang)));
    if (parts[1] === "top_rated") return page(MOVIES.slice().sort((a, b) => b.vote - a.vote).slice(0, 20).map((movie) => movieCard(movie, lang)));
    const movie = allMovies().find((entry) => entry.id === Number(parts[1]));
    if (!movie) return null;
    if (parts[2] === "watch") return { id: movie.id, ...PROVIDERS };
    return movieDetail(movie, lang, append);
  }

  if (parts[0] === "tv") {
    if (parts[1] === "popular") return page(SERIES.map((series) => seriesCard(series, lang)));
    if (parts[1] === "top_rated") return page(SERIES.slice().sort((a, b) => b.vote - a.vote).map((series) => seriesCard(series, lang)));
    const series = SERIES.find((entry) => entry.id === Number(parts[1]));
    if (!series) return null;
    if (parts[2] === "watch") return { id: series.id, ...PROVIDERS };
    if (parts[2] === "season") {
      const seasonNumber = Number(parts[3]);
      if (!series.seasons.some((season) => season.number === seasonNumber)) return null;
      if (parts[4] === "episode") {
        const episode = episodesOf(series, seasonNumber).find((entry) => entry.episode_number === Number(parts[5]));
        return episode ? { ...episode, ...appended(append, { credits: () => ({ cast: [], crew: [], guest_stars: [] }) }) } : null;
      }
      return seasonDetail(series, seasonNumber);
    }
    return seriesDetail(series, lang, append);
  }

  return null;
}

// Künstliche Bilder: Farbverläufe je Dateiname, damit Layout und Ambient-Licht prüfbar sind.
function hashHue(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function imageLabel(file: string): string {
  const match = /^\/(m|t)(\d+)/.exec(file);
  if (match?.[1] === "m") return allMovies().find((movie) => movie.id === Number(match[2]))?.title ?? "";
  if (match?.[1] === "t") return SERIES.find((series) => series.id === Number(match[2]))?.title ?? "";
  const personMatch = /^\/p(\d+)/.exec(file);
  if (personMatch) return person(Number(personMatch[1]))?.name ?? "";
  return "";
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const imageCache = new Map<string, Buffer>();

async function renderImage(file: string, size: string): Promise<Buffer> {
  const cacheKey = `${size}${file}`;
  const cached = imageCache.get(cacheKey);
  if (cached) return cached;

  const hue = hashHue(file);
  const isBackdrop = /b2?\.jpg$/.test(file) || /^\/e/.test(file);
  const isPerson = /^\/p\d/.test(file);
  const isProvider = /^\/provider/.test(file);
  const [width, height] = isProvider ? [92, 92] : isBackdrop ? [1280, 720] : [500, 750];
  const label = escapeXml(imageLabel(file));
  const fontSize = isBackdrop ? 64 : isPerson ? 46 : 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},62%,34%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 55) % 360},70%,12%)"/>
      </linearGradient>
      <radialGradient id="r" cx=".72" cy=".24" r=".55">
        <stop offset="0" stop-color="hsl(${(hue + 25) % 360},85%,66%)" stop-opacity=".75"/>
        <stop offset="1" stop-color="hsl(${hue},80%,50%)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#r)"/>
    ${isProvider || isBackdrop ? "" : `<text x="50%" y="${height - 70}" font-family="Georgia, serif" font-size="${fontSize}" fill="rgba(255,255,255,.9)" text-anchor="middle" textLength="${Math.min(width - 60, label.length * fontSize * 0.5)}" lengthAdjust="spacingAndGlyphs">${label}</text>`}
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  imageCache.set(cacheKey, buffer);
  return buffer;
}

export interface MockControls {
  /** Antwortet die nächsten N API-Anfragen mit diesem Status. */
  failNext(count: number, status: number): void;
  requestCount(): number;
  reset(): void;
}

export async function startMockTmdb(port: number): Promise<{ server: Server; close: () => Promise<void> } & MockControls> {
  let failures = 0;
  let failStatus = 503;
  let requests = 0;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);

      if (url.pathname.startsWith("/t/p/") && url.pathname.endsWith(".svg")) {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#f3efe8"/></svg>';
        response.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*" }).end(svg);
        return;
      }

      if (url.pathname.startsWith("/t/p/")) {
        const [, , , size, ...rest] = url.pathname.split("/");
        const image = await renderImage(`/${rest.join("/")}`, size ?? "w500");
        response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" });
        response.end(image);
        return;
      }

      if (url.pathname === "/__health") {
        response.writeHead(200).end("ok");
        return;
      }

      if (request.headers.authorization !== `Bearer ${MOCK_TOKEN}`) {
        response.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ status_code: 7, status_message: "Invalid API key" }));
        return;
      }

      requests += 1;
      if (failures > 0) {
        failures -= 1;
        response.writeHead(failStatus, { "Content-Type": "application/json", ...(failStatus === 429 ? { "Retry-After": "1" } : {}) }).end(JSON.stringify({ status_message: "failure" }));
        return;
      }

      const body = route(url);
      if (body === null) {
        response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ status_code: 34, status_message: "Not found" }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
    })().catch((error) => {
      console.error("[mock-tmdb]", error);
      response.writeHead(500).end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, resolve);
  });

  return {
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    failNext(count, status) {
      failures = count;
      failStatus = status;
    },
    requestCount: () => requests,
    reset() {
      failures = 0;
      requests = 0;
    },
  };
}
