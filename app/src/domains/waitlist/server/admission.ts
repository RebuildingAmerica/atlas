import "@tanstack/react-start/server-only";
import type { AtlasSessionPayload } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import { UserFacingError } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import type { WaitlistProduct } from "../contracts";
import { getWaitlistStore, paidAccessMode } from "./runtime";
import { queryActiveProducts } from "@/domains/access/server/workspace-products";
import { canManageAtlasOrganizationRole } from "@rebuildingamerica/atlas-access/workspace/organization-metadata";

/** Invitations authorize a purchase; settled payment remains the sole paid-feature authority. */
export async function assertPaidAdmission(
  session: AtlasSessionPayload,
  product: WaitlistProduct,
  workspaceId?: string,
): Promise<void> {
  if (paidAccessMode() === "open") return;
  if (!session.user.emailVerified)
    throw new UserFacingError("Verify your email before continuing with this plan.");
  const workspace = workspaceId
    ? session.workspace.memberships.find((item) => item.id === workspaceId)
    : session.workspace.activeOrganization;
  if (workspace && canManageAtlasOrganizationRole(workspace.role)) {
    const products = await queryActiveProducts(workspace.id);
    if (products.includes(product)) return;
  }
  const store = await getWaitlistStore();
  if (!(await store.isAdmitted(session.user.email, product)))
    throw new UserFacingError(
      "An invitation is required for this plan. Join the waitlist to request access.",
    );
}
