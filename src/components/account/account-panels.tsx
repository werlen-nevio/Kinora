"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Monitor, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Field, FormError } from "@/components/auth/field";
import { type HeaderUser, UserAvatar } from "@/components/layout/header";
import { apiFetch, useLibraryAction, useReplaceLibraryState } from "@/components/library/library-provider";
import { TmdbImage } from "@/components/media/tmdb-image";
import { Button, buttonStyles } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger, Select, Switch } from "@/components/ui/primitives";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { formatDate, pluralize } from "@/lib/format";
import type { LibraryState } from "@/lib/library-types";
import { SUPPORTED_LANGUAGES, SUPPORTED_REGIONS } from "@/lib/locale";
import type { Genre } from "@/lib/tmdb-types";
import { cn } from "@/lib/utils";

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-5 border-t border-white/8 py-9 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12">
      <div>
        <h2 className="font-display text-title-sm font-medium">{title}</h2>
        {description ? <p className="mt-1.5 text-sm text-fog">{description}</p> : null}
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </section>
  );
}

export function AccountPanels({
  user,
  language,
  region,
  showWhy,
  genres,
  genrePrefs,
}: {
  user: HeaderUser;
  language: string;
  region: string;
  showWhy: boolean;
  genres: Genre[];
  genrePrefs: { genreId: number; weight: number }[];
}) {
  return (
    <div className="mt-8">
      <ProfilePanel user={user} />
      <PreferencesPanel language={language} region={region} showWhy={showWhy} />
      <GenrePanel genres={genres} initial={genrePrefs} />
      <RejectedPanel />
      <PasswordPanel />
      <SessionsPanel />
      <DataPanel />
    </div>
  );
}

function ProfilePanel({ user }: { user: HeaderUser }) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    const { error } = await authClient.updateUser({ name: trimmed });
    setSaving(false);
    if (error) toast.error(authErrorMessage(error));
    else {
      toast.success("Anzeigename gespeichert");
      router.refresh();
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("avatar", file);
    try {
      await apiFetch("/api/account/avatar", { method: "POST", body: form });
      toast.success("Profilbild gespeichert");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeAvatar = async () => {
    await apiFetch("/api/account/avatar", { method: "DELETE" }).catch(() => toast.error("Das Profilbild liess sich nicht entfernen."));
    router.refresh();
  };

  return (
    <Panel title="Profil">
      <div className="flex items-center gap-4">
        <UserAvatar user={user} className="size-20 text-2xl" />
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Profilbild auswählen" onChange={(event) => void upload(event.target.files?.[0])} />
          <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Upload /> {user.image ? "Bild ersetzen" : "Bild hochladen"}
          </Button>
          {user.image ? (
            <Button variant="ghost" onClick={removeAvatar}>
              Bild entfernen
            </Button>
          ) : null}
        </div>
      </div>
      <form onSubmit={saveName} className="mt-6 space-y-4">
        <Field label="Anzeigename" name="displayName" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} required />
        <Field label="E-Mail" name="emailReadonly" value={user.email} readOnly disabled className="opacity-60" />
        <Button type="submit" variant="primary" disabled={saving || name.trim() === user.name}>
          Änderungen speichern
        </Button>
      </form>
    </Panel>
  );
}

function PreferencesPanel({ language, region, showWhy }: { language: string; region: string; showWhy: boolean }) {
  const router = useRouter();
  const save = async (patch: object, message: string) => {
    try {
      await apiFetch("/api/account/preferences", { method: "PATCH", body: JSON.stringify(patch) });
      toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
    }
  };
  return (
    <Panel title="Sprache und Region" description="Die Sprache gilt für Titel und Beschreibungen von TMDB, die Region für Anbieter und Altersfreigaben. Die Oberfläche selbst ist auf Deutsch.">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="text-sm font-medium">
            Bevorzugte Sprache
            <Select
              label="Bevorzugte Sprache"
              className="mt-1.5 w-full font-normal"
              value={language}
              onValueChange={(value) => void save({ language: value }, "Sprache gespeichert")}
              options={SUPPORTED_LANGUAGES.map((entry) => ({ value: entry.code, label: entry.label }))}
            />
          </div>
          <div className="text-sm font-medium">
            Region
            <Select
              label="Region"
              className="mt-1.5 w-full font-normal"
              value={region}
              onValueChange={(value) => void save({ region: value }, "Region gespeichert")}
              options={SUPPORTED_REGIONS.map((entry) => ({ value: entry.code, label: entry.label }))}
            />
          </div>
        </div>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>
            <span className="block font-medium">Begründungen anzeigen</span>
            <span className="text-fog">Zeigt bei Empfehlungen, warum sie zu dir passen.</span>
          </span>
          <Switch defaultChecked={showWhy} onCheckedChange={(value) => void save({ showRecommendationWhy: value }, "Einstellung gespeichert")} />
        </label>
      </div>
    </Panel>
  );
}

function GenrePanel({ genres, initial }: { genres: Genre[]; initial: { genreId: number; weight: number }[] }) {
  const [prefs, setPrefs] = useState<ReadonlyMap<number, number>>(() => new Map(initial.map((entry) => [entry.genreId, entry.weight])));
  const [saving, setSaving] = useState(false);

  if (genres.length === 0) return null;

  // Kreislauf pro Klick: neutral, mag ich, mag ich nicht.
  const cycle = (id: number) =>
    setPrefs((current) => {
      const next = new Map(current);
      const value = next.get(id);
      if (value === undefined) next.set(id, 1);
      else if (value === 1) next.set(id, -1);
      else next.delete(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/account/preferences", {
        method: "PATCH",
        body: JSON.stringify({ genres: [...prefs.entries()].map(([genreId, weight]) => ({ genreId, weight })) }),
      });
      toast.success("Genre-Vorlieben gespeichert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="Genre-Vorlieben" description="Ein Klick: mag ich. Zweiter Klick: mag ich nicht. Dritter Klick: neutral. Das fliesst in deine Empfehlungen ein.">
      <div className="flex flex-wrap gap-1.5">
        {genres.map((genre) => {
          const value = prefs.get(genre.id);
          return (
            <button
              key={genre.id}
              type="button"
              onClick={() => cycle(genre.id)}
              aria-label={`${genre.name}: ${value === 1 ? "mag ich" : value === -1 ? "mag ich nicht" : "neutral"}`}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] transition-colors",
                value === 1 ? "bg-seen font-medium text-ink" : value === -1 ? "bg-danger/20 text-danger line-through" : "bg-white/8 text-screen/85 hover:bg-white/14",
              )}
            >
              {genre.name}
            </button>
          );
        })}
      </div>
      <Button variant="primary" className="mt-5" onClick={save} disabled={saving}>
        Vorlieben speichern
      </Button>
    </Panel>
  );
}

function PasswordPanel() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.changePassword({
      currentPassword: String(form.get("currentPassword")),
      newPassword: String(form.get("newPassword")),
      revokeOtherSessions: true,
    });
    setPending(false);
    if (failure) {
      setError(authErrorMessage(failure));
      return;
    }
    formElement.reset();
    toast.success("Passwort geändert. Andere Geräte sind abgemeldet.");
  };

  return (
    <Panel title="Passwort" description="Nach dem Ändern sind alle anderen Geräte abgemeldet.">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="Aktuelles Passwort" name="currentPassword" type="password" autoComplete="current-password" required />
        <Field label="Neues Passwort" name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required hint="Mindestens 10 Zeichen." />
        <Button type="submit" disabled={pending}>
          Passwort ändern
        </Button>
      </form>
    </Panel>
  );
}

interface SessionRow {
  id: string;
  token: string;
  createdAt: string | Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

function describeAgent(agent: string | null | undefined) {
  if (!agent) return "Unbekanntes Gerät";
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  const system = /Windows/.test(agent) ? "Windows" : /Android/.test(agent) ? "Android" : /iPhone|iPad/.test(agent) ? "iOS" : /Mac OS/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} auf ${system}` : browser;
}

function SessionsPanel() {
  const client = useQueryClient();
  const { data, isError, isLoading } = useQuery({
    queryKey: ["account-sessions"],
    queryFn: async () => {
      const [list, current] = await Promise.all([authClient.listSessions(), authClient.getSession()]);
      if (list.error) throw new Error(authErrorMessage(list.error));
      return { sessions: list.data as SessionRow[], currentToken: current.data?.session.token ?? null };
    },
  });

  const revoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token });
    if (error) toast.error(authErrorMessage(error));
    else {
      toast.success("Gerät abgemeldet");
      await client.invalidateQueries({ queryKey: ["account-sessions"] });
    }
  };

  return (
    <Panel title="Angemeldete Geräte" description="Melde Geräte ab, die du nicht mehr nutzt oder nicht erkennst.">
      {isError ? <p className="text-sm text-danger">Die Geräte liessen sich nicht laden.</p> : null}
      {isLoading ? <div className="skeleton h-14 rounded-xl" /> : null}
      <ul className="space-y-2">
        {data?.sessions.map((session) => {
          const current = session.token === data.currentToken;
          return (
            <li key={session.id} className="flex items-center gap-3 rounded-xl bg-white/4 p-3">
              <Monitor className="size-5 shrink-0 text-fog" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{describeAgent(session.userAgent)}</p>
                <p className="text-xs text-fog">
                  {current ? "Dieses Gerät, " : ""}
                  angemeldet am {formatDate(new Date(session.createdAt).toISOString())}
                </p>
              </div>
              {!current ? (
                <Button size="sm" onClick={() => void revoke(session.token)}>
                  Abmelden
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function DataPanel() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const remove = async () => {
    setPending(true);
    setError(null);
    const { error: failure } = await authClient.deleteUser({ password });
    setPending(false);
    if (failure) {
      setError(authErrorMessage(failure));
      return;
    }
    router.replace("/anmelden");
    router.refresh();
  };

  return (
    <Panel title="Deine Daten" description="Lade alles herunter, was Kinora über dich gespeichert hat, oder lösche dein Konto.">
      <div className="flex flex-wrap gap-2">
        <a href="/api/account/export" download className={buttonStyles({ variant: "secondary" })}>
          <Download /> Daten exportieren
        </a>
        <Dialog>
          <DialogTrigger className={buttonStyles({ variant: "danger" })}>
            <Trash2 /> Konto löschen
          </DialogTrigger>
          <DialogContent title="Konto endgültig löschen?" description="Watchlist, Bewertungen, Sehverlauf, Statistiken und Empfehlungen werden sofort und unwiderruflich gelöscht.">
            <div className="mt-5 space-y-4">
              <FormError message={error} />
              <Field label="Dein Passwort zur Bestätigung" name="deletePassword" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              <div className="flex justify-end gap-2">
                <DialogClose className={buttonStyles({ variant: "ghost" })}>Abbrechen</DialogClose>
                <Button variant="danger" disabled={!password || pending} onClick={remove}>
                  Konto löschen
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Panel>
  );
}

interface RejectedTitle {
  kind: "movie" | "tv";
  tmdbId: number;
  title: string;
  posterPath: string | null;
  year: number | null;
}

/** Links gewischte und abgelehnte Titel. Nur was hier zurückgenommen wird, darf wiederkommen. */
function RejectedPanel() {
  const client = useQueryClient();
  const replaceLibrary = useReplaceLibraryState();
  const action = useLibraryAction({ silent: true });
  const key = ["discovery-rejected"];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ titles: RejectedTitle[] }>("/api/discovery/rejected"),
  });
  const titles = data?.titles ?? [];
  const [confirmOpen, setConfirmOpen] = useState(false);

  const restore = (title: RejectedTitle) => {
    client.setQueryData<{ titles: RejectedTitle[] }>(key, { titles: titles.filter((other) => other !== title) });
    action.mutate({ kind: title.kind, tmdbId: title.tmdbId, action: "notInterested", on: false }, { onError: () => void client.invalidateQueries({ queryKey: key }) });
    toast.success(`${title.title} kann wieder vorgeschlagen werden`);
  };

  const resetAll = async () => {
    setConfirmOpen(false);
    try {
      const { reset } = await apiFetch<{ reset: number }>("/api/discovery/rejected", { method: "DELETE" });
      client.setQueryData(key, { titles: [] });
      replaceLibrary(await apiFetch<LibraryState>("/api/library"));
      toast.success(`${pluralize(reset, "Titel", "Titel")} zurückgesetzt`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt.");
    }
  };

  return (
    <Panel title="Abgelehnte Titel" description="Was du links gewischt oder abgelehnt hast, schlägt dir Kinora nicht mehr vor.">
      {titles.length === 0 ? (
        <p className="text-sm text-fog">Du hast bisher nichts abgelehnt.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm tabular-nums">{pluralize(titles.length, "Titel", "Titel")} abgelehnt</p>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger className={buttonStyles({ size: "sm" })}>Alle zurücksetzen</DialogTrigger>
              <DialogContent title="Alle Ablehnungen zurücksetzen?" description="Diese Titel können danach wieder in Empfehlungen und im Swipe-Modus auftauchen.">
                <div className="mt-6 flex justify-end gap-2">
                  <DialogClose className={buttonStyles({ variant: "ghost" })}>Abbrechen</DialogClose>
                  <Button variant="primary" onClick={() => void resetAll()}>
                    Alle zurücksetzen
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <ul className="max-h-96 divide-y divide-white/6 overflow-y-auto border-y border-white/8">
            {titles.map((title) => (
              <li key={`${title.kind}:${title.tmdbId}`} className="flex items-center gap-3 py-2">
                <span className="relative aspect-[2/3] w-8 shrink-0 overflow-hidden rounded bg-ink-raised">
                  {title.posterPath ? <TmdbImage path={title.posterPath} kind="poster" alt="" sizes="40px" /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {title.title}
                  {title.year ? <span className="ml-2 text-fog">{title.year}</span> : null}
                </span>
                <Button size="sm" variant="ghost" aria-label={`${title.title} wieder vorschlagen`} onClick={() => restore(title)}>
                  Wieder vorschlagen
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
