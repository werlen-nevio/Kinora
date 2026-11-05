import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { TmdbImage } from "@/components/media/tmdb-image";
import { getSession } from "@/server/auth/session";
import { getTrending } from "@/server/tmdb/api";

async function loadPosters() {
  try {
    const page = await getTrending("all", "week");
    return page.results.filter((card) => card.posterPath).slice(0, 20);
  } catch {
    // Ohne TMDB bleibt die Anmeldung trotzdem benutzbar, nur ohne Plakatwand.
    return [];
  }
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session) redirect("/");
  const posters = await loadPosters();

  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[minmax(26rem,34rem)_1fr]">
      <div className="relative z-10 flex flex-col justify-between gap-10 bg-ink px-6 py-8 sm:px-12">
        <Link href="/anmelden" aria-label="Kinora">
          <Logo />
        </Link>
        <main className="w-full max-w-sm">{children}</main>
        <p className="text-xs text-fog-dim">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
      <div aria-hidden="true" className="relative hidden overflow-hidden lg:block">
        <div className="absolute -inset-x-8 -inset-y-16 grid rotate-[-4deg] grid-cols-5 gap-3 opacity-70">
          {posters.map((card) => (
            <div key={`${card.kind}:${card.tmdbId}`} className="relative aspect-[2/3] overflow-hidden rounded-lg bg-ink-raised">
              {card.posterPath ? <TmdbImage path={card.posterPath} kind="poster" alt="" sizes="20vw" /> : null}
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/50 to-ink/20" />
        <div className="ambient-light absolute inset-0 opacity-60" />
      </div>
    </div>
  );
}
