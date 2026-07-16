// @vitest-environment jsdom

import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { createEntryFixture } from "@/../tests/fixtures/catalog/entries";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useEntries: vi.fn(),
  useTaxonomy: vi.fn(),
}));

export { mocks };

export interface BrowseSearchUpdate {
  issue_areas?: string;
  offset?: number;
  query?: string;
  states?: string;
  view?: string;
}

export interface NavigateOptions {
  search?: BrowseSearchUpdate | ((current: BrowseSearchUpdate) => BrowseSearchUpdate);
}

export function getNavigateCalls(): NavigateOptions[] {
  return mocks.navigate.mock.calls.map(([options]) => options as NavigateOptions);
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    search?: Record<string, unknown>;
    to: string;
  }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@headlessui/react", () => ({
  Popover: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PopoverButton: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  PopoverPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type = "button",
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) => (
    <button type={type} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock("@/domains/catalog/components/browse/us-map-surface", () => ({
  UsMapSurface: ({ onSelectState }: { onSelectState: (state: string) => void }) => (
    <button
      type="button"
      onClick={() => {
        onSelectState("MO");
      }}
    >
      Select Missouri
    </button>
  ),
}));

vi.mock("@/domains/catalog/components/entries/entry-list", () => ({
  EntryList: ({ error, total }: { error?: Error | null; total?: number }) => (
    <div>
      {error ? <div role="alert">{error.message}</div> : null}
      <div>Entry list total: {total ?? 0}</div>
    </div>
  ),
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-entries", () => ({
  useEntries: mocks.useEntries,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.useEntries.mockReset();
  mocks.useTaxonomy.mockReset();
  mocks.useTaxonomy.mockReturnValue({
    data: {
      Housing: [
        {
          description: "Housing policy",
          name: "Housing Affordability",
          slug: "housing_affordability",
        },
      ],
    },
  });
  mocks.useEntries.mockReturnValue({
    data: {
      data: [
        createEntryFixture({
          id: "entry_123",
          first_seen: "2023-02-10T00:00:00Z",
          last_seen: "2026-04-12T00:00:00Z",
          latest_source_date: "2026-04-12",
          source_count: 4,
          type: "organization",
        }),
      ],
      facets: {
        states: [
          { count: 10, value: "MO" },
          { count: 5, value: "CA" },
        ],
      },
      pagination: {
        has_more: true,
        limit: 20,
        offset: 0,
        total: 25,
      },
    },
    error: null,
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
});
