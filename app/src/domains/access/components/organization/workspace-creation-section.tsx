import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Select } from "@/platform/ui/select";
import { workspaceTypeOptions } from "./organization-page-helpers";

/**
 * Props for the first-workspace creation section.
 */
interface WorkspaceCreationSectionProps {
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
    <section className="border-outline bg-surface rounded-[1.5rem] border p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div className="border-outline-variant rounded-[1.25rem] border bg-white/70 p-4">
            <p className="type-title-small text-on-surface">Individual workspace</p>
            <p className="type-body-medium text-outline mt-2">
              Best for solo work — no team management controls.
            </p>
          </div>

          <div className="border-outline-variant rounded-[1.25rem] border bg-white/70 p-4">
            <p className="type-title-small text-on-surface">Team workspace</p>
            <p className="type-body-medium text-outline mt-2">
              Built for shared discovery, role-based access, and team invitations.
            </p>
          </div>
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
            <p className="type-body-medium text-outline">
              The first workspace becomes your active context automatically.
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
