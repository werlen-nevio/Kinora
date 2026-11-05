// Stellt aus den bewerteten Kandidaten die Empfehlungsreihen zusammen. Pure Funktion:
// Eingabe sind bewertete Kandidaten und Profil, Ausgabe sind Reihen mit Begründungen.

import { featureKey } from "./profile";
import { byScore, diversify } from "./ranking";
import { itemSimilarity } from "./scoring";
import type { RecommendationSection, ScoredCandidate, TasteProfile, UserSignal } from "./types";

export const MIN_SECTION_ITEMS = 4;
const SECTION_SIZE = 18;
const MIN_SEED_RATING_FOR_BECAUSE = 7;

export interface SectionInput {
  scored: readonly ScoredCandidate[];
  profile: TasteProfile;
  genreNames: ReadonlyMap<number, string>;
  now: Date;
}

function fromSource(scored: readonly ScoredCandidate[], source: string) {
  return scored.filter((item) => item.provenance.some((entry) => entry.source === source));
}

function withReason(item: ScoredCandidate, text: string, type: ScoredCandidate["reasons"][number]["type"], strength = 2): ScoredCandidate {
  return { ...item, reasons: [{ type, text, strength }, ...item.reasons.filter((reason) => reason.text !== text)].slice(0, 2) };
}

function isStrongSeed(seed: UserSignal) {
  return seed.favorite || (seed.rating !== null && seed.rating >= MIN_SEED_RATING_FOR_BECAUSE);
}

function becauseItems(seed: UserSignal, available: readonly ScoredCandidate[]): ScoredCandidate[] {
  const key = featureKey(seed.features);
  const verb = seed.favorite ? "zu deinen Favoriten zählst" : `mit ${seed.rating}/10 bewertet hast`;
  const related = available
    .map((item) => ({
      item,
      linked: item.provenance.some((entry) => entry.seedKey === key),
      similarity: itemSimilarity(item.features, seed.features),
    }))
    .filter(({ linked, similarity }) => linked || similarity >= 0.2)
    .map(({ item, similarity }) => ({ ...item, score: item.score * (1 + similarity) }));
  return diversify(related, { limit: SECTION_SIZE, lambda: 0.85, maxPerCollection: 3 }).map((item) =>
    withReason(item, `Weil du ${seed.features.title} ${verb}.`, "similar"),
  );
}

/** Eine Filmreihe, die noch nicht begonnen wurde: pro Reihe nur der früheste Kandidat. */
function nextFranchiseItems(available: readonly ScoredCandidate[], profile: TasteProfile): ScoredCandidate[] {
  const started = new Set(profile.seeds.map((seed) => seed.features.collectionId).filter((id) => id !== null));
  const earliest = new Map<number, ScoredCandidate>();
  for (const item of available) {
    const { collectionId, year } = item.features;
    if (collectionId === null || started.has(collectionId)) continue;
    const current = earliest.get(collectionId);
    if (!current || (year ?? 9999) < (current.features.year ?? 9999)) earliest.set(collectionId, item);
  }
  return [...earliest.values()]
    .sort(byScore)
    .slice(0, SECTION_SIZE)
    .map((item) => (item.features.collectionName ? withReason(item, `Einstieg in ${item.features.collectionName}.`, "collection", 1) : item));
}

function newGenreItems(available: readonly ScoredCandidate[], profile: TasteProfile, genreNames: ReadonlyMap<number, string>): ScoredCandidate[] {
  const knownGenres = new Set([...profile.genres.entries()].filter(([, value]) => value.evidence >= 2).map(([id]) => id));
  const items = fromSource(available, "new_genres")
    .map((item) => {
      const fresh = item.features.genreIds.find((id) => !knownGenres.has(id) && genreNames.has(id));
      if (fresh === undefined) return null;
      return withReason(item, `In ${genreNames.get(fresh)} hast du bisher wenig gesehen.`, "new_genre");
    })
    .filter((item): item is ScoredCandidate => item !== null);
  return diversify(items, { limit: SECTION_SIZE, lambda: 0.65, maxGenreShare: 0.4 });
}

export function buildSections({ scored, profile, genreNames, now }: SectionInput): RecommendationSection[] {
  const pool = [...scored].sort(byScore);
  const used = new Set<string>();
  const sections: RecommendationSection[] = [];

  /**
   * Jede Reihe wählt nur aus Titeln, die noch in keiner anderen Reihe stehen. Erst
   * auszuwählen und dann Dubletten zu streichen, würde Reihen unnötig leeren.
   * Bleibt zu wenig übrig, entfällt die Reihe, statt sich zu wiederholen.
   */
  const add = (id: string, title: string, build: (available: readonly ScoredCandidate[]) => ScoredCandidate[], emphasis?: string) => {
    const items = build(pool.filter((item) => !used.has(featureKey(item.features))));
    if (items.length < MIN_SECTION_ITEMS) return;
    items.forEach((item) => used.add(featureKey(item.features)));
    sections.push({ id, title, items, ...(emphasis ? { emphasis } : {}) });
  };

  add("for_you", "Für dich empfohlen", (available) => diversify(available, { limit: 20 }));

  for (const seed of profile.seeds.filter(isStrongSeed).slice(0, 2)) {
    const { kind, tmdbId, title } = seed.features;
    add(`because:${kind}:${tmdbId}`, `Weil du ${title} magst`, (available) => becauseItems(seed, available), title);
  }

  add("favorite_actors", "Von deinen Lieblingsschauspielern", (available) =>
    diversify(
      available.filter((item) => item.provenance.some((entry) => entry.personRole === "actor")),
      { limit: SECTION_SIZE, maxPerCollection: 2 },
    ).map((item) => {
      const person = item.provenance.find((entry) => entry.personRole === "actor")?.personName;
      return person ? withReason(item, `Mit ${person} aus deinen Lieblingstiteln.`, "actor") : item;
    }),
  );

  add("hidden_gems", "Verborgene Highlights", (available) =>
    diversify(
      fromSource(available, "hidden_gems").filter((item) => (item.features.voteCount ?? 0) <= 4000),
      { limit: SECTION_SIZE, lambda: 0.7 },
    ),
  );

  add("next_franchise", "Deine nächste Filmreihe", (available) => nextFranchiseItems(available, profile));

  const favoriteSeeds = new Set(profile.seeds.filter((seed) => seed.favorite).map((seed) => featureKey(seed.features)));
  if (favoriteSeeds.size > 0) {
    add("similar_to_favorites", "Ähnlich zu deinen Favoriten", (available) =>
      diversify(
        available.filter((item) => item.provenance.some((entry) => entry.seedKey !== undefined && favoriteSeeds.has(entry.seedKey))),
        { limit: SECTION_SIZE },
      ),
    );
  }

  add("new_genres", "Entdecke neue Genres", (available) => newGenreItems(available, profile, genreNames));

  add("nostalgia", "Nostalgie", (available) =>
    diversify(
      fromSource(available, "nostalgia").filter((item) => item.features.year !== null && item.features.year <= now.getFullYear() - 20),
      { limit: SECTION_SIZE },
    ),
  );

  return sections;
}
