import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Job } from "@/generated/prisma/client";
import { prisma } from "../db";

const STUCK_AFTER_MS = 10 * 60 * 1000;

export interface EnqueueOptions {
  dedupeKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

/** Legt einen Job an. Existiert zum selben `dedupeKey` schon ein offener, passiert nichts. */
export async function enqueueJob(type: string, payload: Prisma.InputJsonObject = {}, options: EnqueueOptions = {}) {
  await prisma.$executeRaw`
    INSERT INTO "jobs" ("id", "type", "payload", "dedupeKey", "runAt", "maxAttempts", "updatedAt")
    VALUES (
      ${crypto.randomUUID()},
      ${type},
      ${JSON.stringify(payload)}::jsonb,
      ${options.dedupeKey ?? null},
      ${options.runAt ?? new Date()},
      ${options.maxAttempts ?? 5},
      now()
    )
    ON CONFLICT ("dedupeKey") WHERE "status" = 'PENDING' AND "dedupeKey" IS NOT NULL DO NOTHING
  `;
}

/** Holt genau einen fälligen Job. `SKIP LOCKED` erlaubt mehrere Worker nebeneinander. */
export async function claimJob(): Promise<Job | null> {
  const rows = await prisma.$queryRaw<Job[]>`
    UPDATE "jobs"
    SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1, "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "jobs"
      WHERE "status" = 'PENDING' AND "runAt" <= now()
      ORDER BY "runAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function completeJob(id: string) {
  await prisma.job.update({ where: { id }, data: { status: "DONE", lockedAt: null, lastError: null } });
}

export async function failJob(job: Pick<Job, "id" | "attempts" | "maxAttempts">, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      lockedAt: null,
      lastError: message.slice(0, 2000),
      runAt: new Date(Date.now() + 30_000 * 2 ** job.attempts),
    },
  });
}

/** Ein abgestürzter Worker darf Jobs nicht für immer blockieren. */
export async function releaseStuckJobs() {
  await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STUCK_AFTER_MS) } },
    data: { status: "PENDING", lockedAt: null },
  });
}
