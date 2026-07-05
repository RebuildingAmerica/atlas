import { createFileRoute } from "@tanstack/react-router";
import { DeviceApprovalCompletePage } from "@/domains/access";
import { requireAtlasSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/device/approved")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    return {
      session: await requireAtlasSession(location.href),
    };
  },
  component: DeviceApprovedRoute,
});

function DeviceApprovedRoute() {
  return <DeviceApprovalCompletePage />;
}
