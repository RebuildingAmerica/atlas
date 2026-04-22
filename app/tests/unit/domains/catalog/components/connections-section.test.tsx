// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ConnectionsSection } from "@/domains/catalog/components/profiles/connections-section";
import type { ConnectionGroup } from "@/types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

const mockConnections: ConnectionGroup[] = [
  {
    type: "same_organization",
    actors: [
      {
        id: "org-1",
        name: "Prairie Workers Cooperative",
        type: "organization",
        slug: "prairie-workers-a1b2",
        description_snippet: "A worker cooperative in Kansas City",
        evidence: "Affiliated organization",
      },
    ],
  },
  {
    type: "co_mentioned",
    actors: [
      {
        id: "person-2",
        name: "Maria Reyes",
        type: "person",
        slug: "maria-reyes-c3d4",
        description_snippet: "Community organizer",
        evidence: "Both mentioned in: Kansas City Star",
      },
    ],
  },
];

describe("ConnectionsSection", () => {
  it("renders connection groups with labels", () => {
    render(<ConnectionsSection connections={mockConnections} isLoading={false} />);
    expect(screen.getByText("Same Organization")).toBeTruthy();
    expect(screen.getByText("Co-mentioned")).toBeTruthy();
  });

  it("renders actor names and evidence", () => {
    render(<ConnectionsSection connections={mockConnections} isLoading={false} />);
    expect(screen.getByText("Prairie Workers Cooperative")).toBeTruthy();
    expect(screen.getByText("Affiliated organization")).toBeTruthy();
    expect(screen.getByText("Maria Reyes")).toBeTruthy();
    expect(screen.getByText("Both mentioned in: Kansas City Star")).toBeTruthy();
  });

  it("renders loading state", () => {
    render(<ConnectionsSection connections={[]} isLoading={true} />);
    expect(screen.getByText("Loading connections...")).toBeTruthy();
  });

  it("renders empty state when no connections", () => {
    render(<ConnectionsSection connections={[]} isLoading={false} />);
    expect(screen.getByText("No connections found yet")).toBeTruthy();
  });
});
