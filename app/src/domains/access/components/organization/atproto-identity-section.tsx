import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAtprotoIdentities,
  useProvisionManagedAtprotoIdentity,
} from "@/domains/access/atproto-identities";
import type { AtlasOrganizationMemberRecord } from "@/domains/access/organization-contracts";
import {
  attachOrganizationAtprotoIdentity,
  detachOrganizationAtprotoIdentity,
  getOrganizationAtprotoIdentity,
  grantOrganizationAtprotoIdentityDelegation,
  listOrganizationAtprotoIdentityDelegations,
  revokeOrganizationAtprotoIdentityDelegation,
} from "@/lib/generated/atlas/organization-identity/organization-identity";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

interface OrganizationAtprotoIdentitySectionProps {
  canManageOrganization: boolean;
  currentUserId: string | undefined;
  members: AtlasOrganizationMemberRecord[];
  organizationId: string;
}

const organizationIdentityQueryKey = (organizationId: string) =>
  ["organization-atproto-identity", organizationId, "identity"] as const;

const organizationDelegationsQueryKey = (organizationId: string, identityId: string) =>
  ["organization-atproto-identity", organizationId, identityId, "delegations"] as const;

/**
 * Lets owners and admins manage the workspace's public identity, while
 * rendering the one delegated action available to an authorized member.
 */
export function OrganizationAtprotoIdentitySection({
  canManageOrganization,
  currentUserId,
  members,
  organizationId,
}: OrganizationAtprotoIdentitySectionProps) {
  const [delegateUserId, setDelegateUserId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [managedHandle, setManagedHandle] = useState("");
  const [selectedIdentityId, setSelectedIdentityId] = useState("");
  const queryClient = useQueryClient();
  const accountIdentities = useAtprotoIdentities();
  const provisionManaged = useProvisionManagedAtprotoIdentity();
  const organizationIdentity = useQuery({
    queryKey: organizationIdentityQueryKey(organizationId),
    queryFn: () => getOrganizationAtprotoIdentity(organizationId),
  });
  const activeIdentityId = organizationIdentity.data?.identity_id;
  const delegations = useQuery({
    enabled: Boolean(activeIdentityId),
    queryKey: organizationDelegationsQueryKey(organizationId, activeIdentityId ?? ""),
    queryFn: () =>
      activeIdentityId
        ? listOrganizationAtprotoIdentityDelegations(organizationId, activeIdentityId)
        : Promise.resolve([]),
  });
  const attach = useMutation({
    mutationFn: async (identityId: string) =>
      await attachOrganizationAtprotoIdentity(organizationId, { identity_id: identityId }),
    onError: () => {
      setFeedback("Atlas could not use that identity for this organization.");
    },
    onSuccess: async () => {
      setFeedback("Organization identity updated.");
      await queryClient.invalidateQueries({
        queryKey: organizationIdentityQueryKey(organizationId),
      });
    },
  });
  const grant = useMutation({
    mutationFn: async (userId: string) => {
      if (!activeIdentityId) throw new Error("Organization identity is unavailable.");
      return await grantOrganizationAtprotoIdentityDelegation(organizationId, activeIdentityId, {
        delegate_user_id: userId,
      });
    },
    onError: () => {
      setFeedback("Atlas could not grant delegated administration.");
    },
    onSuccess: async () => {
      setDelegateUserId("");
      setFeedback("Delegated administration granted.");
      if (activeIdentityId) {
        await queryClient.invalidateQueries({
          queryKey: organizationDelegationsQueryKey(organizationId, activeIdentityId),
        });
      }
    },
  });
  const revoke = useMutation({
    mutationFn: async (userId: string) => {
      if (!activeIdentityId) throw new Error("Organization identity is unavailable.");
      return await revokeOrganizationAtprotoIdentityDelegation(
        organizationId,
        activeIdentityId,
        userId,
      );
    },
    onError: () => {
      setFeedback("Atlas could not revoke delegated administration.");
    },
    onSuccess: async (_result, userId) => {
      const member = members.find((candidate) => candidate.userId === userId);
      setFeedback(`Delegated administration revoked for ${member?.name ?? "that member"}.`);
      if (activeIdentityId) {
        await queryClient.invalidateQueries({
          queryKey: organizationDelegationsQueryKey(organizationId, activeIdentityId),
        });
      }
    },
  });
  const detach = useMutation({
    mutationFn: async () => {
      if (!activeIdentityId) throw new Error("Organization identity is unavailable.");
      return await detachOrganizationAtprotoIdentity(organizationId, activeIdentityId);
    },
    onError: () => {
      setFeedback(
        "Atlas could not remove this identity. Your delegated access may have been revoked.",
      );
    },
    onSuccess: async () => {
      setFeedback("Organization identity removed.");
      await queryClient.invalidateQueries({
        queryKey: organizationIdentityQueryKey(organizationId),
      });
      if (activeIdentityId) {
        await queryClient.invalidateQueries({
          queryKey: organizationDelegationsQueryKey(organizationId, activeIdentityId),
        });
      }
    },
  });
  const selectedIdentity = selectedIdentityId || accountIdentities.data?.[0]?.id || "";
  const activeIdentity = accountIdentities.data?.find(
    (identity) => identity.id === activeIdentityId,
  );
  const isActiveDelegate = Boolean(
    currentUserId &&
    delegations.data?.some((delegation) => delegation.delegate_user_id === currentUserId),
  );

  async function createAndAttachManagedIdentity() {
    if (!managedHandle.trim()) return;
    try {
      const identity = await provisionManaged.mutateAsync(managedHandle.trim());
      attach.mutate(identity.id);
    } catch {
      setFeedback("Atlas could not create that identity. Try a different handle.");
    }
  }

  if (!canManageOrganization && !isActiveDelegate) return null;

  return (
    <section className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5">
      <div className="space-y-1">
        <h3 className="type-title-medium text-ink-strong">Organization identity</h3>
        <p className="type-body-small text-ink-soft">
          {canManageOrganization
            ? "Choose the DID Atlas presents for this workspace without moving account-level control."
            : "Manage your delegated authority for this workspace's public identity."}
        </p>
      </div>

      {canManageOrganization ? (
        <>
          <div className="border-border bg-surface-container-low rounded-lg border p-4">
            <h4 className="type-title-small text-ink-strong">Use an Atlas identity</h4>
            <p className="type-body-small text-ink-soft mt-1">
              Create an Atlas-managed identity on the Atlas PDS, then attach it to this
              organization.
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Input
                  label="New Atlas handle"
                  placeholder="organization.atlas.example"
                  value={managedHandle}
                  onChange={setManagedHandle}
                />
              </div>
              <Button
                disabled={!managedHandle.trim() || provisionManaged.isPending || attach.isPending}
                onClick={() => void createAndAttachManagedIdentity()}
              >
                Create and use Atlas identity
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h4 className="type-title-small text-ink-strong">
                Use an existing controlled identity
              </h4>
              <p className="type-body-small text-ink-soft mt-1">
                Attach an identity already controlled by your Atlas account instead.
              </p>
            </div>
            {accountIdentities.isError ? (
              <p className="type-body-small text-error" role="status">
                Atlas could not load your controlled identities.
              </p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="type-body-small text-ink-strong min-w-0 flex-1">
                  Existing controlled identity
                  <select
                    aria-label="Existing controlled identity"
                    className="border-border bg-surface mt-1 w-full rounded-md border px-3 py-2"
                    value={selectedIdentity}
                    onChange={(event) => {
                      setSelectedIdentityId(event.target.value);
                    }}
                  >
                    {!accountIdentities.data?.length ? (
                      <option value="">No identities available</option>
                    ) : null}
                    {accountIdentities.data?.map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.current_handle}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={!selectedIdentity || attach.isPending}
                  variant="secondary"
                  onClick={() => {
                    attach.mutate(selectedIdentity);
                  }}
                >
                  Use selected identity
                </Button>
              </div>
            )}
          </div>
        </>
      ) : null}

      {organizationIdentity.isError ? (
        <p className="type-body-small text-error" role="status">
          Atlas could not load this organization identity.
        </p>
      ) : activeIdentityId ? (
        <div className="border-border space-y-4 border-t pt-4">
          <div>
            <p className="type-label-large text-ink-soft">Active organization identity</p>
            <p className="type-body-medium text-ink-strong">
              {canManageOrganization
                ? (activeIdentity?.current_handle ?? activeIdentityId)
                : "An organization identity is currently set."}
            </p>
          </div>
          {canManageOrganization ? (
            <div className="space-y-3">
              <div>
                <h4 className="type-title-small text-ink-strong">Delegated administration</h4>
                <p className="type-body-small text-ink-soft mt-1">
                  Let a workspace member administer this identity until an owner or admin revokes
                  it.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="type-body-small text-ink-strong min-w-0 flex-1">
                  Delegate member
                  <select
                    aria-label="Delegate member"
                    className="border-border bg-surface mt-1 w-full rounded-md border px-3 py-2"
                    value={delegateUserId}
                    onChange={(event) => {
                      setDelegateUserId(event.target.value);
                    }}
                  >
                    <option value="">Choose a member</option>
                    {members.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name} ({member.email})
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={!delegateUserId || grant.isPending}
                  variant="secondary"
                  onClick={() => {
                    grant.mutate(delegateUserId);
                  }}
                >
                  Grant administration
                </Button>
              </div>
              {delegations.data?.length ? (
                <ul className="space-y-2">
                  {delegations.data.map((delegation) => {
                    const member = members.find(
                      (candidate) => candidate.userId === delegation.delegate_user_id,
                    );
                    const memberName = member?.name ?? delegation.delegate_user_id;
                    return (
                      <li
                        key={delegation.id}
                        className="border-border flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <span className="type-body-small text-ink-strong">{memberName}</span>
                        <Button
                          disabled={revoke.isPending}
                          variant="ghost"
                          onClick={() => {
                            revoke.mutate(delegation.delegate_user_id);
                          }}
                        >
                          Revoke {memberName}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="type-body-small text-ink-soft">No delegated administrators yet.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <h4 className="type-title-small text-ink-strong">Delegated administration</h4>
                <p className="type-body-small text-ink-soft mt-1">
                  Your active delegation can remove this workspace association without changing the
                  underlying DID account.
                </p>
              </div>
              <Button
                disabled={detach.isPending}
                variant="secondary"
                onClick={() => {
                  detach.mutate();
                }}
              >
                Remove organization identity
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {feedback ? (
        <p className="type-body-small text-ink-soft" role="status">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}
