import type { Metadata } from "next";
import Link from "next/link";
import { Backfill } from "@/components/diary/backfill";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Filme nachtragen" };

export default async function BackfillPage() {
  await requireUser();
  return (
    <div className="gutter relative pb-8 pt-24 lg:pt-28">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-60" />
      <p className="text-sm text-fog">
        <Link href="/tagebuch" className="hover:text-screen hover:underline">
          Tagebuch
        </Link>
      </p>
      <h1 className="font-display mt-2 text-title-lg font-medium leading-[1.05]">Filme nachtragen</h1>
      <p className="mt-3 max-w-xl text-fog">Ein Klick aufs Plakat, und der Film gilt als gesehen, ganz ohne Datum. Bewertung und Datum kannst du direkt darunter ergänzen oder einfach weglassen.</p>
      <Backfill />
    </div>
  );
}
