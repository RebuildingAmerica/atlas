import type { ReactNode } from "react";
import { TopNavChrome } from "./top-nav-chrome";

/**
 * Props accepted by the shared workspace navigation bar.
 */
interface WorkspaceNavProps {
  identitySlot?: ReactNode;
  menuSlot?: ReactNode;
}

/**
 * Top navigation bar for the authenticated workspace shell.
 *
 * Domain-specific identity controls flow in through `identitySlot`; primary
 * workspace destinations live in the workbench rail.
 */
export function WorkspaceNav({ identitySlot, menuSlot }: WorkspaceNavProps) {
  return <TopNavChrome identitySlot={identitySlot} rightSlot={menuSlot} />;
}
