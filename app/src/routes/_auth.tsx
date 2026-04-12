import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AuthFlowLayout } from "@/platform/layout/auth-layout";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <AuthFlowLayout>
      <Outlet />
    </AuthFlowLayout>
  );
}
