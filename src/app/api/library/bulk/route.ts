import { bulkActionSchema } from "@/lib/library-types";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { getLibraryState, performBulkAction } from "@/server/library/service";

export const POST = withUser(
  async ({ user, body }) => {
    const results = await performBulkAction(user.id, body);
    return { results, state: await getLibraryState(user.id) };
  },
  { schema: bulkActionSchema, rateLimit: RATE_LIMITS.bulk },
);
