import { z } from "zod";
import { SUPPORTED_LANGUAGES, SUPPORTED_REGIONS } from "@/lib/locale";
import { prisma } from "@/server/db";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { markRecommendationsDirty } from "@/server/library/service";

const languages = SUPPORTED_LANGUAGES.map((entry) => entry.code) as [string, ...string[]];
const regions = SUPPORTED_REGIONS.map((entry) => entry.code) as [string, ...string[]];

const schema = z.object({
  language: z.enum(languages).optional(),
  region: z.enum(regions).optional(),
  showRecommendationWhy: z.boolean().optional(),
  genres: z
    .array(z.object({ genreId: z.number().int().positive(), weight: z.union([z.literal(1), z.literal(-1)]) }))
    .max(40)
    .optional(),
});

export const PATCH = withUser(
  async ({ user, body }) => {
    const { genres, ...preferences } = body;
    await prisma.$transaction(async (tx) => {
      await tx.userPreference.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...preferences },
        update: preferences,
      });
      if (genres) {
        await tx.userGenrePreference.deleteMany({ where: { userId: user.id } });
        await tx.userGenrePreference.createMany({
          data: genres.map((genre) => ({ userId: user.id, genreId: genre.genreId, weight: genre.weight })),
        });
      }
    });
    if (genres) await markRecommendationsDirty(user.id);
    return { ok: true };
  },
  { schema, rateLimit: RATE_LIMITS.preferences },
);
