"use client";

import { BookOpen, Bookmark, Compass, GalleryHorizontal, Home, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActivePath } from "./header";

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/entdecken", label: "Entdecken", icon: Compass },
  { href: "/swipe", label: "Swipe", icon: GalleryHorizontal },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/tagebuch", label: "Tagebuch", icon: BookOpen },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hauptnavigation mobil"
      className="glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/8 pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-14 min-w-0 flex-col items-center justify-center gap-1 text-[10px] transition-colors",
              active ? "text-screen" : "text-fog-dim",
            )}
          >
            <Icon className={cn("size-5", active && "text-ambient")} strokeWidth={active ? 2.2 : 1.8} />
            <span className="truncate">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
