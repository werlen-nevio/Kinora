import { z } from "zod";
import { prisma } from "@/server/db";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { searchMulti } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

const querySchema = z.string().trim().min(1).max(120);
const MAX_HISTORY = 100;

export const GET = withUser(async ({ user, url }) => {
  const query = querySchema.parse(url.searchParams.get("q") ?? "");
  const { language } = await getUserContext(user.id);
  const results = await searchMulti(query, language);
  return {
    movies: results.media.filter((card) => card.kind === "movie").slice(0, 6),
    series: results.media.filter((card) => card.kind === "tv").slice(0, 4),
    people: results.people.slice(0, 4),
    totalResults: results.totalResults,
  };
}, { rateLimit: RATE_LIMITS.search });

/** Merkt sich einen bewusst abgeschickten Begriff, nicht jede Eingabe während des Tippens. */
export const POST = withUser(
  async ({ user, body }) => {
    const normalized = body.query.toLowerCase();
    await prisma.searchHistory.upsert({
      where: { userId_normalized: { userId: user.id, normalized } },
      create: { userId: user.id, query: body.query, normalized },
      update: { query: body.query },
    });
    const outdated = await prisma.searchHistory.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      skip: MAX_HISTORY,
      select: { id: true },
    });
    if (outdated.length > 0) await prisma.searchHistory.deleteMany({ where: { id: { in: outdated.map((row) => row.id) } } });
    return { ok: true };
  },
  { schema: z.object({ query: querySchema }), rateLimit: RATE_LIMITS.search },
);
