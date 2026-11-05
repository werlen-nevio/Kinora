"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Native Scroll-Reihe. Pfeile gibt es nur mit Maus; Touch und Trackpad scrollen direkt. */
export function Carousel({ children, label, gap = "gap-3 sm:gap-4", className }: { children: ReactNode; label: string; gap?: string; className?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const update = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    setCanBack(element.scrollLeft > 8);
    setCanForward(element.scrollLeft + element.clientWidth < element.scrollWidth - 8);
  }, []);

  useEffect(() => {
    update();
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [update, children]);

  const page = (direction: 1 | -1) => {
    const element = viewport.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollBy({ left: direction * element.clientWidth * 0.82, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className={cn("group/row relative", className)}>
      <div ref={viewport} onScroll={update} role="group" aria-label={label} className={cn("reel py-2", gap)}>
        {children}
      </div>
      <ArrowButton direction="back" visible={canBack} onClick={() => page(-1)} />
      <ArrowButton direction="forward" visible={canForward} onClick={() => page(1)} />
    </div>
  );
}

function ArrowButton({ direction, visible, onClick }: { direction: "back" | "forward"; visible: boolean; onClick: () => void }) {
  const Icon = direction === "back" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      // Für die Tastatur reichen Tab durch die Karten; die Pfeile sind eine Mausabkürzung.
      tabIndex={-1}
      aria-hidden="true"
      onClick={onClick}
      className={cn(
        "absolute top-0 z-10 hidden h-full w-[var(--gutter)] min-w-12 items-center justify-center text-screen opacity-0 transition-opacity duration-200 [@media(hover:hover)]:flex",
        direction === "back"
          ? "left-0 bg-gradient-to-r from-ink/90 to-transparent"
          : "right-0 bg-gradient-to-l from-ink/90 to-transparent",
        visible ? "group-hover/row:opacity-100" : "pointer-events-none",
      )}
    >
      <Icon className="size-8" />
    </button>
  );
}
