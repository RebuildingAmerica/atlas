// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoverageTargetsList } from "@/domains/workspace/pages/coverage-page-panels";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("CoverageTargetsList", () => {
  it("renders nothing when the workspace has no coverage targets", () => {
    const { container } = render(<CoverageTargetsList targets={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
