import type { EditorialActivity } from "./editorial-activity.functions";

interface ActivityLabelRule {
  action: string;
  label: string;
  /** Matches the end of the route template, such as `/approve`. */
  routeEnds?: string;
  method?: string;
}

/**
 * Plain sentences for the decisions the audit log records, most specific
 * first. A route the table does not know falls through to its action name, so
 * a new kind of decision still shows up rather than vanishing.
 */
const ACTIVITY_LABELS: readonly ActivityLabelRule[] = [
  { action: "instance.flags.resolve", label: "Resolved a visitor report", routeEnds: "/resolve" },
  { action: "instance.flags.resolve", label: "Dismissed a visitor report", routeEnds: "/dismiss" },
  {
    action: "instance.review_queue.decide",
    label: "Approved a discovery review",
    routeEnds: "/approve",
  },
  {
    action: "instance.review_queue.decide",
    label: "Rejected a discovery review",
    routeEnds: "/reject",
  },
  { action: "instance.review_queue.stage", label: "Sent a profile to review" },
  { action: "instance.review_queue.scan", label: "Ran a review scan" },
  {
    action: "instance.claims.review",
    label: "Approved a profile verification",
    routeEnds: "/approve",
  },
  {
    action: "instance.claims.review",
    label: "Rejected a profile verification",
    routeEnds: "/reject",
  },
  { action: "instance.claims.review", label: "Rechecked profile verifications" },
  { action: "instance.entries.takedown", label: "Restored a profile", routeEnds: "/restore" },
  { action: "instance.entries.takedown", label: "Took a profile down" },
  { action: "instance.entries.merge", label: "Merged duplicate profiles" },
  { action: "instance.schedules.write", label: "Added a discovery schedule", method: "POST" },
  { action: "instance.schedules.write", label: "Changed a discovery schedule", method: "PATCH" },
  { action: "instance.schedules.write", label: "Removed a discovery schedule", method: "DELETE" },
  { action: "instance.runs.cancel", label: "Cancelled a discovery run" },
];

/**
 * Describes one decision in plain words.
 *
 * @param activity - The decision from the audit log.
 */
export function describeActivity(activity: EditorialActivity): string {
  const rule = ACTIVITY_LABELS.find(
    (candidate) =>
      candidate.action === activity.action &&
      (candidate.routeEnds === undefined || activity.route.endsWith(candidate.routeEnds)) &&
      (candidate.method === undefined || candidate.method === activity.method),
  );
  return rule?.label ?? activity.action;
}
