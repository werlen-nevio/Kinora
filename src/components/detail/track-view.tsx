"use client";

import { useEffect } from "react";
import type { MediaRef } from "@/lib/tmdb-types";

/** Zählt nur tatsächlich geöffnete Seiten, keine Prefetches. */
export function TrackView({ media }: { media: MediaRef }) {
  const { kind, tmdbId } = media;
  useEffect(() => {
    void fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "DETAIL_VIEW", kind, tmdbId }),
    }).catch(() => undefined);
  }, [kind, tmdbId]);
  return null;
}
