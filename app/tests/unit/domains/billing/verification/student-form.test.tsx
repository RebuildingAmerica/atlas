// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StudentForm } from "@/domains/billing/verification/student-form";

describe("StudentForm", () => {
  describe("validation", () => {
    it("asks for a school email before anything is entered", async () => {
      const onSubmit = vi.fn();
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("School email is required");
      expect(screen.getByLabelText("School email")).toHaveAttribute("aria-invalid", "true");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("rejects a domain with no dot, which the browser's own email check lets through", async () => {
      const onSubmit = vi.fn();
      render(<StudentForm onSubmit={onSubmit} />);

      // `type="email"` accepts a dotless domain, so this is the malformed
      // address a real student can actually get past the input.
      await userEvent.type(screen.getByLabelText("School email"), "ada@howard");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent(
        "School email must be a valid email address",
      );
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("treats whitespace as an empty school email", async () => {
      const onSubmit = vi.fn();
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "   ");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("School email is required");
    });

    it("asks for a school name once the email is valid", async () => {
      const onSubmit = vi.fn();
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByRole("alert")).toHaveTextContent("School or program is required");
      expect(screen.getByLabelText("School or program")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("School email")).not.toHaveAttribute("aria-invalid");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("points the error message at the field it belongs to", async () => {
      render(<StudentForm onSubmit={vi.fn()} />);

      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(screen.getByLabelText("School email")).toHaveAccessibleDescription(
        "Use the email address connected to your current school or program. School email is required",
      );
    });

    it("clears the previous error when the form is resubmitted", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
  });

  describe("submission", () => {
    it("sends the school email and school name the student typed", async () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(onSubmit).toHaveBeenCalledWith({
        schoolEmail: "ada@howard.edu",
        schoolName: "Howard University",
      });
    });

    it("shows the reason the server gave for rejecting the request", async () => {
      const onSubmit = vi.fn().mockRejectedValue(new Error("That school is already verified."));
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "That school is already verified.",
      );
      expect(screen.getByLabelText("School email")).not.toHaveAttribute("aria-invalid");
    });

    it("shows a generic failure when the rejection carries no message", async () => {
      const onSubmit = vi.fn().mockRejectedValue("network down");
      render(<StudentForm onSubmit={onSubmit} />);

      await userEvent.type(screen.getByLabelText("School email"), "ada@howard.edu");
      await userEvent.type(screen.getByLabelText("School or program"), "Howard University");
      await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Submission failed");
    });
  });

  describe("while a submission is in flight", () => {
    it("disables the fields and says it is submitting", () => {
      render(<StudentForm onSubmit={vi.fn()} isLoading />);

      expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
      expect(screen.getByLabelText("School email")).toBeDisabled();
      expect(screen.getByLabelText("School or program")).toBeDisabled();
    });
  });
});
