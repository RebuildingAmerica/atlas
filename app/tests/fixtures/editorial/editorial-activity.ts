import type { EditorialActivity } from "@/domains/editorial/editorial-activity.functions";

/** An approval as the Atlas API returns it. */
export const API_APPROVAL = {
  action: "instance.review_queue.decide",
  actor_email: "editor@rebuildingus.org",
  actor_id: "user_editor",
  allowed: true,
  id: "audit-1",
  method: "POST",
  occurred_at: "2026-10-08T15:30:00Z",
  reason: null,
  route: "/api/review-queue/{item_id}/approve",
  target: { item_id: "review-1" },
};

/** The same approval as the activity page sees it. */
export const APPROVAL: EditorialActivity = {
  action: "instance.review_queue.decide",
  actor: "editor@rebuildingus.org",
  allowed: true,
  id: "audit-1",
  method: "POST",
  occurredAt: "2026-10-08T15:30:00Z",
  reason: null,
  route: "/api/review-queue/{item_id}/approve",
  target: { item_id: "review-1" },
};

/** Someone off the operator list trying to remove a schedule. */
export const REFUSED_REMOVAL: EditorialActivity = {
  action: "instance.schedules.write",
  actor: "visitor@example.org",
  allowed: false,
  id: "audit-2",
  method: "DELETE",
  occurredAt: "2026-10-08T14:00:00Z",
  reason: "This action requires Atlas staff.",
  route: "/api/discovery-schedules/{schedule_id}",
  target: {},
};
