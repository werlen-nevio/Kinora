import { parseBrowseParams } from "@/lib/search-params";
import { runBrowse } from "@/server/detail/browse";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { getUserContext } from "@/server/user";

export const GET = withUser(async ({ user, url }) => {
  const params = parseBrowseParams(Object.fromEntries(url.searchParams));
  const { language, region } = await getUserContext(user.id);
  return runBrowse(params, language, region);
}, { rateLimit: RATE_LIMITS.browse });
