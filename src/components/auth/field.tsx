import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Field({ label, hint, className, id, ...props }: ComponentProps<"input"> & { label: string; hint?: string }) {
  const inputId = id ?? props.name;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-screen">
        {label}
      </label>
      <input
        id={inputId}
        className={cn(
          "h-11 w-full rounded-xl border border-white/12 bg-white/5 px-3.5 text-[15px] text-screen outline-none transition-colors placeholder:text-fog-dim hover:border-white/20 focus:border-screen",
          className,
        )}
        {...props}
      />
      {hint ? <p className="text-xs text-fog">{hint}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
      {message}
    </p>
  );
}
