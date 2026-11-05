import { cn } from "@/lib/utils";

/**
 * Ein K, aus der runden Blende eines Projektors geschnitten. Der Lichtkegel zwischen den
 * Armen trägt die Farbe des aktuellen Films. Regeln und alle Varianten: docs/brand/README.md.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="16 16 224 224" aria-hidden="true" className={cn("size-[1.4em] shrink-0", className)}>
      <path d="M84.5 24.79 L84.5 92.03 L128.39 16 A112 112 0 0 1 203.03 44.85 L84.5 113.28 L84.5 142.72 L203.03 211.15 A112 112 0 0 1 128.39 240 L84.5 163.97 L84.5 231.21 A112 112 0 0 1 84.5 24.79 Z" fill="currentColor" />
      <path d="M104 128 L234.41 93.06 A112 112 0 0 1 234.41 162.94 Z" fill="var(--ambient, #f2be7e)" />
    </svg>
  );
}

/** Masse in em, damit Zeichen, Abstand und Schrift bei jeder Grösse im festen Verhältnis bleiben. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.4em] text-[1.45rem] text-screen", className)}>
      <LogoMark />
      <span className="font-display leading-none">Kinora</span>
    </span>
  );
}
