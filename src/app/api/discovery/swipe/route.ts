import { swipeSchema } from "@/lib/discovery";
import { applySwipe } from "@/server/discovery/service";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

export const POST = withUser(async ({ user, body }) => applySwipe(user.id, body), {
  schema: swipeSchema,
  rateLimit: RATE_LIMITS.swipe,
});
