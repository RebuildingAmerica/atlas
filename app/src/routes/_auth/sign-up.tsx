import { createFileRoute } from "@tanstack/react-router";
import { SignUpPage } from "@/domains/access/pages/sign-up-page";

export const Route = createFileRoute("/_auth/sign-up")({
  ssr: false,
  component: SignUpRoute,
});

function SignUpRoute() {
  return <SignUpPage />;
}
