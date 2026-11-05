const INTERNAL_BASE = "http://kinora.invalid";

/**
 * Nur interne Pfade. Der URL-Parser entfernt Tabs und Zeilenumbrüche, bevor er den Wert
 * deutet: Aus `/\t/evil.example` wird so `//evil.example`. Eine Prüfung der ersten Zeichen
 * reicht deshalb nicht, massgeblich ist das Ergebnis des Parsers.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  try {
    const url = new URL(value, INTERNAL_BASE);
    return url.origin === INTERNAL_BASE ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
