import { ArrowRightLeft } from "lucide-react";
import { Select } from "@/platform/ui/select";

/**
 * Props for the workspace-switcher section.
 */
interface WorkspaceSwitcherSectionProps {
  isPending: boolean;
  memberships: {
    id: string;
    name: string;
    workspaceType: string;
  }[];
  selectedOrganizationId: string;
  onChange: (organizationId: string) => void;
}

/**
 * Workspace switcher shown when the current operator belongs to more than one
 * workspace.
 */
export function WorkspaceSwitcherSection({
  isPending,
  memberships,
  onChange,
  selectedOrganizationId,
}: WorkspaceSwitcherSectionProps) {
  return (
    <section className="border-border-strong bg-surface rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Active workspace</h2>
          <p className="type-body-medium text-ink-soft">
            Switch contexts without exposing team controls in places that do not need them.
          </p>
        </div>
        <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <ArrowRightLeft className="h-4 w-4" />
          {memberships.length} workspaces
        </span>
      </div>

      <div className="mt-5 max-w-md">
        <Select
          label="Workspace"
          value={selectedOrganizationId}
          onChange={onChange}
          disabled={isPending}
          options={memberships.map((membership) => ({
            label: `${membership.name} · ${membership.workspaceType}`,
            value: membership.id,
          }))}
        />
      </div>
    </section>
  );
}
