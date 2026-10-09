import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import { describeActivity } from "./editorial-activity-labels";
import type { EditorialActivity } from "./editorial-activity.functions";

export interface EditorialActivityViewProps {
  errorMessage?: string;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  items: EditorialActivity[];
  onLoadMore: () => void;
}

interface ActivityRowProps {
  activity: EditorialActivity;
}

/**
 * Every editorial decision on this instance, newest first, from the
 * append-only audit log: who did what, to what, and when. Refused attempts
 * are listed too, so an operator can see when someone tried.
 */
export function EditorialActivityView({
  errorMessage,
  hasMore,
  isLoading,
  isLoadingMore,
  items,
  onLoadMore,
}: EditorialActivityViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Audit log"
        title="Editorial activity"
        description="Every change made through the editorial tools, newest first. Entries cannot be edited or deleted, including by the person who made them."
      />
      <section aria-label="Editorial decisions" className="space-y-3">
        <AdminInlineStatus message={errorMessage} />
        {isLoading ? (
          <div
            aria-busy
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
          />
        ) : items.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">No editorial changes yet.</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {items.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </ol>
        )}
        {hasMore ? (
          <Button disabled={isLoadingMore} onClick={onLoadMore} size="sm" variant="secondary">
            {isLoadingMore ? "Loading…" : "Show older"}
          </Button>
        ) : null}
      </section>
    </AdminPageShell>
  );
}

function ActivityRow({ activity }: ActivityRowProps) {
  const targets = Object.entries(activity.target);
  return (
    <li className="border-border bg-surface-container-lowest space-y-1 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="type-title-small text-ink-strong">{describeActivity(activity)}</p>
        {activity.allowed ? null : (
          <AdminStatusBadge compact tone="block">
            Refused
          </AdminStatusBadge>
        )}
      </div>
      <p className="type-body-small text-ink-soft">
        {activity.actor} · {formatTime(activity.occurredAt)}
      </p>
      {targets.length > 0 ? (
        <p className="type-body-small text-ink-soft break-all">
          {targets.map(([key, value]) => `${key} ${value}`).join(" · ")}
        </p>
      ) : null}
      {activity.reason ? (
        <p className="type-body-small text-ink-strong break-words whitespace-pre-wrap">
          {activity.allowed ? `Reason: ${activity.reason}` : activity.reason}
        </p>
      ) : null}
    </li>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}
