// Begründungen. Jede Aussage muss sich auf ein vorhandenes Nutzersignal stützen:
// Gibt es keins, gibt es auch keine Begründung.

import { topAffinities } from "./profile";
import type { RankContext } from "./ranking";
import { similarityScore } from "./scoring";
import type { Reason, ScoredCandidate, TasteProfile, UserSignal } from "./types";

const MIN_SIMILARITY_FOR_REASON = 0.12;
const MIN_GENRE_AFFINITY = 0.12;
const MIN_GENRE_EVIDENCE = 2;
const MIN_PERSON_AFFINITY = 0.2;
const MIN_PERSON_EVIDENCE = 2;

export function joinTitles(titles: readonly string[]): string {
  if (titles.length <= 1) return titles[0] ?? "";
  return `${titles.slice(0, -1).join(", ")} und ${titles[titles.length - 1]}`;
}

function verbFor(seeds: readonly UserSignal[]): string {
  const [only] = seeds;
  if (seeds.length === 1 && only?.rating != null && only.rating >= 7) return `mit ${only.rating}/10 bewertet hast`;
  if (seeds.every((seed) => seed.rating !== null && seed.rating >= 7)) return "hoch bewertet hast";
  if (seeds.every((seed) => seed.favorite)) return "zu deinen Favoriten zählst";
  if (seeds.every((seed) => seed.watchlisted)) return "auf deiner Watchlist hast";
  return "magst";
}

function similarReason(candidate: ScoredCandidate, profile: TasteProfile): Reason | null {
  const matches = similarityScore(candidate.features, profile.seeds).matches.filter(
    (match) => match.similarity >= MIN_SIMILARITY_FOR_REASON && match.seed.weight >= 0.2,
  );

  // Hat TMDB den Titel direkt zu einem Seed empfohlen, belegt auch das die Nähe.
  const recommendedBy = candidate.provenance
    .filter((entry) => entry.source === "tmdb_recommendations" && entry.seedKey)
    .map((entry) => profile.seeds.find((seed) => `${seed.features.kind}:${seed.features.tmdbId}` === entry.seedKey))
    .filter((seed): seed is UserSignal => seed !== undefined && seed.weight >= 0.2);

  const seeds = [...new Map([...matches.map((match) => match.seed), ...recommendedBy].map((seed) => [seed.features.tmdbId, seed])).values()].slice(0, 2);
  if (seeds.length === 0) return null;
  return {
    type: "similar",
    text: `Weil du ${joinTitles(seeds.map((seed) => seed.features.title))} ${verbFor(seeds)}.`,
    strength: candidate.breakdown.similarity + candidate.breakdown.tmdb,
  };
}

function genreReason(candidate: ScoredCandidate, context: RankContext): Reason | null {
  const liked = candidate.features.genreIds
    .map((id) => ({ id, affinity: context.profile.genres.get(id), name: context.genreNames.get(id) }))
    .filter(
      (entry) =>
        entry.name !== undefined &&
        entry.affinity !== undefined &&
        entry.affinity.score >= MIN_GENRE_AFFINITY &&
        entry.affinity.evidence >= MIN_GENRE_EVIDENCE,
    )
    .sort((a, b) => (b.affinity?.score ?? 0) - (a.affinity?.score ?? 0))
    .slice(0, 2);
  if (liked.length === 0) return null;
  const names = liked.map((entry) => entry.name as string);
  const text = names.length === 2 ? `Passt zu deinen Lieblingsgenres ${names[0]} und ${names[1]}.` : `Passt zu deinem Lieblingsgenre ${names[0]}.`;
  return { type: "genre", text, strength: candidate.breakdown.genre * 0.6 };
}

function personReason(candidate: ScoredCandidate, profile: TasteProfile): Reason | null {
  const provenanceNames = new Map(
    candidate.provenance.filter((entry) => entry.personId !== undefined && entry.personName).map((entry) => [entry.personId as number, entry]),
  );

  const directors = candidate.features.directorIds
    .map((id) => ({ id, affinity: profile.directors.get(id) }))
    .filter((entry) => (entry.affinity?.score ?? 0) >= MIN_PERSON_AFFINITY && (entry.affinity?.evidence ?? 0) >= MIN_PERSON_EVIDENCE);
  const namedDirector = directors.find((entry) => provenanceNames.has(entry.id));
  if (namedDirector) {
    const name = provenanceNames.get(namedDirector.id)?.personName;
    return { type: "director", text: `Regie: ${name}. Du magst mehrere dieser Filme.`, strength: candidate.breakdown.crew };
  }

  const actors = candidate.features.castIds
    .slice(0, 10)
    .map((id) => ({ id, affinity: profile.actors.get(id) }))
    .filter((entry) => (entry.affinity?.score ?? 0) >= MIN_PERSON_AFFINITY && (entry.affinity?.evidence ?? 0) >= MIN_PERSON_EVIDENCE);
  const namedActor = actors.find((entry) => provenanceNames.has(entry.id));
  if (namedActor) {
    const name = provenanceNames.get(namedActor.id)?.personName;
    return { type: "actor", text: `Mit ${name} aus deinen Lieblingstiteln.`, strength: candidate.breakdown.actors };
  }
  if (actors.length > 0) {
    return { type: "actor", text: "Mit jemandem aus deinen Lieblingstiteln.", strength: candidate.breakdown.actors * 0.8 };
  }
  return null;
}

function collectionReason(candidate: ScoredCandidate, profile: TasteProfile): Reason | null {
  const { collectionId, collectionName } = candidate.features;
  if (collectionId === null || !collectionName) return null;
  const started = profile.seeds.some((seed) => seed.features.collectionId === collectionId);
  if (!started) return null;
  return { type: "collection", text: `Aus einer Reihe, die du begonnen hast: ${collectionName}.`, strength: 1 };
}

export function buildReasons(candidate: ScoredCandidate, context: RankContext): Reason[] {
  const { profile } = context;
  if (profile.signalCount === 0) return [];
  return [collectionReason(candidate, profile), similarReason(candidate, profile), personReason(candidate, profile), genreReason(candidate, context)]
    .filter((reason): reason is Reason => reason !== null)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 2);
}

export function primaryReason(reasons: readonly Reason[]): string | undefined {
  return reasons[0]?.text;
}

/** Die Lieblingsgenres in Klartext, für Profil und Statistik. */
export function describeTaste(profile: TasteProfile, genreNames: ReadonlyMap<number, string>): string | null {
  const top = topAffinities(profile.genres, 3, MIN_GENRE_EVIDENCE, MIN_GENRE_AFFINITY)
    .map((entry) => genreNames.get(entry.id))
    .filter((name): name is string => name !== undefined);
  if (top.length === 0) return null;
  const decades = topAffinities(profile.decades, 1, 2, MIN_GENRE_AFFINITY);
  const decade = decades[0] ? `, vor allem aus den ${decades[0].id}ern` : "";
  return `Du schaust am liebsten ${joinTitles(top)}${decade}.`;
}
