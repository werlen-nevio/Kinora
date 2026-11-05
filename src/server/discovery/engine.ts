import "server-only";
import { type DiscoveryCard, type DiscoveryFilters, type DiscoveryModeName, matchesBasicFilters, matchesDiscoveryFilters } from "@/lib/discovery";
import type { MediaCard, MediaDetail, MediaKind } from "@/lib/tmdb-types";
import { refKey, streamingProviders } from "@/lib/tmdb-types";
import { getAmbient } from "../ambient";
import { primaryReason } from "../recommender/explain";
import { featureKey } from "../recommender/profile";
import { buildCandidatePool, type PooledCandidate } from "../recommender/service";
import { type CandidateSource, CANDIDATE_SOURCES, hiddenGems, newGenres, type RawCandidate, trending } from "../recommender/sources";
import type { Weights } from "../recommender/types";
import { discover, type DiscoverFilters, getCollection, getDetail, getTopRated } from "../tmdb/api";
import { getUserContext } from "../user";
import { arrangeFranchises, type FranchiseGroup, isExploration, selectSessionItems, SESSION_SIZE } from "./selection";

const AMBIENT_CONCURRENCY = 6;
const MAX_FRANCHISES = 6;

function kindsOf(filters: DiscoveryFilters): MediaKind[] {
  return filters.kinds === "all" ? ["movie", "tv"] : [filters.kinds];
}

function providerIdsOf(detail: MediaDetail | null, region: string): number[] | null {
  return detail ? streamingProviders(detail.providersByRegion[region]).map((provider) => provider.id) : null;
}

function runtimeOf(detail: MediaDetail | null): number | null {
  if (!detail) return null;
  return detail.kind === "movie" ? detail.runtime : detail.episodeRuntime;
}

/** Fragt TMDB direkt mit den Filtern ab. So bleibt der Pool auch bei engen Filtern gefüllt. */
function filteredDiscover(id: string, filters: DiscoveryFilters, region: string, overrides: Partial<DiscoverFilters>, pages: readonly number[]): CandidateSource {
  return {
    id,
    async collect({ language }) {
      const requests = kindsOf(filters).flatMap((kind) =>
        pages.map((page) =>
          discover(
            {
              kind,
              page,
              genres: filters.genres,
              genresMode: "any",
              yearFrom: filters.yearFrom ?? undefined,
              yearTo: filters.yearTo ?? undefined,
              ratingMin: filters.ratingMin ?? undefined,
              language: filters.language ?? undefined,
              runtimeMax: filters.runtimeMax ?? undefined,
              providers: filters.providers,
              region,
              ...overrides,
            },
            language,
          ),
        ),
      );
      const results = await Promise.allSettled(requests);
      return results.flatMap((result): RawCandidate[] =>
        result.status === "fulfilled" ? result.value.results.map((card, rank) => ({ card, provenance: { source: id, rank } })) : [],
      );
    },
  };
}

const topRatedLists: CandidateSource = {
  id: "top_rated_lists",
  async collect({ language }) {
    const pages = await Promise.allSettled([getTopRated("movie", language), getTopRated("tv", language)]);
    return pages.flatMap((page): RawCandidate[] => (page.status === "fulfilled" ? page.value.results.map((card, rank) => ({ card, provenance: { source: "top_rated_lists", rank } })) : []));
  },
};

/** Gewichte für Modi, die nicht einfach das Profil abbilden. */
const MODE_WEIGHTS: Partial<Record<DiscoveryModeName, Partial<Weights>>> = {
  // Weniger «mehr vom Gleichen», mehr Qualität und Neues.
  SURPRISE: { similarity: 0.1, genre: 0.1, tmdb: 0.05, actors: 0.05, crew: 0.05, keywords: 0.05, quality: 0.3, novelty: 0.3 },
  TOP_RATED: { similarity: 0.15, genre: 0.15, tmdb: 0.05, actors: 0.05, crew: 0.05, keywords: 0.05, quality: 0.45, novelty: 0.05 },
  // Bayes-Bewertung im Qualitätssignal sichert kleine Stichproben statistisch ab.
  HIDDEN_GEMS: { similarity: 0.2, genre: 0.2, tmdb: 0.05, actors: 0.05, crew: 0.05, keywords: 0.05, quality: 0.3, novelty: 0.1 },
};

function sourcesFor(mode: DiscoveryModeName, filters: DiscoveryFilters, region: string, round: number): CandidateSource[] {
  // Jede neue Runde blättert weiter, damit nicht immer dieselben Titel kommen.
  const pages = [1 + (round % 3), 2 + (round % 3)];
  const popular = filteredDiscover("filtered_popular", filters, region, { sort: "popularity.desc", voteCountMin: 100 }, pages);
  const best = filteredDiscover("filtered_best", filters, region, { sort: "vote_average.desc", voteCountMin: 500 }, pages);

  switch (mode) {
    case "FOR_YOU":
      return [...CANDIDATE_SOURCES, popular, best];
    case "SURPRISE":
      return [newGenres, hiddenGems, trending, best, filteredDiscover("exploration", filters, region, { sort: "vote_count.asc", voteCountMin: 300, ratingMin: Math.max(filters.ratingMin ?? 0, 7) }, pages)];
    case "TOP_RATED":
      return [topRatedLists, filteredDiscover("filtered_top", filters, region, { sort: "vote_average.desc", voteCountMin: 2000 }, [1, 2, 3].map((page) => page + round))];
    case "HIDDEN_GEMS":
      return [hiddenGems, filteredDiscover("filtered_gems", filters, region, { sort: "vote_average.desc", voteCountMin: 150, voteCountMax: 3000, ratingMin: Math.max(filters.ratingMin ?? 0, 7) }, [1, 2, 3].map((page) => page + round))];
    case "FRANCHISES":
      return [...CANDIDATE_SOURCES, popular];
  }
}

export interface SessionCandidate {
  score: number;
  card: DiscoveryCard;
}

function toDiscoveryCard(card: MediaCard, detail: MediaDetail | null, genreNames: ReadonlyMap<number, string>, reason: string | null, exploration: boolean, region: string): DiscoveryCard {
  const genreIds = detail ? detail.genres.map((genre) => genre.id) : card.genreIds;
  return {
    kind: card.kind,
    tmdbId: card.tmdbId,
    title: detail?.title ?? card.title,
    posterPath: detail?.posterPath ?? card.posterPath,
    backdropPath: detail?.backdropPath ?? card.backdropPath,
    year: detail?.year ?? card.year,
    voteAverage: detail?.voteAverage ?? card.voteAverage,
    voteCount: detail?.voteCount ?? card.voteCount,
    runtime: runtimeOf(detail),
    seasons: detail?.kind === "tv" ? detail.numberOfSeasons : null,
    genres: genreIds.flatMap((id) => genreNames.get(id) ?? []).slice(0, 3),
    genreIds,
    overview: detail?.overview || card.overview,
    reason,
    exploration,
    rank: 0,
    collectionId: detail?.kind === "movie" ? (detail.collection?.id ?? null) : null,
    collectionName: detail?.kind === "movie" ? (detail.collection?.name ?? null) : null,
    ambient: null,
    streaming: streamingProviders(detail?.providersByRegion[region]),
  };
}

async function buildFranchises(accepted: readonly PooledCandidate[], startedCollections: ReadonlySet<number>, seenKeys: ReadonlySet<string>, language: string, region: string, genreNames: ReadonlyMap<number, string>, filters: DiscoveryFilters, today: string): Promise<SessionCandidate[]> {
  const best = new Map<number, PooledCandidate>();
  for (const item of accepted) {
    const id = item.features.collectionId;
    if (id === null || startedCollections.has(id)) continue;
    const current = best.get(id);
    if (!current || item.score > current.score) best.set(id, item);
  }
  const top = [...best.entries()].sort(([, a], [, b]) => b.score - a.score).slice(0, MAX_FRANCHISES);

  const groups = await Promise.all(
    top.map(async ([collectionId, lead]): Promise<FranchiseGroup<SessionCandidate> | null> => {
      const collection = await getCollection(collectionId, language).catch(() => null);
      if (!collection) return null;
      const released = collection.parts.filter((part) => part.releaseDate !== null && part.releaseDate <= today);
      const parts = await Promise.all(
        released
          .filter((part) => !seenKeys.has(refKey(part)))
          .map(async (part): Promise<SessionCandidate | null> => {
            const detail = await getDetail({ kind: "movie", tmdbId: part.tmdbId }, language, region).catch(() => null);
            const fits = matchesDiscoveryFilters(
              {
                kind: "movie",
                genreIds: detail?.genres.map((genre) => genre.id) ?? part.genreIds,
                year: part.year,
                voteAverage: part.voteAverage,
                originalLanguage: part.originalLanguage,
                runtime: runtimeOf(detail),
                providerIds: providerIdsOf(detail, region),
              },
              filters,
            );
            if (!fits) return null;
            const number = released.findIndex((entry) => entry.tmdbId === part.tmdbId) + 1;
            const reason = `Teil ${number} von ${released.length}: ${collection.name}.`;
            return { score: lead.score, card: toDiscoveryCard(part, detail, genreNames, reason, false, region) };
          }),
      );
      const available = parts.filter((part): part is SessionCandidate => part !== null);
      return available.length ? { collectionId, name: collection.name, parts: available, score: lead.score } : null;
    }),
  );
  return arrangeFranchises(groups.filter((group): group is FranchiseGroup<SessionCandidate> => group !== null));
}

async function attachAmbient(items: SessionCandidate[]) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(AMBIENT_CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const item = items[cursor];
        cursor += 1;
        if (!item) return;
        item.card.ambient = await getAmbient(item.card.backdropPath).catch(() => null);
      }
    }),
  );
}

/**
 * Stellt die Karten einer Session zusammen. Nutzt denselben Kandidatenpool und dasselbe
 * Scoring wie die Startseite; Modus und Filter ändern nur Quellen, Gewichte und Auswahl.
 */
export async function buildSessionItems(userId: string, mode: DiscoveryModeName, filters: DiscoveryFilters, round: number, now: Date = new Date()): Promise<SessionCandidate[]> {
  const context = await getUserContext(userId);
  const { pool, signals, genreNames, language, region } = await buildCandidatePool(userId, {
    now,
    sources: sourcesFor(mode, filters, context.region, round),
    weights: MODE_WEIGHTS[mode],
    excludeSeen: filters.excludeSeen,
    excludeWatchlist: filters.excludeWatchlist,
    accept: (card) => matchesBasicFilters(card, filters),
  });

  const accepted = pool.filter((item) =>
    matchesDiscoveryFilters(
      {
        kind: item.card.kind,
        genreIds: item.features.genreIds,
        year: item.features.year,
        voteAverage: item.features.voteAverage,
        originalLanguage: item.detail?.originalLanguage ?? item.card.originalLanguage,
        runtime: runtimeOf(item.detail),
        providerIds: providerIdsOf(item.detail, region),
      },
      filters,
    ),
  );

  let items: SessionCandidate[];
  if (mode === "FRANCHISES") {
    const seen = signals.filter((signal) => signal.watched || signal.notInterested || (filters.excludeWatchlist && signal.watchlisted));
    const seenKeys = new Set(seen.map((signal) => featureKey(signal.features)));
    const started = new Set(signals.filter((signal) => signal.watched).map((signal) => signal.features.collectionId).filter((id): id is number => id !== null));
    items = await buildFranchises(
      accepted.filter((item) => item.card.kind === "movie"),
      started,
      seenKeys,
      language,
      region,
      genreNames,
      filters,
      now.toISOString().slice(0, 10),
    );
  } else {
    const selected = selectSessionItems(accepted, mode, SESSION_SIZE);
    items = selected.map((item) => ({
      score: item.score,
      card: toDiscoveryCard(item.card, (item as PooledCandidate).detail ?? null, genreNames, primaryReason(item.reasons) ?? null, isExploration(item), region),
    }));
  }

  items.forEach((item, rank) => {
    item.card.rank = rank;
  });
  await attachAmbient(items);
  return items;
}
