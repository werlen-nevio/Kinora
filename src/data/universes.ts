// Kuratierte Universen: Titel, die zusammengehören, aber bei TMDB in getrennten
// Collections liegen. Nur TMDB-IDs; alle Anzeigedaten kommen weiterhin von TMDB.
// Eine ungültige ID wird beim Laden übersprungen und zeigt nichts Erfundenes an.

export interface Universe {
  id: string;
  /** Überschrift der Reihe, mit dem passenden Artikel. */
  rowTitle: string;
  collectionIds: number[];
  movieIds: number[];
}

export const UNIVERSES: readonly Universe[] = [
  { id: "wizarding-world", rowTitle: "Mehr aus der Wizarding World", collectionIds: [1241, 435259], movieIds: [] },
  { id: "middle-earth", rowTitle: "Mehr aus Mittelerde", collectionIds: [119, 121938], movieIds: [] },
  { id: "star-wars", rowTitle: "Mehr aus dem Star-Wars-Universum", collectionIds: [10], movieIds: [330459, 348350] },
];

export function findUniverse(collectionId: number | null, movieId: number): Universe | null {
  return (
    UNIVERSES.find(
      (universe) =>
        (collectionId !== null && universe.collectionIds.includes(collectionId)) || universe.movieIds.includes(movieId),
    ) ?? null
  );
}
