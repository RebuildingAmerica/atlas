import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendDiscountReviewResultEmail: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: () => ({ callbackSecret: "callback-test-secret" }), // pragma: allowlist secret
}));

vi.mock("@/domains/billing/server/discount-verification-emails", () => ({
  sendDiscountReviewResultEmail: mocks.sendDiscountReviewResultEmail,
}));

describe("the discount review-result callback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mocks.sendDiscountReviewResultEmail.mockReset();
  });

  it("emails the applicant the decision the API reports", async () => {
    const { handleDiscountReviewResultRequest } =
      await import("@/domains/billing/server/internal-discount-review-result");

    const response = await handleDiscountReviewResultRequest(
      new Request("https://atlas.test/api/auth/internal/discount-review-results", {
        body: JSON.stringify({ segment: "student", status: "verified", user_id: "user_1" }),
        headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret
        method: "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.sendDiscountReviewResultEmail).toHaveBeenCalledWith({
      segment: "student",
      status: "verified",
      userId: "user_1",
    });
  });

  it("refuses a caller without the callback secret", async () => {
    const { handleDiscountReviewResultRequest } =
      await import("@/domains/billing/server/internal-discount-review-result");

    const response = await handleDiscountReviewResultRequest(
      new Request("https://atlas.test/api/auth/internal/discount-review-results", {
        body: JSON.stringify({ segment: "student", status: "verified", user_id: "user_1" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.sendDiscountReviewResultEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that is not JSON", "not json"],
    ["an unknown segment", JSON.stringify({ segment: "x", status: "verified", user_id: "u" })],
    ["a pending status", JSON.stringify({ segment: "student", status: "pending", user_id: "u" })],
  ])("rejects %s", async (_label, body) => {
    const { handleDiscountReviewResultRequest } =
      await import("@/domains/billing/server/internal-discount-review-result");

    const response = await handleDiscountReviewResultRequest(
      new Request("https://atlas.test/api/auth/internal/discount-review-results", {
        body,
        headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.sendDiscountReviewResultEmail).not.toHaveBeenCalled();
  });

  it.each([new Error("Resend unavailable"), "mailbox full"])(
    "answers 502 so the API can tell the operator the email was not sent (%s)",
    async (failure) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.sendDiscountReviewResultEmail.mockRejectedValue(failure);
      const { handleDiscountReviewResultRequest } =
        await import("@/domains/billing/server/internal-discount-review-result");

      const response = await handleDiscountReviewResultRequest(
        new Request("https://atlas.test/api/auth/internal/discount-review-results", {
          body: JSON.stringify({ segment: "student", status: "rejected", user_id: "user_1" }),
          headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret
          method: "POST",
        }),
      );

      expect(response.status).toBe(502);
      expect(error).toHaveBeenCalledWith("Discount review email was not sent", {
        error: failure instanceof Error ? failure.message : failure,
        userId: "user_1",
      });
    },
  );
});
