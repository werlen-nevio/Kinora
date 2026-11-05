import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export function Footer() {
  return (
    <footer className="gutter mt-24 border-t border-white/8 pb-24 pt-10 text-sm text-fog lg:pb-12">
      <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md space-y-3">
          <Logo className="text-[1.2rem]" />
          <p>Deine private Film- und Serienbibliothek. Kinora spielt keine Filme ab und bietet keine Inhalte zum Streamen an.</p>
        </div>
        <div className="max-w-md space-y-3">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="inline-block">
            <Image src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" width={64} height={46} unoptimized />
          </a>
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          <p>
            Verfügbarkeit bei Streaming-, Kauf- und Leihanbietern: Daten von{" "}
            <a href="https://www.justwatch.com" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-screen">
              JustWatch
            </a>{" "}
            über TMDB.
          </p>
        </div>
      </div>
      <p className="mt-8 text-xs text-fog-dim">
        <Link href="/profil" className="hover:text-screen">
          Deine Daten exportieren oder löschen
        </Link>
      </p>
    </footer>
  );
}
