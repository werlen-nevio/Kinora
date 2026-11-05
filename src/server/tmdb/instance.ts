import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { TmdbClient, type CacheEntry, type CacheStore } from "./client";

const postgresStore: CacheStore = {
  async get(key) {
    const row = await prisma.tmdbCache.findUnique({ where: { key } });
    if (!row) return null;
    return { payload: row.payload, expiresAt: row.expiresAt.getTime(), staleAt: row.staleAt.getTime() };
  },
  async set(key, entry: CacheEntry) {
    const data = {
      payload: entry.payload as Prisma.InputJsonValue,
      fetchedAt: new Date(),
      expiresAt: new Date(entry.expiresAt),
      staleAt: new Date(entry.staleAt),
    };
    await prisma.tmdbCache.upsert({ where: { key }, create: { key, ...data }, update: data });
  },
};

const globalForTmdb = globalThis as unknown as { kinoraTmdb?: TmdbClient };

export const tmdb =
  globalForTmdb.kinoraTmdb ??
  new TmdbClient({
    token: env.TMDB_READ_ACCESS_TOKEN,
    baseUrl: env.TMDB_API_BASE_URL,
    store: postgresStore,
    onError: (error, context) => console.error(`[tmdb] ${context}:`, error),
  });

if (env.NODE_ENV !== "production") globalForTmdb.kinoraTmdb = tmdb;
