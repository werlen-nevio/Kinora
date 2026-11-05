import "server-only";
import { z } from "zod";
import { auth } from "../auth/auth";
import { allowedOrigins } from "../env";
import { LibraryError } from "../library/service";
import { TmdbError } from "../tmdb/client";
import { BodyTooLargeError, readBodyLimited } from "./body";
import { type RateLimitRule, userRateLimiter } from "./rate-limit";

export type ApiUser = { id: string; name: string; email: string; image?: string | null };

const MAX_JSON_BYTES = 64 * 1024;

export interface ApiContext<B> {
  user: ApiUser;
  body: B;
  request: Request;
  url: URL;
}

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

/** Browser senden bei POST immer einen Origin. Fremde Seiten scheitern hier. */
export function isOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return allowedOrigins().includes(origin);
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

function mapError(error: unknown): Response {
  if (error instanceof z.ZodError) {
    return apiError(400, "invalid_input", error.issues[0]?.message ?? "Die Eingabe ist ungültig.");
  }
  if (error instanceof BodyTooLargeError) {
    return apiError(413, "too_large", "Die Anfrage ist zu gross.");
  }
  if (error instanceof LibraryError) {
    return apiError(error.code === "not_found" ? 404 : 409, error.code, error.message);
  }
  if (error instanceof TmdbError) {
    switch (error.code) {
      case "not_found":
        return apiError(404, "not_found", "Diesen Titel gibt es bei TMDB nicht.");
      case "rate_limited":
        return apiError(503, "tmdb_busy", "TMDB begrenzt gerade die Anfragen. Versuche es gleich noch einmal.");
      case "not_configured":
      case "unauthorized":
        console.error("[api] TMDB-Konfiguration:", error.message);
        return apiError(503, "tmdb_config", "Der TMDB-Zugang ist nicht eingerichtet. Prüfe TMDB_READ_ACCESS_TOKEN.");
      default:
        return apiError(503, "tmdb_unavailable", "TMDB ist gerade nicht erreichbar. Versuche es gleich noch einmal.");
    }
  }
  console.error("[api] Unerwarteter Fehler:", error);
  return apiError(500, "internal", "Das hat nicht geklappt. Versuche es noch einmal.");
}

interface RouteOptions<B> {
  schema?: z.ZodType<B>;
  rateLimit?: RateLimitRule;
}

/**
 * Einheitlicher Rahmen für geschützte Routen: Origin prüfen, Session prüfen, Kontingent
 * prüfen, Eingabe validieren, Fehler abbilden. Der Handler bekommt die `userId` nur aus
 * der Session; es gibt keinen Weg, eine fremde ID von aussen zu übergeben.
 */
export function withUser<B = undefined>(
  handler: (context: ApiContext<B>) => Promise<Response | object | void>,
  options: RouteOptions<B> = {},
) {
  return async (request: Request): Promise<Response> => {
    try {
      const mutating = request.method !== "GET" && request.method !== "HEAD";
      if (mutating && !isOriginAllowed(request)) {
        return apiError(403, "forbidden_origin", "Diese Anfrage kommt von einer fremden Seite.");
      }

      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return apiError(401, "unauthorized", "Bitte melde dich an.");

      if (options.rateLimit && !userRateLimiter.allow(session.user.id, options.rateLimit)) {
        return apiError(429, "too_many_requests", "Zu viele Anfragen. Warte einen Moment und versuche es noch einmal.");
      }

      let body = undefined as B;
      if (options.schema) {
        const text = new TextDecoder().decode(await readBodyLimited(request, MAX_JSON_BYTES));
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new z.ZodError([{ code: "custom", message: "Die Anfrage enthält kein gültiges JSON.", path: [], input: undefined }]);
        }
        body = options.schema.parse(raw);
      }

      const result = await handler({ user: session.user, body, request, url: new URL(request.url) });
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (error) {
      return mapError(error);
    }
  };
}
