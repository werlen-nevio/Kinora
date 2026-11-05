import { startSessionSchema } from "@/lib/discovery";
import { DiscoveryEmptyError, getDiscoveryState, startDiscoverySession } from "@/server/discovery/service";
import { apiError, withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

export const GET = withUser(async ({ user }) => getDiscoveryState(user.id));

export const POST = withUser(
  async ({ user, body }) => {
    try {
      return { session: await startDiscoverySession(user.id, body.mode, body.filters) };
    } catch (error) {
      if (error instanceof DiscoveryEmptyError) return apiError(422, "discovery_empty", error.message);
      throw error;
    }
  },
  { schema: startSessionSchema, rateLimit: RATE_LIMITS.discoverySession },
);
