import { Handshake, Map, MapPin, Network, Play, Tags, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/platform/ui/button";
import type { DiscoveryResearchGoal } from "@rebuildingamerica/atlas-api-client";

interface DiscoveryIssueAreaOption {
  description?: string | null;
  name: string;
  slug: string;
}

interface DiscoveryResearchGoalOption {
  bestFor: string;
  icon: LucideIcon;
  label: string;
  value: DiscoveryResearchGoal;
}

const RESEARCH_GOAL_OPTIONS: DiscoveryResearchGoalOption[] = [
  {
    bestFor: "Best for understanding who is active around a place and issue.",
    icon: Map,
    label: "Landscape scan",
    value: "landscape_scan",
  },
  {
    bestFor: "Best for source lists, reporting calls, and first outreach.",
    icon: Users,
    label: "Interview leads",
    value: "interview_leads",
  },
  {
    bestFor: "Best for finding credible organizations for outreach or collaboration.",
    icon: Handshake,
    label: "Partner scan",
    value: "partner_scan",
  },
  {
    bestFor: "Best for seeing clusters, gaps, and relationships across a local ecosystem.",
    icon: Network,
    label: "Ecosystem map",
    value: "ecosystem_map",
  },
];

interface DiscoveryRunFormProps {
  canRunResearch: boolean;
  issueAreas: DiscoveryIssueAreaOption[];
  isPending: boolean;
  isTaxonomyLoading: boolean;
  locationQuery: string;
  researchGoal: DiscoveryResearchGoal;
  selectedIssues: string[];
  startErrorMessage: string | null;
  state: string;
  onLocationChange: (value: string) => void;
  onResearchGoalChange: (value: DiscoveryResearchGoal) => void;
  onStateChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleIssue: (slug: string) => void;
}

/**
 * Form panel that captures location, state, and selected issue areas
 * before starting source-backed research.  The submit button stays disabled
 * until the workspace has the research capability and every required
 * field is populated.
 */
export function DiscoveryRunForm({
  canRunResearch,
  issueAreas,
  isPending,
  isTaxonomyLoading,
  locationQuery,
  onLocationChange,
  onResearchGoalChange,
  onStateChange,
  onSubmit,
  onToggleIssue,
  researchGoal,
  selectedIssues,
  startErrorMessage,
  state,
}: DiscoveryRunFormProps) {
  const selectedGoal = RESEARCH_GOAL_OPTIONS.find((option) => option.value === researchGoal);

  return (
    <form
      onSubmit={onSubmit}
      className="border-border-strong bg-surface space-y-6 rounded-[1rem] border p-6"
    >
      <div className="space-y-2">
        <h2 className="type-title-large text-ink-strong">New research request</h2>
        <p className="type-body-medium text-ink-muted">Choose place, issue, and goal.</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="type-label-large text-ink-strong">Research goal</legend>
        <div className="border-border grid gap-1 rounded-[0.75rem] border bg-white p-1 sm:grid-cols-4">
          {RESEARCH_GOAL_OPTIONS.map((option) => {
            const isSelected = researchGoal === option.value;
            const Icon = option.icon;
            return (
              <label
                key={option.value}
                className={[
                  "type-label-large flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-center transition-colors",
                  isSelected
                    ? "bg-primary text-white"
                    : "text-ink-soft hover:bg-surface-subtle hover:text-ink-strong",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="research_goal"
                  value={option.value}
                  checked={isSelected}
                  onChange={() => {
                    onResearchGoalChange(option.value);
                  }}
                  className="sr-only"
                />
                <Icon className="h-4 w-4" aria-hidden />
                {option.label}
              </label>
            );
          })}
        </div>
        {selectedGoal ? (
          <p className="type-body-small text-ink-muted">{selectedGoal.bestFor}</p>
        ) : null}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem]">
        <label className="space-y-2">
          <span className="type-label-large text-ink-strong inline-flex items-center gap-2">
            <MapPin className="h-4 w-4" aria-hidden />
            Location
          </span>
          <input
            value={locationQuery}
            onChange={(event) => {
              onLocationChange(event.target.value);
            }}
            placeholder="Kansas City, MO"
            className="type-body-large border-border text-ink-strong w-full rounded-xl border bg-white px-4 py-3 outline-none"
          />
        </label>

        <label className="space-y-2">
          <span className="type-label-large text-ink-strong">State</span>
          <input
            value={state}
            onChange={(event) => {
              onStateChange(event.target.value);
            }}
            placeholder="MO"
            className="type-body-large border-border text-ink-strong w-full rounded-xl border bg-white px-4 py-3 outline-none"
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="type-label-large text-ink-strong inline-flex items-center gap-2">
            <Tags className="h-4 w-4" aria-hidden />
            Issue areas
          </p>
          <p className="type-body-medium text-ink-muted">{selectedIssues.length} selected</p>
        </div>

        <div className="border-border max-h-72 overflow-y-auto rounded-[0.75rem] border bg-white p-3">
          {isTaxonomyLoading ? null : issueAreas.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {issueAreas.map((issue) => (
                <label
                  key={issue.slug}
                  className="hover:border-border flex items-center gap-3 rounded-lg border border-transparent px-2 py-2"
                >
                  <input
                    type="checkbox"
                    aria-label={issue.name}
                    checked={selectedIssues.includes(issue.slug)}
                    onChange={() => {
                      onToggleIssue(issue.slug);
                    }}
                    className="mt-1"
                  />
                  <span className="type-title-small text-ink-strong">{issue.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="type-body-medium text-ink-muted">Could not load issue areas.</p>
          )}
        </div>
      </div>

      {startErrorMessage ? (
        <p className="type-body-medium text-red-700" role="alert">
          {startErrorMessage}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={
            !canRunResearch ||
            isPending ||
            !locationQuery.trim() ||
            state.trim().length !== 2 ||
            selectedIssues.length === 0
          }
        >
          <Play className="mr-2 inline h-4 w-4" aria-hidden />
          {isPending ? "Starting..." : "Start research"}
        </Button>
      </div>
    </form>
  );
}
