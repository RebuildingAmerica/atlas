// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceBillingSection } from "@/domains/billing/components/workspace-billing-section";
import { installRouterMocks } from "../../../../helpers/router-harness";

const mocks = vi.hoisted(() => ({
  createPortalSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const { installRouterMocks: install } = await import("../../../../helpers/router-harness");
  return install();
});
vi.mock("@/domains/billing/billing.functions", () => ({
  createPortalSession: mocks.createPortalSession,
}));

describe("WorkspaceBillingSection", () => {
  beforeEach(() => {
    installRouterMocks();
  });

  describe("on a workspace with no paid products", () => {
    it("shows the free plan and an upgrade route, with no portal button", () => {
      render(<WorkspaceBillingSection activeProducts={[]} />);

      expect(screen.getByText("Free")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/pricing");
      expect(screen.queryByRole("button", { name: "Manage subscription" })).not.toBeInTheDocument();
    });
  });

  describe("on a workspace with paid products", () => {
    it("names every active product", () => {
      render(<WorkspaceBillingSection activeProducts={["atlas_pro", "atlas_research_pass"]} />);

      expect(screen.getByText("Atlas Pro")).toBeInTheDocument();
      expect(screen.getByText("Atlas Research Pass")).toBeInTheDocument();
      expect(screen.queryByText("Free")).not.toBeInTheDocument();
    });

    it("offers both the billing portal and an upgrade route", () => {
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      expect(screen.getByRole("button", { name: "Manage subscription" })).toBeEnabled();
      expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute("href", "/pricing");
    });

    it("sends the operator to the Stripe portal URL it was given", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      mocks.createPortalSession.mockResolvedValue({ url: "https://billing.stripe.test/p/session" });
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      await waitFor(() => {
        expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p/session");
      });
    });

    it("says it is opening while the portal session is being created", async () => {
      let releasePortal: (value: { url: string }) => void = () => undefined;
      mocks.createPortalSession.mockReturnValue(
        new Promise<{ url: string }>((resolve) => {
          releasePortal = resolve;
        }),
      );
      vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      expect(await screen.findByRole("button", { name: "Opening..." })).toBeDisabled();

      releasePortal({ url: "https://billing.stripe.test/p/session" });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Manage subscription" })).toBeEnabled();
      });
    });

    it("explains why the portal did not open and lets the operator retry", async () => {
      mocks.createPortalSession.mockRejectedValue(
        new Error("This workspace has no Stripe customer yet."),
      );
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      expect(
        await screen.findByText("This workspace has no Stripe customer yet."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Manage subscription" })).toBeEnabled();
    });

    it("falls back to a readable message when the failure is not an Error", async () => {
      mocks.createPortalSession.mockRejectedValue("network down");
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      expect(await screen.findByText("Could not open billing portal.")).toBeInTheDocument();
    });

    it("clears a previous failure when the operator tries again", async () => {
      const assign = vi.fn();
      vi.stubGlobal("location", { ...window.location, assign });
      mocks.createPortalSession.mockRejectedValueOnce(new Error("Stripe was unreachable."));
      mocks.createPortalSession.mockResolvedValue({ url: "https://billing.stripe.test/p/session" });
      render(<WorkspaceBillingSection activeProducts={["atlas_pro"]} />);

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));
      expect(await screen.findByText("Stripe was unreachable.")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Manage subscription" }));

      await waitFor(() => {
        expect(screen.queryByText("Stripe was unreachable.")).not.toBeInTheDocument();
      });
      expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p/session");
    });
  });
});
