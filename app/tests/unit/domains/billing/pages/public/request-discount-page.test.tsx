// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { RequestDiscountPage } from "@/domains/billing/pages/public/request-discount-page";
import { renderWithProviders } from "../../../../../helpers/render-with-providers";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "../../../../../fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  getAtlasSession: vi.fn(),
  getCurrentDiscountVerificationStatus: vi.fn(),
  submitDiscountVerification: vi.fn(),
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));
vi.mock("@/domains/billing/discount-verifications.functions", () => ({
  getCurrentDiscountVerificationStatus: mocks.getCurrentDiscountVerificationStatus,
  submitDiscountVerification: mocks.submitDiscountVerification,
}));

describe("RequestDiscountPage", () => {
  beforeEach(() => {
    mocks.getCurrentDiscountVerificationStatus.mockResolvedValue({ record: null });
  });

  describe("while the session is still loading", () => {
    it("does not guess at whether the visitor is signed in", () => {
      mocks.getAtlasSession.mockReturnValue(new Promise(() => undefined));

      renderWithProviders(<RequestDiscountPage />);

      expect(screen.getByText("Loading...")).toBeInTheDocument();
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });
  });

  describe("for a visitor with no account", () => {
    it("explains the discounts and asks them to create an account first", async () => {
      mocks.getAtlasSession.mockResolvedValue(null);

      renderWithProviders(<RequestDiscountPage />);

      expect(
        await screen.findByRole("heading", { name: "Get discounted access to Atlas" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
        "href",
        "/sign-in",
      );
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    });

    it("lists every discount Atlas offers, with its rate", async () => {
      mocks.getAtlasSession.mockResolvedValue(null);

      renderWithProviders(<RequestDiscountPage />);
      await screen.findByRole("heading", { name: "Get discounted access to Atlas" });

      expect(screen.getByText(/\$12\.80 every four months after verification/)).toBeInTheDocument();
      expect(screen.getByText(/40% off Atlas Pro/)).toBeInTheDocument();
      // Journalists and civic tech workers both get 50%, so there are two.
      expect(screen.getAllByText(/50% off Atlas Pro/)).toHaveLength(2);
    });

    it("offers no verification form, since there is nothing to attach it to", async () => {
      mocks.getAtlasSession.mockResolvedValue(null);

      renderWithProviders(<RequestDiscountPage />);
      await screen.findByRole("heading", { name: "Get discounted access to Atlas" });

      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(mocks.getCurrentDiscountVerificationStatus).not.toHaveBeenCalled();
    });
  });

  describe("for a signed-in operator", () => {
    it("offers the verification form and explains how review works", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({ workspace: createAtlasWorkspace() }),
      );

      renderWithProviders(<RequestDiscountPage />);

      expect(
        await screen.findByRole("heading", { name: "Request discount access" }),
      ).toBeInTheDocument();
      expect(screen.getByText("How verification works")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create account" })).not.toBeInTheDocument();
    });

    it("scopes the verification request to the active workspace", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({ workspace: createAtlasWorkspace() }),
      );

      renderWithProviders(<RequestDiscountPage />);
      await screen.findByRole("heading", { name: "Request discount access" });

      expect(mocks.getCurrentDiscountVerificationStatus).toHaveBeenCalledWith({
        data: { organizationId: "org_team" },
      });
    });

    it("asks for a workspace first when the operator has none yet", async () => {
      mocks.getAtlasSession.mockResolvedValue(
        createAtlasSessionFixture({
          workspace: createAtlasWorkspace({ activeOrganization: null }),
        }),
      );

      renderWithProviders(<RequestDiscountPage />);

      expect(
        await screen.findByRole("heading", { name: "Request discount access" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Create a workspace first")).toBeInTheDocument();
    });
  });
});
