import type { ReactNode } from "react";

// Bei jeder Navigation neu eingehängt: Die Seite blendet kurz ein, ohne das Layout zu berühren.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
