import type { ReactNode } from "react";
import type { AppNavItem } from "./app-navigation";
import { TopNavChrome } from "./top-nav-chrome";

/**
 * Props accepted by the shared workspace navigation bar.
 */
interface WorkspaceNavProps {
  identitySlot?: ReactNode;
  tabs?: AppNavItem[];
}

const DEFAULT_WORKSPACE_TABS: AppNavItem[] = [
  { label: "Home", to: "/home" },
  { label: "Research", to: "/discovery" },
  { label: "Browse", to: "/browse" },
];

/**
 * Top navigation bar for the authenticated workspace shell.
 *
 * Domain-specific identity controls flow in through `identitySlot`, while the
 * route decides which tabs are relevant for the current session.
 */
export function WorkspaceNav({ identitySlot, tabs = DEFAULT_WORKSPACE_TABS }: WorkspaceNavProps) {
  return <TopNavChrome identitySlot={identitySlot} items={tabs} />;
}
