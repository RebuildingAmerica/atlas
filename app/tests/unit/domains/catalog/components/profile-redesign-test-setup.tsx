import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
  }: {
    children: ReactNode;
    params?: Record<string, string>;
    search?: Record<string, unknown>;
    to: string;
  }) => (
    <a
      href={to}
      data-link-params={params ? JSON.stringify(params) : undefined}
      data-link-search={search ? JSON.stringify(search) : undefined}
    >
      {children}
    </a>
  ),
  useRouter: () => ({}),
}));
vi.mock("@/domains/catalog/components/profiles/private-notes-panel", () => ({
  PrivateNotesPanel: ({
    targetId,
    targetLabel,
    type,
  }: {
    targetId: string;
    targetLabel: string;
    type: "entry" | "source";
  }) => <div data-testid={`private-notes-${type}-${targetId}`}>{targetLabel}</div>,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
