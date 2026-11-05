import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FranchiseSection } from "@/components/detail/franchise";
import { ExpandableText } from "@/components/detail/sections";
import { AmbientSync } from "@/components/media/ambient";
import { ambientStyle } from "@/lib/ambient-color";
import { TmdbImage } from "@/components/media/tmdb-image";
import { todayIso } from "@/lib/series-progress";
import { getAmbient } from "@/server/ambient";
import { getSession, requireUser } from "@/server/auth/session";
import { getCollection } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";
import { getUserContext } from "@/server/user";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function load(id: number, language?: string) {
  try {
    return await getCollection(id, language);
  } catch (error) {
    if (error instanceof TmdbError && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // Der Proxy sieht nur, ob ein Cookie existiert. Ohne echte Session gibt es keinen TMDB-Abruf.
  if (!(await getSession())) return {};
  const collection = await getCollection(Number((await params).id)).catch(() => null);
  return collection ? { title: collection.name } : {};
}

export default async function CollectionPage({ params }: PageProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const user = await requireUser();
  const { language } = await getUserContext(user.id);
  const collection = await load(id, language);
  const ambient = await getAmbient(collection.backdropPath);

  return (
    <div style={ambientStyle(ambient)}>
      <AmbientSync ambient={ambient} />
      <section className="relative isolate">
        <div className="absolute inset-x-0 top-0 -z-10 h-[60vh] overflow-hidden">
          {collection.backdropPath ? <TmdbImage path={collection.backdropPath} kind="backdrop" alt="" sizes="100vw" preload className="object-[center_25%]" /> : null}
          <div className="scrim-hero absolute inset-0" />
        </div>
        <div className="gutter space-y-4 pt-[34vh]">
          <h1 className="font-display text-title-lg font-medium leading-[1.05] text-balance">{collection.name}</h1>
          {collection.overview ? <ExpandableText text={collection.overview} /> : null}
        </div>
      </section>
      <div className="mt-12">
        <FranchiseSection id={collection.id} name="Alle Teile" parts={collection.parts} today={todayIso()} />
      </div>
    </div>
  );
}
