// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VerificationForm } from "@/domains/billing/verification/verification-form";
import type { DiscountSegment } from "@/domains/billing/discount-segments";

describe("VerificationForm", () => {
  describe("picking the form for a segment", () => {
    it("asks a student for their school", () => {
      render(<VerificationForm segment="student" onSubmit={vi.fn()} />);

      expect(screen.getByLabelText("School email")).toBeInTheDocument();
      expect(screen.getByLabelText("School or program")).toBeInTheDocument();
    });

    it("asks a journalist for their portfolio", () => {
      render(<VerificationForm segment="independent_journalist" onSubmit={vi.fn()} />);

      expect(screen.getByLabelText("Portfolio or Byline URL")).toBeInTheDocument();
    });

    it("asks a nonprofit for its EIN and budget", () => {
      render(<VerificationForm segment="grassroots_nonprofit" onSubmit={vi.fn()} />);

      expect(screen.getByLabelText("Organization Name or EIN")).toBeInTheDocument();
      expect(screen.getByLabelText("Annual Budget")).toBeInTheDocument();
    });

    it("asks a civic tech worker for their project and mission", () => {
      render(<VerificationForm segment="civic_tech_worker" onSubmit={vi.fn()} />);

      expect(screen.getByLabelText("Project URL")).toBeInTheDocument();
      expect(screen.getByLabelText("Mission Statement")).toBeInTheDocument();
    });

    it("says so rather than rendering a blank form for a segment it does not know", () => {
      render(<VerificationForm segment={"lobbyist" as DiscountSegment} onSubmit={vi.fn()} />);

      expect(screen.getByText("Unknown segment")).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });

  describe("submitting", () => {
    it("tags a student submission with its segment", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<VerificationForm segment="student" onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        data: { schoolEmail: "ada@howard.edu", schoolName: "Howard University" },
        segment: "student",
      });
    });

    it("tags a civic tech submission with its segment", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<VerificationForm segment="civic_tech_worker" onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Project URL"), "https://example.org/civic");
      await userEvent.type(
        screen.getByLabelText("Mission Statement"),
        "We build open tools for civic accountability.",
      );
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        data: {
          mission: "We build open tools for civic accountability.",
          projectUrl: "https://example.org/civic",
        },
        segment: "civic_tech_worker",
      });
    });

    it("tags a nonprofit submission with its segment", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<VerificationForm segment="grassroots_nonprofit" onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("Organization Name or EIN"), "Community Fund");
      await userEvent.type(screen.getByLabelText("Annual Budget"), "$500,000");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        data: { budget: "$500,000", einOrName: "Community Fund" },
        segment: "grassroots_nonprofit",
      });
    });

    it("tags a journalist submission with its segment", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<VerificationForm segment="independent_journalist" onSubmit={onSubmit} />);

      await userEvent.type(
        screen.getByLabelText("Portfolio or Byline URL"),
        "https://example.org/byline",
      );
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        data: { portfolioUrl: "https://example.org/byline" },
        segment: "independent_journalist",
      });
    });
  });

  describe("after a successful submission", () => {
    it("replaces the form with a review-pending confirmation", async () => {
      render(
        <VerificationForm segment="student" onSubmit={vi.fn().mockResolvedValue(undefined)} />,
      );

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(
        await screen.findByRole("heading", { name: "Submission Received" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/usually within 24 hours/)).toBeInTheDocument();
      expect(screen.queryByLabelText("School email")).not.toBeInTheDocument();
    });

    it("keeps the form up when the submission was rejected", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error("Already verified."));
      render(<VerificationForm segment="student" onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Already verified.");
      expect(screen.queryByText("Submission Received")).not.toBeInTheDocument();
      expect(screen.getByLabelText("School email")).toBeInTheDocument();
    });
  });

  it("passes the in-flight state down to the segment form", () => {
    render(<VerificationForm segment="student" onSubmit={vi.fn()} isLoading />);

    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
  });
});
