// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndependentJournalistForm } from "@/domains/billing/verification/independent-journalist-form";

describe("IndependentJournalistForm", () => {
  it("asks for a portfolio URL before anything is entered", async () => {
    const onSubmit = vi.fn();
    render(<IndependentJournalistForm onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Portfolio URL is required");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a portfolio value that is not a URL, even when native validation is bypassed", async () => {
    const onSubmit = vi.fn();
    const { container } = render(<IndependentJournalistForm onSubmit={onSubmit} />);

    // `type="url"` normally blocks this before the handler runs, so submit the
    // form directly to prove the handler's own guard still holds.
    await userEvent.type(screen.getByLabelText("Portfolio or Byline URL"), "my-byline-page");
    const form = container.querySelector("form");
    if (!form) throw new Error("Expected the journalist form to render.");
    fireEvent.submit(form);

    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid URL");
    expect(screen.getByLabelText("Portfolio or Byline URL")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends the portfolio URL the journalist typed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<IndependentJournalistForm onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByLabelText("Portfolio or Byline URL"),
      "https://example.org/byline",
    );
    await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    expect(onSubmit).toHaveBeenCalledWith({ portfolioUrl: "https://example.org/byline" });
  });

  it("shows the reason the server gave for rejecting the request", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("That byline is already verified."));
    render(<IndependentJournalistForm onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByLabelText("Portfolio or Byline URL"),
      "https://example.org/byline",
    );
    await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That byline is already verified.");
  });

  it("shows a generic failure when the rejection carries no message", async () => {
    const onSubmit = vi.fn().mockRejectedValue("network down");
    render(<IndependentJournalistForm onSubmit={onSubmit} />);

    await userEvent.type(
      screen.getByLabelText("Portfolio or Byline URL"),
      "https://example.org/byline",
    );
    await userEvent.click(screen.getByRole("button", { name: "Request Verification" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Submission failed");
  });

  it("disables the field and says it is submitting while in flight", () => {
    render(<IndependentJournalistForm onSubmit={vi.fn()} isLoading />);

    expect(screen.getByRole("button", { name: "Submitting..." })).toBeDisabled();
    expect(screen.getByLabelText("Portfolio or Byline URL")).toBeDisabled();
  });
});
