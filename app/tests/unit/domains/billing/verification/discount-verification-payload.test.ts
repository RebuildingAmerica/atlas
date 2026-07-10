import { describe, expect, it } from "vitest";
import { buildDiscountVerificationRequestBody } from "@/domains/billing/verification/discount-verification-payload";

describe("buildDiscountVerificationRequestBody", () => {
  it("keeps the selected discount segment attached to its typed verification data", () => {
    expect(
      buildDiscountVerificationRequestBody({
        organizationId: "org_123",
        submission: {
          data: {
            schoolEmail: "maya@university.edu",
            schoolName: "Howard University",
          },
          segment: "student",
        },
        userId: "user_123",
      }),
    ).toEqual({
      data: {
        schoolEmail: "maya@university.edu",
        schoolName: "Howard University",
      },
      organization_id: "org_123",
      segment: "student",
      user_id: "user_123",
    });
  });
});
