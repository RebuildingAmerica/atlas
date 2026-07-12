import { createFileRoute } from "@tanstack/react-router";
import { AdminDashboardPage } from "@/domains/admin/admin-dashboard-page";

export const Route = createFileRoute("/_workspace/admin/")({
  component: AdminDashboardPage,
});
