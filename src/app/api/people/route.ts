import { z } from "zod";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { searchPeople } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";

export const GET = withUser(async ({ user, url }) => {
  const query = z.string().trim().min(1).max(120).parse(url.searchParams.get("q") ?? "");
  const { language } = await getUserContext(user.id);
  return { people: (await searchPeople(query, language)).slice(0, 8) };
}, { rateLimit: RATE_LIMITS.people });
