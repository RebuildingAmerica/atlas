import { describe, expect, it } from "vitest";
import { describeActivity } from "@/domains/editorial/editorial-activity-labels";
import { APPROVAL } from "../../../fixtures/editorial/editorial-activity";

describe("describeActivity", () => {
  it.each([
    [
      "instance.flags.resolve",
      "POST",
      "/api/entity-flags/{flag_id}/resolve",
      "Resolved a visitor report",
    ],
    [
      "instance.flags.resolve",
      "POST",
      "/api/source-flags/{flag_id}/dismiss",
      "Dismissed a visitor report",
    ],
    [
      "instance.review_queue.decide",
      "POST",
      "/api/review-queue/{item_id}/approve",
      "Approved a discovery review",
    ],
    [
      "instance.review_queue.decide",
      "POST",
      "/api/review-queue/{item_id}/reject",
      "Rejected a discovery review",
    ],
    [
      "instance.review_queue.stage",
      "POST",
      "/api/review-queue/editorial-candidates",
      "Sent a profile to review",
    ],
    [
      "instance.review_queue.scan",
      "POST",
      "/api/review-queue/website-candidate-scan",
      "Ran a review scan",
    ],
    [
      "instance.claims.review",
      "POST",
      "/api/profiles/claims/review/{claim_id}/approve",
      "Approved a profile verification",
    ],
    [
      "instance.claims.review",
      "POST",
      "/api/profiles/claims/review/{claim_id}/reject",
      "Rejected a profile verification",
    ],
    [
      "instance.claims.review",
      "POST",
      "/api/profiles/claims/review/atproto/revalidate",
      "Rechecked profile verifications",
    ],
    [
      "instance.entries.takedown",
      "POST",
      "/api/takedowns/{takedown_id}/restore",
      "Restored a profile",
    ],
    ["instance.entries.takedown", "POST", "/api/takedowns", "Took a profile down"],
    ["instance.entries.merge", "POST", "/api/merges", "Merged duplicate profiles"],
    ["instance.schedules.write", "POST", "/api/discovery-schedules", "Added a discovery schedule"],
    [
      "instance.schedules.write",
      "PATCH",
      "/api/discovery-schedules/{schedule_id}",
      "Changed a discovery schedule",
    ],
    [
      "instance.schedules.write",
      "DELETE",
      "/api/discovery-schedules/{schedule_id}",
      "Removed a discovery schedule",
    ],
    [
      "instance.runs.cancel",
      "POST",
      "/api/discovery-runs/{run_id}/cancel",
      "Cancelled a discovery run",
    ],
  ])("describes %s %s %s", (action, method, route, label) => {
    expect(describeActivity({ ...APPROVAL, action, method, route })).toBe(label);
  });

  it("names a decision it does not know by its action rather than hiding it", () => {
    expect(describeActivity({ ...APPROVAL, action: "instance.future.thing" })).toBe(
      "instance.future.thing",
    );
  });
});
