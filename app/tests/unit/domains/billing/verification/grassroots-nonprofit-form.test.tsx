// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GrassrootsNonprofitForm } from "@/domains/billing/verification/grassroots-nonprofit-form";

describe("GrassrootsNonprofitForm", () => {
  describe("validation", () => {
    it("asks for an organization name or EIN before anything is entered", async () => {
      const onSubmit = vi.fn();
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Organization name or EIN is required");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("asks for a budget once the organization is named", async () => {
      render(<GrassrootsNonprofitForm onSubmit={vi.fn()} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "Community Fund");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Annual budget is required");
    });

    it("turns away an organization at or above the $2M ceiling", async () => {
      const onSubmit = vi.fn();
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "Community Fund");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "$2,000,000");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Budget must be under $2,000,000");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("turns away a budget that is not a number", async () => {
      const onSubmit = vi.fn();
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "Community Fund");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "not sure");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Budget must be under $2,000,000");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("accepts a budget just under the ceiling, formatted with a dollar sign and commas", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "Community Fund");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "$1,999,999");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        budget: "$1,999,999",
        einOrName: "Community Fund",
      });
    });
  });

  describe("submission", () => {
    it("shows the reason the server gave for rejecting the request", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error("We could not find that EIN."));
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "12-3456789");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "$500,000");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("We could not find that EIN.");
    });

    it("shows a generic failure when the rejection carries no message", async () => {
      const onSubmit = vi.fn().mockRejectedValue("network down");
      render(<GrassrootsNonprofitForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "12-3456789");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "$500,000");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Submission failed");
    });
  });

  describe("while a submission is in flight", () => {
    it("disables the fields and says it is submitting", () => {
      render(<GrassrootsNonprofitForm onSubmit={vi.fn()} isLoading />);

      expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
      expect(screen.getByLabelText("Organization Name or EIN")).toBeDisabled();
      expect(screen.getByLabelText("Annual Budget")).toBeDisabled();
    });
  });
});
