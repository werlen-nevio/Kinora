"use client";

import { Clock, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, buttonStyles } from "@/components/ui/button";
import { Checkbox, Dialog, DialogClose, DialogContent } from "@/components/ui/primitives";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { type DiaryEntryView, type DiaryPayload, localToday } from "@/lib/diary";
import type { MediaKind } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import { RatingScale } from "./rating-scale";

export interface DiaryTarget {
  kind: MediaKind;
  tmdbId: number;
  title: string;
  posterPath?: string | null;
  year?: number | null;
}

type Step = "rating" | "date" | "note";
const STEPS: readonly Step[] = ["rating", "date", "note"];

function noun(kind: MediaKind) {
  return kind === "movie" ? "der Film" : "die Serie";
}

function nounAccusative(kind: MediaKind) {
  return kind === "movie" ? "den Film" : "die Serie";
}

function Header({ target }: { target: DiaryTarget }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative aspect-[2/3] w-11 shrink-0 overflow-hidden rounded-md bg-ink-raised ring-1 ring-white/10">
        {target.posterPath ? <TmdbImage path={target.posterPath} kind="poster" alt="" sizes="60px" /> : <ImageFallback title="" />}
      </span>
      <p className="min-w-0 text-sm text-fog">
        <span className="block truncate font-medium text-screen">{target.title}</span>
        {target.year ?? null}
      </p>
    </div>
  );
}

function TimeField({ value, onChange }: { value: string | null; onChange: (time: string | null) => void }) {
  if (value === null) {
    return (
      <button type="button" onClick={() => onChange("20:00")} className="inline-flex items-center gap-1.5 text-sm text-fog hover:text-screen">
        <Clock className="size-4" /> Uhrzeit ergänzen
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-fog">
        Uhrzeit
        <input
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value || null)}
          className="h-9 rounded-lg border border-white/12 bg-white/5 px-2 text-sm text-screen [color-scheme:dark] outline-none focus:border-screen"
        />
      </label>
      <button type="button" onClick={() => onChange(null)} className="text-sm text-fog hover:text-screen">
        Entfernen
      </button>
    </div>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="sr-only">Notiz</span>
      <textarea
        value={value}
        maxLength={2000}
        rows={4}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Was bleibt dir in Erinnerung?"
        className="w-full resize-y rounded-xl border border-white/12 bg-white/5 p-3 text-sm text-screen outline-none placeholder:text-fog-dim focus:border-screen"
      />
    </label>
  );
}

function RewatchField({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <Checkbox checked={checked} onCheckedChange={(state) => onChange(state === true)} />
      Erneut angesehen
    </label>
  );
}

/**
 * Drei kurze Schritte, die alle übersprungen werden dürfen. Das heutige Datum ist nur eine
 * Vorauswahl: Gespeichert wird es erst, wenn jemand den Datumsschritt mit «Weiter» bestätigt.
 */
export function DiaryWizard({
  target,
  open,
  onOpenChange,
  alreadySeen,
  onSubmit,
}: {
  target: DiaryTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alreadySeen: boolean;
  onSubmit: (payload: DiaryPayload) => void;
}) {
  const [step, setStep] = useState<Step>("rating");
  const [rating, setRating] = useState<number | null>(null);
  const [date, setDate] = useState(localToday);
  const [time, setTime] = useState<string | null>(null);
  const [dateKnown, setDateKnown] = useState(false);
  const [review, setReview] = useState("");
  const [rewatch, setRewatch] = useState(alreadySeen);

  // Der Dialog wird pro Titel neu eingehängt, die Felder starten also immer leer.
  const finish = (when: { date: string | null; time: string | null }) => {
    onSubmit({
      rating,
      watchedAt: when.date,
      watchedTime: when.date ? when.time : null,
      review: review.trim() || null,
      isRewatch: rewatch,
    });
  };

  // Was bis hier angegeben ist, bleibt erhalten. Das vorausgewählte Datum gehört nicht dazu.
  const skipRest = () => finish({ date: null, time: null });

  const titles: Record<Step, string> = {
    rating: `Wie hat dir ${noun(target.kind)} gefallen?`,
    date: `Wann hast du ${nounAccusative(target.kind)} gesehen?`,
    note: "Möchtest du etwas festhalten?",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={titles[step]} className="max-w-md">
        <div className="mt-4">
          <Header target={target} />
        </div>

        <div className="mt-5 min-h-[9rem]">
          {step === "rating" ? (
            <div className="space-y-4">
              <RatingScale
                value={rating}
                onChange={setRating}
                onCommit={() => setStep("date")}
                label={`${target.title} bewerten`}
                size="lg"
              />
              <p className="text-sm text-fog">Deine Bewertung macht die Vorschläge genauer. Halbe Punkte sind möglich.</p>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep("date")}>
                  Bewertung überspringen
                </Button>
                <Button variant="primary" disabled={rating === null} onClick={() => setStep("date")}>
                  Weiter
                </Button>
              </div>
            </div>
          ) : null}

          {step === "date" ? (
            <div className="space-y-4">
              <DatePicker value={date} onChange={setDate} />
              <TimeField value={time} onChange={setTime} />
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDateKnown(false);
                    setStep("note");
                  }}
                >
                  Datum unbekannt
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDateKnown(true);
                    setStep("note");
                  }}
                >
                  Weiter
                </Button>
              </div>
            </div>
          ) : null}

          {step === "note" ? (
            <div className="space-y-4">
              <NoteField value={review} onChange={setReview} />
              <RewatchField checked={rewatch} onChange={setRewatch} />
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setStep("date")}>
                  Zurück
                </Button>
                <Button variant="primary" onClick={() => finish({ date: dateKnown ? date : null, time: dateKnown ? time : null })}>
                  Speichern
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/8 pt-4">
          <div aria-hidden="true" className="flex shrink-0 gap-1">
            {STEPS.map((entry, index) => (
              <span key={entry} className={cn("h-1.5 w-5 rounded-sm", index <= STEPS.indexOf(step) ? "bg-ambient" : "bg-white/14")} />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Schritt {STEPS.indexOf(step) + 1} von {STEPS.length}
          </p>
          {step !== "note" ? (
            <button type="button" onClick={skipRest} className="min-w-0 text-right text-[13px] text-fog underline-offset-2 hover:text-screen hover:underline">
              Ohne weitere Angaben als gesehen markieren
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Bearbeitet einen vorhandenen Sehvorgang: alle Angaben auf einen Blick, statt in Schritten. */
export function DiaryEntryEditor({
  entry,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  entry: DiaryEntryView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: DiaryPayload) => void;
  onDelete: () => void;
}) {
  const [rating, setRating] = useState(entry.rating);
  const [dateKnown, setDateKnown] = useState(entry.watchedDate !== null);
  const [date, setDate] = useState(entry.watchedDate ?? localToday());
  const [time, setTime] = useState(entry.watchedTime);
  const [review, setReview] = useState(entry.review ?? "");
  const [rewatch, setRewatch] = useState(entry.isRewatch);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Eintrag bearbeiten" className="max-w-md">
        <div className="mt-4">
          <Header target={entry} />
        </div>

        <div className="mt-6 space-y-6">
          <section aria-label="Bewertung dieses Sehvorgangs" className="space-y-2">
            <p className="text-sm font-medium">Bewertung</p>
            <RatingScale value={rating} onChange={setRating} label={`Bewertung für ${entry.title}`} />
            {rating !== null ? (
              <button type="button" onClick={() => setRating(null)} className="text-sm text-fog hover:text-screen">
                Bewertung entfernen
              </button>
            ) : null}
          </section>

          <section aria-label="Sehdatum" className="space-y-3">
            <p className="text-sm font-medium">Sehdatum</p>
            {dateKnown ? (
              <>
                <DatePicker value={date} onChange={setDate} />
                <TimeField value={time} onChange={setTime} />
                <button type="button" onClick={() => setDateKnown(false)} className="block text-sm text-fog hover:text-screen">
                  Datum unbekannt
                </button>
              </>
            ) : (
              <Button onClick={() => setDateKnown(true)}>Datum ergänzen</Button>
            )}
          </section>

          <section aria-label="Notiz" className="space-y-3">
            <p className="text-sm font-medium">Notiz</p>
            <NoteField value={review} onChange={setReview} />
            <RewatchField checked={rewatch} onChange={setRewatch} />
          </section>
        </div>

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-white/8 pt-4">
          <Button
            variant="danger"
            onClick={() => {
              onDelete();
              onOpenChange(false);
            }}
          >
            <Trash2 /> Löschen
          </Button>
          <div className="flex gap-2">
            <DialogClose className={buttonStyles({ variant: "ghost" })}>Abbrechen</DialogClose>
            <Button
              variant="primary"
              onClick={() => {
                onSave({
                  rating,
                  watchedAt: dateKnown ? date : null,
                  watchedTime: dateKnown ? time : null,
                  review: review.trim() || null,
                  isRewatch: rewatch,
                });
                onOpenChange(false);
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
