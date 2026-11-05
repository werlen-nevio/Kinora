// Regeln für widerspruchsfreie Statusänderungen, frei von I/O.
// Der Service übernimmt den Unterschied zwischen `before` und `after` in die
// Datenbank; was hier nicht erlaubt ist, kann dort nicht entstehen.

import type { MediaKind } from "@/lib/tmdb-types";

export interface ItemFlags {
  watched: boolean;
  watchlisted: boolean;
  favorite: boolean;
  rating: number | null;
  notInterested: boolean;
}

export const EMPTY_FLAGS: ItemFlags = {
  watched: false,
  watchlisted: false,
  favorite: false,
  rating: null,
  notInterested: false,
};

export type FlagAction =
  | { type: "watchlist"; on: boolean }
  | { type: "watched"; on: boolean }
  | { type: "favorite"; on: boolean }
  | { type: "rating"; value: number | null }
  | { type: "notInterested"; on: boolean };

export function applyAction(kind: MediaKind, flags: ItemFlags, action: FlagAction): ItemFlags {
  const next: ItemFlags = { ...flags };

  // Bei Filmen setzt Bewerten oder Favorisieren das Gesehen-Sein voraus. Bei Serien
  // nicht: Dort hängt «gesehen» an den Episoden, und man bewertet oft mitten in der Serie.
  const markSeenIfMovie = () => {
    if (kind === "movie" && !next.watched) {
      next.watched = true;
      next.watchlisted = false;
    }
  };

  switch (action.type) {
    case "watchlist":
      next.watchlisted = action.on;
      if (action.on) next.notInterested = false;
      break;
    case "watched":
      if (action.on) {
        next.watched = true;
        next.watchlisted = false;
        next.notInterested = false;
      } else {
        next.watched = false;
        if (kind === "movie") {
          next.rating = null;
          next.favorite = false;
        }
      }
      break;
    case "favorite":
      next.favorite = action.on;
      if (action.on) {
        next.notInterested = false;
        markSeenIfMovie();
      }
      break;
    case "rating":
      next.rating = action.value;
      if (action.value !== null) {
        next.notInterested = false;
        markSeenIfMovie();
      }
      break;
    case "notInterested":
      next.notInterested = action.on;
      if (action.on) {
        next.watchlisted = false;
        next.favorite = false;
      }
      break;
  }
  return next;
}

/** Prüft die Invarianten; die Tests sichern damit alle Aktionsfolgen ab. */
export function violations(kind: MediaKind, flags: ItemFlags): string[] {
  const problems: string[] = [];
  if (flags.notInterested && flags.watchlisted) problems.push("notInterested+watchlisted");
  if (flags.notInterested && flags.favorite) problems.push("notInterested+favorite");
  if (kind === "movie" && flags.rating !== null && !flags.watched) problems.push("rating-without-watched");
  if (kind === "movie" && flags.favorite && !flags.watched) problems.push("favorite-without-watched");
  if (flags.rating !== null && (flags.rating < 1 || flags.rating > 10)) problems.push("rating-range");
  return problems;
}
