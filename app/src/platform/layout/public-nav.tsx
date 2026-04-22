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
 * Renders the session-aware auth link.
 *
 * Before hydration we always show "Sign in" so the server-rendered HTML
 * matches the first client render. After hydration we switch to "Workspace"
 * when a session is present.
 */
function PricingNavLink() {
  const { data: session } = useAtlasSession();

  if (session?.isLocal) {
    return null;
  }

  return <NavLink to="/pricing" label="Pricing" />;
}

function AuthNavLink() {
  const hydrated = useHydrated();
  const { data: session } = useAtlasSession();

  if (session?.isLocal) {
    return null;
  }

  const isAuthenticated = hydrated && session != null;

  if (isAuthenticated) {
    return <NavLink to="/discovery" label="Workspace" />;
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
      className="border-border mx-auto flex max-w-3xl items-center justify-between rounded-2xl border px-4 py-2.5 shadow-sm backdrop-blur-md md:px-5 md:py-3"
      style={{ backgroundColor: "rgba(248, 241, 230, 0.8)" }}
    >
      {/* Brand */}
      <Link to="/" className="flex items-center gap-2.5 no-underline">
        <div className="bg-accent flex h-7 w-7 items-center justify-center rounded-xl text-white">
          <span className="type-label-medium leading-none">A</span>
        </div>
        <span className="type-title-medium text-ink-strong">Atlas</span>
      </Link>

      {/* Links */}
      <div className="flex items-center gap-1">
        <NavLink to="/browse" label="Browse" />
        <PricingNavLink />
        <AuthNavLink />
      </div>
    </nav>
  );
}
