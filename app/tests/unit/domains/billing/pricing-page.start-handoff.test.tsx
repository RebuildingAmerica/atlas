// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  navigate: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/platform/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/platform/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));

import { PricingPage } from "@/domains/billing/pages/public/pricing-page";

describe("PricingPage start handoff", () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.navigate.mockReset();
    mocks.useAtlasSession.mockReset();
    mocks.navigate.mockResolvedValue(undefined);
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("routes anonymous Team buyers to purchase onboarding", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get Atlas Team" }));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/start",
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

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/start",
      search: { interval: "monthly", product: "atlas_pro" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
