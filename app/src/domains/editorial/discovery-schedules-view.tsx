import { useState } from "react";
import type { IssueArea } from "@rebuildingamerica/atlas-api-client/taxonomy";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import type { DiscoverySchedule, ScheduleSearchDepth } from "./discovery-schedules.functions";

/** A schedule the operator is about to add. */
export interface NewDiscoverySchedule {
  issueAreas: string[];
  locationQuery: string;
  searchDepth: ScheduleSearchDepth;
  state: string;
}

export interface DiscoverySchedulesViewProps {
  actionError?: string;
  createError?: string;
  errorMessage?: string;
  /** Changes after each target is added, which clears the form. */
  formResetKey: number;
  isCreating: boolean;
  isLoading: boolean;
  issueAreas: IssueArea[];
  onCreate: (schedule: NewDiscoverySchedule) => void;
  onDelete: (schedule: DiscoverySchedule) => void;
  onToggle: (schedule: DiscoverySchedule) => void;
  pendingScheduleId?: string;
  schedules: DiscoverySchedule[];
}

interface ScheduleRowProps {
  issueNames: (slugs: string[]) => string;
  onDelete: (schedule: DiscoverySchedule) => void;
  onToggle: (schedule: DiscoverySchedule) => void;
  pending: boolean;
  schedule: DiscoverySchedule;
}

interface NewScheduleFormProps {
  createError?: string;
  isCreating: boolean;
  issueAreas: IssueArea[];
  onCreate: (schedule: NewDiscoverySchedule) => void;
}

const DEPTH_OPTIONS = [
  { label: "Standard search", value: "standard" },
  { label: "Deep search (more queries, more cost)", value: "deep" },
];

/**
 * The places and issues Atlas re-researches every night, so an operator can
 * see what the nightly run will do and change it without a terminal.
 */
export function DiscoverySchedulesView({
  actionError,
  createError,
  errorMessage,
  formResetKey,
  isCreating,
  isLoading,
  issueAreas,
  onCreate,
  onDelete,
  onToggle,
  pendingScheduleId,
  schedules,
}: DiscoverySchedulesViewProps) {
  const namesBySlug = new Map(issueAreas.map((issue) => [issue.slug, issue.name]));
  const issueNames = (slugs: string[]) =>
    slugs.map((slug) => namesBySlug.get(slug) ?? slug).join(", ");
  const active = schedules.filter((schedule) => schedule.enabled).length;

  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Nightly research"
        title="Discovery schedules"
        description="Each target is researched again every night. Pause a target to skip it without losing it; new findings still wait for review before anyone sees them."
      />
      <section aria-label="Scheduled targets" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-title-large text-ink-strong">Targets</h2>
          <span className="type-body-small text-ink-soft">
            {active} of {schedules.length} running nightly
          </span>
        </div>
        <AdminInlineStatus message={errorMessage} />
        <AdminInlineStatus message={actionError} />
        {isLoading ? (
          <div
            aria-busy
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
          />
        ) : schedules.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">
              Nothing is scheduled. Add a place below to have Atlas research it every night.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                issueNames={issueNames}
                onDelete={onDelete}
                onToggle={onToggle}
                pending={pendingScheduleId === schedule.id}
                schedule={schedule}
              />
            ))}
          </ul>
        )}
      </section>
      <NewScheduleForm
        key={formResetKey}
        createError={createError}
        isCreating={isCreating}
        issueAreas={issueAreas}
        onCreate={onCreate}
      />
    </AdminPageShell>
  );
}

function ScheduleRow({ issueNames, onDelete, onToggle, pending, schedule }: ScheduleRowProps) {
  const place = `${schedule.locationQuery}, ${schedule.state}`;
  return (
    <li className="border-border bg-surface-container-lowest space-y-3 rounded-lg border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="type-title-medium text-ink-strong">{place}</h3>
          <p className="type-body-small text-ink-soft">{issueNames(schedule.issueAreas)}</p>
        </div>
        <AdminStatusBadge tone={schedule.enabled ? "pass" : "warn"}>
          {schedule.enabled ? "Nightly" : "Paused"}
        </AdminStatusBadge>
      </div>
      <p className="type-body-small text-ink-soft">
        {schedule.searchDepth === "deep" ? "Deep search" : "Standard search"} ·{" "}
        {schedule.lastRunAt ? `Last run ${formatRunDate(schedule.lastRunAt)}` : "Not run yet"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          ariaLabel={`${schedule.enabled ? "Pause" : "Resume"} ${place}`}
          disabled={pending}
          onClick={() => {
            onToggle(schedule);
          }}
          size="sm"
          variant="secondary"
        >
          {schedule.enabled ? "Pause" : "Resume"}
        </Button>
        <Button
          ariaLabel={`Remove ${place}`}
          disabled={pending}
          onClick={() => {
            onDelete(schedule);
          }}
          size="sm"
          variant="ghost"
        >
          Remove
        </Button>
      </div>
    </li>
  );
}

function NewScheduleForm({ createError, isCreating, issueAreas, onCreate }: NewScheduleFormProps) {
  const [locationQuery, setLocationQuery] = useState("");
  const [state, setState] = useState("");
  const [searchDepth, setSearchDepth] = useState<ScheduleSearchDepth>("standard");
  const [selected, setSelected] = useState<string[]>([]);
  const ready =
    locationQuery.trim().length > 0 && /^[A-Za-z]{2}$/.test(state.trim()) && selected.length > 0;

  return (
    <section aria-label="Add a target" className="space-y-4">
      <h2 className="type-title-large text-ink-strong">Add a target</h2>
      <AdminInlineStatus message={createError} />
      <form
        className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onCreate({
            issueAreas: selected,
            locationQuery: locationQuery.trim(),
            searchDepth,
            state: state.trim().toUpperCase(),
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-[1fr_8rem]">
          <Input label="Place" onChange={setLocationQuery} required value={locationQuery} />
          <Input label="State" onChange={setState} required value={state} />
        </div>
        <Select
          label="Search depth"
          onChange={(value) => {
            setSearchDepth(value === "deep" ? "deep" : "standard");
          }}
          options={DEPTH_OPTIONS}
          value={searchDepth}
        />
        <fieldset className="space-y-2">
          <legend className="type-label-large text-ink-soft">Issues</legend>
          <div className="border-border grid max-h-64 gap-1 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {issueAreas.map((issue) => (
              <label key={issue.slug} className="type-body-small text-ink-strong flex gap-2">
                <input
                  checked={selected.includes(issue.slug)}
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setSelected((current) =>
                      checked
                        ? [...current, issue.slug]
                        : current.filter((slug) => slug !== issue.slug),
                    );
                  }}
                  type="checkbox"
                />
                {issue.name}
              </label>
            ))}
          </div>
        </fieldset>
        <Button disabled={!ready || isCreating} type="submit">
          {isCreating ? "Adding…" : "Add target"}
        </Button>
      </form>
    </section>
  );
}

function formatRunDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
