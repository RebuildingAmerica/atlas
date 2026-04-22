import { Link } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import type { AtlasOrganizationDetails } from "../../organization-contracts";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";

/**
 * Props for the workspace-profile section.
 */
interface WorkspaceProfileSectionProps {
  canManageOrganization: boolean;
  organization: AtlasOrganizationDetails;
  profileName: string;
  profileSlug: string;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
}

/**
 * Workspace profile section for the active workspace.
 */
export function WorkspaceProfileSection({
  canManageOrganization,
  isPending,
  onNameChange,
  onSlugChange,
  onSubmit,
  organization,
  profileName,
  profileSlug,
}: WorkspaceProfileSectionProps) {
  return (
    <article className="border-border-strong bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Workspace profile</h2>
          <p className="type-body-medium text-ink-soft">
            {organization.capabilities.canUseTeamFeatures
              ? "Manage your shared workspace profile."
              : "This is a personal workspace."}
          </p>
        </div>
        <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Building2 className="h-4 w-4" />
          {organization.workspaceType === "team" ? "Team" : "Personal"}
        </span>
      </div>

      {canManageOrganization ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <Input label="Workspace name" value={profileName} onChange={onNameChange} />
          <Input label="Workspace slug" value={profileSlug} onChange={onSlugChange} />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={isPending || !profileName.trim() || !profileSlug.trim()}
            >
              {isPending ? "Saving..." : "Save changes"}
            </Button>
            <p className="type-body-medium text-ink-soft">Your role: {organization.role}</p>
          </div>
        </form>
      ) : (
        <div className="border-border space-y-3 rounded-[1.25rem] border bg-white/70 p-4">
          <p className="type-title-small text-ink-strong">{organization.name}</p>
          <p className="type-body-medium text-ink-soft">
            {organization.slug} · {organization.role}
          </p>
          {!organization.capabilities.canUseTeamFeatures ? (
            <p className="type-body-medium text-ink-soft">
              Need to manage passkeys or API keys instead? Head back to{" "}
              <Link className="text-ink-strong underline" to="/account">
                Account
              </Link>
              .
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
