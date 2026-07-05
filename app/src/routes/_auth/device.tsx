import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAtlasSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/device")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    return {
      session: await requireAtlasSession(location.href),
    };
  },
  component: DeviceRoute,
});

function DeviceRoute() {
  return <Outlet />;
}
