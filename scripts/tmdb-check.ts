// Prüft das TMDB-Token und die wichtigsten Annahmen der Anwendung gegen die echte API.
// Aufruf: npm run tmdb:check

import "dotenv/config";

const BASE = process.env.TMDB_API_BASE_URL || "https://api.themoviedb.org/3";
const TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;

interface Check {
  name: string;
  run: () => Promise<string>;
}

async function get(path: string): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const response = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} antwortete mit ${response.status}`);
  return response.json();
}

function expectThat(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const checks: Check[] = [
  {
    name: "Token gültig",
    run: async () => {
      const data = await get("/authentication");
      expectThat(data.success, "TMDB hat das Token abgelehnt.");
      return "akzeptiert";
    },
  },
  {
    name: "Filmdetails mit append_to_response",
    run: async () => {
      const movie = await get("/movie/671?language=de-DE&append_to_response=credits,videos,images,keywords,watch/providers,recommendations,similar,translations,release_dates&include_image_language=de,en,null");
      expectThat(movie.credits?.cast?.some((person: { id: number }) => person.id === 10980), "Daniel Radcliffe fehlt in der Besetzung.");
      expectThat(movie.belongs_to_collection?.id === 1241, "Die Harry-Potter-Collection fehlt.");
      return `«${movie.title}», ${movie.credits.cast.length} Personen, ${movie.images?.logos?.length ?? 0} Logos`;
    },
  },
  {
    name: "Harry-Potter-Filmreihe hat acht Filme",
    run: async () => {
      const collection = await get("/collection/1241?language=de-DE");
      expectThat(collection.parts?.length === 8, `Erwartet 8 Teile, erhalten ${collection.parts?.length}.`);
      return collection.name;
    },
  },
  {
    name: "Kuratierte Universen zeigen auf echte Einträge",
    run: async () => {
      const ids = [1241, 435259, 119, 121938, 10];
      const names = await Promise.all(ids.map(async (id) => (await get(`/collection/${id}?language=de-DE`)).name as string));
      await Promise.all([330459, 348350].map((id) => get(`/movie/${id}`)));
      return names.join(", ");
    },
  },
  {
    name: "Serie mit Staffeln über append_to_response",
    run: async () => {
      const tv = await get("/tv/1396?language=de-DE&append_to_response=aggregate_credits,season/1,season/2,content_ratings,watch/providers");
      expectThat(tv["season/1"]?.episodes?.length > 0, "Staffel 1 fehlt in der Antwort.");
      return `«${tv.name}», ${tv.number_of_episodes} Episoden`;
    },
  },
  {
    name: "Person mit Filmografie",
    run: async () => {
      const person = await get("/person/10980?language=de-DE&append_to_response=combined_credits,images,translations");
      expectThat(person.combined_credits?.cast?.length > 10, "Die Filmografie ist unerwartet kurz.");
      return `${person.name}, ${person.combined_credits.cast.length} Rollen`;
    },
  },
  {
    name: "Suche und Discover",
    run: async () => {
      const search = await get("/search/multi?query=harry%20potter&language=de-DE");
      const discover = await get("/discover/movie?with_genres=14&vote_count.gte=500&sort_by=vote_average.desc&language=de-DE");
      expectThat(search.results?.length > 0, "Die Suche lieferte nichts.");
      expectThat(discover.results?.length > 0, "Discover lieferte nichts.");
      return `${search.total_results} Treffer`;
    },
  },
  {
    name: "Trends und Anbieter in der Schweiz",
    run: async () => {
      const trending = await get("/trending/all/week?language=de-DE");
      const providers = await get("/watch/providers/movie?watch_region=CH&language=de-DE");
      expectThat(trending.results?.length > 0, "Trends sind leer.");
      return `${providers.results?.length ?? 0} Anbieter`;
    },
  },
];

async function main() {
  if (!TOKEN) {
    console.error("TMDB_READ_ACCESS_TOKEN fehlt. Trage den API Read Access Token in die .env ein: https://www.themoviedb.org/settings/api");
    process.exit(1);
  }
  let failed = 0;
  for (const check of checks) {
    try {
      console.log(`OK      ${check.name}: ${await check.run()}`);
    } catch (error) {
      failed += 1;
      console.error(`FEHLER  ${check.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(failed === 0 ? "\nAlles in Ordnung." : `\n${failed} von ${checks.length} Prüfungen fehlgeschlagen.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
