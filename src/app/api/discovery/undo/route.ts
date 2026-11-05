import { undoSchema } from "@/lib/discovery";
import { undoLastSwipe } from "@/server/discovery/service";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

export const POST = withUser(async ({ user, body }) => undoLastSwipe(user.id, body.sessionId), {
  schema: undoSchema,
  rateLimit: RATE_LIMITS.swipe,
});
