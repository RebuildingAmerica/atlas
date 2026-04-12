import { Outlet, createFileRoute } from "@tanstack/react-router";
import { PublicFloatingNav } from "@/platform/layout/public-nav";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <>
      <PublicFloatingNav />
      <Outlet />
    </>
  );
}
