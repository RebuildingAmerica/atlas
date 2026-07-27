// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CivicTechForm } from "@/domains/billing/verification/civic-tech-form";

describe("CivicTechForm", () => {
  describe("validation", () => {
    it("asks for a project URL before anything is entered", async () => {
      const onSubmit = vi.fn();
      render(<CivicTechForm onSubmit={onSubmit} />);

      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Project URL is required");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("asks for a mission statement once a URL is entered", async () => {
      render(<CivicTechForm onSubmit={vi.fn()} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Mission statement is required");
    });

    it("rejects a project URL that is not a URL, even when native validation is bypassed", async () => {
      const onSubmit = vi.fn();
      const { container } = render(<CivicTechForm onSubmit={onSubmit} />);

      // `type="url"` normally blocks this before the handler runs, so submit
      // the form directly to prove the handler's own guard still holds.
      await userEvent.type(screen.getByLabelText("Project URL"), "example.org");
      await userEvent.type(
        screen.getByLabelText("Mission Statement"),
        "We build open tools for civic accountability.",
      );
      const form = container.querySelector("form");
      if (!form) throw new Error("Expected the civic tech form to render.");
      fireEvent.submit(form);

      expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid project URL");
      expect(screen.getByLabelText("Project URL")).toHaveAttribute("aria-invalid", "true");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("rejects a mission statement shorter than twenty characters", async () => {
      const onSubmit = vi.fn();
      render(<CivicTechForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.type(screen.getByLabelText("Mission Statement"), "Civic tools.");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Mission statement should be at least 20 characters",
      );
      expect(screen.getByLabelText("Mission Statement")).toHaveAttribute("aria-invalid", "true");
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("submission", () => {
    it("sends the project URL and mission the applicant typed", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<CivicTechForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.type(
        screen.getByLabelText("Mission Statement"),
        "We build open tools for civic accountability.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        mission: "We build open tools for civic accountability.",
        projectUrl: "https://example.org/civic",
      });
    });

    it("shows the reason the server gave for rejecting the request", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error("That project is already verified."));
      render(<CivicTechForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.type(
        screen.getByLabelText("Mission Statement"),
        "We build open tools for civic accountability.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That project is already verified.",
      );
    });

    it("shows a generic failure when the rejection carries no message", async () => {
      const onSubmit = vi.fn().mockRejectedValue("network down");
      render(<CivicTechForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.type(
        screen.getByLabelText("Mission Statement"),
        "We build open tools for civic accountability.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Submission failed");
    });
  });

  describe("while a submission is in flight", () => {
    it("disables the fields and says it is submitting", () => {
      render(<CivicTechForm onSubmit={vi.fn()} isLoading />);

      expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
      expect(screen.getByLabelText("Project URL")).toBeDisabled();
      expect(screen.getByLabelText("Mission Statement")).toBeDisabled();
    });
  });
});
