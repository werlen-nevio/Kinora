import { z } from "zod";
import { createDiaryEntrySchema, updateDiaryEntrySchema } from "@/lib/diary";
import { createDiaryEntry, deleteDiaryEntry, getDiary, getEntriesForMedia, updateDiaryEntry } from "@/server/diary/service";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

const refQuery = z.object({
  kind: z.enum(["movie", "tv"]),
  tmdbId: z.coerce.number().int().positive(),
});

/** Mit Titel dessen Sehvorgänge, ohne das ganze Tagebuch. */
export const GET = withUser(async ({ user, url }) => {
  if (!url.searchParams.has("kind")) return getDiary(user.id);
  const ref = refQuery.parse({ kind: url.searchParams.get("kind"), tmdbId: url.searchParams.get("tmdbId") });
  return { entries: await getEntriesForMedia(user.id, ref) };
});

export const POST = withUser(async ({ user, body }) => createDiaryEntry(user.id, body), {
  schema: createDiaryEntrySchema,
  rateLimit: RATE_LIMITS.diary,
});

export const PATCH = withUser(async ({ user, body }) => updateDiaryEntry(user.id, body), {
  schema: updateDiaryEntrySchema,
  rateLimit: RATE_LIMITS.diary,
});

export const DELETE = withUser(
  async ({ user, url }) => {
    const id = z.string().min(1).max(64).parse(url.searchParams.get("id") ?? "");
    return { item: await deleteDiaryEntry(user.id, id) };
  },
  { rateLimit: RATE_LIMITS.diary },
);
