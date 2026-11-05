"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ArrowUp, Bookmark, Eye, Info, SlidersHorizontal, Undo2, X } from "lucide-react";
import { AnimatePresence, motion, type PanInfo, useMotionValue, useTransform, type Variants } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useOpenDiary } from "@/components/diary/diary-provider";
import { DIARY_KEY } from "@/components/diary/use-diary";
import { FrameStrip } from "@/components/home/cards";
import { ApiFailure, apiFetch, optimisticItem, useLibraryState, useSetLibraryItem } from "@/components/library/library-provider";
import { AmbientSync } from "@/components/media/ambient";
import { ProviderLogos } from "@/components/media/provider-logos";
import { ImageFallback, TmdbImage } from "@/components/media/tmdb-image";
import { Button, buttonStyles } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/primitives";
import { ambientStyle } from "@/lib/ambient-color";
import type { DiaryPayload } from "@/lib/diary";
import { countActiveFilters, type DiscoveryCard, type DiscoveryFilters, type DiscoveryModeName, type DiscoveryQueueItem, type DiscoverySessionView, MODE_LABELS, type SwipeActionName } from "@/lib/discovery";
import { formatRating, formatRuntime, pluralize } from "@/lib/format";
import { type LibraryAction, EMPTY_ITEM, type LibraryItem } from "@/lib/library-types";
import { mediaHref, type MediaRef, refKey } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";
import { type DiscoveryOptions, FilterFields, ModePicker } from "./discovery-settings";

const DISCOVERY_KEY = ["discovery"] as const;
const STACK_SIZE = 3;
const OFFSET_THRESHOLD = 110;
const VELOCITY_THRESHOLD = 600;
const CARD_SIZES = "(max-width: 640px) 92vw, 480px";

type Direction = "left" | "right" | "up";

export interface DiscoveryClientState {
  session: DiscoverySessionView | null;
  mode: DiscoveryModeName;
  filters: DiscoveryFilters;
}

interface SwipeResponse {
  session: DiscoverySessionView;
  item: LibraryItem;
}

interface MotionContext {
  exit: Direction | null;
  enter: Direction | null;
}

const OFFSCREEN: Record<Direction, { x: number; y: number }> = {
  left: { x: -640, y: 40 },
  right: { x: 640, y: 40 },
  up: { x: 0, y: -860 },
};

const ACTION_DIRECTION: Record<SwipeActionName, Direction> = {
  interested: "right",
  not_interested: "left",
  watched: "up",
};

const cardVariants: Variants = {
  enter: ({ enter }: MotionContext) => (enter ? { ...OFFSCREEN[enter], opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9, y: 40 }),
  exit: ({ exit }: MotionContext) =>
    exit
      ? { ...OFFSCREEN[exit], opacity: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }
      : { opacity: 0, scale: 0.92, transition: { duration: 0.2 } },
};

function cardKey(card: Pick<DiscoveryCard, "kind" | "tmdbId">) {
  return refKey(card);
}

/** Über diese Karte wurde schon anderswo entschieden, etwa auf der Detailseite. */
function isDecided(item: LibraryItem | undefined, filters: DiscoveryFilters) {
  if (!item) return false;
  return item.notInterested || (filters.excludeSeen && item.watched) || (filters.excludeWatchlist && item.watchlisted);
}

function refOf(card: DiscoveryCard): MediaRef {
  return { kind: card.kind, tmdbId: card.tmdbId };
}

function libraryActionFor(card: DiscoveryCard, action: SwipeActionName): LibraryAction {
  const ref = refOf(card);
  if (action === "interested") return { ...ref, action: "watchlist", on: true };
  if (action === "not_interested") return { ...ref, action: "notInterested", on: true };
  return { ...ref, action: "watched", on: true };
}

function CardBody({ card }: { card: DiscoveryCard }) {
  const runtime = card.kind === "tv" ? (card.seasons ? pluralize(card.seasons, "Staffel", "Staffeln") : null) : formatRuntime(card.runtime);
  const rating = formatRating(card.voteAverage);
  return (
    <div className="@container absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink from-45% via-ink/85 to-transparent p-5 pt-24 sm:p-6 sm:pt-28">
      <h2 className="font-display line-clamp-2 text-[1.75rem] font-medium leading-[1.08] text-balance @[22rem]:text-[2.1rem]">{card.title}</h2>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-screen/90">
        {card.year ? <span>{card.year}</span> : null}
        {runtime ? <span>{runtime}</span> : null}
        {card.kind === "tv" ? <span>Serie</span> : null}
        {rating ? <span>TMDB {rating}</span> : null}
      </p>
      {card.genres.length ? <p className="mt-1 truncate text-sm text-fog">{card.genres.join(", ")}</p> : null}
      <ProviderLogos providers={card.streaming ?? []} className="mt-2" />
      {card.overview ? <p className="mt-2.5 hidden text-sm leading-relaxed text-screen/80 line-clamp-3 @[15rem]:[display:-webkit-box]">{card.overview}</p> : null}
      {card.reason ? <p className="mt-2.5 text-sm font-medium leading-snug text-ambient line-clamp-2">{card.reason}</p> : null}
    </div>
  );
}

function SwipeCard({
  item,
  depth,
  context,
  onDecide,
}: {
  item: DiscoveryQueueItem;
  depth: number;
  context: MotionContext;
  onDecide: (direction: Direction) => void;
}) {
  const { card } = item;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-14, 14]);
  const right = useTransform(x, [24, 140], [0, 1]);
  const left = useTransform(x, [-140, -24], [1, 0]);
  const up = useTransform(y, [-150, -30], [1, 0]);
  const isTop = depth === 0;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    const vertical = Math.abs(offset.y) > Math.abs(offset.x);
    if (vertical && (offset.y < -OFFSET_THRESHOLD || velocity.y < -VELOCITY_THRESHOLD)) onDecide("up");
    else if (!vertical && (offset.x > OFFSET_THRESHOLD || velocity.x > VELOCITY_THRESHOLD)) onDecide("right");
    else if (!vertical && (offset.x < -OFFSET_THRESHOLD || velocity.x < -VELOCITY_THRESHOLD)) onDecide("left");
  };

  return (
    <motion.div
      variants={cardVariants}
      custom={context}
      initial="enter"
      animate={{ x: 0, y: depth * 14, scale: 1 - depth * 0.045, opacity: 1 }}
      exit="exit"
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      drag={isTop}
      dragSnapToOrigin
      dragElastic={0.85}
      dragMomentum={false}
      onDragEnd={onDragEnd}
      style={{ x, y, rotate, zIndex: 10 - depth, touchAction: isTop ? "none" : undefined }}
      aria-hidden={!isTop}
      className={cn("absolute inset-0 select-none", isTop ? "cursor-grab active:cursor-grabbing" : "pointer-events-none")}
    >
      <article style={ambientStyle(card.ambient)} className="relative size-full overflow-hidden rounded-[20px] bg-ink-raised shadow-2xl shadow-black/60 ring-1 ring-white/10 [&_img]:pointer-events-none">
        {card.posterPath ? (
          <TmdbImage path={card.posterPath} kind="poster" alt="" sizes={CARD_SIZES} preload />
        ) : card.backdropPath ? (
          <TmdbImage path={card.backdropPath} kind="backdrop" alt="" sizes={CARD_SIZES} preload />
        ) : (
          <ImageFallback title={card.title} />
        )}
        <CardBody card={card} />

        {isTop ? (
          <>
            <motion.div aria-hidden="true" style={{ opacity: right }} className="pointer-events-none absolute inset-0 bg-gradient-to-br from-seen/55 via-seen/15 to-transparent">
              <span className="absolute left-5 top-5 flex items-center gap-1.5 rounded-full bg-seen px-3 py-1.5 text-sm font-semibold text-ink">
                <Bookmark className="size-4" fill="currentColor" /> Zur Watchlist
              </span>
            </motion.div>
            <motion.div aria-hidden="true" style={{ opacity: left }} className="pointer-events-none absolute inset-0 bg-gradient-to-bl from-danger/50 via-danger/15 to-transparent">
              <span className="absolute right-5 top-5 flex items-center gap-1.5 rounded-full bg-danger px-3 py-1.5 text-sm font-semibold text-ink">
                <X className="size-4" strokeWidth={3} /> Nicht interessiert
              </span>
            </motion.div>
            <motion.div aria-hidden="true" style={{ opacity: up }} className="pointer-events-none absolute inset-0 bg-gradient-to-b from-tungsten/50 via-tungsten/10 to-transparent">
              <span className="absolute left-1/2 top-5 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-tungsten px-3 py-1.5 text-sm font-semibold text-ink">
                <Eye className="size-4" /> Bereits gesehen
              </span>
            </motion.div>
          </>
        ) : null}
      </article>
    </motion.div>
  );
}

const KBD = "ml-1 hidden rounded border border-white/15 px-1 align-[-1px] font-sans text-[10px] text-fog-dim lg:inline-block [&_svg]:inline [&_svg]:size-2.5";

function DeckButton({ label, shortcut, keys, onClick, tone, disabled, children }: { label: string; shortcut: React.ReactNode; keys: string; onClick: () => void; tone: "reject" | "seen" | "keep"; disabled?: boolean; children: React.ReactNode }) {
  const tones = {
    reject: "bg-danger/14 text-danger hover:bg-danger/24",
    seen: "bg-white/10 text-screen hover:bg-white/16",
    keep: "bg-seen/16 text-seen hover:bg-seen/26",
  };
  return (
    <button type="button" aria-keyshortcuts={keys} onClick={onClick} disabled={disabled} className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl outline-none disabled:opacity-40">
      <span className={cn("flex size-14 items-center justify-center rounded-full transition-[background-color,transform] duration-150 group-active:scale-90 group-focus-visible:ring-2 group-focus-visible:ring-screen [&_svg]:size-6", tones[tone])}>{children}</span>
      <span className="text-center text-[11px] leading-tight text-fog group-hover:text-screen sm:text-xs">
        {label}
        <kbd className={KBD}>{shortcut}</kbd>
      </span>
    </button>
  );
}

function SideButton({ label, shortcut, children }: { label: string; shortcut: string; children: React.ReactNode }) {
  return (
    <>
      {children}
      <span className="text-center text-[11px] leading-tight text-fog sm:text-xs">
        {label}
        <kbd className={KBD}>{shortcut}</kbd>
      </span>
    </>
  );
}

const STAGE = "relative mx-auto aspect-[2/3] h-[clamp(20rem,calc(100dvh-18.5rem-env(safe-area-inset-bottom)),46rem)] max-w-full lg:h-[clamp(20rem,calc(100dvh-14.5rem),46rem)]";

function DeckSkeleton({ note }: { note?: string }) {
  return (
    <div className="gutter flex flex-col items-center pb-20 pt-24 lg:pb-8" aria-busy="true">
      <p aria-live="polite" className="mb-5 text-sm text-fog">
        {note ?? "Karten werden geladen"}
      </p>
      <div className={STAGE}>
        <div className="skeleton size-full rounded-[20px]" />
      </div>
    </div>
  );
}

function StartScreen({
  mode,
  filters,
  options,
  starting,
  problem,
  onStart,
}: {
  mode: DiscoveryModeName;
  filters: DiscoveryFilters;
  options: DiscoveryOptions;
  starting: boolean;
  problem: string | null;
  onStart: (mode: DiscoveryModeName, filters: DiscoveryFilters) => void;
}) {
  const [draftMode, setDraftMode] = useState(mode);
  const [draftFilters, setDraftFilters] = useState(filters);
  const active = countActiveFilters(draftFilters);

  return (
    <div className="gutter relative pb-24 pt-24 lg:pb-12 lg:pt-28">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-70" />
      <header className="max-w-3xl">
        <h1 className="font-display text-title-lg font-medium leading-[1.05] text-balance">Was schaust du als Nächstes?</h1>
        <p className="mt-3 max-w-xl text-fog">Rechts merkt sich den Titel, links lehnt ihn ab, nach oben trägt ihn als gesehen ein. Jede Entscheidung macht die nächsten Vorschläge genauer.</p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
        <div>
          <ModePicker value={draftMode} onChange={setDraftMode} />
          <Button variant="primary" size="lg" className="mt-5 w-full" disabled={starting} onClick={() => onStart(draftMode, draftFilters)}>
            {starting ? "Karten werden gemischt" : "Swipe starten"}
          </Button>
          {problem ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {problem}
            </p>
          ) : null}
        </div>
        <details className="group min-w-0 lg:[&>summary]:hidden" open>
          <summary className="cursor-pointer select-none text-sm font-medium">Filter{active ? ` (${active})` : ""}</summary>
          <div className="mt-4 lg:mt-0">
            <FilterFields value={draftFilters} onChange={setDraftFilters} options={options} />
          </div>
        </details>
      </div>
    </div>
  );
}

function Summary({ session, canUndo, onUndo, onRestart }: { session: DiscoverySessionView; canUndo: boolean; onUndo: () => void; onRestart: () => void }) {
  const { interested, notInterested, watched } = session.counts;
  const figures = [
    { value: interested, label: "Auf die Watchlist" },
    { value: watched, label: "Als gesehen" },
    { value: notInterested, label: "Abgelehnt" },
  ];
  return (
    <div className="gutter relative flex min-h-[70dvh] flex-col justify-center pb-24 pt-24 lg:pb-12">
      <div className="ambient-light absolute inset-x-0 top-0 -z-10 h-[50vh] opacity-70" />
      <h1 className="font-display text-title-lg font-medium leading-[1.05]">Alle Karten gesehen</h1>
      <p className="mt-3 max-w-xl text-fog">Deine Entscheidungen fliessen jetzt in die Empfehlungen ein.</p>
      <dl className="mt-8 flex flex-wrap gap-x-12 gap-y-5">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dd className="text-title-md font-semibold leading-none">{figure.value}</dd>
            <dt className="mt-2 text-sm text-fog">{figure.label}</dt>
          </div>
        ))}
      </dl>
      <div className="mt-8 flex flex-wrap gap-2.5">
        <Button variant="primary" size="lg" onClick={onRestart}>
          Neue Karten
        </Button>
        {interested > 0 ? (
          <Link href="/watchlist" className={buttonStyles({ size: "lg" })}>
            Zur Watchlist
          </Link>
        ) : null}
        {canUndo ? (
          <Button size="lg" variant="ghost" onClick={onUndo}>
            <Undo2 /> Letzte Karte zurückholen
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SwipeDeck({ initial, options }: { initial: DiscoveryClientState; options: DiscoveryOptions }) {
  const router = useRouter();
  const client = useQueryClient();
  const library = useLibraryState();
  const setItem = useSetLibraryItem();
  const openDiary = useOpenDiary();
  const [mountedAt] = useState(() => Date.now());

  // Der Cache lebt im Layout. Nach einem Ausflug auf die Detailseite geht es genau hier weiter.
  const { data: state = initial } = useQuery<DiscoveryClientState>({
    queryKey: DISCOVERY_KEY,
    queryFn: () => apiFetch<DiscoveryClientState>("/api/discovery"),
    initialData: initial,
    initialDataUpdatedAt: mountedAt,
    staleTime: 15_000,
  });

  const [inFlight, setInFlight] = useState<readonly string[]>([]);
  const [context, setContext] = useState<MotionContext>({ exit: null, enter: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restart, setRestart] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const directions = useRef<Direction[]>([]);

  // Anfragen laufen strikt nacheinander, damit Reihenfolge und Rückgängig eindeutig bleiben.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const enqueue = (task: () => Promise<void>) => {
    chain.current = chain.current.then(task, task);
  };

  const setSession = (session: DiscoverySessionView | null) => client.setQueryData<DiscoveryClientState>(DISCOVERY_KEY, (current) => ({ ...(current ?? initial), session }));
  const reloadSession = () => void client.invalidateQueries({ queryKey: DISCOVERY_KEY });

  /** Eine in einem anderen Tab abgelöste Session zählt nicht mehr; der aktuelle Stand kommt vom Server. */
  const applySessionResult = (next: DiscoverySessionView) => {
    if (next.state === "ABANDONED") reloadSession();
    else setSession(next);
  };
  const showFailure = (error: unknown) => {
    if (error instanceof ApiFailure && error.status === 409) reloadSession();
    toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
  };

  const start = useMutation({
    // Läuft in derselben Reihe wie die Swipes: Eine späte Antwort darf die neue Session nicht überschreiben.
    mutationFn: (input: { mode: DiscoveryModeName; filters: DiscoveryFilters }) =>
      new Promise<{ session: DiscoverySessionView }>((resolve, reject) => {
        enqueue(() => apiFetch<{ session: DiscoverySessionView }>("/api/discovery", { method: "POST", body: JSON.stringify(input) }).then(resolve, reject));
      }),
    onMutate: () => setProblem(null),
    onError: (error) => {
      setProblem(error.message);
      toast.error(error.message);
    },
    onSuccess: ({ session }, { mode, filters }) => {
      client.setQueryData<DiscoveryClientState>(DISCOVERY_KEY, { session, mode, filters });
      setInFlight([]);
      directions.current = [];
      setSettingsOpen(false);
      setRestart(false);
    },
  });

  const session = state.session;
  const sessionId = session?.id;

  // Der Startknopf liegt auf dem Handy weit unten; die Karte muss danach ganz im Bild sein.
  useEffect(() => {
    if (sessionId) window.scrollTo({ top: 0 });
  }, [sessionId]);

  const queue = (session?.queue ?? []).filter((item) => !inFlight.includes(cardKey(item.card)));
  const visible = queue.filter((item) => !session || !isDecided(library[cardKey(item.card)], session.filters));
  const top = visible[0];

  // Wurde eine Karte anderswo entschieden, liefert der Server die nächsten nach.
  const decidedElsewhere = queue.filter((item) => !visible.includes(item)).map((item) => cardKey(item.card)).join();
  useEffect(() => {
    if (decidedElsewhere) void client.invalidateQueries({ queryKey: DISCOVERY_KEY });
  }, [client, decidedElsewhere]);

  const act = (item: DiscoveryQueueItem, action: SwipeActionName, diary?: DiaryPayload) => {
    if (!session || start.isPending) return;
    const { card } = item;
    const key = cardKey(card);
    const ref = refOf(card);
    const previous = library[key] ?? EMPTY_ITEM;
    const direction = ACTION_DIRECTION[action];

    directions.current.push(direction);
    setContext({ exit: direction, enter: null });
    setInFlight((current) => [...current, key]);
    setItem(ref, optimisticItem(card.kind, previous, libraryActionFor(card, action)));
    const labels = { interested: "Zur Watchlist hinzugefügt", not_interested: "Abgelehnt", watched: "Als gesehen gespeichert" };
    setAnnouncement(`${card.title}: ${labels[action]}`);

    enqueue(async () => {
      try {
        const result = await apiFetch<SwipeResponse>("/api/discovery/swipe", {
          method: "POST",
          body: JSON.stringify({ sessionId: session.id, ...ref, action, ...(diary ? { diary } : {}) }),
        });
        setItem(ref, result.item);
        applySessionResult(result.session);
        if (action === "watched") void client.invalidateQueries({ queryKey: DIARY_KEY });
      } catch (error) {
        directions.current.pop();
        setItem(ref, previous);
        setContext({ exit: null, enter: direction });
        showFailure(error);
      } finally {
        setInFlight((current) => current.filter((other) => other !== key));
      }
    });
  };

  const decide = (direction: Direction) => {
    if (!top) return;
    if (direction === "right") act(top, "interested");
    else if (direction === "left") act(top, "not_interested");
    else {
      openDiary(
        { ...refOf(top.card), title: top.card.title, posterPath: top.card.posterPath, year: top.card.year },
        { onSubmit: (payload) => act(top, "watched", payload) },
      );
    }
  };

  const undo = () => {
    if (!session || start.isPending) return;
    const direction = directions.current.pop() ?? "left";
    enqueue(async () => {
      try {
        const result = await apiFetch<SwipeResponse & { ref: MediaRef }>("/api/discovery/undo", { method: "POST", body: JSON.stringify({ sessionId: session.id }) });
        setContext({ exit: null, enter: direction });
        // Zuerst die Bibliothek: Sonst wäre die zurückgeholte Karte kurz als «entschieden» ausgeblendet.
        setItem(result.ref, result.item);
        applySessionResult(result.session);
        void client.invalidateQueries({ queryKey: DIARY_KEY });
        setAnnouncement(`${result.session.queue[0]?.card.title ?? "Karte"} ist zurück`);
      } catch (error) {
        showFailure(error);
      }
    });
  };

  const canUndo = Boolean(session?.canUndo) || inFlight.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable], [role='dialog'], [role='menu'], [role='listbox']")) return;
      if (document.querySelector("[role='dialog']")) return;
      const key = event.key.toLowerCase();
      if ((key === "u" || key === "backspace") && canUndo) {
        event.preventDefault();
        undo();
        return;
      }
      if (!top) return;
      if (key === "arrowright") decide("right");
      else if (key === "arrowleft") decide("left");
      else if (key === "arrowup") decide("up");
      else if (key === "i") router.push(mediaHref(top.card));
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (start.isPending && !session) return <DeckSkeleton note="Karten werden gemischt" />;

  const finished = session !== null && (session.state === "COMPLETED" || session.queue.length === 0) && inFlight.length === 0;

  if (!session || restart) {
    return (
      <StartScreen
        mode={state.mode}
        filters={state.filters}
        options={options}
        starting={start.isPending}
        problem={problem}
        onStart={(mode, filters) => start.mutate({ mode, filters })}
      />
    );
  }

  if (finished) return <Summary session={session} canUndo={session.canUndo} onUndo={undo} onRestart={() => setRestart(true)} />;

  const done = Math.min(session.total, session.done + inFlight.length);
  const preloads = visible.slice(STACK_SIZE);

  return (
    <div className="relative flex flex-col items-center overflow-x-clip px-4 pb-20 pt-[4.25rem] lg:pb-6">
      <AmbientSync ambient={top?.card.ambient} />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <AnimatePresence initial={false}>
          {top?.card.backdropPath ? (
            <motion.div key={top.card.backdropPath} initial={{ opacity: 0 }} animate={{ opacity: 0.28 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }} className="absolute inset-0 hidden lg:block">
              <TmdbImage path={top.card.backdropPath} kind="backdrop" alt="" sizes="480px" className="scale-110 blur-2xl" />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="ambient-light absolute inset-x-0 top-0 h-[60vh]" />
      </div>

      <h1 className="sr-only">Swipe</h1>
      <p className="sr-only" aria-live="polite">
        {announcement}
        {top ? ` Aktuelle Karte: ${top.card.title}${top.card.year ? `, ${top.card.year}` : ""}. ${top.card.reason ?? ""}` : ""}
      </p>

      <div className="mb-3 flex w-full max-w-[30rem] items-center gap-3">
        <Button size="sm" onClick={() => setSettingsOpen(true)} aria-label="Modus und Filter ändern">
          <SlidersHorizontal /> {MODE_LABELS[session.mode].title}
          {countActiveFilters(session.filters) ? <span className="tabular-nums text-fog">{countActiveFilters(session.filters)}</span> : null}
        </Button>
        <div className="min-w-0 flex-1">
          <FrameStrip seen={done} total={session.total} label={`${done} von ${session.total} Karten`} />
        </div>
        <p className="shrink-0 text-xs tabular-nums text-fog">
          {done} von {session.total}
        </p>
      </div>

      <div className={STAGE}>
        {top ? null : <div className="skeleton absolute inset-0 rounded-[20px]" />}
        <AnimatePresence custom={context} initial={false}>
          {visible
            .slice(0, STACK_SIZE)
            .map((item, depth) => <SwipeCard key={cardKey(item.card)} item={item} depth={depth} context={context} onDecide={decide} />)
            .reverse()}
        </AnimatePresence>
      </div>

      {/* Die nächsten Plakate liegen schon im Browser-Cache, wenn ihre Karte drankommt. */}
      <div aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden opacity-0">
        {preloads.map((item) =>
          item.card.posterPath ? (
            <span key={cardKey(item.card)} className="relative block size-px">
              <TmdbImage path={item.card.posterPath} kind="poster" alt="" sizes={CARD_SIZES} preload />
            </span>
          ) : null,
        )}
      </div>

      <div className="mt-5 grid w-full max-w-[30rem] grid-cols-5 items-start gap-1">
        <div className="flex flex-col items-center gap-1.5 pt-1.5">
          <SideButton label="Zurück" shortcut="U">
            <button type="button" aria-label="Letzte Aktion rückgängig machen" disabled={!canUndo} onClick={undo} className={cn(buttonStyles({ size: "icon" }), "size-11")}>
              <Undo2 />
            </button>
          </SideButton>
        </div>
        <DeckButton label="Nicht interessiert" shortcut={<ArrowLeft />} keys="ArrowLeft" tone="reject" disabled={!top} onClick={() => decide("left")}>
          <X strokeWidth={2.5} />
        </DeckButton>
        <DeckButton label="Bereits gesehen" shortcut={<ArrowUp />} keys="ArrowUp" tone="seen" disabled={!top} onClick={() => decide("up")}>
          <Eye />
        </DeckButton>
        <DeckButton label="Zur Watchlist" shortcut={<ArrowRight />} keys="ArrowRight" tone="keep" disabled={!top} onClick={() => decide("right")}>
          <Bookmark />
        </DeckButton>
        <div className="flex flex-col items-center gap-1.5 pt-1.5">
          <SideButton label="Details" shortcut="I">
            {top ? (
              <Link href={mediaHref(top.card)} aria-label={`Details zu ${top.card.title}`} className={cn(buttonStyles({ size: "icon" }), "size-11")}>
                <Info />
              </Link>
            ) : (
              <span className={cn(buttonStyles({ size: "icon" }), "size-11 opacity-40")}>
                <Info />
              </span>
            )}
          </SideButton>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        session={session}
        options={options}
        starting={start.isPending}
        problem={problem}
        onStart={(mode, filters) => start.mutate({ mode, filters })}
      />
    </div>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  session,
  options,
  starting,
  problem,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: DiscoverySessionView;
  options: DiscoveryOptions;
  starting: boolean;
  problem: string | null;
  onStart: (mode: DiscoveryModeName, filters: DiscoveryFilters) => void;
}) {
  const [mode, setMode] = useState(session.mode);
  const [filters, setFilters] = useState(session.filters);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Modus und Filter" description="Änderungen starten neue Karten. Deine bisherigen Entscheidungen bleiben gespeichert." className="max-w-2xl">
        <div className="mt-5 space-y-7">
          <ModePicker value={mode} onChange={setMode} />
          <FilterFields value={filters} onChange={setFilters} options={options} />
        </div>
        {problem ? (
          <p role="alert" className="mt-4 text-sm text-danger">
            {problem}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2 border-t border-white/8 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button variant="primary" disabled={starting} onClick={() => onStart(mode, filters)}>
            {starting ? "Karten werden gemischt" : "Neue Karten starten"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
