import { getRejectedTitles, resetRejectedTitles } from "@/server/discovery/service";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

export const GET = withUser(async ({ user }) => ({ titles: await getRejectedTitles(user.id) }));

/** Nimmt alle Ablehnungen zurück. Einzelne Titel laufen über die normale Bibliotheksaktion. */
export const DELETE = withUser(async ({ user }) => ({ reset: await resetRejectedTitles(user.id) }), {
  rateLimit: RATE_LIMITS.preferences,
});
