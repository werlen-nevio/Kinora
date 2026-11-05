import { withUser } from "@/server/http/api";
import { RATE_LIMITS } from "@/server/http/rate-limit";
import { getWatchlist } from "@/server/library/service";
import { getWatchProviders } from "@/server/tmdb/api";
import { getUserContext } from "@/server/user";
import { refKey, type WatchProvider } from "@/lib/tmdb-types";

const CONCURRENCY = 6;

/** Wird erst geladen, wenn jemand den Anbieterfilter öffnet: je Titel eine (gecachte) Anfrage. */
export const GET = withUser(async ({ user }) => {
  const [rows, { region }] = await Promise.all([getWatchlist(user.id), getUserContext(user.id)]);
  const providers = new Map<number, WatchProvider>();
  const byItem: Record<string, number[]> = {};

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, rows.length) }, async () => {
      for (;;) {
        const row = rows[cursor];
        cursor += 1;
        if (!row) return;
        const regional = (await getWatchProviders(row).catch(() => null))?.[region];
        if (!regional) continue;
        const available = [...regional.flatrate, ...regional.free, ...regional.ads, ...regional.rent, ...regional.buy];
        byItem[refKey(row)] = [...new Set(available.map((provider) => provider.id))];
        available.forEach((provider) => providers.set(provider.id, provider));
      }
    }),
  );

  return {
    region,
    providers: [...providers.values()].sort((a, b) => a.priority - b.priority),
    byItem,
  };
}, { rateLimit: RATE_LIMITS.watchlistExtras });
