import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { useAtlasSession } from "@/domains/access";
import { cn } from "@/lib/utils";

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

interface NavLinkProps {
  to: string;
  label: string;
}

function NavLink({ to, label }: NavLinkProps) {
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

/**
 * Session-aware auth link shown when Atlas is running in auth-enabled mode.
 *
 * Before hydration we always show "Sign in" so the server-rendered HTML
 * matches the first client render. After hydration we switch to "Workspace"
 * when a session is present.
 */
function PricingNavLink() {
  return <NavLink to="/pricing" label="Pricing" />;
}

function AuthNavLink() {
  const hydrated = useHydrated();
  const { data: session } = useAtlasSession();
  const isAuthenticated = hydrated && session != null;

  if (isAuthenticated) {
    return <NavLink to="/discovery" label="Workspace" />;
  }

  return <NavLink to="/sign-in" label="Sign in" />;
}

/**
 * Public navigation bar for public pages.
 *
 * Renders an anchored top bar that stays attached to the viewport edge while
 * scrolling. Contains the Atlas brand mark, profile and browse entry points,
 * and a session-aware auth link.
 */
export function PublicTopNav({ localMode }: PublicTopNavProps) {
  const scrolled = useScrolledPastHero();

  return <PublicTopNavShell localMode={localMode} scrolled={scrolled} />;
}

export function PublicTopNavSafe() {
  const scrolled = useScrolledPastHero();

  return <PublicTopNavShell hideSessionLinks localMode scrolled={scrolled} />;
}

function PublicTopNavShell({
  hideSessionLinks = false,
  localMode,
  scrolled,
}: {
  hideSessionLinks?: boolean;
  localMode: boolean;
  scrolled: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[88rem] transition-all duration-250",
        scrolled ? "px-0 pt-0" : "px-6 pt-3",
      )}
    >
      <nav
        className={cn(
          "shadow-soft border-border-strong flex items-center justify-between px-6 backdrop-blur-md transition-all duration-250",
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

        <div className="flex items-center gap-1">
          <NavLink to="/profiles" label="Profiles" />
          <NavLink to="/browse" label="Browse" />
          {hideSessionLinks || localMode ? null : (
            <>
              <NavLink to="/enterprise" label="Enterprise" />
              <PricingNavLink />
              <AuthNavLink />
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
