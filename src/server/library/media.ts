import "server-only";
import type { CreditRole, Media, MediaType } from "@/generated/prisma/client";
import { DEFAULT_LANGUAGE, DEFAULT_REGION } from "@/lib/locale";
import type { MediaDetail, MediaKind, MediaRef } from "@/lib/tmdb-types";
import { prisma } from "../db";
import { getDetail } from "../tmdb/api";
import { countAiredEpisodes } from "@/lib/series-progress";

const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const TOP_CAST = 12;
const MAX_CREW_PER_ROLE = 6;

export function toMediaType(kind: MediaKind): MediaType {
  return kind === "movie" ? "MOVIE" : "TV";
}

export function toKind(type: MediaType): MediaKind {
  return type === "MOVIE" ? "movie" : "tv";
}

interface CreditInput {
  tmdbId: number;
  name: string;
  profilePath: string | null;
  role: CreditRole;
  position: number;
}

function collectCredits(detail: MediaDetail): CreditInput[] {
  const credits: CreditInput[] = detail.cast.slice(0, TOP_CAST).map((member, position) => ({
    tmdbId: member.id,
    name: member.name,
    profilePath: member.profilePath,
    role: "ACTOR",
    position,
  }));
  const directors = detail.crew.filter((member) => member.job === "Director").slice(0, MAX_CREW_PER_ROLE);
  const writers = detail.crew
    .filter((member) => ["Screenplay", "Writer", "Story"].includes(member.job))
    .slice(0, MAX_CREW_PER_ROLE);
  directors.forEach((member, position) =>
    credits.push({ tmdbId: member.id, name: member.name, profilePath: member.profilePath, role: "DIRECTOR", position }),
  );
  writers.forEach((member, position) =>
    credits.push({ tmdbId: member.id, name: member.name, profilePath: member.profilePath, role: "WRITER", position }),
  );
  if (detail.kind === "tv") {
    detail.createdBy.slice(0, MAX_CREW_PER_ROLE).forEach((person, position) =>
      credits.push({ tmdbId: person.id, name: person.name, profilePath: person.profilePath, role: "CREATOR", position }),
    );
  }
  return credits;
}

function snapshotOf(detail: MediaDetail) {
  const shared = {
    title: detail.title,
    originalTitle: detail.originalTitle,
    posterPath: detail.posterPath,
    backdropPath: detail.backdropPath,
    voteAverage: detail.voteAverage,
    voteCount: detail.voteCount,
    popularity: detail.popularity,
    originalLanguage: detail.originalLanguage,
    genreIds: detail.genres.map((genre) => genre.id),
    keywordIds: detail.keywords.map((keyword) => keyword.id),
    fetchedAt: new Date(),
  };
  if (detail.kind === "movie") {
    return {
      ...shared,
      releaseDate: detail.releaseDate ? new Date(detail.releaseDate) : null,
      runtime: detail.runtime,
      collectionId: detail.collection?.id ?? null,
      collectionName: detail.collection?.name ?? null,
    };
  }
  return {
    ...shared,
    releaseDate: detail.firstAirDate ? new Date(detail.firstAirDate) : null,
    runtime: detail.episodeRuntime,
    tmdbStatus: detail.status,
    seasonCount: detail.numberOfSeasons,
    airedEpisodes: countAiredEpisodes(detail.seasons, detail.lastEpisode),
    totalEpisodes: detail.seasons.filter((season) => season.seasonNumber > 0).reduce((sum, season) => sum + season.episodeCount, 0),
  };
}

export async function storeSnapshot(detail: MediaDetail): Promise<Media> {
  const type = toMediaType(detail.kind);
  const snapshot = snapshotOf(detail);
  const credits = collectCredits(detail);

  return prisma.$transaction(async (tx) => {
    const media = await tx.media.upsert({
      where: { type_tmdbId: { type, tmdbId: detail.tmdbId } },
      create: { type, tmdbId: detail.tmdbId, ...snapshot },
      update: snapshot,
    });

    const uniquePeople = [...new Map(credits.map((credit) => [credit.tmdbId, credit])).values()];
    await tx.person.createMany({
      data: uniquePeople.map((person) => ({ tmdbId: person.tmdbId, name: person.name, profilePath: person.profilePath })),
      skipDuplicates: true,
    });
    // Feste Reihenfolge, damit sich parallele Snapshots beim Nachführen nicht blockieren.
    const people = await tx.person.findMany({
      where: { tmdbId: { in: uniquePeople.map((person) => person.tmdbId) } },
      select: { id: true, tmdbId: true, name: true, profilePath: true },
      orderBy: { tmdbId: "asc" },
    });
    const idByTmdb = new Map(people.map((person) => [person.tmdbId, person.id]));

    // Name und Bild stammen von TMDB und dürfen nicht veralten, auch nicht bei bekannten Personen.
    const latestByTmdb = new Map(uniquePeople.map((person) => [person.tmdbId, person]));
    for (const person of people) {
      const latest = latestByTmdb.get(person.tmdbId);
      if (latest && (latest.name !== person.name || latest.profilePath !== person.profilePath)) {
        await tx.person.update({ where: { id: person.id }, data: { name: latest.name, profilePath: latest.profilePath } });
      }
    }

    await tx.mediaPerson.deleteMany({ where: { mediaId: media.id } });
    await tx.mediaPerson.createMany({
      data: credits.flatMap((credit) => {
        const personId = idByTmdb.get(credit.tmdbId);
        return personId ? [{ mediaId: media.id, personId, role: credit.role, position: credit.position }] : [];
      }),
      skipDuplicates: true,
    });
    return media;
  });
}

/** Stellt sicher, dass ein Snapshot existiert. Bei einem TMDB-Ausfall reicht auch ein alter. */
export async function ensureMedia(ref: MediaRef): Promise<Media> {
  const existing = await prisma.media.findUnique({
    where: { type_tmdbId: { type: toMediaType(ref.kind), tmdbId: ref.tmdbId } },
  });
  if (existing && Date.now() - existing.fetchedAt.getTime() < SNAPSHOT_MAX_AGE_MS) return existing;
  try {
    return await storeSnapshot(await getDetail(ref, DEFAULT_LANGUAGE, DEFAULT_REGION));
  } catch (error) {
    if (existing) return existing;
    throw error;
  }
}
