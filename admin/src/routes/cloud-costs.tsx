import { createFileRoute } from "@tanstack/react-router";
import { CloudCostsPage } from "@/domains/cloud-costs/cloud-costs-page";

export const Route = createFileRoute("/cloud-costs")({
  head: () => ({ meta: [{ title: "Cloud costs | Atlas platform admin" }] }),
  component: CloudCostsPage,
});
