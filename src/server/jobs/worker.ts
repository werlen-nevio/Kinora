import "server-only";
import { prisma } from "../db";
import { storeSnapshot } from "../library/media";
import { deriveSeriesStatus } from "@/lib/series-progress";
import { recomputeRecommendations } from "../recommender/service";
import { getTv } from "../tmdb/api";
import { claimJob, completeJob, enqueueJob, failJob, releaseStuckJobs } from "./queue";

const POLL_INTERVAL_MS = 1_500;
const IDLE_MAINTENANCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const SERIES_REFRESH_BATCH = 200;

type Handler = (payload: Record<string, unknown>) => Promise<void>;

const handlers: Record<string, Handler> = {
  async recompute_recommendations(payload) {
    const userId = payload.userId;
    if (typeof userId !== "string") throw new Error("userId fehlt");
    await recomputeRecommendations(userId);
  },

  // Neue Folgen können eine abgeschlossene Serie wieder öffnen. Deshalb werden
  // Snapshot und Status aller Serien in Bibliotheken täglich abgeglichen.
  async refresh_series() {
    const series = await prisma.media.findMany({
      where: { type: "TV", userMedia: { some: { episodesWatched: { gt: 0 } } } },
      orderBy: { fetchedAt: "asc" },
      take: SERIES_REFRESH_BATCH,
    });
    for (const media of series) {
      const detail = await getTv(media.tmdbId);
      const updated = await storeSnapshot(detail);
      await reconcileSeriesStatus(updated.id, updated.airedEpisodes ?? 0);
    }
  },

  async cleanup() {
    const now = new Date();
    await prisma.tmdbCache.deleteMany({ where: { staleAt: { lt: now } } });
    await prisma.job.deleteMany({
      where: { status: { in: ["DONE", "FAILED"] }, updatedAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } },
    });
    await prisma.userInteraction.deleteMany({
      where: { type: { in: ["DETAIL_VIEW", "RECOMMENDATION_CLICK"] }, createdAt: { lt: new Date(now.getTime() - 365 * DAY_MS) } },
    });
    await prisma.rateLimit.deleteMany({ where: { lastRequest: { lt: BigInt(now.getTime() - DAY_MS) } } });
  },
};

async function reconcileSeriesStatus(mediaId: string, aired: number) {
  const rows = await prisma.userMedia.findMany({ where: { mediaId, episodesWatched: { gt: 0 } } });
  for (const row of rows) {
    const status = deriveSeriesStatus({ watched: row.episodesWatched, aired, previous: row.seriesStatus, advanced: false });
    if (status !== row.seriesStatus) {
      await prisma.userMedia.update({
        where: { id: row.id },
        data: { seriesStatus: status, watched: status === "COMPLETED", watchCount: status === "COMPLETED" ? 1 : 0 },
      });
    }
  }
}

export async function runNextJob(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new Error(`Unbekannter Job-Typ: ${job.type}`);
    await handler(job.payload as Record<string, unknown>);
    await completeJob(job.id);
  } catch (error) {
    console.error(`[jobs] ${job.type} fehlgeschlagen (Versuch ${job.attempts}):`, error);
    await failJob(job, error);
  }
  return true;
}

async function scheduleMaintenance() {
  await releaseStuckJobs();
  const nextRun = new Date(Date.now() + DAY_MS);
  await enqueueJob("refresh_series", {}, { dedupeKey: "daily:refresh_series", runAt: nextRun });
  await enqueueJob("cleanup", {}, { dedupeKey: "daily:cleanup", runAt: nextRun });
}

const state = globalThis as unknown as { kinoraWorkerStarted?: boolean };

export function startWorker() {
  if (state.kinoraWorkerStarted) return;
  state.kinoraWorkerStarted = true;

  let lastMaintenance = 0;
  const tick = async () => {
    try {
      if (Date.now() - lastMaintenance > IDLE_MAINTENANCE_MS) {
        lastMaintenance = Date.now();
        await scheduleMaintenance();
      }
      // Alle fälligen Jobs abarbeiten, bevor wieder gewartet wird.
      while (await runNextJob()) {
        // Weiter mit dem nächsten Job.
      }
    } catch (error) {
      console.error("[jobs] Worker-Durchlauf fehlgeschlagen:", error);
    } finally {
      setTimeout(() => void tick(), POLL_INTERVAL_MS).unref();
    }
  };
  void tick();
  console.log("[jobs] Worker gestartet");
}
