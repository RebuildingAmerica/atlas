// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DiscountReviewView } from "@/domains/discounts/discount-review-view";
import {
  discountRequest as record,
  ignoreDecision as noop,
} from "../fixtures/admin";

describe("DiscountReviewView", () => {
  it("shows placeholders while requests load", () => {
    render(
      <DiscountReviewView
        isLoading
        onDecide={noop}
        records={[]}
        reviewPending={false}
        total={0}
      />,
    );

    expect(screen.getAllByText("-")).toHaveLength(4);
    expect(
      screen.queryByText("No discount requests yet."),
    ).not.toBeInTheDocument();
  });

  it("says when there is nothing to review", () => {
    render(
      <DiscountReviewView
        isLoading={false}
        onDecide={noop}
        records={[]}
        reviewPending={false}
        total={0}
      />,
    );

    expect(screen.getByText("No discount requests yet.")).toBeInTheDocument();
  });

  it("shows why the requests could not load", () => {
    render(
      <DiscountReviewView
        errorMessage="Sign in again through Cloudflare Access."
        isLoading={false}
        onDecide={noop}
        records={[record()]}
        reviewPending={false}
        total={1}
      />,
    );

    expect(
      screen.getByText("Sign in again through Cloudflare Access."),
    ).toBeInTheDocument();
    expect(screen.queryByText("student@example.edu")).not.toBeInTheDocument();
  });

  it("counts requests by status and shows each one's evidence and outcome", () => {
    render(
      <DiscountReviewView
        decisionMessage="The applicant could not be emailed, so the request is still waiting. Decide it again."
        isLoading={false}
        onDecide={noop}
        records={[
          record({ id: "a" }),
          record({
            id: "b",
            notes: "Byline confirmed",
            segment: "independent_journalist",
            status: "verified",
          }),
          record({ id: "c", status: "rejected", verification_data: {} }),
          record({ id: "d", status: "expired" }),
        ]}
        reviewPending={false}
        total={4}
      />,
    );

    expect(
      screen.getByText(
        "The applicant could not be emailed, so the request is still waiting. Decide it again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Reason: Byline confirmed")).toBeInTheDocument();
    expect(
      screen.getByText("The applicant gave no evidence."),
    ).toBeInTheDocument();
    for (const label of ["Pending", "Approved", "Declined", "Expired"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByText("Independent Creator or Journalist"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("student@example.edu")).toHaveLength(3);
  });

  it("requires a reason before a decision can be made", async () => {
    const onDecide = vi.fn();
    render(
      <DiscountReviewView
        isLoading={false}
        onDecide={onDecide}
        records={[record()]}
        reviewPending={false}
        total={1}
      />,
    );
    const approve = screen.getByRole("button", { name: "Approve" });
    const decline = screen.getByRole("button", { name: "Decline" });

    expect(approve).toBeDisabled();
    await userEvent.type(
      screen.getByRole("textbox"),
      "  Enrollment letter checked  ",
    );
    await userEvent.click(approve);
    await userEvent.click(decline);

    expect(onDecide).toHaveBeenNthCalledWith(1, {
      notes: "Enrollment letter checked",
      status: "verified",
      verificationId: "v-1",
    });
    expect(onDecide).toHaveBeenNthCalledWith(2, {
      notes: "Enrollment letter checked",
      status: "rejected",
      verificationId: "v-1",
    });
  });

  it("holds decisions while one is being saved", () => {
    render(
      <DiscountReviewView
        isLoading={false}
        onDecide={noop}
        records={[record()]}
        reviewPending
        total={1}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("shows a decided request without its reason when none was given", () => {
    render(
      <DiscountReviewView
        isLoading={false}
        onDecide={noop}
        records={[record({ status: "verified", verification_data: undefined })]}
        reviewPending={false}
        total={1}
      />,
    );

    expect(screen.queryByText(/^Reason:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
  });
});
