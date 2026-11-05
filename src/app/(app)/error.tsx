"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="gutter flex min-h-[70dvh] flex-col items-start justify-center gap-5 pt-24">
      <h1 className="font-display text-title-lg">Diese Seite liess sich nicht laden</h1>
      <p className="max-w-xl text-fog">
        Meist ist TMDB kurz nicht erreichbar oder der Server braucht einen Moment. Deine Bibliothek ist davon nicht betroffen.
      </p>
      <Button variant="primary" size="lg" onClick={reset}>
        <RefreshCw /> Erneut laden
      </Button>
    </div>
  );
}
