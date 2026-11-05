import { exportUserData } from "@/server/account/service";
import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";

export const GET = withUser(async ({ user }) => {
  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kinora-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}, { rateLimit: RATE_LIMITS.export });
