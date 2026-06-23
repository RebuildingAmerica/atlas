import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AcceptInvitationPage } from "@/domains/access/pages/auth/accept-invitation-page";
import { redirectIfLocalSession } from "@/domains/access/server";

const acceptInvitationSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/_auth/accept-invitation/$invitationId")({
  validateSearch: acceptInvitationSearchSchema,
  beforeLoad: () => redirectIfLocalSession("/discovery"),
  component: AcceptInvitationRoute,
});

function AcceptInvitationRoute() {
  const { invitationId } = Route.useParams();
  return <AcceptInvitationPage invitationId={invitationId} />;
}
