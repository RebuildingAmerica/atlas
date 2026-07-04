import { Globe2 } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { Input } from "@/platform/ui/input";
import { Textarea } from "@/platform/ui/textarea";

interface WorkspaceDirectoryConfigSectionProps {
  canManageOrganization: boolean;
  directoryConfigPending: boolean;
  directoryCorrectionPolicy: string;
  directoryEntryTypes: string;
  directoryGeographyLabels: string;
  directoryIssueAreaIds: string;
  directoryMethodologySummary: string;
  directoryReviewPolicy: string;
  directorySourcePolicy: string;
  directorySponsorLabel: string;
  directoryTitle: string;
  onDirectoryCorrectionPolicyChange: (value: string) => void;
  onDirectoryEntryTypesChange: (value: string) => void;
  onDirectoryGeographyLabelsChange: (value: string) => void;
  onDirectoryIssueAreaIdsChange: (value: string) => void;
  onDirectoryMethodologySummaryChange: (value: string) => void;
  onDirectoryReviewPolicyChange: (value: string) => void;
  onDirectorySourcePolicyChange: (value: string) => void;
  onDirectorySponsorLabelChange: (value: string) => void;
  onDirectoryTitleChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Workspace-facing editor for public directory metadata.
 */
export function WorkspaceDirectoryConfigSection({
  canManageOrganization,
  directoryConfigPending,
  directoryCorrectionPolicy,
  directoryEntryTypes,
  directoryGeographyLabels,
  directoryIssueAreaIds,
  directoryMethodologySummary,
  directoryReviewPolicy,
  directorySourcePolicy,
  directorySponsorLabel,
  directoryTitle,
  onDirectoryCorrectionPolicyChange,
  onDirectoryEntryTypesChange,
  onDirectoryGeographyLabelsChange,
  onDirectoryIssueAreaIdsChange,
  onDirectoryMethodologySummaryChange,
  onDirectoryReviewPolicyChange,
  onDirectorySourcePolicyChange,
  onDirectorySponsorLabelChange,
  onDirectoryTitleChange,
  onSubmit,
}: WorkspaceDirectoryConfigSectionProps) {
  if (!canManageOrganization) {
    return (
      <article className="border-border bg-surface space-y-4 rounded-[1.5rem] border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h2 className="type-title-large text-ink-strong">Public directory</h2>
            <p className="type-body-medium text-ink-soft">
              {directoryTitle || "No directory title set."}
            </p>
          </div>
          <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
            <Globe2 className="h-4 w-4" />
            Public
          </span>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
            <dt className="type-label-small text-ink-muted uppercase">Scope</dt>
            <dd className="type-body-medium text-ink-strong mt-1">
              {directoryIssueAreaIds || "No issue scope set."}
            </dd>
          </div>
          <div className="border-border bg-surface-container-lowest rounded-[1rem] border p-3">
            <dt className="type-label-small text-ink-muted uppercase">Place</dt>
            <dd className="type-body-medium text-ink-strong mt-1">
              {directoryGeographyLabels || "No place scope set."}
            </dd>
          </div>
        </dl>
      </article>
    );
  }

  return (
    <article className="border-border bg-surface space-y-5 rounded-[1.5rem] border p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h2 className="type-title-large text-ink-strong">Public directory</h2>
          <p className="type-body-medium text-ink-soft">Source-backed public directory.</p>
        </div>
        <span className="border-border text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Globe2 className="h-4 w-4" />
          Public
        </span>
      </div>

      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Directory title" value={directoryTitle} onChange={onDirectoryTitleChange} />
          <Input
            label="Sponsor label"
            value={directorySponsorLabel}
            onChange={onDirectorySponsorLabelChange}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Input
            label="Issue scope"
            value={directoryIssueAreaIds}
            onChange={onDirectoryIssueAreaIdsChange}
          />
          <Input
            label="Place scope"
            value={directoryGeographyLabels}
            onChange={onDirectoryGeographyLabelsChange}
          />
          <Input
            label="Actor types"
            value={directoryEntryTypes}
            onChange={onDirectoryEntryTypesChange}
          />
        </div>

        <Textarea
          autoExpand
          label="Methodology summary"
          rows={2}
          value={directoryMethodologySummary}
          onChange={onDirectoryMethodologySummaryChange}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <Textarea
            autoExpand
            label="Source policy"
            rows={3}
            value={directorySourcePolicy}
            onChange={onDirectorySourcePolicyChange}
          />
          <Textarea
            autoExpand
            label="Review policy"
            rows={3}
            value={directoryReviewPolicy}
            onChange={onDirectoryReviewPolicyChange}
          />
          <Textarea
            autoExpand
            label="Correction policy"
            rows={3}
            value={directoryCorrectionPolicy}
            onChange={onDirectoryCorrectionPolicyChange}
          />
        </div>

        <Button type="submit" disabled={directoryConfigPending || !directoryTitle.trim()}>
          {directoryConfigPending ? "Saving..." : "Save directory settings"}
        </Button>
      </form>
    </article>
  );
}
