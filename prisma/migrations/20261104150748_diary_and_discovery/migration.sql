-- CreateEnum
CREATE TYPE "SwipeAction" AS ENUM ('INTERESTED', 'NOT_INTERESTED', 'WATCHED');

-- CreateEnum
CREATE TYPE "DiscoveryMode" AS ENUM ('FOR_YOU', 'SURPRISE', 'TOP_RATED', 'HIDDEN_GEMS', 'FRANCHISES');

-- CreateEnum
CREATE TYPE "DiscoverySessionState" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "DiscoveryItemStatus" AS ENUM ('PENDING', 'INTERESTED', 'NOT_INTERESTED', 'WATCHED', 'SKIPPED');

-- AlterTable
ALTER TABLE "ratings" ALTER COLUMN "value" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "discoveryFilters" JSONB,
ADD COLUMN     "discoveryMode" "DiscoveryMode" NOT NULL DEFAULT 'FOR_YOU';

-- CreateTable
CREATE TABLE "watch_diary_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "watchedAt" TIMESTAMP(3),
    "hasWatchTime" BOOLEAN NOT NULL DEFAULT false,
    "rating" DOUBLE PRECISION,
    "review" TEXT,
    "isRewatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_diary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_swipe_interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "action" "SwipeAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_swipe_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "DiscoveryMode" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "currentPosition" INTEGER NOT NULL DEFAULT 0,
    "state" "DiscoverySessionState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_session_items" (
    "sessionId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "recommendationScore" DOUBLE PRECISION NOT NULL,
    "status" "DiscoveryItemStatus" NOT NULL DEFAULT 'PENDING',
    "card" JSONB NOT NULL,
    "effect" JSONB,
    "actedAt" TIMESTAMP(3),

    CONSTRAINT "discovery_session_items_pkey" PRIMARY KEY ("sessionId","mediaId")
);

-- CreateIndex
CREATE INDEX "watch_diary_entries_userId_watchedAt_idx" ON "watch_diary_entries"("userId", "watchedAt");

-- CreateIndex
CREATE INDEX "watch_diary_entries_userId_mediaId_idx" ON "watch_diary_entries"("userId", "mediaId");

-- CreateIndex
CREATE INDEX "watch_diary_entries_userId_createdAt_idx" ON "watch_diary_entries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "media_swipe_interactions_userId_createdAt_idx" ON "media_swipe_interactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "media_swipe_interactions_userId_mediaId_createdAt_idx" ON "media_swipe_interactions"("userId", "mediaId", "createdAt");

-- CreateIndex
CREATE INDEX "media_swipe_interactions_userId_action_idx" ON "media_swipe_interactions"("userId", "action");

-- CreateIndex
CREATE INDEX "discovery_sessions_userId_state_updatedAt_idx" ON "discovery_sessions"("userId", "state", "updatedAt");

-- CreateIndex
CREATE INDEX "discovery_session_items_sessionId_status_position_idx" ON "discovery_session_items"("sessionId", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_session_items_sessionId_position_key" ON "discovery_session_items"("sessionId", "position");

-- AddForeignKey
ALTER TABLE "watch_diary_entries" ADD CONSTRAINT "watch_diary_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_diary_entries" ADD CONSTRAINT "watch_diary_entries_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_swipe_interactions" ADD CONSTRAINT "media_swipe_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_swipe_interactions" ADD CONSTRAINT "media_swipe_interactions_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_sessions" ADD CONSTRAINT "discovery_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_session_items" ADD CONSTRAINT "discovery_session_items_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "discovery_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_session_items" ADD CONSTRAINT "discovery_session_items_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "media"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Bestehende Daten übernehmen. Von Hand ergänzt, Prisma hätte watch_history gelöscht.
-- ---------------------------------------------------------------------------

-- Jeder bisherige Sehvorgang wird ein Tagebucheintrag. Der früheste pro Titel ist die
-- Erstsichtung, alle weiteren sind Wiederholungen. Ohne Datum bleibt das Datum NULL.
INSERT INTO "watch_diary_entries" ("id", "userId", "mediaId", "watchedAt", "hasWatchTime", "isRewatch", "createdAt", "updatedAt")
SELECT
  h."id",
  h."userId",
  h."mediaId",
  h."watchedAt",
  false,
  ROW_NUMBER() OVER (PARTITION BY h."userId", h."mediaId" ORDER BY h."watchedAt" ASC NULLS FIRST, h."createdAt" ASC, h."id" ASC) > 1,
  h."createdAt",
  h."createdAt"
FROM "watch_history" h;

-- Als gesehen geführte Filme ohne Sehvorgang bekommen einen Eintrag ohne Datum.
INSERT INTO "watch_diary_entries" ("id", "userId", "mediaId", "watchedAt", "hasWatchTime", "isRewatch", "createdAt", "updatedAt")
SELECT 'migrated-' || um."id", um."userId", um."mediaId", NULL, false, false, um."createdAt", um."createdAt"
FROM "user_media" um
JOIN "media" m ON m."id" = um."mediaId"
WHERE um."watched" = true
  AND m."type" = 'MOVIE'
  AND NOT EXISTS (
    SELECT 1 FROM "watch_diary_entries" e WHERE e."userId" = um."userId" AND e."mediaId" = um."mediaId"
  );

-- Die bisherige Bewertung gehört zum jüngsten Sehvorgang; die Gesamtbewertung bleibt bestehen.
UPDATE "watch_diary_entries" e
SET "rating" = r."value"
FROM "ratings" r
WHERE r."userId" = e."userId"
  AND r."mediaId" = e."mediaId"
  AND e."id" = (
    SELECT x."id" FROM "watch_diary_entries" x
    WHERE x."userId" = e."userId" AND x."mediaId" = e."mediaId"
    ORDER BY x."watchedAt" DESC NULLS LAST, x."createdAt" DESC, x."id" DESC
    LIMIT 1
  );

-- Der Sehzähler folgt den Einträgen.
UPDATE "user_media" um
SET "watchCount" = counted.total
FROM (
  SELECT e."userId", e."mediaId", COUNT(*)::int AS total
  FROM "watch_diary_entries" e
  JOIN "media" m ON m."id" = e."mediaId"
  WHERE m."type" = 'MOVIE'
  GROUP BY e."userId", e."mediaId"
) counted
WHERE um."userId" = counted."userId" AND um."mediaId" = counted."mediaId";

DROP TABLE "watch_history";

-- ---------------------------------------------------------------------------
-- Von Prisma nicht modellierbare Absicherungen
-- ---------------------------------------------------------------------------

-- Bewertungen von 1 bis 10 in halben Punkten
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_value_range";
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_value_half_steps" CHECK ("value" BETWEEN 1 AND 10 AND "value" * 2 = floor("value" * 2));
ALTER TABLE "watch_diary_entries" ADD CONSTRAINT "watch_diary_entries_rating_half_steps" CHECK ("rating" IS NULL OR ("rating" BETWEEN 1 AND 10 AND "rating" * 2 = floor("rating" * 2)));
ALTER TABLE "watch_diary_entries" ADD CONSTRAINT "watch_diary_entries_review_length" CHECK ("review" IS NULL OR char_length("review") <= 2000);

-- Eine Uhrzeit ohne Datum gibt es nicht.
ALTER TABLE "watch_diary_entries" ADD CONSTRAINT "watch_diary_entries_time_needs_date" CHECK ("hasWatchTime" = false OR "watchedAt" IS NOT NULL);

-- Pro Person höchstens eine laufende Discovery-Session
CREATE UNIQUE INDEX "discovery_sessions_one_active" ON "discovery_sessions" ("userId") WHERE "state" = 'ACTIVE';
