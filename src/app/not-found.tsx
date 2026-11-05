import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="gutter flex min-h-dvh flex-col items-start justify-center gap-5">
      <h1 className="font-display text-title-lg">Diese Seite gibt es nicht</h1>
      <p className="max-w-xl text-fog">Vielleicht ist der Link veraltet, oder TMDB führt diesen Titel nicht mehr.</p>
      <Link href="/" className={buttonStyles({ variant: "primary", size: "lg" })}>
        Zur Startseite
      </Link>
    </div>
  );
}
