import { describe, expect, it } from "vitest";
import { regionName } from "@/lib/locale";
import { streamingProviders, uniqueProviders } from "@/lib/tmdb-types";
import { discoverParams } from "@/server/tmdb/api";
import { normalizeCard, normalizeCollection, normalizeMovie, normalizePerson, normalizeTv } from "@/server/tmdb/normalize";

const translations = {
  translations: [
    { iso_639_1: "de", iso_3166_1: "DE", data: { title: "", overview: "", tagline: "" } },
    { iso_639_1: "en", iso_3166_1: "US", data: { title: "Spirited Away", overview: "A girl enters the spirit world.", tagline: "Go." } },
  ],
};

describe("Anbieterlisten", () => {
  const provider = (id: number, priority: number) => ({ id, name: `Anbieter ${id}`, logoPath: null, priority });
  const regional = {
    region: "CH",
    link: null,
    flatrate: [provider(8, 5)],
    free: [provider(3, 1)],
    ads: [provider(3, 1), provider(4, 9)],
    rent: [provider(2, 0)],
    buy: [provider(2, 0)],
  };

  it("zählt nur Abo, Kostenlos und Werbung als Streaming, jeden Anbieter einmal und nach Priorität", () => {
    expect(streamingProviders(regional).map((entry) => entry.id)).toEqual([3, 8, 4]);
  });

  it("liefert ohne Angaben für die Region eine leere Liste", () => {
    expect(streamingProviders(undefined)).toEqual([]);
  });

  it("führt einen Anbieter zum Leihen und Kaufen nur einmal", () => {
    expect(uniqueProviders(regional.rent, regional.buy).map((entry) => entry.id)).toEqual([2]);
  });

  it("nennt die Region passend für «für»", () => {
    expect(regionName("CH")).toBe("die Schweiz");
    expect(regionName("US")).toBe("die USA");
    expect(regionName("DE")).toBe("Deutschland");
    expect(regionName("JP")).toBe("JP");
  });
});

describe("normalizeCard", () => {
  it("vereinheitlicht Filme und Serien", () => {
    expect(normalizeCard({ id: 1, title: "A", release_date: "2001-05-02", media_type: "movie" })).toMatchObject({ kind: "movie", title: "A", year: 2001 });
    expect(normalizeCard({ id: 2, name: "B", first_air_date: "2010-01-01", media_type: "tv" })).toMatchObject({ kind: "tv", title: "B", year: 2010 });
  });

  it("verwirft Erwachsenentitel und Personen", () => {
    expect(normalizeCard({ id: 1, title: "A", media_type: "movie", adult: true })).toBeNull();
    expect(normalizeCard({ id: 1, name: "A", media_type: "person" })).toBeNull();
  });

  it("macht aus leeren Feldern null statt falscher Werte", () => {
    expect(normalizeCard({ id: 1, title: "A", poster_path: "", release_date: "", vote_average: 0, vote_count: 0 }, "movie")).toMatchObject({
      posterPath: null,
      releaseDate: null,
      year: null,
      voteAverage: null,
      voteCount: null,
    });
  });
});

describe("Sprach-Fallback", () => {
  it("füllt fehlende deutsche Texte mit Englisch auf", () => {
    const movie = normalizeMovie({ id: 129, title: "千と千尋の神隠し", original_title: "千と千尋の神隠し", overview: "", translations }, "de-DE", "CH");
    expect(movie.title).toBe("Spirited Away");
    expect(movie.overview).toBe("A girl enters the spirit world.");
    expect(movie.tagline).toBe("Go.");
    expect(movie.originalTitle).toBe("千と千尋の神隠し");
  });

  it("behält vorhandene deutsche Texte", () => {
    const movie = normalizeMovie({ id: 1, title: "Der Pate", original_title: "The Godfather", overview: "Deutscher Text", translations }, "de-DE", "CH");
    expect(movie).toMatchObject({ title: "Der Pate", overview: "Deutscher Text" });
  });

  it("erfindet nichts, wenn auch Englisch fehlt", () => {
    const movie = normalizeMovie({ id: 1, title: "X", overview: "" }, "de-DE", "CH");
    expect(movie.overview).toBe("");
    expect(movie.tagline).toBeNull();
  });
});

describe("Länder und Sprachen", () => {
  const raw = {
    id: 1,
    title: "A",
    production_countries: [{ iso_3166_1: "GB", name: "United Kingdom" }, { iso_3166_1: "XX", name: "Unbekanntes Land" }],
    spoken_languages: [{ iso_639_1: "en", english_name: "English", name: "English" }],
  };

  it("übersetzt die englischen Namen von TMDB in die gewählte Sprache", () => {
    const movie = normalizeMovie(raw, "de-DE", "CH");
    expect(movie.productionCountries[0]).toBe("Vereinigtes Königreich");
    expect(movie.spokenLanguages).toEqual(["Englisch"]);
    expect(normalizeMovie(raw, "fr-FR", "CH").spokenLanguages).toEqual(["anglais"]);
  });

  it("behält den Namen von TMDB, wenn der Code unbekannt ist", () => {
    expect(normalizeMovie(raw, "de-DE", "CH").productionCountries[1]).toBe("Unbekanntes Land");
  });
});

describe("Altersfreigabe und Region", () => {
  const release_dates = {
    results: [
      { iso_3166_1: "DE", release_dates: [{ certification: "12", release_date: "2001-11-22T00:00:00Z", type: 3 }] },
      { iso_3166_1: "CH", release_dates: [{ certification: "", release_date: "2001-11-29T00:00:00Z", type: 3 }] },
    ],
  };

  it("zeigt das regionale Datum und fällt für die Freigabe auf Nachbarländer zurück", () => {
    const movie = normalizeMovie({ id: 1, title: "A", release_dates }, "de-DE", "CH");
    expect(movie.regionalReleaseDate).toBe("2001-11-29");
    expect(movie.ageRating).toBe("DE 12");
  });

  it("zeigt keine Freigabe, wenn TMDB keine kennt", () => {
    expect(normalizeMovie({ id: 1, title: "A" }, "de-DE", "CH").ageRating).toBeNull();
  });

  it("übernimmt Serienfreigaben", () => {
    expect(normalizeTv({ id: 1, name: "A", content_ratings: { results: [{ iso_3166_1: "CH", rating: "16" }] } }, "de-DE", "CH").ageRating).toBe("CH 16");
  });
});

describe("Medien", () => {
  it("wählt das Logo nach Sprache und verwirft fremdsprachige", () => {
    const images = (logos: unknown[]) => ({ id: 1, title: "A", images: { logos } });
    const de = { file_path: "/de.png", iso_639_1: "de", vote_average: 1 };
    const en = { file_path: "/en.png", iso_639_1: "en", vote_average: 5 };
    const ja = { file_path: "/ja.png", iso_639_1: "ja", vote_average: 9 };
    expect(normalizeMovie(images([en, de]), "de-DE", "CH").logoPath).toBe("/de.png");
    expect(normalizeMovie(images([en, ja]), "de-DE", "CH").logoPath).toBe("/en.png");
    expect(normalizeMovie(images([ja]), "de-DE", "CH").logoPath).toBeNull();
  });

  it("nimmt nur YouTube-Videos, Trailer zuerst", () => {
    const movie = normalizeMovie(
      {
        id: 1,
        title: "A",
        videos: {
          results: [
            { site: "Vimeo", key: "v", type: "Trailer" },
            { site: "YouTube", key: "c", type: "Clip", official: true },
            { site: "YouTube", key: "t", type: "Trailer", official: false },
          ],
        },
      },
      "de-DE",
      "CH",
    );
    expect(movie.videos.map((video) => video.key)).toEqual(["t", "c"]);
  });

  it("gruppiert Watch-Provider nach Region und Priorität", () => {
    const movie = normalizeMovie(
      {
        id: 1,
        title: "A",
        "watch/providers": {
          results: {
            CH: {
              link: "https://x",
              flatrate: [
                { provider_id: 2, provider_name: "B", display_priority: 5 },
                { provider_id: 1, provider_name: "A", display_priority: 1 },
              ],
            },
          },
        },
      },
      "de-DE",
      "CH",
    );
    expect(movie.providersByRegion.CH?.flatrate.map((provider) => provider.id)).toEqual([1, 2]);
    expect(movie.providersByRegion.CH?.rent).toEqual([]);
    expect(movie.providersByRegion.DE).toBeUndefined();
  });
});

describe("normalizeCollection", () => {
  it("sortiert Teile chronologisch, angekündigte ohne Datum ans Ende", () => {
    const collection = normalizeCollection(
      {
        id: 1,
        name: "Reihe",
        parts: [
          { id: 3, title: "C", release_date: "2011-01-01" },
          { id: 9, title: "Z", release_date: "" },
          { id: 1, title: "A", release_date: "2001-01-01" },
          { id: 2, title: "B", release_date: "2005-01-01" },
        ],
      },
      "de-DE",
    );
    expect(collection.parts.map((part) => part.tmdbId)).toEqual([1, 2, 3, 9]);
  });
});

describe("normalizePerson", () => {
  it("führt Rollen und Crew-Aufgaben getrennt und übersetzt die Biografie", () => {
    const person = normalizePerson(
      {
        id: 1,
        name: "A",
        biography: "",
        translations: { translations: [{ iso_639_1: "en", iso_3166_1: "US", data: { biography: "Bio" } }] },
        combined_credits: {
          cast: [{ id: 1, title: "F", media_type: "movie", character: "Held", credit_id: "x" }],
          crew: [{ id: 2, name: "S", media_type: "tv", job: "Producer", credit_id: "y" }],
        },
      },
      "de-DE",
    );
    expect(person.biography).toBe("Bio");
    expect(person.credits.map((credit) => credit.creditType)).toEqual(["cast", "crew"]);
    expect(person.credits[0]?.character).toBe("Held");
  });
});

describe("discoverParams", () => {
  it("setzt filmspezifische und serienspezifische Datumsfelder", () => {
    expect(discoverParams({ kind: "movie", yearFrom: 2000, yearTo: 2010 }, "de-DE")).toMatchObject({ "primary_release_date.gte": "2000-01-01", "primary_release_date.lte": "2010-12-31" });
    expect(discoverParams({ kind: "tv", yearFrom: 2000 }, "de-DE")).toMatchObject({ "first_air_date.gte": "2000-01-01" });
  });

  it("verlangt für Anbieter eine Region", () => {
    expect(discoverParams({ kind: "movie", providers: [8, 2] }, "de-DE")).toMatchObject({ with_watch_providers: "8|2", watch_region: "CH" });
  });

  it("sendet Personenfilter nur für Filme, weil TMDB sie für Serien nicht kennt", () => {
    expect(discoverParams({ kind: "movie", cast: [1, 2], crew: [3] }, "de-DE")).toMatchObject({ with_cast: "1,2", with_crew: "3" });
    expect(discoverParams({ kind: "tv", cast: [1] }, "de-DE").with_cast).toBeUndefined();
  });

  it("verknüpft Genres je nach Modus mit UND oder ODER", () => {
    expect(discoverParams({ kind: "movie", genres: [1, 2] }, "de-DE").with_genres).toBe("1,2");
    expect(discoverParams({ kind: "movie", genres: [1, 2], genresMode: "any" }, "de-DE").with_genres).toBe("1|2");
  });
});
