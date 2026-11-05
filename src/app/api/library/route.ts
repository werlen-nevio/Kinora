import { libraryActionSchema } from "@/lib/library-types";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { getLibraryState, performLibraryAction } from "@/server/library/service";

export const GET = withUser(async ({ user }) => getLibraryState(user.id));

export const POST = withUser(
  async ({ user, body }) => ({ item: await performLibraryAction(user.id, body) }),
  { schema: libraryActionSchema, rateLimit: RATE_LIMITS.library },
);
