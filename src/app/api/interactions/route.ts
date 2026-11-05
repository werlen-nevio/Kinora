import { z } from "zod";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { recordInteraction } from "@/server/library/service";

const schema = z.object({
  type: z.enum(["DETAIL_VIEW", "RECOMMENDATION_CLICK"]),
  kind: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive(),
  section: z.string().max(80).optional(),
});

export const POST = withUser(
  async ({ user, body }) => {
    await recordInteraction(
      user.id,
      body.type,
      { kind: body.kind, tmdbId: body.tmdbId },
      { kind: body.kind, tmdbId: body.tmdbId, ...(body.section ? { section: body.section } : {}) },
    );
    return { ok: true };
  },
  { schema, rateLimit: RATE_LIMITS.interactions },
);
