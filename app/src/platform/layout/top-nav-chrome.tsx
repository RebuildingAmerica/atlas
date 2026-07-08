import type { ReactNode } from "react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { AppNavItem } from "./app-navigation";

interface TopNavChromeProps {
  identitySlot?: ReactNode;
  items?: AppNavItem[];
  rightSlot?: ReactNode;
}

interface AtlasTopBarProps {
  brandSlot: ReactNode;
  frame?: AtlasTopBarFrame;
  leadingSlot?: ReactNode;
  menuSlot?: ReactNode;
  mobileSlot?: ReactNode;
  primarySlot?: ReactNode;
  searchSlot?: ReactNode;
  sessionSlot?: ReactNode;
}

interface TopNavChromeState {
  menuOpen: boolean;
  toggleMenu: () => void;
}

type TopNavSlotResolver<Props> = (props: Props, state: TopNavChromeState) => AtlasTopBarProps;
type AtlasTopBarFrame = "app" | "showcase";

interface GlobalSearchFormProps {
  ariaLabel?: string;
  className?: string;
}

interface AtlasMenuGlyphProps {
  open: boolean;
  testIdPrefix?: string;
}

function TopNavLink({ label, native, to }: AppNavItem) {
  if (native) {
    return (
      <a
        href={to}
        className="type-label-large text-ink-muted hover:bg-surface-container hover:text-ink-strong rounded-lg px-3 py-1.5 no-underline"
      >
        {label}
      </a>
    );
  }

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

export function AtlasBrandLink() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5 no-underline">
      <div className="bg-accent flex h-7 w-7 items-center justify-center rounded-[0.85rem] text-white">
        <span className="type-label-medium leading-none">A</span>
      </div>
      <span className="type-title-medium text-ink-strong">Atlas</span>
    </Link>
  );
}

export function GlobalSearchForm({ ariaLabel = "Search Atlas", className }: GlobalSearchFormProps) {
  return (
    <form action="/browse" className={cn("min-w-0 flex-1", className)} role="search">
      <input
        aria-label={ariaLabel}
        className="border-border bg-surface-container-lowest text-ink-strong placeholder:text-ink-muted focus-visible:ring-civic h-10 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-2"
        name="query"
        placeholder="Search a place, issue, person, or organization"
        type="search"
      />
    </form>
  );
}

export function AtlasMenuGlyph({ open, testIdPrefix }: AtlasMenuGlyphProps) {
  const iconState = open ? "open" : "closed";
  const lineClassName =
    "bg-current absolute left-0 h-0.5 w-4 rounded-full transition-[top,bottom,opacity,transform] duration-200 ease-out motion-reduce:transition-none";

  return (
    <span aria-hidden="true" className="relative block h-4 w-4">
      <span
        className={cn(lineClassName, open ? "top-1/2 rotate-45" : "top-[3px] rotate-0")}
        data-icon-state={iconState}
        data-testid={testIdPrefix ? `${testIdPrefix}-top` : undefined}
      />
      <span
        className={cn(
          lineClassName,
          "top-1/2 -translate-y-1/2",
          open ? "scale-x-0 opacity-0" : "scale-x-100 opacity-100",
        )}
        data-icon-state={iconState}
        data-testid={testIdPrefix ? `${testIdPrefix}-middle` : undefined}
      />
      <span
        className={cn(lineClassName, open ? "top-1/2 -rotate-45" : "bottom-[3px] rotate-0")}
        data-icon-state={iconState}
        data-testid={testIdPrefix ? `${testIdPrefix}-bottom` : undefined}
      />
    </span>
  );
}

export function AtlasTopBar({
  brandSlot,
  frame = "app",
  leadingSlot,
  menuSlot,
  mobileSlot,
  primarySlot,
  searchSlot,
  sessionSlot,
}: AtlasTopBarProps) {
  return (
    <div
      className={cn(
        "atlas-top-bar-shell mx-auto w-full max-w-[88rem]",
        frame === "showcase" ? "atlas-top-bar-shell-showcase" : "px-0 pt-0",
      )}
    >
      <nav
        aria-label="Primary navigation"
        data-chrome-frame={frame}
        className={cn(
          "atlas-top-bar border-border-strong bg-surface-container-high/92 shadow-soft flex flex-nowrap items-center gap-4 border-b px-4 py-4 backdrop-blur-md sm:px-8",
          frame === "showcase" ? "atlas-top-bar-showcase border" : null,
        )}
      >
        {leadingSlot}
        {brandSlot}
        {searchSlot}
        {primarySlot}
        {menuSlot || sessionSlot ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {menuSlot}
            {sessionSlot}
          </div>
        ) : null}
      </nav>
      {mobileSlot}
    </div>
  );
}

export function withTopNavChrome<Props extends object>(resolveSlots: TopNavSlotResolver<Props>) {
  return function AtlasNavigation(props: Props) {
    const [menuOpen, setMenuOpen] = useState(false);
    const state: TopNavChromeState = {
      menuOpen,
      toggleMenu: () => {
        setMenuOpen((open) => !open);
      },
    };

    return <AtlasTopBar {...resolveSlots(props, state)} />;
  };
}

export function TopNavChrome({ identitySlot, items = [], rightSlot }: TopNavChromeProps) {
  const primarySlot = items.length ? (
    <div className="hidden shrink-0 items-center gap-1 lg:flex">
      {items.map((item) => (
        <TopNavLink key={item.to} label={item.label} native={item.native} to={item.to} />
      ))}
    </div>
  ) : null;

  return (
    <AtlasTopBar
      brandSlot={<AtlasBrandLink />}
      searchSlot={<GlobalSearchForm className="hidden max-w-[32rem] sm:block" />}
      primarySlot={primarySlot}
      menuSlot={rightSlot}
      sessionSlot={identitySlot ? <div className="min-w-0">{identitySlot}</div> : null}
    />
  );
}
