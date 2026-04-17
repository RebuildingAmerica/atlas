import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Select } from "@/platform/ui/select";
import { workspaceTypeOptions } from "./organization-page-helpers";

/**
 * Props for the first-workspace creation section.
 */
interface WorkspaceCreationSectionProps {
  inviteOnlyMode: boolean;
  isPending: boolean;
  workspaceName: string;
  workspaceSlug: string;
  workspaceType: "individual" | "team";
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onWorkspaceTypeChange: (value: string) => void;
}

/**
 * Workspace creation form shown when the signed-in operator has not created or
 * joined a workspace yet.
 */
export function WorkspaceCreationSection({
  inviteOnlyMode,
  isPending,
  onNameChange,
  onSlugChange,
  onSubmit,
  onWorkspaceTypeChange,
  workspaceName,
  workspaceSlug,
  workspaceType,
}: WorkspaceCreationSectionProps) {
  return (
    <section className="border-border-strong bg-surface rounded-[1.5rem] border p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div className="border-border rounded-[1.25rem] border bg-white/70 p-4">
            <p className="type-title-small text-ink-strong">Individual workspace</p>
            <p className="type-body-medium text-ink-soft mt-2">
              Best when one operator is doing the work alone and should not see team-management
              controls all over the product.
            </p>
          </div>

          <div className="border-border rounded-[1.25rem] border bg-white/70 p-4">
            <p className="type-title-small text-ink-strong">Team workspace</p>
            <p className="type-body-medium text-ink-soft mt-2">
              Built for shared discovery, role-based administration, invitations, and a cleaner
              story when Atlas needs to be sold as a collaborative product.
            </p>
          </div>

          {inviteOnlyMode ? (
            <p className="type-body-medium text-ink-soft">
              Workspace creation stays private. Public pages keep sign-in understated while this
              setup flow stays explicit and operator-only.
            </p>
          ) : null}
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <Input
            label="Workspace name"
            value={workspaceName}
            onChange={onNameChange}
            placeholder="Civic Research Team"
          />
          <Input
            label="Workspace slug"
            value={workspaceSlug}
            onChange={onSlugChange}
            placeholder="civic-research-team"
          />
          <Select
            label="Workspace type"
            value={workspaceType}
            onChange={onWorkspaceTypeChange}
            options={workspaceTypeOptions.map((option) => ({
              label: option.label,
              value: option.value,
            }))}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={isPending || !workspaceName.trim() || !workspaceSlug.trim()}
            >
              {isPending ? "Creating..." : "Create workspace"}
            </Button>
            <p className="type-body-medium text-ink-soft">
              The first workspace becomes your active context automatically.
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
