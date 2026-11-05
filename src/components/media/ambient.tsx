"use client";

import { useEffect } from "react";
import type { AmbientColors } from "@/lib/ambient-color";

/**
 * Hängt die Farbe des Films an die Wurzel, damit auch Navigation und Logo sie
 * übernehmen. Die Übergänge laufen über die registrierten CSS-Properties.
 */
export function AmbientSync({ ambient }: { ambient: AmbientColors | null | undefined }) {
  useEffect(() => {
    const root = document.documentElement;
    if (ambient) {
      root.style.setProperty("--ambient", ambient.accent);
      root.style.setProperty("--ambient-glow", ambient.glow);
    } else {
      root.style.removeProperty("--ambient");
      root.style.removeProperty("--ambient-glow");
    }
    return () => {
      root.style.removeProperty("--ambient");
      root.style.removeProperty("--ambient-glow");
    };
  }, [ambient]);
  return null;
}
