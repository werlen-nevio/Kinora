import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";
import { apiError, isOriginAllowed } from "@/server/http/api";

const handlers = toNextJsHandler(auth);

const AUTH_PREFIX = "/api/auth/";

// Nur was Kinora nutzt. Das Rate Limiting von Better Auth legt pro Pfad einen Datensatz an;
// ohne diese Liste könnte jeder mit erfundenen Pfaden die Datenbank füllen.
const GET_PATHS = new Set(["get-session", "list-sessions", "ok", "error"]);
const POST_PATHS = new Set([
  "sign-up/email",
  "sign-in/email",
  "sign-out",
  "request-password-reset",
  "reset-password",
  "change-password",
  "update-user",
  "delete-user",
  "revoke-session",
]);

function authPath(request: Request) {
  const { pathname } = new URL(request.url);
  return pathname.startsWith(AUTH_PREFIX) ? pathname.slice(AUTH_PREFIX.length).replace(/\/$/, "") : "";
}

export async function GET(request: Request) {
  const path = authPath(request);
  // Der Link aus der Mail: /reset-password/<token>
  const isResetLink = /^reset-password\/[\w-]+$/.test(path);
  if (!GET_PATHS.has(path) && !isResetLink) return apiError(404, "not_found", "Diese Adresse gibt es nicht.");
  return handlers.GET(request);
}

/**
 * Better Auth prüft die Origin nur, wenn schon ein Cookie mitkommt. Die Prüfung hier gilt
 * auch ohne Cookie und verhindert so, dass fremde Seiten jemanden in ein Konto einloggen.
 */
export async function POST(request: Request) {
  if (!isOriginAllowed(request)) return apiError(403, "forbidden_origin", "Diese Anfrage kommt von einer fremden Seite.");
  const path = authPath(request);
  if (!POST_PATHS.has(path)) return apiError(404, "not_found", "Diese Adresse gibt es nicht.");

  if (path === "delete-user") {
    // Ohne Passwort genügt Better Auth eine junge Session. Eine Löschung ist endgültig,
    // deshalb verlangt Kinora das Passwort immer, auch am entsperrten Gerät.
    const body = (await request.clone().json().catch(() => null)) as { password?: unknown } | null;
    if (typeof body?.password !== "string" || body.password === "") {
      return apiError(400, "password_required", "Bestätige die Löschung mit deinem Passwort.");
    }
  }
  return handlers.POST(request);
}
