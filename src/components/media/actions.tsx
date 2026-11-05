"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bookmark, CalendarPlus, Check, ChevronDown, Eye, EyeOff, Heart, ListChecks, MoreHorizontal, Pause, Play, Plus, Share2, Star, ThumbsDown, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { type DiaryTarget, DiaryEntryEditor } from "@/components/diary/diary-dialog";
import { useOpenDiary } from "@/components/diary/diary-provider";
import { RatingScale } from "@/components/diary/rating-scale";
import { diaryKey, fetchDiaryEntries, useDeleteDiaryEntry, useUpdateDiaryEntry } from "@/components/diary/use-diary";
import { useLibraryAction, useLibraryItem } from "@/components/library/library-provider";
import { Button, buttonStyles } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/primitives";
import type { DiaryEntryView } from "@/lib/diary";
import { formatDate, pluralize } from "@/lib/format";
import type { MediaRef } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

export function WatchlistButton({ media, size = "lg" }: { media: MediaRef; size?: "md" | "lg" }) {
  const item = useLibraryItem(media);
  const action = useLibraryAction();
  return (
    <Button
      size={size}
      aria-pressed={item.watchlisted}
      onClick={() => action.mutate({ ...media, action: "watchlist", on: !item.watchlisted })}
    >
      <Bookmark className={cn(item.watchlisted && "text-tungsten")} fill={item.watchlisted ? "currentColor" : "none"} />
      {item.watchlisted ? "Auf der Watchlist" : "Zur Watchlist"}
    </Button>
  );
}

/**
 * Noch nicht gesehen: öffnet den Tagebuchdialog. Schon gesehen: ein Menü für alles, was danach
 * noch dazukommt. Die Liste der Sehvorgänge selbst steht im Panel weiter unten auf der Seite.
 */
export function SeenButton({ media, size = "lg" }: { media: DiaryTarget; size?: "md" | "lg" }) {
  const ref = { kind: media.kind, tmdbId: media.tmdbId };
  const item = useLibraryItem(ref);
  const openDiary = useOpenDiary();
  const client = useQueryClient();
  const action = useLibraryAction({ silent: true });
  const update = useUpdateDiaryEntry();
  const remove = useDeleteDiaryEntry();
  const [ratingOpen, setRatingOpen] = useState(false);
  const [editing, setEditing] = useState<DiaryEntryView | null>(null);
  const isSeries = media.kind === "tv";
  const seen = item.watched;

  if (!seen) {
    return (
      <Button size={size} onClick={() => openDiary(media)}>
        <Eye />
        {isSeries ? "Alles als gesehen markieren" : "Als gesehen markieren"}
      </Button>
    );
  }

  const completeDate = async () => {
    const { entries } = await client.fetchQuery({ queryKey: diaryKey(ref), queryFn: () => fetchDiaryEntries(ref) });
    const undated = entries.find((entry) => entry.watchedDate === null);
    if (undated) setEditing(undated);
    else toast.info(entries.length ? "Alle Sehvorgänge haben bereits ein Datum." : "Erfasse zuerst einen Sehvorgang.");
  };

  return (
    <>
      <Menu>
        <MenuTrigger className={buttonStyles({ size })}>
          <Check className="text-seen" strokeWidth={3} />
          Gesehen
          <ChevronDown className="text-fog" />
        </MenuTrigger>
        <MenuContent align="start">
          <MenuItem onSelect={() => openDiary(media)}>
            <Plus /> Weiteren Sehvorgang erfassen
          </MenuItem>
          <MenuItem onSelect={() => setRatingOpen(true)}>
            <Star /> Bewertung ändern
          </MenuItem>
          <MenuItem onSelect={() => void completeDate()}>
            <CalendarPlus /> Sehdatum ergänzen
          </MenuItem>
          <MenuItem onSelect={() => document.getElementById("sehvorgaenge")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
            <ListChecks /> Einträge bearbeiten
          </MenuItem>
        </MenuContent>
      </Menu>

      <Dialog open={ratingOpen} onOpenChange={setRatingOpen}>
        <DialogContent title="Bewertung ändern" description="Das ist deine aktuelle Gesamtbewertung. Bewertungen einzelner Sehvorgänge bleiben davon unberührt.">
          <div className="mt-5">
            <RatingScale
              value={item.rating}
              size="lg"
              label={`${media.title} bewerten`}
              onChange={(value) => action.mutate({ ...ref, action: "rating", value })}
              onCommit={() => setRatingOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

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
    </>
  );
}

export function FavoriteButton({ media }: { media: MediaRef }) {
  const item = useLibraryItem(media);
  const action = useLibraryAction();
  const label = item.favorite ? "Favorit entfernen" : "Als Favorit markieren";
  return (
    <Tooltip label={label}>
      <Button size="icon" className="size-12" aria-label={label} aria-pressed={item.favorite} onClick={() => action.mutate({ ...media, action: "favorite", on: !item.favorite })}>
        <Heart className={cn(item.favorite && "text-fav")} fill={item.favorite ? "currentColor" : "none"} />
      </Button>
    </Tooltip>
  );
}

export function RatingControl({ media, title }: { media: MediaRef; title: string }) {
  const item = useLibraryItem(media);
  const action = useLibraryAction({ silent: true });
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="lg" aria-label={item.rating ? `Deine Bewertung: ${item.rating} von 10. Ändern` : "Persönlich bewerten"}>
          <Star className={cn(item.rating && "text-ambient")} fill={item.rating ? "currentColor" : "none"} />
          {item.rating ? `${item.rating} von 10` : "Bewerten"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-2rem))]">
        <p className="mb-3 text-sm font-medium">Wie fandest du {title}?</p>
        <RatingScale
          value={item.rating}
          label={`${title} bewerten`}
          onChange={(value) => action.mutate({ ...media, action: "rating", value })}
          onCommit={(value) => {
            setOpen(false);
            toast.success(`Mit ${value} von 10 bewertet`);
          }}
        />
        {item.rating ? (
          <button
            type="button"
            onClick={() => {
              action.mutate({ ...media, action: "rating", value: null });
              setOpen(false);
              toast.success("Bewertung entfernt");
            }}
            className="mt-3 text-xs text-fog hover:text-screen"
          >
            Bewertung entfernen
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export function TrailerButton({ videoKey, title, size = "lg", variant = "secondary" }: { videoKey: string; title: string; size?: "md" | "lg"; variant?: "primary" | "secondary" }) {
  return (
    <Dialog>
      <DialogTrigger className={buttonStyles({ variant, size })}>
        <Play fill="currentColor" /> Trailer ansehen
      </DialogTrigger>
      <VideoDialog videoKey={videoKey} title={`Trailer zu ${title}`} />
    </Dialog>
  );
}

export function VideoDialog({ videoKey, title }: { videoKey: string; title: string }) {
  return (
    <DialogContent title={title} hideTitle className="max-w-5xl overflow-hidden bg-black p-0">
      {/* Steht vor dem Player: Der Dialog fokussiert das erste Element, und aus einem fremden iframe käme Escape nicht mehr zurück. */}
      <DialogClose aria-label="Schliessen" className="glass absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full">
        <X className="size-4" />
      </DialogClose>
      {/* Der Player lädt erst nach dem Klick und über die datensparsame Domain. */}
      <div className="aspect-video w-full">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoKey)}?autoplay=1&rel=0`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full"
        />
      </div>
    </DialogContent>
  );
}

export function ShareButton({ title }: { title: string }) {
  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success("Link kopiert");
  };
  return (
    <Tooltip label="Teilen">
      <Button size="icon" className="size-12" aria-label={`${title} teilen`} onClick={share}>
        <Share2 />
      </Button>
    </Tooltip>
  );
}

export function MoreMenu({ media, title }: { media: MediaRef; title: string }) {
  const item = useLibraryItem(media);
  const action = useLibraryAction();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isSeries = media.kind === "tv";
  const inProgress = isSeries && item.episodesWatched > 0 && item.seriesStatus !== "COMPLETED";

  return (
    <>
      <Menu>
        <Tooltip label="Weitere Aktionen">
          <MenuTrigger className={cn(buttonStyles({ size: "icon" }), "size-12")} aria-label={`Weitere Aktionen zu ${title}`}>
            <MoreHorizontal />
          </MenuTrigger>
        </Tooltip>
        <MenuContent>
          {inProgress ? (
            <MenuItem onSelect={() => action.mutate({ kind: "tv", tmdbId: media.tmdbId, action: "pause", on: item.seriesStatus !== "PAUSED" })}>
              {item.seriesStatus === "PAUSED" ? <Play /> : <Pause />}
              {item.seriesStatus === "PAUSED" ? "Weiterschauen" : "Pausieren"}
            </MenuItem>
          ) : null}
          {item.watched ? (
            <MenuItem onSelect={() => setConfirmOpen(true)}>
              <EyeOff /> Nicht mehr als gesehen markieren
            </MenuItem>
          ) : null}
          {inProgress || item.watched ? <MenuSeparator /> : null}
          <MenuItem onSelect={() => action.mutate({ ...media, action: "notInterested", on: !item.notInterested })}>
            <ThumbsDown /> {item.notInterested ? "Wieder empfehlen" : "Nicht interessiert"}
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Nicht mehr als gesehen markieren?"
          description={
            isSeries
              ? `Alle abgehakten Episoden und Tagebucheinträge zu ${title} werden gelöscht.`
              : `Alle Tagebucheinträge zu ${title}, deine Bewertung und der Favorit werden gelöscht.`
          }
        >
          <div className="mt-6 flex justify-end gap-2">
            <DialogClose className={buttonStyles({ variant: "ghost" })}>Abbrechen</DialogClose>
            <Button
              variant="danger"
              onClick={() => {
                action.mutate({ ...media, action: "watched", on: false });
                setConfirmOpen(false);
              }}
            >
              Einträge löschen
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const SERIES_STATUS_LABEL = {
  STARTED: "Angefangen",
  WATCHING: "Aktuell am Schauen",
  PAUSED: "Pausiert",
  COMPLETED: "Abgeschlossen",
} as const;

/** Der persönliche Stand als ruhige Zeile direkt beim Titel. */
export function PersonalStatus({ media }: { media: MediaRef }) {
  const item = useLibraryItem(media);
  const parts: string[] = [];

  if (media.kind === "tv") {
    if (item.seriesStatus) parts.push(SERIES_STATUS_LABEL[item.seriesStatus]);
  } else if (item.watched) {
    const date = formatDate(item.lastWatchedAt);
    parts.push(date ? `Zuletzt gesehen am ${date}` : "Gesehen");
    if (item.watchCount > 1) parts.push(pluralize(item.watchCount, "Mal", "Mal"));
  }
  if (item.rating) parts.push(`Deine Bewertung: ${item.rating} von 10`);
  if (item.favorite) parts.push("Favorit");
  if (item.notInterested) parts.push("Wird dir nicht empfohlen");

  if (parts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ambient">
      {parts.map((part) => (
        <li key={part}>{part}</li>
      ))}
    </ul>
  );
}
