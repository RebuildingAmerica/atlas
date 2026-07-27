import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { useHydrated } from "@/platform/runtime/use-hydrated";
import type { AppNavItem } from "./app-navigation";
import {
  AtlasBrandLink,
  AtlasMenuGlyph,
  GlobalSearchForm,
  withTopNavChrome,
} from "./top-nav-chrome";

interface PublicTopNavProps {
  localMode: boolean;
  showSearch?: boolean;
}

interface PublicTopNavChromeProps {
  frame: "app" | "showcase";
  menuItems: AppNavItem[];
  primaryItems: AppNavItem[];
  showSearch: boolean;
  sessionItem: AppNavItem;
  sessionThumbnailUrl?: string;
}

interface PublicTopNavShellProps {
  hideSessionLinks?: boolean;
  localMode: boolean;
  showSearch: boolean;
}

interface PublicNavigationMenuProps {
  items: AppNavItem[];
  open: boolean;
  toggleMenu: () => void;
}

interface PublicPrimaryNavProps {
  items: AppNavItem[];
}

interface PublicActionLinkProps {
  item: AppNavItem;
}

interface PublicSessionAreaProps {
  showSearch: boolean;
  sessionItem: AppNavItem;
  sessionThumbnailUrl?: string;
}

interface PublicSessionChipProps {
  item: AppNavItem;
  thumbnailUrl?: string;
}

const PUBLIC_NAV_ITEMS: AppNavItem[] = [
  { label: "Browse", to: "/browse" },
  { label: "Map", to: "/map" },
  { label: "People", to: "/profiles/people" },
  { label: "Organizations", to: "/profiles/organizations" },
  { label: "Pricing", to: "/pricing" },
  { label: "Firehose", to: "/firehose" },
  { label: "Docs", native: true, to: "/docs" },
  { label: "API", native: true, to: "/docs/api" },
];

const PUBLIC_SESSION_NAV_ITEM: AppNavItem = { label: "Sign in", to: "/sign-in" };
const PUBLIC_WORKBENCH_NAV_ITEM: AppNavItem = { label: "Workbench", to: "/home" };

/**
 * Public navigation bar for public pages.
 *
 * Renders an anchored top bar that stays attached to the viewport edge while
 * scrolling. Contains the Atlas brand mark, profile and browse entry points,
 * and a session-aware auth link.
 */
export function PublicTopNav({ localMode, showSearch = true }: PublicTopNavProps) {
  return <PublicTopNavShell localMode={localMode} showSearch={showSearch} />;
}

export function PublicTopNavSafe() {
  return <PublicTopNavShell hideSessionLinks localMode showSearch={false} />;
}

function PublicTopNavShell({
  hideSessionLinks = false,
  localMode,
  showSearch,
}: PublicTopNavShellProps) {
  const hydrated = useHydrated();
  const { data: session } = useAtlasSession();
  const signedIn = hydrated && session != null && !hideSessionLinks && !localMode;
  const sessionItem =
    hideSessionLinks || localMode
      ? PUBLIC_WORKBENCH_NAV_ITEM
      : signedIn
        ? PUBLIC_WORKBENCH_NAV_ITEM
        : PUBLIC_SESSION_NAV_ITEM;
  const sessionThumbnailUrl = signedIn ? (session.user.image ?? undefined) : undefined;

  return (
    <PublicTopNavChrome
      frame={signedIn || localMode || hideSessionLinks ? "app" : "showcase"}
      menuItems={PUBLIC_NAV_ITEMS}
      primaryItems={PUBLIC_NAV_ITEMS}
      showSearch={showSearch}
      sessionItem={sessionItem}
      sessionThumbnailUrl={sessionThumbnailUrl}
    />
  );
}

const PublicTopNavChrome = withTopNavChrome<PublicTopNavChromeProps>(
  (
    { frame, menuItems, primaryItems, showSearch, sessionItem, sessionThumbnailUrl },
    { menuOpen, toggleMenu },
  ) => ({
    brandSlot: <AtlasBrandLink />,
    frame,
    leadingSlot: <PublicNavigationMenu items={menuItems} open={menuOpen} toggleMenu={toggleMenu} />,
    primarySlot: <PublicPrimaryNav items={primaryItems} />,
    sessionSlot: (
      <PublicSessionArea
        showSearch={showSearch}
        sessionItem={sessionItem}
        sessionThumbnailUrl={sessionThumbnailUrl}
      />
    ),
  }),
);

function PublicNavigationMenu({ items, open, toggleMenu }: PublicNavigationMenuProps) {
  return (
    <div className="visible relative flex max-w-12 shrink-0 translate-y-0 overflow-visible opacity-100 transition-[max-width,opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none md:pointer-events-none md:invisible md:max-w-0 md:-translate-y-1 md:opacity-0">
      <button
        type="button"
        aria-controls="public-navigation-menu"
        aria-expanded={open}
        aria-label="Open public navigation menu"
        className="border-border bg-surface-container-lowest text-ink-strong hover:bg-surface-container focus-visible:ring-civic flex h-10 w-10 items-center justify-center rounded-full border transition-colors duration-150 outline-none focus-visible:ring-2 motion-reduce:transition-none"
        data-menu-state={open ? "open" : "closed"}
        onClick={toggleMenu}
      >
        <AtlasMenuGlyph open={open} testIdPrefix="public-menu-icon" />
      </button>
      {open ? <PublicMenuPanel items={items} /> : null}
    </div>
  );
}

function PublicPrimaryNav({ items }: PublicPrimaryNavProps) {
  return (
    <div className="invisible flex max-w-0 shrink-0 -translate-y-1 items-center gap-1 overflow-hidden opacity-0 transition-[max-width,opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none md:visible md:max-w-[48rem] md:translate-y-0 md:opacity-100">
      {items.map((item) => (
        <PublicActionLink key={item.to} item={item} />
      ))}
    </div>
  );
}

function PublicActionLink({ item }: PublicActionLinkProps) {
  if (item.native) {
    return (
      <a
        href={item.to}
        className="type-label-large text-ink-strong hover:bg-surface-container rounded-lg px-3 py-2 no-underline"
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link
      to={item.to}
      className="type-label-large text-ink-strong hover:bg-surface-container rounded-lg px-3 py-2 no-underline"
    >
      {item.label}
    </Link>
  );
}

function PublicSessionArea({
  showSearch,
  sessionItem,
  sessionThumbnailUrl,
}: PublicSessionAreaProps) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {showSearch ? (
        <div className="invisible max-w-0 shrink-0 opacity-0 transition-[max-width,opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none xl:visible xl:max-w-56 xl:opacity-100 2xl:max-w-64">
          <GlobalSearchForm className="w-full flex-none" />
        </div>
      ) : null}
      <PublicSessionChip item={sessionItem} thumbnailUrl={sessionThumbnailUrl} />
    </div>
  );
}

function PublicSessionChip({ item, thumbnailUrl }: PublicSessionChipProps) {
  const content = (
    <>
      <span className="bg-surface-container-high text-ink-soft flex h-7 w-7 items-center justify-center overflow-hidden rounded-full">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="h-4 w-4" aria-hidden="true" />
        )}
      </span>
      <span>{item.label}</span>
    </>
  );
  const className =
    "type-label-large border-border bg-surface-container-lowest text-ink-strong hover:bg-surface-container focus-visible:ring-civic inline-flex h-10 items-center gap-2 rounded-full border py-1 pr-3 pl-1.5 no-underline outline-none focus-visible:ring-2";

  return (
    <Link to={item.to} className={className}>
      {content}
    </Link>
  );
}

function PublicMenuPanel({ items }: { items: AppNavItem[] }) {
  return (
    <div
      id="public-navigation-menu"
      className="border-border bg-surface-container-lowest absolute top-12 left-0 z-50 grid w-56 gap-1 rounded-lg border p-2 shadow-lg"
    >
      <nav aria-label="Public navigation menu" className="grid gap-1">
        {items.map((item) => (
          <PublicActionLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}
