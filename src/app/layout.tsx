import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Kinora", template: "%s | Kinora" },
  description: "Deine private Film- und Serienbibliothek mit Tracking, Statistiken und persönlichen Empfehlungen.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0c12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de-CH">
      <body>
        {children}
        <Toaster
          position="bottom-center"
          theme="dark"
          offset={{ bottom: "5rem" }}
          toastOptions={{
            style: {
              background: "color-mix(in oklab, var(--color-ink-overlay) 92%, transparent)",
              border: "1px solid rgb(255 255 255 / 0.1)",
              color: "var(--color-screen)",
              backdropFilter: "blur(16px)",
            },
          }}
        />
      </body>
    </html>
  );
}
