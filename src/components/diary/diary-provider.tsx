"use client";

import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { toast } from "sonner";
import { useLibraryAction, useLibraryState } from "@/components/library/library-provider";
import type { DiaryPayload } from "@/lib/diary";
import { EMPTY_ITEM, type LibraryItem } from "@/lib/library-types";
import { type MediaRef, refKey } from "@/lib/tmdb-types";
import { type DiaryTarget, DiaryWizard } from "./diary-dialog";
import { useCreateDiaryEntry, useDeleteDiaryEntry } from "./use-diary";

interface OpenOptions {
  /** Ersetzt das normale Speichern, etwa wenn der Swipe-Modus den Eintrag selbst anlegt. */
  onSubmit?: (payload: DiaryPayload) => void;
  onCancel?: () => void;
}

type OpenDiary = (target: DiaryTarget, options?: OpenOptions) => void;

const DiaryContext = createContext<OpenDiary | null>(null);

export function useOpenDiary(): OpenDiary {
  const open = useContext(DiaryContext);
  if (!open) throw new Error("useOpenDiary braucht einen DiaryProvider.");
  return open;
}

/** Nimmt einen eben gespeicherten Sehvorgang samt seiner Folgen zurück. */
function useUndoDiaryEntry() {
  const remove = useDeleteDiaryEntry();
  const action = useLibraryAction({ silent: true });
  return (ref: MediaRef, id: string, before: LibraryItem) => {
    remove.mutate(
      { ref, id },
      {
        onSuccess: ({ item }) => {
          if (before.watchlisted && !item.watchlisted) action.mutate({ ...ref, action: "watchlist", on: true });
          if (before.notInterested && !item.notInterested) action.mutate({ ...ref, action: "notInterested", on: true });
          if (before.rating !== null && before.rating !== item.rating) action.mutate({ ...ref, action: "rating", value: before.rating });
        },
      },
    );
  };
}

/** Hält den einen Tagebuchdialog: Jede Stelle, die «gesehen» kennt, öffnet denselben. */
export function DiaryProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; target: DiaryTarget; options: OpenOptions } | null>(null);
  const [open, setOpen] = useState(false);
  const library = useLibraryState();
  const create = useCreateDiaryEntry();
  const seriesAction = useLibraryAction({ silent: true });
  const undoEntry = useUndoDiaryEntry();

  const openDiary = useCallback<OpenDiary>((target, options = {}) => {
    setCurrent((previous) => ({ id: (previous?.id ?? 0) + 1, target, options }));
    setOpen(true);
  }, []);

  const save = (target: DiaryTarget, payload: DiaryPayload) => {
    const ref: MediaRef = { kind: target.kind, tmdbId: target.tmdbId };
    const before = library[refKey(ref)] ?? EMPTY_ITEM;
    create.mutate(
      { ...ref, ...payload },
      {
        onSuccess: ({ entry }) => {
          const message = before.watched ? "Sehvorgang im Tagebuch gespeichert" : "Als gesehen gespeichert";
          // Serien: Der Eintrag hat alle Episoden abgehakt. Einen früheren Teilstand kennt der Toast nicht.
          if (ref.kind === "tv" && before.episodesWatched > 0) {
            toast.success(message);
            return;
          }
          toast.success(message, {
            action: {
              label: "Rückgängig",
              onClick: () => (ref.kind === "tv" ? seriesAction.mutate({ ...ref, action: "watched", on: false }) : undoEntry(ref, entry.id, before)),
            },
          });
        },
      },
    );
  };

  return (
    <DiaryContext.Provider value={openDiary}>
      {children}
      {current ? (
        <DiaryWizard
          key={current.id}
          target={current.target}
          open={open}
          alreadySeen={Boolean(library[refKey(current.target)]?.watched)}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) current.options.onCancel?.();
          }}
          onSubmit={(payload) => {
            setOpen(false);
            if (current.options.onSubmit) current.options.onSubmit(payload);
            else save(current.target, payload);
          }}
        />
      ) : null}
    </DiaryContext.Provider>
  );
}
