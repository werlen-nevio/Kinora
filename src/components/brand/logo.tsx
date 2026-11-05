import { cn } from "@/lib/utils";

/**
 * Das Zeichen zitiert die Kinora, das Daumenkino der Brüder Lumière: Vom Scharnier
 * fächern zwei Bildkarten auf und bilden mit dem Schaft ein K. Die Karte dazwischen
 * ist der Lichtstrahl und trägt die Farbe des aktuellen Films.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <rect x="4.5" y="4" width="5.5" height="24" rx="1.4" fill="currentColor" />
      <path d="M12.6 14.6 21.7 4h6.1L18.3 15.1a1.6 1.6 0 0 1-1.2.5h-3.8a.8.8 0 0 1-.7-1Z" fill="currentColor" />
      <path d="M12.6 17.4 21.7 28h6.1l-9.5-11.1a1.6 1.6 0 0 0-1.2-.5h-3.8a.8.8 0 0 0-.7 1Z" fill="currentColor" />
      <path d="M20.2 14.9 29 12.6v6.8l-8.8-2.3a1.1 1.1 0 0 1 0-2.2Z" fill="var(--ambient, #f2be7e)" />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-screen", className)}>
      <LogoMark className={markClassName} />
      <span className="font-display text-[1.45rem] font-semibold leading-none tracking-tight">Kinora</span>
    </span>
  );
}
