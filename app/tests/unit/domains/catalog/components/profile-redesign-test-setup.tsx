import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});
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
