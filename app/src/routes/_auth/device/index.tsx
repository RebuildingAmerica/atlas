import { createFileRoute } from "@tanstack/react-router";
import { DeviceApprovalPage, deviceApprovalSearchSchema } from "@/domains/access";

export const Route = createFileRoute("/_auth/device/")({
  validateSearch: deviceApprovalSearchSchema,
  component: DeviceApprovalRoute,
});

function DeviceApprovalRoute() {
  const search = Route.useSearch();
  return <DeviceApprovalPage status={search.status} userCode={search.user_code} />;
}
