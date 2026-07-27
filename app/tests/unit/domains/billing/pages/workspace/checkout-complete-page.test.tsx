// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckoutCompletePage } from "@/domains/billing/pages/workspace/checkout-complete-page";
import { renderWithProviders } from "../../../../../helpers/render-with-providers";
import { installRouterMocks } from "../../../../../helpers/router-harness";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  getAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const { installRouterMocks: install } = await import("../../../../../helpers/router-harness");
  return install();
});
vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));

describe("CheckoutCompletePage", () => {
  beforeEach(() => {
    installRouterMocks();
    window.localStorage.clear();
    mocks.getAtlasSession.mockResolvedValue(
      createAtlasSessionFixture({ workspace: createAtlasWorkspace({ activeProducts: [] }) }),
    );
  });

  describe("while the webhook has not landed yet", () => {
    it("tells the operator Atlas is still enabling the product they bought", async () => {
      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);

      expect(await screen.findByRole("heading", { name: "Finishing up" })).toBeInTheDocument();
      expect(
        screen.getByText("Atlas is enabling your Atlas Pro access. This usually takes a moment."),
      ).toBeInTheDocument();
    });

    it("keeps waiting for Atlas Team until the team capability is granted", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({
            activeProducts: ["atlas_team"],
            capabilities: { canUseTeamFeatures: false },
          }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_team" />);

      expect(await screen.findByRole("heading", { name: "Finishing up" })).toBeInTheDocument();
    });
  });

  describe("once the purchased product is active", () => {
    it("welcomes an Atlas Pro buyer and lists what they unlocked", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeProducts: ["atlas_pro"] }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);

      expect(
        await screen.findByRole("heading", { name: "Thanks for backing Atlas." }),
      ).toBeInTheDocument();
      expect(screen.getByText("Welcome to Atlas Pro")).toBeInTheDocument();
      expect(screen.getByText("→ Unlimited research requests")).toBeInTheDocument();
      expect(screen.getByText("→ Exports to CSV and JSON")).toBeInTheDocument();
      expect(screen.getByText("→ API key with 1,000 requests a day")).toBeInTheDocument();
    });

    it("points an Atlas Pro buyer at their workspace and their subscription", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeProducts: ["atlas_pro"] }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await screen.findByRole("heading", { name: "Thanks for backing Atlas." });

      expect(screen.getByRole("link", { name: "Open your workspace" })).toHaveAttribute(
        "href",
        "/discovery",
      );
      expect(screen.getByRole("link", { name: "Manage subscription" })).toHaveAttribute(
        "href",
        "/account",
      );
    });

    it("sends an Atlas Team buyer to SSO setup next", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({
            activeProducts: ["atlas_team"],
            capabilities: { canUseTeamFeatures: true },
          }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_team" />);

      expect(
        await screen.findByRole("heading", { name: "Your team workspace is ready." }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Configure SSO" })).toHaveAttribute(
        "href",
        "/organization/sso",
      );
      expect(screen.getByText("→ Up to 50 members")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Manage subscription" })).not.toBeInTheDocument();
    });

    it("calls a Research Pass active rather than a subscription", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeProducts: ["atlas_research_pass"] }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_research_pass" />);

      expect(await screen.findByText("Your Research Pass is active")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "View your account" })).toHaveAttribute(
        "href",
        "/account",
      );
      expect(
        screen.getByText("→ Shortlists and notes you keep after the pass ends"),
      ).toBeInTheDocument();
    });

    it("stops advertising the resume-checkout banner", async () => {
      window.localStorage.setItem(
        "atlas:pending-checkout",
        JSON.stringify({ interval: "monthly", product: "atlas_pro", startedAt: Date.now() }),
      );
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeProducts: ["atlas_pro"] }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await screen.findByRole("heading", { name: "Thanks for backing Atlas." });

      expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
    });
  });

  describe("with no product on the URL", () => {
    it("thanks the operator without naming a product or listing features", async () => {
      renderWithProviders(<CheckoutCompletePage />);

      expect(
        await screen.findByRole("heading", { name: "Thanks for backing Atlas." }),
      ).toBeInTheDocument();
      expect(screen.getByText("Welcome to your purchase")).toBeInTheDocument();
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    });

    it("leaves a pending checkout record alone, since nothing is known to be paid", async () => {
      window.localStorage.setItem(
        "atlas:pending-checkout",
        JSON.stringify({ interval: "monthly", product: "atlas_pro", startedAt: Date.now() }),
      );

      renderWithProviders(<CheckoutCompletePage />);
      await screen.findByRole("heading", { name: "Thanks for backing Atlas." });

      expect(window.localStorage.getItem("atlas:pending-checkout")).not.toBeNull();
    });
  });

  describe("polling", () => {
    it("flips to the welcome card when a later poll sees the product activate", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mocks.getAtlasSession.mockResolvedValueOnce(
        createAtlasSessionFixture({ workspace: createAtlasWorkspace({ activeProducts: [] }) }),
      );
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeProducts: ["atlas_pro"] }),
        }),
      );

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await vi.waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Finishing up"));

      await vi.advanceTimersByTimeAsync(1500);

      await vi.waitFor(() =>
        expect(screen.getByRole("heading")).toHaveTextContent("Thanks for backing Atlas."),
      );
      vi.useRealTimers();
    });

    it("keeps re-reading the session while a session payload stays identical", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await vi.waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Finishing up"));
      const readsBeforePolling = mocks.getAtlasSession.mock.calls.length;

      // A lagging webhook produces byte-identical session payloads, and React
      // Query hands back the same object reference for them. Polling has to
      // survive that: before this was fixed the effect re-ran only on a
      // changed payload, so exactly one poll ever fired and the operator sat
      // on "Finishing up" forever.
      await vi.waitFor(
        () => {
          expect(mocks.getAtlasSession.mock.calls.length).toBeGreaterThan(readsBeforePolling + 1);
        },
        { interval: 1500, timeout: 60_000 },
      );
      vi.useRealTimers();
    });

    it("offers a way out once Atlas has kept the buyer waiting past the timeout", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await vi.waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Finishing up"));

      await vi.advanceTimersByTimeAsync(35_000);

      await vi.waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Almost there"));
      expect(
        screen.getByText(/We have your payment for Atlas Pro, but Atlas hasn't finished/),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to your account" })).toHaveAttribute(
        "href",
        "/account",
      );
      vi.useRealTimers();
    });

    it("reloads the page when the stalled buyer presses Refresh", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const reload = vi.fn();
      vi.stubGlobal("location", { ...window.location, reload });

      renderWithProviders(<CheckoutCompletePage product="atlas_pro" />);
      await vi.advanceTimersByTimeAsync(35_000);
      await vi.waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Almost there"));
      vi.useRealTimers();

      await userEvent.click(screen.getByRole("button", { name: "Refresh" }));

      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    });
  });
});
