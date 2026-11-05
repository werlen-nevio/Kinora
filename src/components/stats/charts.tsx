"use client";

import { useId, useState } from "react";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Datum {
  key: string;
  label: string;
  value: number;
  /** Zusatz im Tooltip, z. B. die Sehzeit eines Monats. */
  detail?: string;
}

/** Jeder Wert steht auch als Tabelle bereit: Farbe und Form allein reichen nicht. */
function DataTable({ caption, data, valueLabel }: { caption: string; data: readonly Datum[]; valueLabel: string }) {
  return (
    <details className="mt-3 text-xs text-fog">
      <summary className="w-fit cursor-pointer select-none hover:text-screen">Als Tabelle anzeigen</summary>
      <table className="mt-2 w-full max-w-md text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-white/10">
            <th scope="col" className="py-1 font-medium">
              Wert
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {valueLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.key} className="border-b border-white/5">
              <th scope="row" className="py-1 font-normal text-screen">
                {datum.label}
              </th>
              <td className="py-1 text-right tabular-nums text-screen">
                {datum.value}
                {datum.detail ? <span className="ml-2 text-fog">{datum.detail}</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Balken mit dem Wert an der Spitze; für Rangfolgen wie Genres. */
export function BarList({ data, caption, valueLabel }: { data: readonly Datum[]; caption: string; valueLabel: string }) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className="space-y-1">
        {data.map((datum) => (
          <li key={datum.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded py-1 transition-colors hover:bg-white/4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            <span className="truncate text-sm text-screen">{datum.label}</span>
            <span className="flex items-center gap-2">
              <span className="block h-3.5 rounded-r bg-ambient" style={{ width: `calc(${(datum.value / max) * 100}% - 2rem)`, minWidth: 3 }} />
              <span className="text-xs tabular-nums text-fog">{datum.value}</span>
            </span>
          </li>
        ))}
      </ul>
      <DataTable caption={caption} data={data} valueLabel={valueLabel} />
    </figure>
  );
}

/**
 * Säulen mit gemeinsamer Grundlinie. Die Trefferfläche ist die ganze Spalte, damit
 * auch kleine Werte per Maus, Touch und Tastatur erreichbar bleiben. Nur Maximum und
 * jüngster Wert tragen eine Zahl; alles andere steht in Tooltip und Tabelle.
 */
export function ColumnChart({
  data,
  caption,
  valueLabel,
  unit,
  labelEvery = 1,
  labelLast = false,
  height = 168,
}: {
  data: readonly Datum[];
  caption: string;
  valueLabel: string;
  /** Einzahl und Mehrzahl der Einheit, z. B. Bewertung und Bewertungen. */
  unit: { one: string; many: string };
  labelEvery?: number;
  labelLast?: boolean;
  height?: number;
}) {
  const withUnit = (value: number) => `${value} ${value === 1 ? unit.one : unit.many}`;
  const [active, setActive] = useState<string | null>(null);
  const tooltipId = useId();
  const max = Math.max(1, ...data.map((datum) => datum.value));
  const maxKey = data.find((datum) => datum.value === max && datum.value > 0)?.key;
  const lastKey = labelLast ? data[data.length - 1]?.key : undefined;
  const activeDatum = data.find((datum) => datum.key === active);

  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <div className="flex items-end border-b border-white/12" style={{ height }}>
          {data.map((datum) => {
            const barHeight = (datum.value / max) * (height - 22);
            const labeled = datum.value > 0 && (datum.key === maxKey || datum.key === lastKey);
            return (
              <button
                key={datum.key}
                type="button"
                onMouseEnter={() => setActive(datum.key)}
                onFocus={() => setActive(datum.key)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(datum.key)}
                aria-label={`${datum.label}: ${withUnit(datum.value)}`}
                aria-describedby={active === datum.key ? tooltipId : undefined}
                className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end outline-none"
              >
                {labeled ? <span className="mb-1 text-[11px] tabular-nums text-screen">{datum.value}</span> : null}
                <span
                  className={cn(
                    "block w-full max-w-6 rounded-t transition-[filter] duration-150 group-focus-visible:ring-2 group-focus-visible:ring-screen",
                    datum.value > 0 ? "bg-ambient" : "bg-transparent",
                    active !== null && active !== datum.key && "brightness-[0.55]",
                  )}
                  // 2 px Luft zwischen den Säulen trennen sie, nicht ein Rand.
                  style={{ height: datum.value > 0 ? Math.max(3, barHeight) : 0, marginInline: 1 }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex">
          {data.map((datum, index) => (
            <span key={datum.key} className="min-w-0 flex-1 text-center text-[11px] text-fog-dim">
              {index % labelEvery === 0 ? datum.label : ""}
            </span>
          ))}
        </div>
        {activeDatum ? (
          <div
            id={tooltipId}
            role="status"
            className="pointer-events-none absolute z-10 w-max max-w-48 -translate-x-1/2 rounded-lg bg-screen px-2.5 py-1.5 text-xs text-ink shadow-xl"
            style={{
              left: `clamp(4rem, ${((data.indexOf(activeDatum) + 0.5) / data.length) * 100}%, calc(100% - 4rem))`,
              bottom: "100%",
            }}
          >
            <span className="font-semibold">{activeDatum.label}</span>
            <span className="ml-2 tabular-nums">{withUnit(activeDatum.value)}</span>
            {activeDatum.detail ? <span className="block text-ink/70">{activeDatum.detail}</span> : null}
          </div>
        ) : null}
      </div>
      <DataTable caption={caption} data={data} valueLabel={valueLabel} />
    </figure>
  );
}

const WEEKDAY_LABELS = ["Mo", "", "Mi", "", "Fr", "", "So"];

function intensity(count: number) {
  if (count === 0) return 0;
  if (count === 1) return 0.55;
  if (count === 2) return 0.8;
  return 1;
}

/**
 * Ein Feld pro Tag, Spalten sind Wochen. Eine Farbe in drei Stufen; die genaue Zahl steht im
 * Tooltip und in der Tabelle. Auf kleinen Bildschirmen scrollt das Raster seitlich und startet
 * bei den jüngsten Wochen.
 */
export function ActivityCalendar({ days }: { days: readonly { date: string; count: number }[] }) {
  const [active, setActive] = useState<{ date: string; count: number } | null>(null);
  const weeks: { date: string; count: number }[][] = [];
  days.forEach((day, index) => {
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]?.push(day);
  });
  const withEntries = days.filter((day) => day.count > 0);
  const describe = (day: { date: string; count: number }) => `${formatDate(day.date)}: ${day.count === 1 ? "1 Titel" : `${day.count} Titel`}`;

  return (
    <figure>
      <figcaption className="sr-only">Sehaktivität pro Tag in den letzten zwölf Monaten</figcaption>
      <div className="flex overflow-x-auto pb-2 [direction:rtl] lg:[direction:ltr]" onMouseLeave={() => setActive(null)}>
        <div className="flex gap-[3px] [direction:ltr] [--cell:12px] lg:[--cell:14px] xl:[--cell:18px]">
          <div aria-hidden="true" className="grid grid-rows-7 gap-[3px] pr-1 text-[10px] text-fog-dim">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index} className="h-[var(--cell)] leading-[var(--cell)]">
                {label}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]?.date} className="grid grid-rows-7 gap-[3px]">
              {week.map((day) => (
                <span
                  key={day.date}
                  aria-hidden="true"
                  onMouseEnter={() => setActive(day)}
                  className="relative block size-[var(--cell)] overflow-hidden rounded-[2px] bg-white/6"
                >
                  {day.count > 0 ? <span className="absolute inset-0 bg-ambient" style={{ opacity: intensity(day.count) }} /> : null}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="mt-1 min-h-5 text-xs text-fog">
        {active ? describe(active) : `An ${withEntries.length === 1 ? "1 Tag" : `${withEntries.length} Tagen`} etwas gesehen`}
      </p>
      <DataTable
        caption="Tage mit Einträgen"
        valueLabel="Titel"
        data={withEntries
          .slice()
          .reverse()
          .map((day) => ({ key: day.date, label: formatDate(day.date) ?? day.date, value: day.count }))}
      />
    </figure>
  );
}
