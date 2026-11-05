// Reihen unter einer Detailseite. Titel erscheinen nur einmal, und die Reihenfolge
// richtet sich nach Passung zum Nutzer und Vollständigkeit, nicht nach festem Schema.

import type { MediaCard } from "@/lib/tmdb-types";
import { refKey } from "@/lib/tmdb-types";

export interface RelatedRow {
  id: string;
  title: string;
  items: MediaCard[];
  /** Vorrang bei doppelten Titeln und Grundgewicht der Reihe. */
  priority: number;
}

const MIN_ROW_ITEMS = 3;
const MAX_ROW_ITEMS = 20;

export interface ArrangeOptions {
  exclude: ReadonlySet<string>;
  /** Persönliche Passung eines Genres, -1 bis +1. Leer bei neuen Nutzern. */
  genreAffinity?: ReadonlyMap<number, number>;
}

export function rowRelevance(items: readonly MediaCard[], priority: number, genreAffinity?: ReadonlyMap<number, number>): number {
  const sample = items.slice(0, 10);
  if (sample.length === 0) return 0;
  const taste = genreAffinity?.size
    ? sample.reduce((sum, card) => {
        const values = card.genreIds.map((id) => genreAffinity.get(id) ?? 0);
        return sum + (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
      }, 0) / sample.length
    : 0;
  const fullness = Math.min(1, sample.length / 10);
  return priority + taste * 0.6 + fullness * 0.2;
}

/** Entfernt Dubletten nach Priorität, verwirft zu kurze Reihen und sortiert den Rest. */
export function arrangeRelatedRows(rows: readonly RelatedRow[], { exclude, genreAffinity }: ArrangeOptions): RelatedRow[] {
  const used = new Set(exclude);
  const deduped: RelatedRow[] = [];
  for (const row of [...rows].sort((a, b) => b.priority - a.priority)) {
    const items: MediaCard[] = [];
    const inRow = new Set<string>();
    for (const card of row.items) {
      const key = refKey(card);
      // Auch innerhalb der Reihe: Wer zwei Aufgaben an einem Titel hatte, liefert ihn doppelt.
      if (used.has(key) || inRow.has(key) || !card.posterPath) continue;
      inRow.add(key);
      items.push(card);
      if (items.length >= MAX_ROW_ITEMS) break;
    }
    if (items.length < MIN_ROW_ITEMS) continue;
    inRow.forEach((key) => used.add(key));
    deduped.push({ ...row, items });
  }
  return deduped.sort(
    (a, b) => rowRelevance(b.items, b.priority, genreAffinity) - rowRelevance(a.items, a.priority, genreAffinity),
  );
}
