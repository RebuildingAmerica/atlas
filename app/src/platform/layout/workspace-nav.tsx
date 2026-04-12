import { Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAtlasSession } from "@/domains/access";
import { getAuthClient } from "@/domains/access/client/auth-client";

/**
 * Top navigation bar for the authenticated operator workspace.
 *
 * Displays the Atlas brand mark, section tabs with active state, and the
 * signed-in operator's identity with a sign-out control.
 */
export function WorkspaceNav() {
  const session = useAtlasSession();

  const displayName = session.data?.user.name?.trim() || session.data?.user.email || "Operator";

  const handleSignOut = async () => {
    await getAuthClient().signOut();
    window.location.assign("/");
  };

  return (
    <nav className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-6 px-6">
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-[var(--accent)] text-white">
            <span className="type-label-medium leading-none">A</span>
          </div>
          <span className="type-title-medium text-[var(--ink-strong)]">Atlas</span>
        </Link>

        <div className="flex items-center gap-1">
          <NavTab to="/account" label="Account" />
          <NavTab to="/discovery" label="Discovery" />
        </div>

        <div className="ml-auto flex items-center gap-4">
          <span className="type-body-medium text-[var(--ink-soft)]">{displayName}</span>
          <button
            type="button"
            onClick={() => {
              void handleSignOut();
            }}
            className="type-label-large inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-container)] hover:text-[var(--ink-strong)]"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}

interface NavTabProps {
  to: string;
  label: string;
}

function NavTab({ to, label }: NavTabProps) {
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
