import type { ReactNode } from "react";
import { DiaryProvider } from "@/components/diary/diary-provider";
import { LibraryProvider } from "@/components/library/library-provider";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { AppHeader } from "@/components/layout/header";
import { Providers } from "@/components/layout/providers";
import { requireUser } from "@/server/auth/session";
import { getLibraryState } from "@/server/library/service";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const library = await getLibraryState(user.id);

  return (
    <Providers>
      <LibraryProvider key={user.id} initial={library}>
        <DiaryProvider>
        <a href="#inhalt" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-screen focus:px-4 focus:py-2 focus:text-ink">
          Zum Inhalt springen
        </a>
        <AppHeader user={{ name: user.name, email: user.email, image: user.image ?? null }} />
        <main id="inhalt">{children}</main>
        <Footer />
        <BottomNav />
        </DiaryProvider>
      </LibraryProvider>
    </Providers>
  );
}
