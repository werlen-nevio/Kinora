import "server-only";
import type { MediaType, Prisma } from "@/generated/prisma/client";
import { DEFAULT_LANGUAGE, DEFAULT_REGION } from "@/lib/locale";
import type { MediaCard, MediaDetail, MediaRef } from "@/lib/tmdb-types";
import { refKey } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { toKind, toMediaType } from "../library/media";
import { getDetail, getGenreMap } from "../tmdb/api";
import { primaryReason } from "./explain";
import { featuresFromCard, featuresFromDetail } from "./features";
import { featureKey } from "./profile";
import { byScore, type RankContext, scoreCandidate } from "./ranking";
import { buildSections } from "./sections";
import { resolveWeights } from "./scoring";
import { loadProfile } from "./signals";
import { CANDIDATE_SOURCES, type CandidateSource, type RawCandidate } from "./sources";
import type { Candidate, ItemFeatures, RecommendationSection, ScoredCandidate, TasteProfile, UserSignal, Weights } from "./types";

const CACHE_TTL_MS = 24 * 3600 * 1000;
const FEATURE_FETCH_LIMIT = 140;
const FEATURE_CONCURRENCY = 8;

function exclusions(signals: readonly UserSignal[], { excludeSeen, excludeWatchlist }: { excludeSeen: boolean; excludeWatchlist: boolean }) {
  const excluded = new Set<string>();
  for (const signal of signals) {
    const key = featureKey(signal.features);
    // Abgelehntes bleibt immer draussen, bis jemand die Ablehnung ausdrücklich zurücknimmt.
    if (signal.notInterested) excluded.add(key);
    if (excludeWatchlist && signal.watchlisted) excluded.add(key);
    if (!excludeSeen) continue;
    if (signal.watched) excluded.add(key);
    // Bei Serien gilt auch «angefangen» als bekannt, es erscheint in «Weiterschauen».
    if (signal.features.kind === "tv" && signal.weight > 0) excluded.add(key);
  }
  return excluded;
}

function mergeCandidates(raw: readonly RawCandidate[], excluded: ReadonlySet<string>): Map<string, { card: MediaCard; provenance: RawCandidate["provenance"][] }> {
  const merged = new Map<string, { card: MediaCard; provenance: RawCandidate["provenance"][] }>();
  for (const { card, provenance } of raw) {
    const key = refKey(card);
    if (excluded.has(key) || !card.posterPath) continue;
    const entry = merged.get(key);
    if (entry) entry.provenance.push(provenance);
    else merged.set(key, { card, provenance: [provenance] });
  }
  return merged;
}

async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        const item = items[index] as T;
        try {
          results[index] = { status: "fulfilled", value: await task(item) };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

export interface PoolOptions {
  now: Date;
  sources?: readonly CandidateSource[];
  weights?: Partial<Weights>;
  excludeSeen?: boolean;
  excludeWatchlist?: boolean;
  featureLimit?: number;
  /** Billiger Vorfilter: Sonst füllen unpassende Titel die Vorauswahl und enge Filter gehen leer aus. */
  accept?: (card: MediaCard) => boolean;
}

export interface PooledCandidate extends ScoredCandidate {
  /** Vollständige TMDB-Daten, falls der Abruf geklappt hat. */
  detail: MediaDetail | null;
}

export interface CandidatePool {
  pool: PooledCandidate[];
  profile: TasteProfile;
  signals: UserSignal[];
  genreNames: Map<number, string>;
  language: string;
  region: string;
}

/**
 * Sammelt Kandidaten aus den Quellen und bewertet sie. Startseite und Discovery-Modus
 * teilen sich diesen Weg, sie unterscheiden sich nur in Quellen, Gewichten und Auswahl.
 */
export async function buildCandidatePool(userId: string, options: PoolOptions): Promise<CandidatePool> {
  const { now, sources = CANDIDATE_SOURCES, excludeSeen = true, excludeWatchlist = true, featureLimit = FEATURE_FETCH_LIMIT } = options;
  const loaded = await loadProfile(userId, now);
  const { profile, signals } = loaded;
  const weights = options.weights ? resolveWeights({ ...loaded.weights, ...options.weights }) : loaded.weights;

  const preferences = await prisma.userPreference.findUnique({ where: { userId }, select: { language: true, region: true } });
  const language = preferences?.language ?? DEFAULT_LANGUAGE;
  const region = preferences?.region ?? DEFAULT_REGION;
  const genreNames = await getGenreMap(language).catch(() => new Map<number, string>());

  const settled = await Promise.allSettled(sources.map((source) => source.collect({ profile, language, now })));
  settled.forEach((result, index) => {
    if (result.status === "rejected") console.error(`[recs] Quelle ${sources[index]?.id} fehlgeschlagen:`, result.reason);
  });
  const raw = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const merged = mergeCandidates(raw, exclusions(signals, { excludeSeen, excludeWatchlist }));
  const accepted = options.accept ? [...merged.values()].filter((entry) => options.accept?.(entry.card)) : [...merged.values()];

  const context: RankContext = { profile, weights, now, genreNames };

  // Vorauswahl mit groben Merkmalen; vollständige Merkmale kosten je Titel eine Anfrage.
  const coarse = accepted.map((entry) =>
    scoreCandidate({ card: entry.card, features: featuresFromCard(entry.card), provenance: entry.provenance }, context),
  );
  const shortlisted = coarse.sort(byScore).slice(0, featureLimit);

  const details = await mapLimited(shortlisted, FEATURE_CONCURRENCY, (item) =>
    getDetail({ kind: item.card.kind, tmdbId: item.card.tmdbId }, language, region),
  );

  const pool: PooledCandidate[] = shortlisted.map((item, index) => {
    const detail = details[index];
    const full = detail?.status === "fulfilled" ? detail.value : null;
    const features: ItemFeatures = full ? featuresFromDetail(full) : item.features;
    const candidate: Candidate = { card: item.card, features, provenance: item.provenance };
    return { ...scoreCandidate(candidate, context), detail: full };
  });

  return { pool, profile, signals, genreNames, language, region };
}

async function computeRecommendations(userId: string, now: Date) {
  const { profile } = await loadProfile(userId, now);
  if (profile.signalCount === 0) return { sections: [] as RecommendationSection[], signalCount: 0 };
  const { pool, genreNames } = await buildCandidatePool(userId, { now });
  return { sections: buildSections({ scored: pool, profile, genreNames, now }), signalCount: profile.signalCount };
}

interface StoredSectionMeta {
  id: string;
  title: string;
  emphasis?: string;
}

async function persist(userId: string, sections: readonly RecommendationSection[], signalCount: number, startedAt: Date) {
  const expiresAt = new Date(startedAt.getTime() + CACHE_TTL_MS);
  const meta: StoredSectionMeta[] = sections.map(({ id, title, emphasis }) => ({ id, title, ...(emphasis ? { emphasis } : {}) }));
  const rows: Prisma.RecommendationCacheCreateManyInput[] = sections.flatMap((section) =>
    section.items.map((item, rank) => ({
      userId,
      section: section.id,
      mediaType: toMediaType(item.card.kind),
      tmdbId: item.card.tmdbId,
      rank,
      score: item.score,
      breakdown: item.breakdown as unknown as Prisma.InputJsonObject,
      reasons: item.reasons as unknown as Prisma.InputJsonArray,
      card: { ...item.card, reason: primaryReason(item.reasons) } as unknown as Prisma.InputJsonObject,
      computedAt: startedAt,
      expiresAt,
    })),
  );
  await prisma.$transaction(async (tx) => {
    await tx.recommendationCache.deleteMany({ where: { userId } });
    if (rows.length > 0) await tx.recommendationCache.createMany({ data: rows, skipDuplicates: true });
    const data = {
      computedAt: startedAt,
      signalCount,
      sections: meta as unknown as Prisma.InputJsonArray,
    };
    await tx.recommendationState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  });
}

const running = new Map<string, Promise<void>>();

/** Neuberechnung für einen Nutzer. Läuft pro Nutzer höchstens einmal gleichzeitig. */
export function recomputeRecommendations(userId: string): Promise<void> {
  const active = running.get(userId);
  if (active) return active;
  const startedAt = new Date();
  const task = computeRecommendations(userId, startedAt)
    .then(({ sections, signalCount }) => persist(userId, sections, signalCount, startedAt))
    .finally(() => running.delete(userId));
  running.set(userId, task);
  return task;
}

function isStale(state: { dirtyAt: Date | null; computedAt: Date | null } | null, now: Date) {
  if (!state?.computedAt) return Boolean(state?.dirtyAt);
  if (state.dirtyAt && state.dirtyAt > state.computedAt) return true;
  return now.getTime() - state.computedAt.getTime() > CACHE_TTL_MS;
}

/**
 * Sichert aktuelle Reihen beim Lesen. Meist hat der Worker schon gerechnet. Falls nicht,
 * wartet die Anfrage begrenzt und zeigt notfalls den letzten Stand, statt zu blockieren.
 */
async function ensureFresh(userId: string) {
  const state = await prisma.recommendationState.findUnique({ where: { userId } });
  if (!isStale(state, new Date())) return;
  const hasResults = Boolean(state?.computedAt);
  const waitMs = hasResults ? 5_000 : 25_000;
  await Promise.race([
    recomputeRecommendations(userId).catch((error) => console.error("[recs] Neuberechnung fehlgeschlagen:", error)),
    new Promise((resolve) => setTimeout(resolve, waitMs)),
  ]);
}

export interface StoredSection {
  id: string;
  title: string;
  emphasis?: string;
  items: MediaCard[];
}

export async function getRecommendationSections(userId: string): Promise<StoredSection[]> {
  await ensureFresh(userId);
  const [state, rows] = await Promise.all([
    prisma.recommendationState.findUnique({ where: { userId }, select: { sections: true } }),
    prisma.recommendationCache.findMany({
      where: { userId },
      orderBy: [{ section: "asc" }, { rank: "asc" }],
      select: { section: true, card: true },
    }),
  ]);
  const meta = (state?.sections ?? []) as unknown as StoredSectionMeta[];
  const bySection = new Map<string, MediaCard[]>();
  for (const row of rows) {
    const list = bySection.get(row.section) ?? [];
    list.push(row.card as unknown as MediaCard);
    bySection.set(row.section, list);
  }
  return meta.map((section) => ({ ...section, items: bySection.get(section.id) ?? [] })).filter((section) => section.items.length > 0);
}

/** Ordnet Titel nach persönlicher Passung, etwa für die empfohlene Watchlist-Reihenfolge. */
export async function rankForUser<T extends MediaRef>(
  userId: string,
  items: readonly (T & { card: MediaCard })[],
): Promise<(T & { card: MediaCard; score: number; reason?: string })[]> {
  const now = new Date();
  const { profile, weights } = await loadProfile(userId, now);
  const genreNames = await getGenreMap().catch(() => new Map<number, string>());
  const context: RankContext = { profile, weights, now, genreNames };

  const known = await prisma.media.findMany({
    where: {
      OR: items.map((item) => ({ type: toMediaType(item.kind) as MediaType, tmdbId: item.tmdbId })),
    },
    include: { credits: { include: { person: { select: { tmdbId: true } } }, orderBy: { position: "asc" } } },
  });
  const knownBy = new Map(known.map((media) => [refKey({ kind: toKind(media.type), tmdbId: media.tmdbId }), media]));

  return items
    .map((item) => {
      const media = knownBy.get(refKey(item));
      const features: ItemFeatures = media
        ? {
            ...featuresFromCard(item.card),
            keywordIds: media.keywordIds,
            genreIds: media.genreIds,
            castIds: media.credits.filter((credit) => credit.role === "ACTOR").map((credit) => credit.person.tmdbId),
            directorIds: media.credits
              .filter((credit) => credit.role === "DIRECTOR" || credit.role === "CREATOR")
              .map((credit) => credit.person.tmdbId),
            collectionId: media.collectionId,
            collectionName: media.collectionName,
          }
        : featuresFromCard(item.card);
      const scored = scoreCandidate({ card: item.card, features, provenance: [] }, context);
      return { ...item, score: scored.score, reason: primaryReason(scored.reasons) };
    })
    .sort((a, b) => b.score - a.score || refKey(a).localeCompare(refKey(b)));
}

export async function getTasteProfile(userId: string) {
  return loadProfile(userId);
}
