"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/primitives";
import { localToday, monthGrid, shiftMonth } from "@/lib/diary";
import { formatDate, formatMonth } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const OLDEST_YEAR = 1950;

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Der 31. existiert nicht in jedem Monat: Dann gilt der letzte Tag des Zielmonats. */
function addMonths(date: string, months: number) {
  const month = shiftMonth(date.slice(0, 7), months);
  const [year, index] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year ?? 0, index ?? 0, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8)), lastDay)).padStart(2, "0")}`;
}

/**
 * Monatskalender ohne zukünftige Tage. Pfeiltasten bewegen sich tageweise, Bild auf und Bild ab
 * monatsweise; für alte Filme führt die Jahresauswahl schnell weit zurück.
 */
export function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const today = useMemo(() => localToday(), []);
  const [month, setMonth] = useState(value.slice(0, 7));
  const pendingFocus = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const weeks = monthGrid(month);
  const currentYear = Number(today.slice(0, 4));
  const years = useMemo(
    () => Array.from({ length: currentYear - OLDEST_YEAR + 1 }, (_, index) => String(currentYear - index)).map((year) => ({ value: year, label: year })),
    [currentYear],
  );

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus();
  }, [value, month]);

  const move = (next: string) => {
    const clamped = next > today ? today : next;
    onChange(clamped);
    setMonth(clamped.slice(0, 7));
    pendingFocus.current = true;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(value, -1),
      ArrowRight: () => addDays(value, 1),
      ArrowUp: () => addDays(value, -7),
      ArrowDown: () => addDays(value, 7),
      PageUp: () => addMonths(value, -1),
      PageDown: () => addMonths(value, 1),
    };
    const target = moves[event.key];
    if (!target) return;
    event.preventDefault();
    move(target());
  };

  const canGoForward = month < today.slice(0, 7);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button size="icon-sm" variant="ghost" aria-label="Vorheriger Monat" onClick={() => setMonth(shiftMonth(month, -1))}>
          <ChevronLeft />
        </Button>
        <p aria-live="polite" className="min-w-0 flex-1 text-center text-sm font-medium">
          {formatMonth(month, "long")}
        </p>
        <Select label="Jahr wählen" value={month.slice(0, 4)} onValueChange={(year) => setMonth(`${year}-${month.slice(5)}` > today.slice(0, 7) ? today.slice(0, 7) : `${year}-${month.slice(5)}`)} options={years} className="h-8 px-3 text-[13px]" />
        <Button size="icon-sm" variant="ghost" aria-label="Nächster Monat" disabled={!canGoForward} onClick={() => setMonth(shiftMonth(month, 1))}>
          <ChevronRight />
        </Button>
      </div>

      <div ref={grid} role="grid" aria-label={`Kalender ${formatMonth(month, "long")} ${month.slice(0, 4)}`} onKeyDown={onKeyDown} className="mt-3">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((day) => (
            <span key={day} role="columnheader" className="py-1 text-center text-xs text-fog-dim">
              {day}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]?.date} role="row" className="grid grid-cols-7">
            {week.map((cell) => {
              const selected = cell.date === value;
              const future = cell.date > today;
              return (
                <span key={cell.date} role="gridcell" aria-selected={selected} className="flex justify-center py-0.5">
                  <button
                    type="button"
                    data-date={cell.date}
                    disabled={future}
                    // Nur der gewählte Tag ist per Tab erreichbar, sonst wären es 42 Tabstopps.
                    tabIndex={selected ? 0 : -1}
                    aria-label={formatDate(cell.date) ?? cell.date}
                    onClick={() => {
                      onChange(cell.date);
                      setMonth(cell.date.slice(0, 7));
                    }}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-full text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-screen disabled:cursor-not-allowed disabled:opacity-25",
                      selected ? "bg-screen font-semibold text-ink" : cell.inMonth ? "text-screen enabled:hover:bg-white/10" : "text-fog-dim enabled:hover:bg-white/6",
                      cell.date === today && !selected && "ring-1 ring-white/30",
                    )}
                  >
                    {cell.day}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
