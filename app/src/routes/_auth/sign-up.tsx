import { createFileRoute } from "@tanstack/react-router";
import { SignUpPage } from "@/domains/access/pages/auth/sign-up-page";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/sign-up")({
  ssr: false,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: SignUpRoute,
});

function SignUpRoute() {
  return <SignUpPage />;
}
