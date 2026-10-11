import { useState } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import {
  AdminInlineStatus,
  AdminPageHeader,
  AdminPageShell,
  AdminStatusBadge,
} from "@rebuildingamerica/atlas-ui/layout/admin-portal";
import type { MergeCounts, MergePreview, MergeProfile, ProfileMerge } from "./merges.functions";

/** The two profile addresses an editor wants to merge. */
export interface MergePair {
  duplicate: string;
  keep: string;
}

export interface MergesViewProps {
  errorMessage?: string;
  /** Changes after each merge, which clears the form. */
  formResetKey: number;
  isLoading: boolean;
  isMerging: boolean;
  isPreviewing: boolean;
  mergeError?: string;
  merges: ProfileMerge[];
  onMerge: (preview: MergePreview, reason: string) => void;
  /** Called when either address changes, so a preview never outlives what it describes. */
  onPairChange: () => void;
  onPreview: (pair: MergePair) => void;
  preview?: MergePreview;
  previewError?: string;
}

interface MergeFormProps {
  isMerging: boolean;
  isPreviewing: boolean;
  mergeError?: string;
  onMerge: MergesViewProps["onMerge"];
  onPairChange: () => void;
  onPreview: (pair: MergePair) => void;
  preview?: MergePreview;
  previewError?: string;
}

interface PreviewCardProps {
  isMerging: boolean;
  onMerge: MergesViewProps["onMerge"];
  preview: MergePreview;
}

interface ProfileSummaryProps {
  label: string;
  profile: MergeProfile;
}

interface MergeRowProps {
  merge: ProfileMerge;
}

const COUNT_LABELS: [keyof MergeCounts, string, string][] = [
  ["sources", "source", "sources"],
  ["issueAreas", "issue area", "issue areas"],
  ["connections", "connection", "connections"],
  ["followers", "follower", "followers"],
  ["savedListPlaces", "saved-list place", "saved-list places"],
  ["openReports", "open visitor report", "open visitor reports"],
  ["identityKeys", "identity key", "identity keys"],
];

/**
 * Folds a duplicate profile into the one to keep, so a visitor finds one
 * profile with every source instead of two halves. The duplicate's address
 * keeps working and opens the kept profile.
 */
export function MergesView({
  errorMessage,
  formResetKey,
  isLoading,
  isMerging,
  isPreviewing,
  mergeError,
  merges,
  onMerge,
  onPairChange,
  onPreview,
  preview,
  previewError,
}: MergesViewProps) {
  return (
    <AdminPageShell>
      <AdminPageHeader
        badge="Duplicates"
        title="Merge profiles"
        description="When Atlas lists one person or organization twice, fold the duplicate into the profile to keep. Sources, connections and followers move over, and the duplicate's address opens the kept profile."
      />
      <MergeForm
        key={formResetKey}
        isMerging={isMerging}
        isPreviewing={isPreviewing}
        mergeError={mergeError}
        onMerge={onMerge}
        onPairChange={onPairChange}
        onPreview={onPreview}
        preview={preview}
        previewError={previewError}
      />
      <section aria-label="Past merges" className="space-y-4">
        <h2 className="type-title-large text-ink-strong">Past merges</h2>
        <AdminInlineStatus message={errorMessage} />
        {isLoading ? (
          <div
            aria-busy
            className="border-border bg-surface-container-lowest h-24 rounded-lg border"
          />
        ) : merges.length === 0 && !errorMessage ? (
          <div className="border-border bg-surface-container-lowest rounded-lg border p-6">
            <p className="type-body-medium text-ink-soft">No profiles have been merged.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {merges.map((merge) => (
              <MergeRow key={merge.id} merge={merge} />
            ))}
          </ul>
        )}
      </section>
    </AdminPageShell>
  );
}

function MergeForm({
  isMerging,
  isPreviewing,
  mergeError,
  onMerge,
  onPairChange,
  onPreview,
  preview,
  previewError,
}: MergeFormProps) {
  const [keep, setKeep] = useState("");
  const [duplicate, setDuplicate] = useState("");
  const ready = keep.trim().length > 0 && duplicate.trim().length > 0;

  return (
    <section aria-label="Merge two profiles" className="space-y-4">
      <h2 className="type-title-large text-ink-strong">Merge two profiles</h2>
      <form
        className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onPreview({ duplicate: duplicate.trim(), keep: keep.trim() });
        }}
      >
        <Input
          label="Profile to keep"
          onChange={(value) => {
            setKeep(value);
            onPairChange();
          }}
          placeholder="https://atlas.rebuildingus.org/profiles/organizations/…"
          required
          value={keep}
        />
        <Input
          label="Duplicate to fold into it"
          onChange={(value) => {
            setDuplicate(value);
            onPairChange();
          }}
          placeholder="https://atlas.rebuildingus.org/profiles/organizations/…"
          required
          value={duplicate}
        />
        <Button disabled={!ready || isPreviewing} type="submit" variant="secondary">
          {isPreviewing ? "Checking…" : "Check this merge"}
        </Button>
      </form>
      <AdminInlineStatus message={previewError} />
      <AdminInlineStatus message={mergeError} />
      {preview ? (
        <PreviewCard
          key={`${preview.keep.id}:${preview.duplicate.id}`}
          isMerging={isMerging}
          onMerge={onMerge}
          preview={preview}
        />
      ) : null}
    </section>
  );
}

function PreviewCard({ isMerging, onMerge, preview }: PreviewCardProps) {
  const [reason, setReason] = useState("");
  const moves = describeCounts(preview.moves);
  const blocked = preview.blockers.length > 0;

  return (
    <article
      aria-label="What this merge does"
      className="border-border bg-surface-container-lowest space-y-4 rounded-lg border p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <ProfileSummary label="Keep" profile={preview.keep} />
        <ProfileSummary label="Fold in and retire" profile={preview.duplicate} />
      </div>
      <div className="space-y-1">
        <h3 className="type-label-large text-ink-strong">What moves to the kept profile</h3>
        <p className="type-body-small text-ink-strong">
          {moves.length > 0 ? moves.join(", ") : "Nothing but its address."}
        </p>
        {preview.moves.pendingReviews > 0 ? (
          <p className="type-body-small text-ink-soft">
            {plural(
              preview.moves.pendingReviews,
              "pending discovery review",
              "pending discovery reviews",
            )}{" "}
            on the duplicate will be closed.
          </p>
        ) : null}
      </div>
      {blocked ? (
        <ul aria-label="Why this cannot be merged" className="space-y-2">
          {preview.blockers.map((blocker) => (
            <li key={blocker} className="type-body-small text-ink-strong flex items-start gap-2">
              <AdminStatusBadge compact tone="block">
                Blocked
              </AdminStatusBadge>
              {blocker}
            </li>
          ))}
        </ul>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim().length < 3) return;
            onMerge(preview, reason.trim());
          }}
        >
          <Textarea
            label="Reason"
            onChange={setReason}
            placeholder="How you know these are the same, for whoever reads this later."
            required
            rows={3}
            value={reason}
          />
          <Button disabled={reason.trim().length < 3 || isMerging} type="submit">
            {isMerging ? "Merging…" : "Merge"}
          </Button>
        </form>
      )}
    </article>
  );
}

function ProfileSummary({ label, profile }: ProfileSummaryProps) {
  return (
    <div className="space-y-1">
      <p className="type-label-small text-ink-muted">{label}</p>
      <p className="type-title-medium text-ink-strong">{profile.name}</p>
      <p className="type-body-small text-ink-soft break-all">
        {profile.type === "person" ? "Person" : "Organization"} · /{profile.slug} ·{" "}
        {profile.active ? "published" : "not published"}
      </p>
    </div>
  );
}

function MergeRow({ merge }: MergeRowProps) {
  const moved = describeCounts(merge.moved);
  return (
    <li className="border-border bg-surface-container-lowest space-y-2 rounded-lg border p-5">
      <h3 className="type-title-medium text-ink-strong">
        {merge.duplicateName} into {merge.keptName}
      </h3>
      <p className="type-body-small text-ink-soft">
        {formatDate(merge.mergedAt)} by {merge.mergedBy}
        {moved.length > 0 ? ` · moved ${moved.join(", ")}` : ""}
      </p>
      <p className="type-body-medium text-ink-strong whitespace-pre-wrap">{merge.reason}</p>
    </li>
  );
}

function describeCounts(counts: MergeCounts): string[] {
  return COUNT_LABELS.filter(([key]) => counts[key] > 0).map(([key, one, many]) =>
    plural(counts[key], one, many),
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
