"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { applyAction, type FlagAction } from "@/lib/library-transitions";
import { EMPTY_ITEM, type LibraryAction, type LibraryItem, type LibraryState } from "@/lib/library-types";
import type { MediaKind, MediaRef } from "@/lib/tmdb-types";
import { refKey } from "@/lib/tmdb-types";

export const LIBRARY_KEY = ["library"] as const;

export class ApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  }).catch(() => {
    throw new ApiFailure("offline", "Keine Verbindung zum Server. Prüfe deine Internetverbindung.", 0);
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiFailure(data?.error?.code ?? "error", data?.error?.message ?? "Das hat nicht geklappt. Versuche es noch einmal.", response.status);
  }
  return data as T;
}

export function LibraryProvider({ initial, children }: { initial: LibraryState; children: ReactNode }) {
  const [client] = useState(() => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
    });
    queryClient.setQueryData(LIBRARY_KEY, initial);
    return queryClient;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useLibraryState(): LibraryState {
  const { data } = useQuery<LibraryState>({
    queryKey: LIBRARY_KEY,
    queryFn: () => apiFetch<LibraryState>("/api/library"),
    staleTime: Infinity,
  });
  return data ?? {};
}

export function useLibraryItem(ref: MediaRef): LibraryItem {
  const state = useLibraryState();
  return state[refKey(ref)] ?? EMPTY_ITEM;
}

function toFlagAction(action: LibraryAction): FlagAction | null {
  switch (action.action) {
    case "watchlist":
      return { type: "watchlist", on: action.on };
    case "watched":
      return { type: "watched", on: action.on };
    case "favorite":
      return { type: "favorite", on: action.on };
    case "rating":
      return { type: "rating", value: action.value };
    case "notInterested":
      return { type: "notInterested", on: action.on };
    default:
      return null;
  }
}

/** Vorschau auf das Serverergebnis: dieselben Regeln wie im Backend, nur ohne Warten. */
export function optimisticItem(kind: MediaKind, item: LibraryItem, action: LibraryAction): LibraryItem {
  const flagAction = toFlagAction(action);
  if (flagAction) {
    const flags = applyAction(kind, item, flagAction);
    return { ...item, ...flags };
  }
  if (action.action === "episode") {
    return { ...item, episodesWatched: Math.max(0, item.episodesWatched + (action.on ? 1 : -1)) };
  }
  if (action.action === "pause") {
    return { ...item, seriesStatus: action.on ? "PAUSED" : item.seriesStatus === "PAUSED" ? "WATCHING" : item.seriesStatus };
  }
  return item;
}

const SUCCESS_MESSAGES: Partial<Record<LibraryAction["action"], (action: LibraryAction) => string | null>> = {
  watchlist: (action) => ("on" in action && action.on ? "Auf der Watchlist" : "Von der Watchlist entfernt"),
  watched: (action) => ("on" in action && action.on ? "Als gesehen markiert" : "Nicht mehr als gesehen markiert"),
  favorite: (action) => ("on" in action && action.on ? "Als Favorit markiert" : "Kein Favorit mehr"),
  notInterested: (action) => ("on" in action && action.on ? "Wird nicht mehr empfohlen" : "Kann wieder empfohlen werden"),
};

export function useLibraryAction(options: { silent?: boolean } = {}) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: LibraryAction) =>
      apiFetch<{ item: LibraryItem }>("/api/library", { method: "POST", body: JSON.stringify(action) }),
    onMutate: async (action) => {
      await client.cancelQueries({ queryKey: LIBRARY_KEY });
      const previous = client.getQueryData<LibraryState>(LIBRARY_KEY);
      const key = refKey(action);
      const current = previous?.[key] ?? EMPTY_ITEM;
      client.setQueryData<LibraryState>(LIBRARY_KEY, { ...previous, [key]: optimisticItem(action.kind, current, action) });
      return { previous };
    },
    onError: (error, _action, context) => {
      if (context?.previous) client.setQueryData(LIBRARY_KEY, context.previous);
      toast.error(error.message);
    },
    onSuccess: ({ item }, action) => {
      client.setQueryData<LibraryState>(LIBRARY_KEY, (state) => ({ ...state, [refKey(action)]: item }));
      if (options.silent) return;
      const message = SUCCESS_MESSAGES[action.action]?.(action);
      if (message) toast.success(message);
    },
  });
}

/** Übernimmt den Stand eines einzelnen Titels, etwa aus der Antwort einer anderen Schnittstelle. */
export function useSetLibraryItem() {
  const client = useQueryClient();
  return useCallback(
    (ref: MediaRef, item: LibraryItem) => client.setQueryData<LibraryState>(LIBRARY_KEY, (state) => ({ ...state, [refKey(ref)]: item })),
    [client],
  );
}

export function useReplaceLibraryState() {
  const client = useQueryClient();
  return (state: LibraryState) => client.setQueryData(LIBRARY_KEY, state);
}
