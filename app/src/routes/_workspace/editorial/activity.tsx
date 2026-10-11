import { createFileRoute } from "@tanstack/react-router";
import { EditorialActivityPage } from "@/domains/editorial/editorial-activity-page";

export const Route = createFileRoute("/_workspace/editorial/activity")({
  head: () => ({ meta: [{ title: "Editorial activity | Atlas editorial" }] }),
  component: EditorialActivityPage,
});
