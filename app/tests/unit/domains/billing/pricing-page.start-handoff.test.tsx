// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));

import { PricingPage } from "@/domains/billing/pages/public/pricing-page";

describe("PricingPage start handoff", () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.useAtlasSession.mockReset();
    resetRouterMocks();
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("routes anonymous Team buyers to purchase onboarding", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_team" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("routes signed-in but incomplete Pro buyers to purchase onboarding", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: false,
        hasPasskey: false,
        workspace: { activeOrganization: null },
      },
    });
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get Atlas Pro" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_pro" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
