import "server-only";
import { pickAmbient, type AmbientColors } from "@/lib/ambient-color";
import { tmdbImageUrl } from "@/lib/tmdb-image";
import { prisma } from "./db";

const memory = new Map<string, AmbientColors | null>();
const MEMORY_LIMIT = 2_000;
const CACHE_DAYS = 180;
const SAFE_PATH = /^\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;

/**
 * Die Farbe, die ein Film in den Raum wirft. Wird einmal pro Bild berechnet und
 * dauerhaft gespeichert. Scheitert etwas, bleibt das neutrale Saallicht.
 */
export async function getAmbient(path: string | null | undefined): Promise<AmbientColors | null> {
  if (!path || !SAFE_PATH.test(path)) return null;
  if (memory.has(path)) return memory.get(path) ?? null;

  const key = `ambient:${path}`;
  const stored = await prisma.tmdbCache.findUnique({ where: { key } }).catch(() => null);
  if (stored) {
    const value = stored.payload as unknown as AmbientColors | { none: true };
    const colors = "none" in value ? null : value;
    remember(path, colors);
    return colors;
  }

  const colors = await extract(path).catch((error) => {
    console.warn(`[ambient] ${path}:`, error instanceof Error ? error.message : error);
    return undefined;
  });
  if (colors === undefined) return null;

  remember(path, colors);
  const expiresAt = new Date(Date.now() + CACHE_DAYS * 24 * 3600 * 1000);
  const payload = (colors ?? { none: true }) as object;
  await prisma.tmdbCache
    .upsert({
      where: { key },
      create: { key, payload, expiresAt, staleAt: expiresAt },
      update: { payload, expiresAt, staleAt: expiresAt, fetchedAt: new Date() },
    })
    .catch(() => undefined);
  return colors;
}

async function extract(path: string): Promise<AmbientColors | null> {
  const response = await fetch(tmdbImageUrl(path, "backdrop", 300), { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`Bild antwortete mit ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buffer).resize(32, 18, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return pickAmbient(data, info.channels);
}

function remember(path: string, colors: AmbientColors | null) {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(path, colors);
}
