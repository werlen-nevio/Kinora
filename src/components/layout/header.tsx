"use client";

import { BarChart3, Film, LogOut, Search, Settings, Tv, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/logo";
import { GlobalSearch, useGlobalSearchShortcut } from "@/components/search/global-search";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/primitives";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/entdecken", label: "Entdecken" },
  { href: "/swipe", label: "Swipe" },
  { href: "/filme", label: "Filme" },
  { href: "/serien", label: "Serien" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/tagebuch", label: "Tagebuch" },
  { href: "/statistiken", label: "Statistiken" },
] as const;

export function isActivePath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export interface HeaderUser {
  name: string;
  email: string;
  image: string | null;
}

export function UserAvatar({ user, className }: { user: HeaderUser; className?: string }) {
  const initial = user.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className={cn("relative flex size-9 items-center justify-center overflow-hidden rounded-full bg-ink-overlay text-sm font-semibold text-screen ring-1 ring-white/15", className)}>
      {user.image ? <Image src={user.image} alt="" fill sizes="80px" unoptimized className="object-cover" /> : initial}
    </span>
  );
}

export function AppHeader({ user }: { user: HeaderUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useGlobalSearchShortcut(() => setSearchOpen(true));

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/anmelden");
    router.refresh();
  };

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-[background-color,box-shadow] duration-300",
        scrolled ? "glass shadow-[0_1px_0_rgb(255_255_255/0.06)]" : "bg-gradient-to-b from-ink/70 to-transparent",
      )}
    >
      <div className="gutter flex h-16 items-center gap-4 xl:gap-6">
        <Link href="/" aria-label="Kinora, zur Startseite" className="shrink-0">
          <Logo />
        </Link>

        <nav aria-label="Hauptnavigation" className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = isActivePath(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm transition-colors xl:px-3",
                  active ? "font-medium text-screen" : "text-fog hover:text-screen",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Suche öffnen"
            className="flex h-9 items-center gap-2.5 rounded-full bg-white/8 px-3 text-sm text-fog ring-1 ring-white/5 transition-colors hover:bg-white/12 hover:text-screen xl:w-64"
          >
            <Search className="size-4" />
            <span className="hidden truncate whitespace-nowrap xl:inline">Filme, Serien, Personen</span>
            <kbd className="ml-auto hidden rounded border border-white/15 px-1.5 text-[11px] font-sans text-fog-dim xl:inline">/</kbd>
          </button>

          <Menu>
            <MenuTrigger aria-label="Profilmenü" className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-screen">
              <UserAvatar user={user} />
            </MenuTrigger>
            <MenuContent>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-fog">{user.email}</p>
              </div>
              <MenuSeparator />
              <MenuItem onSelect={() => router.push("/profil")}>
                <User /> Profil und Einstellungen
              </MenuItem>
              {/* Auf dem Handy bleibt unten nur Platz für fünf Ziele, der Rest steht hier. */}
              <MenuItem className="lg:hidden" onSelect={() => router.push("/filme")}>
                <Film /> Filme
              </MenuItem>
              <MenuItem className="lg:hidden" onSelect={() => router.push("/serien")}>
                <Tv /> Serien
              </MenuItem>
              <MenuItem onSelect={() => router.push("/statistiken")}>
                <BarChart3 /> Statistiken
              </MenuItem>
              <MenuItem onSelect={() => router.push("/onboarding")}>
                <Settings /> Geschmack verfeinern
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={signOut}>
                <LogOut /> Abmelden
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}
