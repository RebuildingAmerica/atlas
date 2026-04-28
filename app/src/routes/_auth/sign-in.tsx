import { createFileRoute } from "@tanstack/react-router";
import { SignInPage, signInSearchSchema } from "@/domains/access";
import { redirectIfLocalSession } from "@/domains/access/server";

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: signInSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: SignInRoute,
});

function SignInRoute() {
  const search = Route.useSearch();
  return (
    <SignInPage
      errorCode={search.error}
      existingAccount={search.existing}
      initialEmail={search.email}
      invitationId={search.invitation}
      redirectTo={search.redirect}
    />
  );
}
