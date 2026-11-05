import { describe, expect, it } from "vitest";
import { applyAction, EMPTY_FLAGS, type FlagAction, type ItemFlags, violations } from "@/lib/library-transitions";
import type { MediaKind } from "@/lib/tmdb-types";

const ACTIONS: FlagAction[] = [
  { type: "watchlist", on: true },
  { type: "watchlist", on: false },
  { type: "watched", on: true },
  { type: "watched", on: false },
  { type: "favorite", on: true },
  { type: "favorite", on: false },
  { type: "rating", value: 9 },
  { type: "rating", value: 2 },
  { type: "rating", value: null },
  { type: "notInterested", on: true },
  { type: "notInterested", on: false },
];

describe("Statusregeln", () => {
  it("markiert einen Film als gesehen und entfernt ihn dabei von der Watchlist", () => {
    const start = applyAction("movie", EMPTY_FLAGS, { type: "watchlist", on: true });
    const seen = applyAction("movie", start, { type: "watched", on: true });
    expect(seen).toMatchObject({ watched: true, watchlisted: false });
  });

  it("erlaubt einen gesehenen Film wieder auf der Watchlist", () => {
    const seen = applyAction("movie", EMPTY_FLAGS, { type: "watched", on: true });
    expect(applyAction("movie", seen, { type: "watchlist", on: true })).toMatchObject({ watched: true, watchlisted: true });
  });

  it("setzt beim Bewerten oder Favorisieren eines Films «gesehen» voraus", () => {
    expect(applyAction("movie", EMPTY_FLAGS, { type: "rating", value: 8 }).watched).toBe(true);
    expect(applyAction("movie", EMPTY_FLAGS, { type: "favorite", on: true }).watched).toBe(true);
  });

  it("markiert Serien durch Bewerten nicht als gesehen, dort zählen die Episoden", () => {
    expect(applyAction("tv", EMPTY_FLAGS, { type: "rating", value: 8 })).toMatchObject({ rating: 8, watched: false });
    expect(applyAction("tv", EMPTY_FLAGS, { type: "favorite", on: true })).toMatchObject({ favorite: true, watched: false });
  });

  it("entfernt beim Zurücknehmen von «gesehen» Bewertung und Favorit eines Films", () => {
    const rated = applyAction("movie", applyAction("movie", EMPTY_FLAGS, { type: "rating", value: 8 }), { type: "favorite", on: true });
    expect(applyAction("movie", rated, { type: "watched", on: false })).toEqual(EMPTY_FLAGS);
  });

  it("lässt «Nicht interessiert» Watchlist und Favorit nicht bestehen", () => {
    const start: ItemFlags = { ...EMPTY_FLAGS, watched: true, watchlisted: true, favorite: true };
    expect(applyAction("movie", start, { type: "notInterested", on: true })).toMatchObject({ notInterested: true, watchlisted: false, favorite: false });
  });

  it("hebt «Nicht interessiert» auf, sobald jemand wieder Interesse zeigt", () => {
    const start = applyAction("movie", EMPTY_FLAGS, { type: "notInterested", on: true });
    const interest: FlagAction[] = [
      { type: "watchlist", on: true },
      { type: "watched", on: true },
      { type: "favorite", on: true },
      { type: "rating", value: 7 },
    ];
    for (const action of interest) expect(applyAction("movie", start, action).notInterested).toBe(false);
  });

  it.each<MediaKind>(["movie", "tv"])("erzeugt für %s in keiner Aktionsfolge einen Widerspruch", (kind) => {
    // Alle Folgen bis Länge 4 aus 11 Aktionen.
    const walk = (flags: ItemFlags, depth: number) => {
      expect(violations(kind, flags), JSON.stringify(flags)).toEqual([]);
      if (depth === 0) return;
      for (const action of ACTIONS) walk(applyAction(kind, flags, action), depth - 1);
    };
    walk(EMPTY_FLAGS, 4);
  });
});
