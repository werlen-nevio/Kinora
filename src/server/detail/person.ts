import "server-only";
import type { PersonCredit, PersonDetail } from "@/lib/tmdb-types";
import { getDetail, getPerson } from "../tmdb/api";

export interface RelatedPerson {
  id: number;
  name: string;
  profilePath: string | null;
  sharedTitles: string[];
}

const MAX_PRODUCTIONS = 14;
const MAX_PEOPLE = 14;

/** Die bekanntesten Produktionen einer Person, ohne Gastauftritte in Talkshows. */
function topProductions(credits: readonly PersonCredit[]): PersonCredit[] {
  const seen = new Set<string>();
  return credits
    .filter((credit) => credit.creditType === "cast" && (credit.kind === "movie" || (credit.episodeCount ?? 0) >= 4))
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .filter((credit) => {
      const key = `${credit.kind}:${credit.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_PRODUCTIONS);
}

/**
 * Andere Personen aus gemeinsamen Produktionen. Die Seite nennt nur diese belegbaren
 * Titel; über persönliche Beziehungen sagt das nichts aus und behauptet nichts.
 */
export async function getRelatedPeople(person: PersonDetail, language?: string): Promise<RelatedPerson[]> {
  const productions = topProductions(person.credits);
  const details = await Promise.allSettled(productions.map((credit) => getDetail({ kind: credit.kind, tmdbId: credit.tmdbId }, language)));

  const shared = new Map<number, RelatedPerson>();
  details.forEach((result) => {
    if (result.status !== "fulfilled") return;
    const { title, cast } = result.value;
    for (const member of cast.slice(0, 12)) {
      if (member.id === person.id) continue;
      const entry = shared.get(member.id) ?? { id: member.id, name: member.name, profilePath: member.profilePath, sharedTitles: [] };
      if (!entry.sharedTitles.includes(title)) entry.sharedTitles.push(title);
      shared.set(member.id, entry);
    }
  });

  return [...shared.values()]
    .filter((entry) => entry.sharedTitles.length >= 2 || shared.size <= MAX_PEOPLE)
    .sort((a, b) => b.sharedTitles.length - a.sharedTitles.length || a.name.localeCompare(b.name, "de"))
    .slice(0, MAX_PEOPLE);
}

export { getPerson };
