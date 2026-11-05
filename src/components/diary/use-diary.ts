"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, LIBRARY_KEY, optimisticItem, useSetLibraryItem } from "@/components/library/library-provider";
import type { CreateDiaryEntry, DiaryEntryView, UpdateDiaryEntry } from "@/lib/diary";
import type { LibraryItem, LibraryState } from "@/lib/library-types";
import { EMPTY_ITEM } from "@/lib/library-types";
import type { MediaRef } from "@/lib/tmdb-types";
import { refKey } from "@/lib/tmdb-types";

interface DiaryResponse {
  entry: DiaryEntryView;
  item: LibraryItem;
}

export const DIARY_KEY = ["diary"] as const;
export const diaryKey = (ref: MediaRef) => [...DIARY_KEY, refKey(ref)] as const;

/** Legt einen Sehvorgang an. Der Status steht sofort, die Antwort ersetzt die Vorschau. */
export function useCreateDiaryEntry() {
  const client = useQueryClient();
  const setItem = useSetLibraryItem();
  return useMutation({
    mutationFn: (input: CreateDiaryEntry) => apiFetch<DiaryResponse>("/api/diary", { method: "POST", body: JSON.stringify(input) }),
    onMutate: (input) => {
      const previous = client.getQueryData<LibraryState>(LIBRARY_KEY)?.[refKey(input)] ?? EMPTY_ITEM;
      setItem(input, optimisticItem(input.kind, previous, { kind: input.kind, tmdbId: input.tmdbId, action: "watched", on: true }));
      return { previous };
    },
    onError: (error, input, context) => {
      if (context) setItem(input, context.previous);
      toast.error(error.message);
    },
    onSuccess: ({ item }, input) => {
      setItem(input, item);
      void client.invalidateQueries({ queryKey: DIARY_KEY });
    },
  });
}

export function useUpdateDiaryEntry() {
  const client = useQueryClient();
  const setItem = useSetLibraryItem();
  return useMutation({
    mutationFn: ({ input }: { ref: MediaRef; input: UpdateDiaryEntry }) => apiFetch<DiaryResponse>("/api/diary", { method: "PATCH", body: JSON.stringify(input) }),
    onError: (error) => toast.error(error.message),
    onSuccess: ({ item }, { ref }) => {
      setItem(ref, item);
      void client.invalidateQueries({ queryKey: DIARY_KEY });
    },
  });
}

export function useDeleteDiaryEntry() {
  const client = useQueryClient();
  const setItem = useSetLibraryItem();
  return useMutation({
    mutationFn: ({ id }: { ref: MediaRef; id: string }) => apiFetch<{ item: LibraryItem }>(`/api/diary?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onError: (error) => toast.error(error.message),
    onSuccess: ({ item }, { ref }) => {
      setItem(ref, item);
      void client.invalidateQueries({ queryKey: DIARY_KEY });
    },
  });
}

/** Alle Sehvorgänge eines Titels; wird erst geladen, wenn es überhaupt welche geben kann. */
export function useDiaryEntries(ref: MediaRef, enabled: boolean) {
  return useQuery({
    queryKey: diaryKey(ref),
    enabled,
    queryFn: () => fetchDiaryEntries(ref),
    select: (data) => data.entries,
  });
}

export function fetchDiaryEntries(ref: MediaRef) {
  return apiFetch<{ entries: DiaryEntryView[] }>(`/api/diary?kind=${ref.kind}&tmdbId=${ref.tmdbId}`);
}
