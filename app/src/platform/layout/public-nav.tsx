import { useSyncExternalStore } from "react";
import { Link } from "@tanstack/react-router";
import { useAtlasSession } from "@/domains/access";

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

interface NavLinkProps {
  to: string;
  label: string;
}

function NavLink({ to, label }: NavLinkProps) {
  return (
    <Link
      to={to}
      className="type-label-large rounded-lg px-3 py-1.5 text-[var(--ink-muted)] no-underline hover:bg-[var(--surface-container)] hover:text-[var(--ink-strong)]"
      activeProps={{
        className:
          "type-label-large rounded-lg px-3 py-1.5 no-underline bg-[var(--surface-container-high)] text-[var(--ink-strong)]",
      }}
    >
      {label}
    </Link>
  );
}

/**
 * Renders the session-aware auth link.
 *
 * Before hydration we always show "Sign in" so the server-rendered HTML
 * matches the first client render. After hydration we switch to "Account"
 * when a session is present.
 */
function AuthNavLink() {
  const hydrated = useHydrated();
  const { data: session } = useAtlasSession();

  const isAuthenticated = hydrated && session != null;

  if (isAuthenticated) {
    return <NavLink to="/account" label="Account" />;
  }

  return <NavLink to="/sign-in" label="Sign in" />;
}

/**
 * Minimal floating navigation bar for public pages.
 *
 * Renders a fixed pill at the top of the viewport that floats over page
 * content with a translucent backdrop-blurred background. Contains the Atlas
 * brand mark, a "Browse" link, and a session-aware auth link.
 */
export function PublicFloatingNav() {
  return (
    <nav
      className="fixed top-4 right-4 left-4 z-30 mx-auto flex max-w-3xl items-center justify-between rounded-2xl border border-[var(--border)] px-4 py-2.5 shadow-sm backdrop-blur-md md:px-5 md:py-3"
      style={{ backgroundColor: "rgba(248, 241, 230, 0.8)" }}
    >
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2.5 no-underline">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
          <span className="type-label-medium leading-none">A</span>
        </div>
        <span className="type-title-medium text-[var(--ink-strong)]">Atlas</span>
      </Link>

      {/* Links */}
      <div className="flex items-center gap-1">
        <NavLink to="/browse" label="Browse" />
        <AuthNavLink />
      </div>
    </nav>
  );
}
