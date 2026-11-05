"use client";

import { useRef, useState } from "react";
import { RATING_VALUES } from "@/lib/diary";
import { cn } from "@/lib/utils";

const FRAMES = Array.from({ length: 10 }, (_, index) => index + 1);

function fillOf(frame: number, value: number) {
  if (value >= frame) return 1;
  return value === frame - 0.5 ? 0.5 : 0;
}

/** Die Stufe unter dem Zeiger. Das erste Feld ist ganz «1», weil es keine 0.5 gibt. */
function valueFromPointer(clientX: number, rect: DOMRect): number {
  const ratio = Math.min(0.999, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.max(1, Math.ceil(ratio * 20) / 2);
}

/**
 * Zehn Bildfelder wie auf einem Filmstreifen, jedes in zwei Hälften: Die Bewertung leuchtet
 * bis zur gewählten Stufe. Bedienbar per Klick, Ziehen, Touch und Pfeiltasten; für
 * Screenreader sind es 19 Optionen von 1 bis 10.
 */
export function RatingScale({
  value,
  onChange,
  onCommit,
  label,
  size = "md",
  showValue = true,
}: {
  value: number | null;
  onChange: (value: number) => void;
  /** Eine abgeschlossene Auswahl per Zeiger oder Enter; Pfeiltasten laufen nur durch. */
  onCommit?: (value: number) => void;
  label: string;
  size?: "sm" | "md" | "lg";
  showValue?: boolean;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const dragging = useRef(false);
  const track = useRef<HTMLDivElement>(null);
  const options = useRef(new Map<number, HTMLButtonElement>());
  const shown = preview ?? value ?? 0;
  const tabStop = value ?? 7;

  const fromEvent = (event: React.PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    return rect ? valueFromPointer(event.clientX, rect) : null;
  };

  const select = (next: number) => {
    onChange(next);
    options.current.get(next)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const current = value ?? tabStop;
    const keys: Record<string, number> = {
      ArrowRight: current + 0.5,
      ArrowUp: current + 0.5,
      ArrowLeft: current - 0.5,
      ArrowDown: current - 0.5,
      PageUp: current + 1,
      PageDown: current - 1,
      Home: 1,
      End: 10,
    };
    const next = keys[event.key];
    if (next !== undefined) {
      event.preventDefault();
      select(Math.min(10, Math.max(1, next)));
    } else if (event.key === "Enter" && value !== null) {
      event.preventDefault();
      onCommit?.(value);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div
        ref={track}
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          const next = fromEvent(event);
          if (next === null) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setPreview(next);
        }}
        onPointerMove={(event) => {
          // Touch hat kein Hover: Dort zählt nur Ziehen, die Vorschau bleibt dem Finger folgend.
          if (!dragging.current && event.pointerType !== "mouse") return;
          setPreview(fromEvent(event));
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          const next = fromEvent(event);
          setPreview(null);
          if (next === null) return;
          select(next);
          onCommit?.(next);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setPreview(null);
        }}
        onPointerLeave={() => {
          if (!dragging.current) setPreview(null);
        }}
        className={cn("relative grid min-w-0 flex-1 cursor-pointer touch-pan-y select-none grid-cols-10 gap-1", size === "lg" ? "h-14" : size === "md" ? "h-10" : "h-7")}
      >
        {FRAMES.map((frame) => {
          const fill = fillOf(frame, shown);
          return (
            <span key={frame} aria-hidden="true" className="relative overflow-hidden rounded-[3px] bg-white/12">
              <span className="absolute inset-y-0 left-0 bg-ambient transition-[width] duration-100" style={{ width: `${fill * 100}%` }} />
            </span>
          );
        })}
        {/* Durchsichtige Optionen über ihrer Fläche. Zeigeraktionen laufen über die Spur darunter. */}
        {RATING_VALUES.map((option) => (
          <button
            key={option}
            ref={(node) => {
              if (node) options.current.set(option, node);
              else options.current.delete(option);
            }}
            type="button"
            role="radio"
            aria-checked={value === option}
            aria-label={`${option} von 10`}
            tabIndex={option === tabStop ? 0 : -1}
            style={{ left: option === 1 ? 0 : `${(option * 2 - 1) * 5}%`, width: option === 1 ? "10%" : "5%" }}
            className="absolute inset-y-0 cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-screen"
            onClick={(event) => {
              // detail 0 heisst: Tastatur oder Hilfstechnologie, kein Zeiger.
              if (event.detail === 0) {
                onChange(option);
                onCommit?.(option);
              }
            }}
          />
        ))}
      </div>
      {showValue ? (
        <p aria-hidden="true" className={cn("shrink-0 text-right font-semibold leading-none", size === "lg" ? "w-20 text-3xl" : size === "md" ? "w-14 text-xl" : "w-9 text-sm")}>
          {shown ? shown : "–"}
          {size === "lg" ? <span className="text-sm font-normal text-fog">/10</span> : null}
        </p>
      ) : null}
    </div>
  );
}
