import { useSyncExternalStore } from "react";
import { useAtlasSession } from "@/domains/access";
import type { AppNavItem } from "./app-navigation";
import { buildAuthenticatedAppNav } from "./app-navigation";
import { TopNavChrome } from "./top-nav-chrome";

interface PublicTopNavProps {
  localMode: boolean;
}

/**
 * Subscribe to nothing -- the store never changes. This is a no-op used only
 * to distinguish server-side from client-side rendering via
 * `useSyncExternalStore`.
 */
function subscribeNoop() {
  // No-op: the hydration "store" never changes, so the unsubscribe is a no-op too.
  return () => undefined;
}

/**
 * Returns `true` on the client after hydration, `false` during SSR.
 *
 * This avoids hydration mismatches when the auth nav link differs between
 * server-rendered HTML and the first client render.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

const PUBLIC_NAV_ITEMS: AppNavItem[] = [
  { label: "Map", to: "/map" },
  { label: "Profiles", to: "/profiles" },
  { label: "Browse", to: "/browse" },
  { label: "API", to: "/api-reference" },
];

const PUBLIC_SESSION_NAV_ITEMS: AppNavItem[] = [
  { label: "Pricing", to: "/pricing" },
  { label: "Sign in", to: "/sign-in" },
];

/**
 * Public navigation bar for public pages.
 *
 * Renders an anchored top bar that stays attached to the viewport edge while
 * scrolling. Contains the Atlas brand mark, profile and browse entry points,
 * and a session-aware auth link.
 */
export function PublicTopNav({ localMode }: PublicTopNavProps) {
  return <PublicTopNavShell localMode={localMode} />;
}

export function PublicTopNavSafe() {
  return <PublicTopNavShell hideSessionLinks localMode />;
}

function PublicTopNavShell({
  hideSessionLinks = false,
  localMode,
}: {
  hideSessionLinks?: boolean;
  localMode: boolean;
}) {
  const hydrated = useHydrated();
  const { data: session } = useAtlasSession();
  const shouldShowAppNav = hydrated && session != null && !hideSessionLinks;
  const publicItems =
    hideSessionLinks || localMode
      ? PUBLIC_NAV_ITEMS
      : [...PUBLIC_NAV_ITEMS, ...PUBLIC_SESSION_NAV_ITEMS];
  const items = shouldShowAppNav ? buildAuthenticatedAppNav(session) : publicItems;

  return <TopNavChrome items={items} />;
}
