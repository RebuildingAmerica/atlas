import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignUpPage } from "@/domains/access/pages/auth/sign-up-page";
import { redirectIfLocalSession } from "@/domains/access/server";

const signUpSearchSchema = z.object({
  intent: z.enum(["team-sso"]).optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_auth/sign-up")({
  validateSearch: signUpSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: SignUpRoute,
});

function SignUpRoute() {
  const search = Route.useSearch();
  return <SignUpPage intent={search.intent} redirectTo={search.redirect} />;
}
