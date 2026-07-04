import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AuthFlowLayout } from "@/platform/layout/auth-layout";

export const Route = createFileRoute("/_auth")({
  head: () => ({
    meta: [
      { title: "Atlas account" },
      { name: "description", content: "Access your Atlas account." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <AuthFlowLayout>
      <Outlet />
    </AuthFlowLayout>
  );
}
