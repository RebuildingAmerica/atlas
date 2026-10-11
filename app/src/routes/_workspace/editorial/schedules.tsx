import { createFileRoute } from "@tanstack/react-router";
import { DiscoverySchedulesPage } from "@/domains/editorial/discovery-schedules-page";

export const Route = createFileRoute("/_workspace/editorial/schedules")({
  head: () => ({ meta: [{ title: "Discovery schedules | Atlas editorial" }] }),
  component: DiscoverySchedulesPage,
});
