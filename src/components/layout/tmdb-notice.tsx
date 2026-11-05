import { getGenres } from "@/server/tmdb/api";
import { TmdbError } from "@/server/tmdb/client";

/** Sagt konkret, was fehlt, statt leere Reihen ohne Erklärung zu zeigen. */
export async function TmdbNotice() {
  let message: string | null = null;
  try {
    await getGenres("movie");
  } catch (error) {
    if (error instanceof TmdbError && (error.code === "not_configured" || error.code === "unauthorized")) {
      message =
        error.code === "not_configured"
          ? "Der TMDB-Zugang fehlt. Trage TMDB_READ_ACCESS_TOKEN in die .env ein und starte den Server neu."
          : "TMDB hat das Token abgelehnt. Prüfe TMDB_READ_ACCESS_TOKEN in der .env.";
    } else {
      message = "TMDB ist gerade nicht erreichbar. Deine Bibliothek bleibt erhalten; Filmdaten erscheinen, sobald TMDB wieder antwortet.";
    }
  }
  if (!message) return null;
  return (
    <div role="alert" className="gutter pt-20">
      <p className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">{message}</p>
    </div>
  );
}
