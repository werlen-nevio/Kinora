import "server-only";
import { type Media, Prisma } from "@/generated/prisma/client";
import { DEFAULT_LANGUAGE, DEFAULT_REGION } from "@/lib/locale";
import { prisma } from "../db";
import { storeSnapshot, toKind } from "../library/media";
import { deriveSeriesStatus } from "@/lib/series-progress";
import { recomputeRecommendations } from "../recommender/service";
import { getDetail, getTv } from "../tmdb/api";
import { TmdbError } from "../tmdb/client";
import { claimJob, completeJob, enqueueJob, failJob, releaseStuckJobs } from "./queue";

const POLL_INTERVAL_MS = 1_500;
const IDLE_MAINTENANCE_MS = 5 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const SERIES_REFRESH_BATCH = 200;
const MEDIA_REFRESH_BATCH = 200;

// TMDB erlaubt, Daten höchstens 6 Monate zu speichern. Die Grenze liegt bewusst darunter:
// Ein Abruf kann bis zu 15 Tage aus dem Cache kommen, und ein Ausfall verzögert den Job.
const TMDB_DATA_MAX_AGE_MS = 120 * DAY_MS;

/** Ein Titel, an dem nichts Persönliches hängt und den `ensureMedia` jederzeit neu anlegen kann. */
const UNREFERENCED = {
  userMedia: { none: {} },
  ratings: { none: {} },
  diaryEntries: { none: {} },
  episodeProgress: { none: {} },
  watchlist: { none: {} },
  favorites: { none: {} },
  interactions: { none: {} },
  swipes: { none: {} },
  discoveryItems: { none: {} },
} satisfies Prisma.MediaWhereInput;

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

  // Hält alles Gespeicherte von TMDB innerhalb der erlaubten Frist. Die Reihenfolge zählt:
  // Erst fallen Sessions weg, damit danach auch Titel frei werden, die nur an ihnen hingen.
  async refresh_tmdb_data() {
    const cutoff = new Date(Date.now() - TMDB_DATA_MAX_AGE_MS);

    // Karten-Snapshots lassen sich neu erzeugen und müssen deshalb nicht aufgefrischt werden.
    await prisma.discoverySession.deleteMany({ where: { createdAt: { lt: cutoff } } });
    await prisma.recommendationCache.deleteMany({ where: { computedAt: { lt: cutoff } } });
    await prisma.recommendationState.updateMany({
      where: { computedAt: { lt: cutoff }, sections: { not: Prisma.DbNull } },
      data: { sections: Prisma.DbNull },
    });

    // Eine schlanke Zeile aus dem Swipe trägt `fetchedAt` 0; ihr echtes Alter steht in `createdAt`.
    const stale = { fetchedAt: { lt: cutoff }, createdAt: { lt: cutoff } };
    await prisma.media.deleteMany({ where: { ...stale, ...UNREFERENCED } });
    await prisma.person.deleteMany({ where: { credits: { none: {} } } });

    const due = await prisma.media.findMany({ where: stale, orderBy: { fetchedAt: "asc" }, take: MEDIA_REFRESH_BATCH });
    for (const media of due) await refreshSnapshot(media);
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

/** Holt einen Titel neu. Ein Ausfall bricht den Job ab, damit er später von vorne versucht wird. */
async function refreshSnapshot(media: Media) {
  try {
    const detail = await getDetail({ kind: toKind(media.type), tmdbId: media.tmdbId }, DEFAULT_LANGUAGE, DEFAULT_REGION);
    const updated = await storeSnapshot(detail);
    if (updated.type === "TV") await reconcileSeriesStatus(updated.id, updated.airedEpisodes ?? 0);
  } catch (error) {
    if (!(error instanceof TmdbError && error.code === "not_found")) throw error;
    // TMDB kennt den Titel nicht mehr. Der Name bleibt, weil Tagebuch und Bibliothek ohne ihn
    // unlesbar würden; alles andere verschwindet. Der nächste Versuch folgt nach Ablauf der Frist.
    await prisma.media.update({
      where: { id: media.id },
      data: {
        originalTitle: null,
        posterPath: null,
        backdropPath: null,
        voteAverage: null,
        voteCount: null,
        popularity: null,
        fetchedAt: new Date(),
        credits: { deleteMany: {} },
      },
    });
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
  await enqueueJob("refresh_tmdb_data", {}, { dedupeKey: "daily:refresh_tmdb_data", runAt: nextRun });
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
