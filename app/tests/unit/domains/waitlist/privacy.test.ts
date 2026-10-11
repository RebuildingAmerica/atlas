import { describe, expect, it } from "vitest";
import { excludePrivateAnalytics } from "@/platform/analytics/private-events";
describe("private request analytics", () => {
  it("suppresses private routes and email credentials for both metrics providers", () => {
    for (const url of [
      "/waitlist",
      "/waitlist/link?token=secret",
      "/admin/waitlist",
      "/api/auth/internal/platform-waitlist",
      "/sign-in?email=private@example.org",
      "/callback?token=secret",
    ])
      expect(excludePrivateAnalytics({ url })).toBeNull();
    const event = { url: "https://atlas.test/browse?issue=transit", type: "pageview" };
    expect(excludePrivateAnalytics(event)).toBe(event);
  });
});
