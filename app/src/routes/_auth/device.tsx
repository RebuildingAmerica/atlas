import { createFileRoute } from "@tanstack/react-router";
import { DeviceApprovalPage, deviceApprovalSearchSchema } from "@/domains/access";

export const Route = createFileRoute("/_auth/device")({
  ssr: false,
  validateSearch: deviceApprovalSearchSchema,
  component: DeviceApprovalRoute,
});

function DeviceApprovalRoute() {
  const search = Route.useSearch();
  return <DeviceApprovalPage userCode={search.user_code} />;
}
