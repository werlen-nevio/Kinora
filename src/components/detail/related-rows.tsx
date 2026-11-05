import { findUniverse } from "@/data/universes";
import { MediaRow } from "@/components/media/media-row";
import { type MediaCard, type MovieDetail, type TvDetail, refKey } from "@/lib/tmdb-types";
import { arrangeRelatedRows, type RelatedRow } from "@/server/detail/related";
import { getLibraryState } from "@/server/library/service";
import { rankForUser } from "@/server/recommender/service";
import { bayesianRating } from "@/server/recommender/scoring";
import { loadProfile } from "@/server/recommender/signals";
import { discover, getCollection, getPerson } from "@/server/tmdb/api";

function creditScore(card: MediaCard) {
  return bayesianRating(card.voteAverage, card.voteCount) + Math.log1p(card.popularity ?? 0) * 0.05;
}

function toCard(credit: MediaCard): MediaCard {
  return { ...credit };
}

async function personRow(id: string, title: string, priority: number, personId: number, language: string, filter: (credit: { creditType: string; job: string | null }) => boolean, kind: "movie" | "tv"): Promise<RelatedRow | null> {
  const person = await getPerson(personId, language).catch(() => null);
  if (!person) return null;
  const items = person.credits
    .filter((credit) => credit.kind === kind && filter(credit) && (credit.voteCount ?? 0) >= 30)
    .sort((a, b) => creditScore(b) - creditScore(a))
    .map(toCard);
  return { id, title, priority, items };
}

async function collectionParts(ids: readonly number[], language: string) {
  const collections = await Promise.allSettled(ids.map((id) => getCollection(id, language)));
  return collections.flatMap((result) => (result.status === "fulfilled" ? result.value.parts : []));
}

async function personalize(userId: string, cards: readonly MediaCard[]): Promise<MediaCard[]> {
  if (cards.length === 0) return [];
  const ranked = await rankForUser(userId, cards.map((card) => ({ kind: card.kind, tmdbId: card.tmdbId, card })));
  return ranked.map((entry) => ({ ...entry.card, reason: entry.reason }));
}

async function renderRows(userId: string, rows: (RelatedRow | null)[], exclude: Set<string>, showWhy: boolean) {
  const [library, { profile }] = await Promise.all([getLibraryState(userId), loadProfile(userId)]);
  // Gesehenes und Abgelehntes wird nicht noch einmal angeboten.
  for (const [key, item] of Object.entries(library)) {
    if (item.watched || item.notInterested) exclude.add(key);
  }
  const genreAffinity = new Map([...profile.genres.entries()].map(([id, value]) => [id, value.score]));
  const arranged = arrangeRelatedRows(rows.filter((row): row is RelatedRow => row !== null), { exclude, genreAffinity });
  return (
    <div className="space-y-10">
      {arranged.map((row) => (
        <MediaRow key={row.id} title={row.title} items={row.items} showWhy={showWhy && row.id === "recommendations"} />
      ))}
    </div>
  );
}

export async function RelatedMovieRows({ userId, movie, language, showWhy }: { userId: string; movie: MovieDetail; language: string; showWhy: boolean }) {
  const exclude = new Set<string>([refKey({ kind: "movie", tmdbId: movie.tmdbId })]);
  const ownParts = movie.collection ? await collectionParts([movie.collection.id], language) : [];
  ownParts.forEach((part) => exclude.add(refKey(part)));

  const primaryGenre = movie.genres[0];
  const director = movie.crew.find((member) => member.job === "Director");
  const leads = movie.cast.slice(0, 2);
  const universe = findUniverse(movie.collection?.id ?? null, movie.tmdbId);

  const [related, leadRows, directorRow, genreRow, universeParts] = await Promise.all([
    personalize(userId, movie.recommendations),
    Promise.all(
      leads.map((lead, index) =>
        personRow(`actor-${lead.id}`, `Mit ${lead.name}`, 3.5 - index * 0.2, lead.id, language, (credit) => credit.creditType === "cast", "movie"),
      ),
    ),
    director
      ? personRow(`director-${director.id}`, `Von ${director.name}`, 4, director.id, language, (credit) => credit.job === "Director", "movie")
      : null,
    primaryGenre
      ? discover({ kind: "movie", genres: movie.genres.slice(0, 2).map((genre) => genre.id), voteCountMin: 500, sort: "vote_average.desc" }, language)
          .then((page): RelatedRow => ({ id: "genre", title: `Mehr ${primaryGenre.name}`, priority: 3, items: page.results }))
          .catch(() => null)
      : null,
    universe
      ? collectionParts(universe.collectionIds.filter((id) => id !== movie.collection?.id), language)
      : Promise.resolve([]),
  ]);

  const rows: (RelatedRow | null)[] = [
    universe && universeParts.length ? { id: "universe", title: universe.rowTitle, priority: 6, items: universeParts } : null,
    { id: "similar", title: "Ähnliche Filme", priority: 5, items: movie.similar },
    { id: "recommendations", title: "Weitere Empfehlungen", priority: 4.5, items: related },
    directorRow,
    ...leadRows,
    genreRow,
  ];
  return renderRows(userId, rows, exclude, showWhy);
}

export async function RelatedSeriesRows({ userId, series, language, showWhy }: { userId: string; series: TvDetail; language: string; showWhy: boolean }) {
  const exclude = new Set<string>([refKey({ kind: "tv", tmdbId: series.tmdbId })]);
  const primaryGenre = series.genres[0];
  const creator = series.createdBy[0];
  const lead = series.cast[0];

  const [related, creatorRow, leadRow, genreRow] = await Promise.all([
    personalize(userId, series.recommendations),
    creator ? personRow(`creator-${creator.id}`, `Von ${creator.name}`, 4, creator.id, language, (credit) => credit.creditType === "crew", "tv") : null,
    lead ? personRow(`actor-${lead.id}`, `Mit ${lead.name}`, 3.5, lead.id, language, (credit) => credit.creditType === "cast", "tv") : null,
    primaryGenre
      ? discover({ kind: "tv", genres: [primaryGenre.id], voteCountMin: 300, sort: "vote_average.desc" }, language)
          .then((page): RelatedRow => ({ id: "genre", title: `Mehr ${primaryGenre.name}`, priority: 3, items: page.results }))
          .catch(() => null)
      : null,
  ]);

  const rows: (RelatedRow | null)[] = [
    { id: "similar", title: "Ähnliche Serien", priority: 5, items: series.similar },
    { id: "recommendations", title: "Weitere Empfehlungen", priority: 4.5, items: related },
    creatorRow,
    leadRow,
    genreRow,
  ];
  return renderRows(userId, rows, exclude, showWhy);
}
