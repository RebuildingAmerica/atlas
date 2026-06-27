import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { AppNavItem } from "./app-navigation";

interface TopNavChromeProps {
  identitySlot?: ReactNode;
  items: AppNavItem[];
}

function subscribeScroll(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener("scroll", callback, { passive: true });
  return () => {
    window.removeEventListener("scroll", callback);
  };
}

function useScrolledPastHero(): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 24,
    () => false,
  );
}

function TopNavLink({ label, to }: AppNavItem) {
  return (
    <Link
      to={to}
      className="type-label-large text-ink-muted hover:bg-surface-container hover:text-ink-strong rounded-lg px-3 py-1.5 no-underline"
      activeProps={{
        className:
          "type-label-large rounded-lg px-3 py-1.5 no-underline bg-surface-container-high text-ink-strong",
      }}
    >
      {label}
    </Link>
  );
}

export function TopNavChrome({ identitySlot, items }: TopNavChromeProps) {
  const scrolled = useScrolledPastHero();

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[88rem] transition-all duration-250",
        scrolled ? "px-0 pt-0" : "px-6 pt-3",
      )}
    >
      <nav
        aria-label="Primary navigation"
        data-chrome-state={scrolled ? "anchored" : "floating"}
        className={cn(
          "shadow-soft border-border-strong flex flex-wrap items-center gap-4 px-6 backdrop-blur-md transition-all duration-250",
          scrolled
            ? "bg-surface-container-high/92 border-b py-3"
            : "bg-surface-container-low/88 rounded-[1.25rem] border py-4",
        )}
      >
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <div className="bg-accent flex h-7 w-7 items-center justify-center rounded-[0.85rem] text-white">
            <span className="type-label-medium leading-none">A</span>
          </div>
          <span className="type-title-medium text-ink-strong">Atlas</span>
        </Link>

        <div className="flex flex-wrap items-center gap-1">
          {items.map((item) => (
            <TopNavLink key={item.to} label={item.label} to={item.to} />
          ))}
        </div>

        {identitySlot ? <div className="ml-auto min-w-0">{identitySlot}</div> : null}
      </nav>
    </div>
  );
}
