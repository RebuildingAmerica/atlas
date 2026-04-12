import { createFileRoute } from "@tanstack/react-router";
import { SignInPage, signInSearchSchema } from "@/domains/access";

export const Route = createFileRoute("/_auth/sign-in")({
  ssr: false,
  validateSearch: signInSearchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const search = Route.useSearch();
  return <SignInPage redirectTo={search.redirect} />;
}
