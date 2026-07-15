import { Contact, Globe, LockKeyhole, UserCheck } from "lucide-react";
import type { AtprotoIdentityResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";
import { Button } from "@/platform/ui/button";
import { Select } from "@/platform/ui/select";
import { SurfaceSection } from "@/platform/ui/surface-section";
import { ClaimVisibilitySummary, FieldBlock } from "./-claim-form-fields";
import { ClaimAtprotoIdentityField } from "./-claim-atproto-identity-field";

export interface ClaimSubmissionPanelProps {
  relationship: string;
  evidence: string;
  requestedChanges: string;
  preferredContactChannel: string;
  privateNote: string;
  atprotoIdentities: AtprotoIdentityResponse[];
  atprotoIdentitiesError: boolean;
  isResolvingAtprotoIdentity: boolean;
  selectedAtprotoIdentityId: string;
  dnsDomain: string;
  activeWorkspaceName: string | null;
  useActiveWorkspace: boolean;
  showOrganizationProofs: boolean;
  isPending: boolean;
  onRelationshipChange: (value: string) => void;
  onEvidenceChange: (value: string) => void;
  onRequestedChangesChange: (value: string) => void;
  onPreferredContactChannelChange: (value: string) => void;
  onPrivateNoteChange: (value: string) => void;
  onAtprotoIdentityChange: (value: string) => void;
  onDnsDomainChange: (value: string) => void;
  onUseActiveWorkspaceChange: (value: boolean) => void;
  onConnectAtproto: (handle: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

interface RelationshipOption {
  label: string;
  value: string;
}

export function ClaimSubmissionPanel(props: ClaimSubmissionPanelProps) {
  return (
    <div className="space-y-5">
      <RelationshipStep {...props} />
      <IdentityProofStep {...props} />
      <PublicChangesStep {...props} />
      <PrivateContextStep {...props} />
    </div>
  );
}

function RelationshipStep({
  relationship,
  evidence,
  showOrganizationProofs,
  onRelationshipChange,
  onEvidenceChange,
}: ClaimSubmissionPanelProps) {
  return (
    <SurfaceSection
      marker="1"
      title="Show your connection"
      description="Start with the link between you and this profile."
    >
      <Select
        ariaLabel="Your relationship to this profile"
        icon={UserCheck}
        value={relationship}
        onChange={onRelationshipChange}
        options={relationshipOptions(showOrganizationProofs)}
        size="compact"
      />
      <FieldBlock
        label="Source for your connection"
        help="Official site, staff page, organization email, public byline, or another source that connects you to this profile."
        htmlFor="claim-evidence"
      >
        <textarea
          id="claim-evidence"
          aria-describedby="claim-evidence-help"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          rows={4}
          value={evidence}
          onChange={(event) => {
            onEvidenceChange(event.target.value);
          }}
        />
      </FieldBlock>
    </SurfaceSection>
  );
}

function relationshipOptions(isOrganization: boolean): RelationshipOption[] {
  if (isOrganization) {
    return [
      { value: "organization_representative", label: "I represent this organization" },
      { value: "staff", label: "I work with this organization" },
    ];
  }
  return [
    { value: "self", label: "This is me" },
    { value: "staff", label: "I work with this person" },
  ];
}

function IdentityProofStep({
  atprotoIdentities,
  atprotoIdentitiesError,
  selectedAtprotoIdentityId,
  dnsDomain,
  activeWorkspaceName,
  useActiveWorkspace,
  showOrganizationProofs,
  onAtprotoIdentityChange,
  onDnsDomainChange,
  onUseActiveWorkspaceChange,
  onConnectAtproto,
}: ClaimSubmissionPanelProps) {
  const canUseActiveWorkspace = activeWorkspaceName !== null;
  const selectedIdentity = atprotoIdentities.find(
    (identity) => identity.id === selectedAtprotoIdentityId,
  );
  const needsOrganizationBackup = isGenericAtprotoHandle(selectedIdentity?.current_handle ?? "");

  return (
    <SurfaceSection
      marker="2"
      title={showOrganizationProofs ? "Show you represent this organization" : "Verify this is you"}
      description={
        showOrganizationProofs
          ? "Use an official account, domain, or workspace role."
          : "Choose a connected account as evidence for review."
      }
    >
      <ClaimAtprotoIdentityField
        identities={atprotoIdentities}
        isError={atprotoIdentitiesError}
        selectedIdentityId={selectedAtprotoIdentityId}
        onConnectAnother={onConnectAtproto}
        onSelect={onAtprotoIdentityChange}
      />
      {showOrganizationProofs && needsOrganizationBackup ? (
        <p className="type-body-small text-ink-soft max-w-xl">
          This personal Bluesky-style handle needs an organization domain or workspace to confirm it
          belongs with this profile.
        </p>
      ) : null}
      {showOrganizationProofs ? (
        <>
          <FieldBlock
            label="Organization domain"
            help="Use the website or email domain that belongs to this organization."
            htmlFor="claim-dns-domain"
            icon={Globe}
          >
            <input
              id="claim-dns-domain"
              aria-describedby="claim-dns-domain-help"
              className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
              value={dnsDomain}
              onChange={(event) => {
                onDnsDomainChange(event.target.value);
              }}
            />
          </FieldBlock>
          <div className="border-outline-variant bg-surface-container-lowest flex items-start gap-3 rounded-lg border p-4">
            <input
              id="claim-use-active-workspace"
              type="checkbox"
              className="accent-primary mt-1 h-4 w-4"
              checked={canUseActiveWorkspace && useActiveWorkspace}
              disabled={!canUseActiveWorkspace}
              onChange={(event) => {
                onUseActiveWorkspaceChange(event.target.checked);
              }}
            />
            <label htmlFor="claim-use-active-workspace" className="space-y-1">
              <span className="type-label-medium text-ink-strong block">Use my workspace role</span>
              <span className="type-body-small text-ink-soft block">
                {activeWorkspaceName ?? "No organization workspace connected."}
              </span>
            </label>
          </div>
        </>
      ) : null}
    </SurfaceSection>
  );
}

function isGenericAtprotoHandle(handle: string): boolean {
  const normalized = handle.trim().toLowerCase().replace(/^@/, "");
  return normalized.endsWith(".bsky.social");
}

function PublicChangesStep({
  requestedChanges,
  preferredContactChannel,
  onRequestedChangesChange,
  onPreferredContactChannelChange,
}: ClaimSubmissionPanelProps) {
  return (
    <SurfaceSection
      marker="3"
      title="Suggest profile updates"
      description="Tell us what should change on the public profile."
    >
      <FieldBlock
        label="What should change?"
        help="Name, role, bio, location, contact preference, or sources."
        htmlFor="claim-requested-changes"
      >
        <textarea
          id="claim-requested-changes"
          aria-describedby="claim-requested-changes-help"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          rows={4}
          value={requestedChanges}
          onChange={(event) => {
            onRequestedChangesChange(event.target.value);
          }}
        />
      </FieldBlock>
      <Select
        ariaLabel="Preferred contact"
        icon={Contact}
        value={preferredContactChannel}
        onChange={onPreferredContactChannelChange}
        options={[
          { value: "", label: "No preference" },
          { value: "email", label: "Email" },
          { value: "form", label: "Contact form" },
          { value: "external", label: "External link" },
        ]}
        size="compact"
      />
    </SurfaceSection>
  );
}

function PrivateContextStep({
  atprotoIdentities,
  selectedAtprotoIdentityId,
  dnsDomain,
  privateNote,
  showOrganizationProofs,
  isPending,
  isResolvingAtprotoIdentity,
  useActiveWorkspace,
  onPrivateNoteChange,
  onCancel,
  onSubmit,
}: ClaimSubmissionPanelProps) {
  const selectedIdentity = atprotoIdentities.find(
    (identity) => identity.id === selectedAtprotoIdentityId,
  );
  const submitBlockReason = submitBlockedReason({
    atprotoHandle: selectedIdentity?.current_handle ?? "",
    dnsDomain,
    showOrganizationProofs,
    useActiveWorkspace,
  });

  return (
    <SurfaceSection
      marker="4"
      title="Private context"
      description="Add anything we should know but readers should not see."
    >
      <FieldBlock
        label="Private note"
        help="Private to Atlas. Do not put public profile copy here."
        htmlFor="claim-private-note"
        icon={LockKeyhole}
      >
        <textarea
          id="claim-private-note"
          aria-describedby="claim-private-note-help"
          className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface w-full rounded-lg border px-3 py-2 focus:ring-2 focus:outline-none"
          rows={3}
          value={privateNote}
          onChange={(event) => {
            onPrivateNoteChange(event.target.value);
          }}
        />
      </FieldBlock>

      <ClaimVisibilitySummary />

      <div className="border-outline-variant flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="type-body-small text-ink-soft max-w-md">
          {submitBlockReason ?? "Send your sources and requested profile updates for review."}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isPending || isResolvingAtprotoIdentity || Boolean(submitBlockReason)}
          >
            {isPending ? "Submitting..." : "Submit verification"}
          </Button>
        </div>
      </div>
    </SurfaceSection>
  );
}

function submitBlockedReason(input: {
  atprotoHandle: string;
  dnsDomain: string;
  showOrganizationProofs: boolean;
  useActiveWorkspace: boolean;
}): string | null {
  if (
    input.showOrganizationProofs &&
    isGenericAtprotoHandle(input.atprotoHandle) &&
    !input.dnsDomain.trim() &&
    !input.useActiveWorkspace
  ) {
    return "Add the organization domain or use a workspace where you manage this organization.";
  }
  return null;
}
