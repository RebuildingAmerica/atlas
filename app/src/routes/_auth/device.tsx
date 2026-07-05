import { createFileRoute } from "@tanstack/react-router";
import { DeviceApprovalPage, deviceApprovalSearchSchema } from "@/domains/access";
import { requireAtlasSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/device")({
  ssr: false,
  validateSearch: deviceApprovalSearchSchema,
  beforeLoad: async ({ location }) => {
    return {
      session: await requireAtlasSession(location.href),
    };
  },
  component: DeviceApprovalRoute,
});

function DeviceApprovalRoute() {
  const search = Route.useSearch();
  return <DeviceApprovalPage userCode={search.user_code} />;
}
