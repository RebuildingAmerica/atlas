import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { WorkspaceFrame } from "@rebuildingamerica/atlas-ui";
import type { AppNavItem } from "./app-navigation";
import { AtlasMenuGlyph } from "./top-nav-chrome";
import { WorkspaceNav } from "./workspace-nav";

/**
 * Props accepted by the shared workspace shell.
 */
interface WorkspaceLayoutProps {
  children: ReactNode;
  identitySlot?: ReactNode;
  tabs?: AppNavItem[];
}

interface WorkspaceFrameInput {
  children: ReactNode;
  identitySlot?: ReactNode;
  railItems: AppNavItem[];
}

interface WorkbenchMenuProps {
  items: AppNavItem[];
}

type WorkspaceShellResolver<Props> = (props: Props) => WorkspaceFrameProps;

const DEFAULT_WORKSPACE_TABS: AppNavItem[] = [
  { label: "Home", to: "/home" },
  { label: "Research", to: "/discovery" },
  { label: "Browse", to: "/browse" },
];

/**
 * Shell layout for authenticated workspace pages.
 *
 * Renders the shared workspace navigation bar and a max-width content area.
 */
export function WorkspaceLayout({
  children,
  identitySlot,
  tabs = DEFAULT_WORKSPACE_TABS,
}: WorkspaceLayoutProps) {
  const railItems = tabs;
  return <WorkspaceFrame children={children} identitySlot={identitySlot} railItems={railItems} />;
}

interface WorkspaceFrameSlots {
  rail: ReactNode;
  topNavigation: ReactNode;
}

type WorkspaceShellResolver<Props> = (props: Props) => WorkspaceFrameSlots;

function withWorkspaceShell<Props extends { children: ReactNode }>(
  resolveSlots: WorkspaceShellResolver<Props>,
) {
  return function WorkspaceShell(props: Props) {
    return <WorkspaceFrame {...resolveSlots(props)}>{props.children}</WorkspaceFrame>;
  };
}

const WorkspaceFrame = withWorkspaceShell<WorkspaceFrameInput>(
  ({ identitySlot, railItems }) => ({
    topNavigation: (
      <WorkspaceNav identitySlot={identitySlot} menuSlot={<WorkbenchMenu items={railItems} />} />
    ),
    rail: <WorkbenchRail items={railItems} />,
  }),
);

function WorkbenchMenu({ items }: WorkbenchMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex max-w-10 shrink-0 opacity-100 transition-[max-width,opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none lg:pointer-events-none lg:invisible lg:max-w-0 lg:-translate-y-1 lg:opacity-0">
      <button
        type="button"
        className="border-border text-ink-soft hover:bg-surface-container-low hover:text-ink-strong focus-visible:ring-civic flex h-10 w-10 items-center justify-center rounded-full border outline-none focus-visible:ring-2"
        aria-label="Open workbench navigation menu"
        aria-expanded={open}
        aria-controls="workbench-menu"
        data-menu-state={open ? "open" : "closed"}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <AtlasMenuGlyph open={open} />
      </button>
      {open ? (
        <div
          id="workbench-menu"
          className="border-border bg-surface-container absolute top-12 right-0 w-[min(calc(100vw-2rem),18rem)] rounded-xl border p-2 shadow-lg"
        >
          <nav aria-label="Workbench menu" className="grid gap-1">
            {items.map((item) => (
              <WorkbenchRailLink key={item.to} item={item} />
            ))}
          </nav>
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchRail({ items }: { items: AppNavItem[] }) {
  return (
    <aside className="border-border bg-surface-container-low hidden border-r px-3 py-5 lg:block">
      <nav aria-label="Workbench navigation" className="sticky top-20 grid gap-1">
        <p className="type-label-small text-ink-muted px-3 pb-2 font-mono tracking-[0.08em] uppercase">
          Workbench
        </p>
        {items.map((item) => (
          <WorkbenchRailLink key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
}

function WorkbenchRailLink({ item }: { item: AppNavItem }) {
  if (item.native) {
    return (
      <a
        href={item.to}
        className="type-label-large text-ink-soft hover:bg-surface-container-high hover:text-ink-strong rounded-lg px-3 py-2 no-underline"
      >
        {item.label}
      </a>
    );
  }

  return (
    <Link
      to={item.to}
      className="type-label-large text-ink-soft hover:bg-surface-container-high hover:text-ink-strong rounded-lg px-3 py-2 no-underline"
      activeProps={{
        className:
          "type-label-large rounded-lg px-3 py-2 no-underline bg-surface-container-high text-ink-strong",
      }}
    >
      {item.label}
    </Link>
  );
}
