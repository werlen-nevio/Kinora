import "server-only";
import type { BrowseParams } from "@/lib/search-params";
import type { MediaCard, PagedResult } from "@/lib/tmdb-types";
import { discover, searchByKind } from "../tmdb/api";

/**
 * Freitext läuft über TMDB Search, Filter über Discover. TMDB kann beides nicht
 * kombinieren: Die Suche kennt nur das Jahr als Filter, Discover keinen Text.
 * Bei einer Suche grenzen die übrigen Filter deshalb die geladene Seite ein.
 */
export async function runBrowse(params: BrowseParams, language: string, region: string): Promise<PagedResult<MediaCard>> {
  const kind = params.typ;

  if (params.q) {
    const page = await searchByKind(kind, params.q, language, params.seite, params.von && params.von === params.bis ? params.von : undefined);
    const results = page.results.filter((card) => {
      if (params.genres.length && !params.genres.every((id) => card.genreIds.includes(id))) return false;
      if (params.von && (card.year ?? 0) < params.von) return false;
      if (params.bis && (card.year ?? 9999) > params.bis) return false;
      if (params.bewertung && (card.voteAverage ?? 0) < params.bewertung) return false;
      if (params.sprache && card.originalLanguage !== params.sprache) return false;
      return true;
    });
    return { ...page, results };
  }

  const dateSort = kind === "tv" ? params.sortierung.replace("primary_release_date", "first_air_date") : params.sortierung;
  return discover(
    {
      kind,
      page: params.seite,
      genres: params.genres,
      yearFrom: params.von,
      yearTo: params.bis,
      ratingMin: params.bewertung,
      voteCountMin: params.stimmen ?? (params.sortierung === "vote_average.desc" ? 300 : undefined),
      language: params.sprache,
      originCountry: params.land,
      runtimeMin: params.laufzeitMin,
      runtimeMax: params.laufzeitMax,
      cast: params.schauspiel,
      crew: params.regie,
      providers: params.anbieter,
      region,
      sort: dateSort,
    },
    language,
  );
}
