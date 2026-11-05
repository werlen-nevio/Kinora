import "server-only";
import type { MediaCard, MediaKind } from "@/lib/tmdb-types";
import { discover, getCollection, getDetail, getPerson, getTrending } from "../tmdb/api";
import { featureKey, topAffinities } from "./profile";
import type { Provenance, TasteProfile } from "./types";

export interface RawCandidate {
  card: MediaCard;
  provenance: Provenance;
}

export interface SourceContext {
  profile: TasteProfile;
  language: string;
  now: Date;
}

/**
 * Eine Quelle liefert Kandidaten samt Herkunft. Neue Verfahren, etwa Collaborative
 * Filtering oder Embeddings, kommen als weiterer Eintrag in `CANDIDATE_SOURCES` dazu.
 */
export interface CandidateSource {
  id: string;
  collect(context: SourceContext): Promise<RawCandidate[]>;
}

const SEEDS_FOR_TMDB = 8;

export const seedRecommendations: CandidateSource = {
  id: "seed_recommendations",
  async collect({ profile, language }) {
    const seeds = profile.seeds.slice(0, SEEDS_FOR_TMDB);
    const lists = await Promise.allSettled(
      seeds.map(async (seed) => {
        const detail = await getDetail({ kind: seed.features.kind, tmdbId: seed.features.tmdbId }, language);
        const base = { seedKey: featureKey(seed.features), seedTitle: seed.features.title, seedWeight: seed.weight };
        return [
          ...detail.recommendations.map((card, rank): RawCandidate => ({
            card,
            provenance: { ...base, source: "tmdb_recommendations", rank },
          })),
          ...detail.similar.map((card, rank): RawCandidate => ({
            card,
            provenance: { ...base, source: "tmdb_similar", rank },
          })),
        ];
      }),
    );
    return lists.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  },
};

function topGenreIds(profile: TasteProfile, limit: number) {
  return topAffinities(profile.genres, limit, 1, 0.02).map((entry) => entry.id);
}

function fromDiscover(source: string, cards: MediaCard[]): RawCandidate[] {
  return cards.map((card, rank) => ({ card, provenance: { source, rank } }));
}

const KINDS: MediaKind[] = ["movie", "tv"];

export const genreDiscover: CandidateSource = {
  id: "genre_discover",
  async collect({ profile, language }) {
    const genres = topGenreIds(profile, 3);
    if (genres.length === 0) return [];
    const requests = KINDS.flatMap((kind) =>
      genres.map((genre) =>
        discover({ kind, genres: [genre], voteCountMin: 500, ratingMin: 6.5, sort: "vote_average.desc" }, language),
      ),
    );
    const pages = await Promise.allSettled(requests);
    return pages.flatMap((page) => (page.status === "fulfilled" ? fromDiscover("genre_discover", page.value.results) : []));
  },
};

export const peopleCredits: CandidateSource = {
  id: "people_credits",
  async collect({ profile, language }) {
    const actors = topAffinities(profile.actors, 4, 2, 0.15).map((entry) => ({ id: entry.id, role: "actor" as const }));
    const directors = topAffinities(profile.directors, 3, 2, 0.15).map((entry) => ({ id: entry.id, role: "director" as const }));
    const results = await Promise.allSettled(
      [...actors, ...directors].map(async ({ id, role }) => {
        const person = await getPerson(id, language);
        const credits = person.credits
          .filter((credit) => (role === "actor" ? credit.creditType === "cast" : credit.job === "Director" || credit.job === "Creator"))
          .filter((credit) => credit.posterPath && (credit.voteCount ?? 0) >= 50)
          // Talkshows und Einzelgastrollen sagen nichts über den Geschmack aus.
          .filter((credit) => !(credit.kind === "tv" && role === "actor" && (credit.episodeCount ?? 0) < 4))
          .sort((a, b) => (b.voteAverage ?? 0) * Math.log1p(b.voteCount ?? 0) - (a.voteAverage ?? 0) * Math.log1p(a.voteCount ?? 0))
          .slice(0, 25);
        return credits.map((credit, rank): RawCandidate => ({
          card: stripCredit(credit),
          provenance: { source: "people_credits", rank, personId: id, personName: person.name, personRole: role },
        }));
      }),
    );
    return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  },
};

function stripCredit(credit: MediaCard): MediaCard {
  return {
    kind: credit.kind,
    tmdbId: credit.tmdbId,
    title: credit.title,
    posterPath: credit.posterPath,
    backdropPath: credit.backdropPath,
    releaseDate: credit.releaseDate,
    year: credit.year,
    voteAverage: credit.voteAverage,
    voteCount: credit.voteCount,
    popularity: credit.popularity,
    genreIds: credit.genreIds,
    overview: credit.overview,
    originalLanguage: credit.originalLanguage,
  };
}

export const collectionParts: CandidateSource = {
  id: "collection_parts",
  async collect({ profile, language, now }) {
    const collectionIds = [
      ...new Set(profile.seeds.map((seed) => seed.features.collectionId).filter((id): id is number => id !== null)),
    ].slice(0, 12);
    const today = now.toISOString().slice(0, 10);
    const results = await Promise.allSettled(collectionIds.map((id) => getCollection(id, language)));
    return results.flatMap((result) =>
      result.status === "fulfilled"
        ? result.value.parts
            .filter((part) => part.releaseDate !== null && part.releaseDate <= today)
            .map((card, rank): RawCandidate => ({ card, provenance: { source: "collection_parts", rank } }))
        : [],
    );
  },
};

export const trending: CandidateSource = {
  id: "trending",
  async collect({ language }) {
    const page = await getTrending("all", "week", language);
    return fromDiscover("trending", page.results);
  },
};

export const hiddenGems: CandidateSource = {
  id: "hidden_gems",
  async collect({ profile, language }) {
    const genres = topGenreIds(profile, 4);
    const requests = KINDS.map((kind) =>
      discover(
        {
          kind,
          genres,
          genresMode: "any",
          voteCountMin: 120,
          voteCountMax: 2500,
          ratingMin: 7.1,
          sort: "vote_average.desc",
        },
        language,
      ),
    );
    const pages = await Promise.allSettled(requests);
    return pages.flatMap((page) => (page.status === "fulfilled" ? fromDiscover("hidden_gems", page.value.results) : []));
  },
};

export const nostalgia: CandidateSource = {
  id: "nostalgia",
  async collect({ profile, language, now }) {
    const genres = topGenreIds(profile, 3);
    if (genres.length === 0) return [];
    const yearTo = now.getFullYear() - 20;
    const page = await discover(
      { kind: "movie", genres, genresMode: "any", yearTo, voteCountMin: 300, ratingMin: 6.8, sort: "vote_average.desc" },
      language,
    );
    return fromDiscover("nostalgia", page.results);
  },
};

export const newGenres: CandidateSource = {
  id: "new_genres",
  async collect({ profile, language }) {
    const known = new Set([...profile.genres.entries()].filter(([, value]) => value.evidence >= 2).map(([id]) => id));
    const disliked = new Set([...profile.genres.entries()].filter(([, value]) => value.score < -0.1).map(([id]) => id));
    // Filmgenres, die TMDB führt und die im Profil noch kaum vorkommen.
    const pool = EXPLORABLE_GENRES.filter((id) => !known.has(id) && !disliked.has(id)).slice(0, 4);
    const pages = await Promise.allSettled(
      pool.map((genre) => discover({ kind: "movie", genres: [genre], voteCountMin: 1500, ratingMin: 7.2, sort: "vote_average.desc" }, language)),
    );
    return pages.flatMap((page) => (page.status === "fulfilled" ? fromDiscover("new_genres", page.value.results) : []));
  },
};

// TMDB-Genre-IDs für Filme; Reihenfolge von zugänglich zu speziell.
const EXPLORABLE_GENRES = [53, 18, 35, 80, 878, 9648, 10749, 16, 36, 99, 10752, 37, 14, 27, 10402];

export const CANDIDATE_SOURCES: CandidateSource[] = [
  seedRecommendations,
  genreDiscover,
  peopleCredits,
  collectionParts,
  trending,
  hiddenGems,
  nostalgia,
  newGenres,
];
