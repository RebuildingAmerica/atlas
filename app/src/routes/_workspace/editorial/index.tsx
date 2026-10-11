import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboardPage } from "@/domains/editorial/admin-dashboard-page";

export const Route = createFileRoute("/_workspace/editorial/")({
  head: () => ({ meta: [{ title: "Editorial | Atlas" }] }),
  component: AdminDashboardPage,
});
