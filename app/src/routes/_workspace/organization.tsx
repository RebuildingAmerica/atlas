import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_workspace/organization")({
  beforeLoad: ({ context }) => {
    const session = (context as { session?: { isLocal?: boolean } }).session;
    if (session?.isLocal) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router redirect pattern
      throw redirect({ to: "/discovery" });
    }
  },
  component: OrganizationLayoutRoute,
});

function OrganizationLayoutRoute() {
  return <Outlet />;
}
