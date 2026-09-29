import { createFileRoute } from "@tanstack/react-router";
import { CloudCostsAdminPage } from "@/domains/admin/cloud-costs-page";

export const Route = createFileRoute("/_workspace/admin/cloud-costs")({
  head: () => ({ meta: [{ title: "Cloud costs | Atlas admin" }] }),
  component: CloudCostsAdminPage,
});
