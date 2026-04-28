import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SignUpPage } from "@/domains/access/pages/auth/sign-up-page";
import { redirectIfLocalSession } from "@/domains/access/server";

const signUpSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_auth/sign-up")({
  ssr: false,
  validateSearch: signUpSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: SignUpRoute,
});

function SignUpRoute() {
  const search = Route.useSearch();
  return <SignUpPage redirectTo={search.redirect} />;
}
