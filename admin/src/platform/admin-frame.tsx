import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

interface AdminFrameProps {
  children: ReactNode;
}

interface NavItem {
  label: string;
  to:
    | "/"
    | "/discounts"
    | "/cloud-costs"
    | "/switches"
    | "/accounts"
    | "/waitlist";
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: "Overview", to: "/" },
  { label: "Discounts", to: "/discounts" },
  { label: "Cloud costs", to: "/cloud-costs" },
  { label: "Switches", to: "/switches" },
  { label: "Accounts", to: "/accounts" },
  { label: "Waitlist", to: "/waitlist" },
];

/**
 * The admin's chrome. It looks deliberately unlike the Atlas app, so an
 * operator always knows they are acting on the platform, not on a workspace.
 */
export function AdminFrame({ children }: AdminFrameProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border bg-surface-container border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <p className="type-title-medium text-ink-strong">
            Atlas <span className="text-accent-deep">platform admin</span>
          </p>
          <nav aria-label="Platform admin">
            <ul className="flex flex-wrap gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="type-label-large text-ink-soft hover:text-ink-strong rounded-md px-3 py-2"
                    activeProps={{
                      className: "bg-surface-container-high text-ink-strong",
                    }}
                    activeOptions={{ exact: true }}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
