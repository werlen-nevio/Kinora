"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { SectionHeading } from "@/components/detail/sections";
import { useLibraryItem } from "@/components/library/library-provider";
import { Button } from "@/components/ui/button";
import type { DiaryEntryView } from "@/lib/diary";
import { formatDate } from "@/lib/format";
import { type DiaryTarget, DiaryEntryEditor } from "./diary-dialog";
import { useOpenDiary } from "./diary-provider";
import { useDeleteDiaryEntry, useDiaryEntries, useUpdateDiaryEntry } from "./use-diary";

/**
 * Alle Sehvorgänge eines Titels. Die Gesamtbewertung steht bewusst getrennt darüber:
 * Sie ist die heutige Meinung, die Einträge halten fest, wie es damals war.
 */
export function MediaDiaryPanel({ media }: { media: DiaryTarget }) {
  const ref = { kind: media.kind, tmdbId: media.tmdbId };
  const item = useLibraryItem(ref);
  const openDiary = useOpenDiary();
  const known = item.watched || item.watchCount > 0;
  const { data: entries = [] } = useDiaryEntries(ref, known);
  const update = useUpdateDiaryEntry();
  const remove = useDeleteDiaryEntry();
  const [editing, setEditing] = useState<DiaryEntryView | null>(null);

  if (!known) return null;

  return (
    <section id="sehvorgaenge" aria-label="Deine Sehvorgänge" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionHeading>Deine Sehvorgänge</SectionHeading>
          <p className="mt-1 text-sm text-fog">
            {item.rating !== null ? `Aktuelle Gesamtbewertung: ${item.rating} von 10` : "Noch keine Gesamtbewertung"}
          </p>
        </div>
        <Button size="md" onClick={() => openDiary(media)}>
          <Plus /> Weiteren Sehvorgang erfassen
        </Button>
      </div>

      {entries.length ? (
        <ul className="max-w-2xl divide-y divide-white/8 border-y border-white/8">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-start gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {entry.watchedDate ? formatDate(entry.watchedDate) : "Datum unbekannt"}
                  {entry.watchedTime ? <span className="ml-2 font-normal text-fog">{entry.watchedTime} Uhr</span> : null}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-fog">
                  <span>{entry.rating !== null ? `${entry.rating} von 10` : "Ohne Bewertung"}</span>
                  {entry.isRewatch ? <span>Erneut angesehen</span> : null}
                </p>
                {entry.review ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-screen/85">{entry.review}</p> : null}
              </div>
              <Button size="sm" variant="ghost" aria-label={`Eintrag vom ${entry.watchedDate ? formatDate(entry.watchedDate) : "unbekannten Datum"} bearbeiten`} onClick={() => setEditing(entry)}>
                <Pencil /> Bearbeiten
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <DiaryEntryEditor
          key={editing.id}
          entry={editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSave={(payload) => update.mutate({ ref, input: { id: editing.id, ...payload } })}
          onDelete={() => remove.mutate({ ref, id: editing.id })}
        />
      ) : null}
    </section>
  );
}
