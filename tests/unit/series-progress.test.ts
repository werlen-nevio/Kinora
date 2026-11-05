import { describe, expect, it } from "vitest";
import { computeProgress, countAiredEpisodes, deriveSeriesStatus, episodeKey, hasAired } from "@/lib/series-progress";

const TODAY = "2026-06-15";

function season(number: number, count: number, firstDate = "2020-01-01") {
  return Array.from({ length: count }, (_, index) => ({ seasonNumber: number, episodeNumber: index + 1, airDate: firstDate }));
}

describe("computeProgress", () => {
  it("berechnet 18 von 24 Episoden als 75 %", () => {
    const episodes = season(1, 24);
    const watched = new Set(episodes.slice(0, 18).map((episode) => episodeKey(1, episode.episodeNumber)));
    expect(computeProgress(episodes, watched, TODAY)).toMatchObject({ total: 24, aired: 24, watched: 18, percent: 75, caughtUp: false });
  });

  it("zählt nicht ausgestrahlte Folgen nicht als offen", () => {
    const episodes = [...season(1, 4), ...season(2, 2, "2030-01-01")];
    const watched = new Set(season(1, 4).map((episode) => episodeKey(1, episode.episodeNumber)));
    expect(computeProgress(episodes, watched, TODAY)).toMatchObject({ total: 6, aired: 4, watched: 4, percent: 100, caughtUp: true, next: null });
  });

  it("behandelt Folgen ohne Datum als nicht ausgestrahlt", () => {
    const episode = { seasonNumber: 1, episodeNumber: 1, airDate: null };
    expect(hasAired(episode, TODAY)).toBe(false);
    expect(computeProgress([episode], new Set(), TODAY)).toMatchObject({ aired: 0, percent: 0, caughtUp: false });
  });

  it("zählt heute laufende Folgen als ausgestrahlt", () => {
    expect(hasAired({ airDate: TODAY }, TODAY)).toBe(true);
  });

  it("schlägt die Folge nach der zuletzt gesehenen vor, auch mit Lücken davor", () => {
    const progress = computeProgress(season(1, 5), new Set([episodeKey(1, 1), episodeKey(1, 3)]), TODAY);
    expect(progress.next?.episodeNumber).toBe(4);
  });

  it("schlägt offene Lücken vor, wenn die letzte Folge schon gesehen ist", () => {
    const progress = computeProgress(season(1, 3), new Set([episodeKey(1, 3)]), TODAY);
    expect(progress.next?.episodeNumber).toBe(1);
  });

  it("schliesst Specials vom Fortschritt aus", () => {
    expect(computeProgress([...season(0, 5), ...season(1, 2)], new Set(), TODAY).aired).toBe(2);
  });

  it("zählt gesehene, nicht mehr existierende Folgen nicht mit", () => {
    expect(computeProgress(season(1, 2), new Set([episodeKey(1, 1), episodeKey(9, 9)]), TODAY).watched).toBe(1);
  });

  it("sortiert Staffeln, auch wenn sie ungeordnet ankommen", () => {
    expect(computeProgress([...season(2, 1), ...season(1, 1)], new Set(), TODAY).next).toMatchObject({ seasonNumber: 1, episodeNumber: 1 });
  });
});

describe("countAiredEpisodes", () => {
  const seasons = [
    { seasonNumber: 0, episodeCount: 3 },
    { seasonNumber: 1, episodeCount: 10 },
    { seasonNumber: 2, episodeCount: 8 },
    { seasonNumber: 3, episodeCount: 8 },
  ];

  it("zählt bis zur letzten ausgestrahlten Folge und ignoriert Specials", () => {
    expect(countAiredEpisodes(seasons, { seasonNumber: 2, episodeNumber: 3 })).toBe(13);
  });

  it("liefert 0, wenn noch nichts ausgestrahlt wurde", () => {
    expect(countAiredEpisodes(seasons, null)).toBe(0);
  });
});

describe("deriveSeriesStatus", () => {
  it("führt von nichts über angefangen und am Schauen bis abgeschlossen", () => {
    expect(deriveSeriesStatus({ watched: 0, aired: 10, previous: null, advanced: false })).toBeNull();
    expect(deriveSeriesStatus({ watched: 1, aired: 10, previous: null, advanced: true })).toBe("STARTED");
    expect(deriveSeriesStatus({ watched: 2, aired: 10, previous: "STARTED", advanced: true })).toBe("WATCHING");
    expect(deriveSeriesStatus({ watched: 10, aired: 10, previous: "WATCHING", advanced: true })).toBe("COMPLETED");
  });

  it("bleibt pausiert, bis eine weitere Folge gesehen wird", () => {
    expect(deriveSeriesStatus({ watched: 4, aired: 10, previous: "PAUSED", advanced: false })).toBe("PAUSED");
    expect(deriveSeriesStatus({ watched: 5, aired: 10, previous: "PAUSED", advanced: true })).toBe("WATCHING");
  });

  it("öffnet eine abgeschlossene Serie wieder, wenn neue Folgen erscheinen", () => {
    expect(deriveSeriesStatus({ watched: 10, aired: 12, previous: "COMPLETED", advanced: false })).toBe("WATCHING");
  });
});
