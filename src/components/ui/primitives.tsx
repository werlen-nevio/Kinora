"use client";

import { Check, ChevronDown } from "lucide-react";
import { Checkbox as RadixCheckbox, Dialog as RadixDialog, DropdownMenu as RadixMenu, Popover as RadixPopover, Select as RadixSelect, Switch as RadixSwitch, Tooltip as RadixTooltip } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const panel = "rounded-2xl border border-white/10 bg-ink-overlay/95 shadow-2xl shadow-black/60 backdrop-blur-xl";

// --- Dialog ---------------------------------------------------------------

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  hideTitle,
  className,
  children,
  ...props
}: ComponentProps<typeof RadixDialog.Content> & { title: string; description?: string; hideTitle?: boolean }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-[page-in_180ms_ease-out]" />
      <RadixDialog.Content
        aria-describedby={description ? undefined : undefined}
        className={cn(
          panel,
          "fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 focus:outline-none data-[state=open]:animate-[page-in_180ms_ease-out]",
          className,
        )}
        {...props}
      >
        <RadixDialog.Title className={cn("font-display text-title-sm", hideTitle && "sr-only")}>{title}</RadixDialog.Title>
        {description ? (
          <RadixDialog.Description className="mt-2 text-sm text-fog">{description}</RadixDialog.Description>
        ) : (
          <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
        )}
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

// --- Menü -----------------------------------------------------------------

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

export function MenuContent({ className, align = "end", ...props }: ComponentProps<typeof RadixMenu.Content>) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content align={align} sideOffset={8} className={cn(panel, "z-50 min-w-52 p-1.5", className)} {...props} />
    </RadixMenu.Portal>
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof RadixMenu.Item>) {
  return (
    <RadixMenu.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-screen outline-none data-[highlighted]:bg-white/10 data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:text-fog",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <RadixMenu.Separator className="my-1.5 h-px bg-white/10" />;
}

// --- Popover --------------------------------------------------------------

export const Popover = RadixPopover.Root;
export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;

export function PopoverContent({ className, align = "start", ...props }: ComponentProps<typeof RadixPopover.Content>) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content align={align} sideOffset={8} className={cn(panel, "z-50 p-4 focus:outline-none", className)} {...props} />
    </RadixPopover.Portal>
  );
}

// --- Tooltip --------------------------------------------------------------

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root delayDuration={300}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content sideOffset={6} className="z-50 rounded-md bg-screen px-2 py-1 text-xs font-medium text-ink">
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

// --- Select ---------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  label,
  className,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        aria-label={label}
        className={cn(
          "inline-flex h-10 min-w-0 items-center justify-between gap-2 rounded-full bg-white/8 px-4 text-sm text-screen outline-none transition-colors hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-screen data-[placeholder]:text-fog",
          className,
        )}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-fog" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content position="popper" sideOffset={8} className={cn(panel, "z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden")}>
          <RadixSelect.Viewport className="p-1.5">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer select-none items-center justify-between gap-4 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-white/10"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check className="size-4 text-ambient" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

// --- Schalter und Checkbox --------------------------------------------------

export function Switch({ className, ...props }: ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        "relative h-6 w-10 shrink-0 cursor-pointer rounded-full bg-white/15 outline-none transition-colors data-[state=checked]:bg-ambient focus-visible:ring-2 focus-visible:ring-screen focus-visible:ring-offset-2 focus-visible:ring-offset-ink",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-screen transition-transform duration-200 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-ink" />
    </RadixSwitch.Root>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      className={cn(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-white/30 bg-ink/60 outline-none transition-colors data-[state=checked]:border-screen data-[state=checked]:bg-screen focus-visible:ring-2 focus-visible:ring-screen",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator>
        <Check className="size-3.5 text-ink" strokeWidth={3} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}
