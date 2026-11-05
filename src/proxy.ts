import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/anmelden", "/registrieren", "/passwort-vergessen", "/passwort-zuruecksetzen"]);

function contentSecurityPolicy(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  const imageBase = process.env.NEXT_PUBLIC_TMDB_IMAGE_BASE_URL;
  const imageOrigin = imageBase ? new URL(imageBase).origin : "https://image.tmdb.org";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Motion und next/image setzen Inline-Styles; ein Nonce würde sie blockieren.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${imageOrigin} https://i.ytimg.com`,
    "font-src 'self'",
    "connect-src 'self'",
    // Trailer laufen ausschliesslich über die datensparsame YouTube-Domain.
    "frame-src https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Setzt pro Anfrage einen CSP-Nonce und leitet Gäste zur Anmeldung um. Die Umleitung
 * prüft nur, ob ein Session-Cookie existiert. Die echte Prüfung passiert serverseitig
 * in `requireUser` und `withUser`, denn das Cookie kann abgelaufen oder gefälscht sein.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!hasSession && !isPublic && !pathname.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/anmelden";
    url.search = pathname === "/" ? "" : `?weiter=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon|icon|apple-icon|tmdb-logo|.*\\.(?:svg|png|jpg|webp|woff2)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
