import "server-only";

export class AvatarError extends Error {}

const SIZE = 320;
// Ein stark komprimiertes PNG kann klein sein und riesig dekodieren; die Pixelgrenze zählt.
const MAX_PIXELS = 24_000_000;
const MAX_CONCURRENT = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Bildverarbeitung lastet die CPU aus; Uploads dürfen die Anwendung nicht ausbremsen. */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  else running += 1;
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/**
 * Kodiert jedes Bild neu. So bleibt nichts vom Original übrig: keine EXIF-Daten,
 * keine Skripte aus SVG-Dateien, kein Polyglot. Nur echte Rasterformate kommen durch.
 */
export async function processAvatar(input: Buffer): Promise<Buffer<ArrayBuffer>> {
  const sharp = (await import("sharp")).default;
  return withSlot(async () => {
    try {
      const image = sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS });
      const { format } = await image.metadata();
      if (!format || !["jpeg", "png", "webp", "avif", "gif"].includes(format)) {
        throw new AvatarError("Bitte lade ein JPG-, PNG- oder WebP-Bild hoch.");
      }
      const output = await image.rotate().resize(SIZE, SIZE, { fit: "cover", position: "attention" }).webp({ quality: 84 }).toBuffer();
      return Buffer.from(output) as Buffer<ArrayBuffer>;
    } catch (error) {
      if (error instanceof AvatarError) throw error;
      throw new AvatarError("Dieses Bild lässt sich nicht lesen. Versuche es mit einer anderen Datei.");
    }
  });
}
