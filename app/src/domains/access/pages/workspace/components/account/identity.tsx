import { useState } from "react";
import {
  useAtprotoIdentities,
  useDisconnectAtprotoIdentity,
  useProvisionManagedAtprotoIdentity,
  useRefreshAtprotoIdentity,
} from "@/domains/access/atproto-identities";
import {
  formatDateTimeOrNull,
  useDateTimeFormatter,
  MEDIUM_DATE,
} from "@rebuildingamerica/atlas-ui/format/date-time";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { useConfirmDialog } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { AccountRow, AccountSection, AccountSubsection, AccountSurface } from "./rows";

function connectUrl(handle: string): string {
  const params = new URLSearchParams({
    handle: handle.trim(),
    returnTo: "/account#identity",
  });
  return `/api/atproto/oauth/start?${params.toString()}`;
}

function startConnection(handle: string): void {
  window.location.assign(connectUrl(handle));
}

export function AccountIdentitySection() {
  const formatDate = useDateTimeFormatter();
  const displayDate = (value: string | null | undefined): string =>
    formatDateTimeOrNull(formatDate, value, MEDIUM_DATE) ?? "Not available";
  const [existingHandle, setExistingHandle] = useState("");
  const [managedHandle, setManagedHandle] = useState("");
  const identities = useAtprotoIdentities();
  const refresh = useRefreshAtprotoIdentity();
  const disconnect = useDisconnectAtprotoIdentity();
  const provisionManaged = useProvisionManagedAtprotoIdentity();
  const { confirm } = useConfirmDialog();

  const submitConnection = () => {
    if (existingHandle.trim()) startConnection(existingHandle);
  };

  const submitManagedIdentity = () => {
    if (managedHandle.trim()) provisionManaged.mutate(managedHandle.trim());
  };

  const confirmDisconnect = async (identityId: string, currentHandle: string) => {
    const identity = identities.data?.find((item) => item.id === identityId);
    const profileNames = identity?.profiles?.map((profile) => profile.name) ?? [];
    const affected = profileNames.length ? ` Affected profiles: ${profileNames.join(", ")}.` : "";
    const accepted = await confirm({
      title: `Disconnect ${currentHandle}?`,
      body: `Its public identity remains until a verified steward removes or replaces it.${affected}`,
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (accepted) disconnect.mutate(identityId);
  };

  return (
    <AccountSection id="identity" title="Identity">
      <AccountSubsection title="ATProto accounts">
        <AccountSurface>
          <div className="space-y-4 px-4 py-4">
            <p className="type-body-medium text-ink-soft">
              Use an ATProto identity for profile verification and public civic contributions.
            </p>
            <div className="border-border bg-surface-container-low rounded-lg border p-4">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h4 className="type-title-small text-ink-strong">Use an Atlas identity</h4>
                  <p className="type-body-small text-ink-soft">
                    Create an identity on the Atlas PDS. Atlas does not expose or retain a PDS
                    password; use your Atlas passkey to sign in here later.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1">
                    <Input
                      label="New Atlas handle"
                      placeholder="person.atlas.example"
                      value={managedHandle}
                      onChange={setManagedHandle}
                    />
                  </div>
                  <Button
                    disabled={!managedHandle.trim() || provisionManaged.isPending}
                    onClick={submitManagedIdentity}
                  >
                    Create Atlas identity
                  </Button>
                </div>
                {provisionManaged.isError ? (
                  <p className="type-body-small text-error" role="status">
                    Atlas could not create that identity. Try a different handle.
                  </p>
                ) : null}
              </div>
            </div>
            <details>
              <summary className="type-label-large text-ink-soft cursor-pointer">
                Connect an existing identity
              </summary>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Existing ATProto handle"
                    placeholder="person.example"
                    value={existingHandle}
                    onChange={setExistingHandle}
                  />
                </div>
                <Button
                  disabled={!existingHandle.trim()}
                  variant="secondary"
                  onClick={submitConnection}
                >
                  Connect existing identity
                </Button>
              </div>
            </details>
          </div>
        </AccountSurface>

        {identities.isError ? (
          <AccountSurface>
            <AccountRow label="ATProto accounts" value="Could not load ATProto accounts." />
          </AccountSurface>
        ) : null}

        {!identities.isPending && !identities.isError && identities.data?.length === 0 ? (
          <AccountSurface>
            <AccountRow label="ATProto accounts" value="No ATProto accounts connected." />
          </AccountSurface>
        ) : null}

        {identities.data?.map((identity) => {
          const needsAttention =
            identity.resolution_status === "needs_attention" ||
            identity.control_status === "conflict";
          return (
            <AccountSurface key={identity.id}>
              <AccountRow
                label={identity.current_handle}
                value={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={needsAttention ? "warning" : "success"}>
                      {needsAttention ? "Needs attention" : "Connected"}
                    </Badge>
                    <span>Connected {displayDate(identity.connected_at)}</span>
                  </div>
                }
              />
              <AccountRow label="Last verification" value={displayDate(identity.verified_at)} />
              <AccountRow
                label="Profiles"
                value={
                  identity.profiles?.length
                    ? identity.profiles.map((profile) => profile.name).join(", ")
                    : "No profiles use this identity."
                }
              />
              <div className="flex flex-wrap gap-2 px-4 py-3.5">
                <Button
                  disabled={refresh.isPending}
                  variant="secondary"
                  onClick={() => {
                    refresh.mutate(identity.id);
                  }}
                >
                  Check connection
                </Button>
                {needsAttention ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      startConnection(identity.current_handle);
                    }}
                  >
                    Reconnect
                  </Button>
                ) : null}
                <Button
                  disabled={disconnect.isPending}
                  variant="ghost"
                  onClick={() => void confirmDisconnect(identity.id, identity.current_handle)}
                >
                  Disconnect
                </Button>
              </div>
              <details className="px-4 py-3.5">
                <summary className="type-label-large text-ink-soft cursor-pointer">
                  Technical details
                </summary>
                <dl className="type-body-small text-ink-soft mt-3 grid gap-2">
                  <div>
                    <dt className="font-semibold">DID</dt>
                    <dd className="break-all">{identity.did}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">PDS</dt>
                    <dd className="break-all">{identity.pds_url ?? "Not available"}</dd>
                  </div>
                </dl>
              </details>
            </AccountSurface>
          );
        })}
      </AccountSubsection>
    </AccountSection>
  );
}
