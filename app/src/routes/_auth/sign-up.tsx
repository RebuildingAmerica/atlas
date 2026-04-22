import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignUpPage } from "@/domains/access/pages/sign-up-page";
import { getAtlasSession } from "@/domains/access/session.functions";

export const Route = createFileRoute("/_auth/sign-up")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getAtlasSession();
    if (session?.isLocal) {
      throw redirect({ to: "/discovery" });
    }
  },
  component: SignUpRoute,
});

function SignUpRoute() {
  return <SignUpPage />;
}
