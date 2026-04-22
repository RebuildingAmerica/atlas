import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignInPage, signInSearchSchema } from "@/domains/access";
import { getAtlasSession } from "@/domains/access/session.functions";

export const Route = createFileRoute("/_auth/sign-in")({
  ssr: false,
  validateSearch: signInSearchSchema,
  beforeLoad: async () => {
    const session = await getAtlasSession();
    if (session?.isLocal) {
      throw redirect({ to: "/discovery" });
    }
  },
  component: SignInRoute,
});

function SignInRoute() {
  const search = Route.useSearch();
  return (
    <SignInPage
      existingAccount={search.existing}
      initialEmail={search.email}
      invitationId={search.invitation}
      redirectTo={search.redirect}
    />
  );
}
