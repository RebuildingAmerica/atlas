import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Navigation tab configuration for the shared workspace shell.
 */
interface WorkspaceTabConfig {
  label: string;
  to: string;
}

/**
 * Props accepted by the shared workspace navigation bar.
 */
interface WorkspaceNavProps {
  identitySlot?: ReactNode;
  tabs?: WorkspaceTabConfig[];
}

const defaultTabs: WorkspaceTabConfig[] = [{ label: "Discovery", to: "/discovery" }];

function WorkspaceNavTab({ label, to }: WorkspaceTabConfig) {
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
 * Top navigation bar for the authenticated workspace shell.
 *
 * Domain-specific identity controls flow in through `identitySlot`, while the
 * route decides which tabs are relevant for the current session.
 */
export function WorkspaceNav({ identitySlot, tabs = defaultTabs }: WorkspaceNavProps) {
  return (
    <nav className="border-border bg-surface border-b">
      <div className="mx-auto flex min-h-14 max-w-[88rem] flex-wrap items-center gap-6 px-6 py-3">
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          <div className="bg-accent flex h-7 w-7 items-center justify-center rounded-xl text-white">
            <span className="type-label-medium leading-none">A</span>
          </div>
          <span className="type-title-medium text-ink-strong">Atlas</span>
        </Link>

        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <WorkspaceNavTab key={tab.to} label={tab.label} to={tab.to} />
          ))}
        </div>

        {identitySlot ? <div className="ml-auto">{identitySlot}</div> : null}
      </div>
    </nav>
  );
}
