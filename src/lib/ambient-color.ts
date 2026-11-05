// Ambient-Farbe aus den Pixeln eines Backdrops. Die dominante Farbe wird auf feste
// Helligkeit normiert, damit Kontrast und Ruhe bei jedem Film gleich bleiben.

import type { CSSProperties } from "react";

export interface AmbientColors {
  /** Für Fortschritt, Bewertung und Akzente. */
  accent: string;
  /** Für das Licht hinter dem Bild. */
  glow: string;
}

const HUE_BUCKETS = 24;
const MIN_TOTAL_WEIGHT_SHARE = 0.015;

function srgbToLinear(value: number) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** sRGB nach OKLCH (Björn Ottosson). Gibt Chroma und Farbton zurück. */
export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  return { l: okL, c: Math.hypot(okA, okB), h: hue < 0 ? hue + 360 : hue };
}

/**
 * Sucht den Farbton, der im Bild am stärksten vorkommt. Satte, mittelhelle Pixel
 * zählen mehr als dunkle oder ausgebleichte. Graue Bilder liefern `null`; dann
 * bleibt das neutrale Saallicht, statt eine Farbe zu erfinden.
 */
export function pickAmbient(pixels: Uint8Array | Buffer, channels = 3): AmbientColors | null {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ weight: 0, chroma: 0, hueX: 0, hueY: 0 }));
  const pixelCount = Math.floor(pixels.length / channels);
  if (pixelCount === 0) return null;

  for (let index = 0; index + 2 < pixels.length; index += channels) {
    const { l, c, h } = rgbToOklch(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0);
    if (l < 0.12 || l > 0.96 || c < 0.025) continue;
    const weight = c * c * (1 - Math.abs(l - 0.55));
    const bucket = buckets[Math.floor((h / 360) * HUE_BUCKETS) % HUE_BUCKETS];
    if (!bucket) continue;
    bucket.weight += weight;
    bucket.chroma += c * weight;
    bucket.hueX += Math.cos((h * Math.PI) / 180) * weight;
    bucket.hueY += Math.sin((h * Math.PI) / 180) * weight;
  }

  let best = buckets[0];
  for (const bucket of buckets) {
    if (best && bucket.weight > best.weight) best = bucket;
  }
  // Schwelle relativ zu einem voll gesättigten Bild, sonst färben Einzelpixel den Raum.
  if (!best || best.weight <= 0 || best.weight / pixelCount < MIN_TOTAL_WEIGHT_SHARE * 0.04) return null;

  const hue = (Math.atan2(best.hueY, best.hueX) * 180) / Math.PI;
  const normalizedHue = hue < 0 ? hue + 360 : hue;
  const chroma = best.chroma / best.weight;
  const accentChroma = Math.min(0.13, Math.max(0.07, chroma));
  const glowChroma = Math.min(0.12, Math.max(0.06, chroma));
  return {
    accent: `oklch(0.8 ${accentChroma.toFixed(3)} ${normalizedHue.toFixed(1)})`,
    glow: `oklch(0.42 ${glowChroma.toFixed(3)} ${normalizedHue.toFixed(1)})`,
  };
}

export function ambientStyle(ambient: AmbientColors | null | undefined): CSSProperties | undefined {
  if (!ambient) return undefined;
  return { "--ambient": ambient.accent, "--ambient-glow": ambient.glow } as CSSProperties;
}
