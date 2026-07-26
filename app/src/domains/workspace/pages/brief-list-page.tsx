import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileText, Plus, ShieldCheck } from "lucide-react";
import { useWorkspaceBriefCollection } from "@/domains/workspace/hooks/use-briefs";
import type { AtlasBrief } from "@/domains/workspace/server/briefs";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { useDateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
import { formatDate } from "./coverage-page-utils";

interface CountLabelOptions {
  plural?: string;
}

interface BriefListItemProps {
  brief: AtlasBrief;
}

interface BriefCollectionStats {
  actorCount: number;
  sourceCount: number;
  runCount: number;
}

function countLabel(count: number, singular: string, options?: CountLabelOptions): string {
  const plural = options?.plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : plural}`;
}

function humanize(value: string): string {
  return value.replace(/[_-]+/g, " ");
}

function joined(values: string[]): string {
  return values.map(humanize).join(", ");
}

function confidenceVariant(state: AtlasBrief["confidence_summary"]["state"]) {
  if (state === "corroborated") {
    return "success";
  }
  if (state === "partial") {
    return "warning";
  }
  return "default";
}

function collectionStats(briefs: AtlasBrief[]): BriefCollectionStats {
  const actorIds = new Set<string>();
  const sourceIds = new Set<string>();
  const runIds = new Set<string>();

  for (const brief of briefs) {
    brief.linked_entry_ids.forEach((id) => actorIds.add(id));
    brief.linked_source_ids.forEach((id) => sourceIds.add(id));
    brief.linked_discovery_run_ids.forEach((id) => runIds.add(id));
  }

  return {
    actorCount: actorIds.size,
    sourceCount: sourceIds.size,
    runCount: runIds.size,
  };
}

function BriefListItem({ brief }: BriefListItemProps) {
  const format = useDateTimeFormatter();

  return (
    <li className="border-outline-variant bg-surface-container-lowest rounded-lg border p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={confidenceVariant(brief.confidence_summary.state)}>
              {brief.confidence_summary.state}
            </Badge>
            <Badge>{brief.confidence_summary.review_status}</Badge>
          </div>
          <div className="space-y-2">
            <Link
              to="/briefs/$briefId"
              params={{ briefId: brief.id }}
              className="type-title-large text-ink-strong hover:text-civic block underline-offset-4 hover:underline"
            >
              {brief.title}
            </Link>
            <p className="type-body-medium text-ink-soft max-w-3xl">{brief.summary}</p>
          </div>
          <div className="type-body-small text-ink-soft flex flex-wrap gap-x-4 gap-y-1">
            <span>{brief.scope.geography}</span>
            <span>{joined(brief.scope.issue_areas)}</span>
            <span>Updated {formatDate(format, brief.updated_at)}</span>
          </div>
        </div>

        <dl className="grid min-w-44 grid-cols-3 gap-3 text-right md:grid-cols-1">
          <div>
            <dt className="type-label-small text-ink-muted">Actors</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(brief.linked_entry_ids.length, "actor")}
            </dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Sources</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(brief.linked_source_ids.length, "source")}
            </dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Runs</dt>
            <dd className="type-title-small text-ink-strong">
              {countLabel(brief.linked_discovery_run_ids.length, "run")}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

export function BriefListPage() {
  const { data: briefCollection } = useWorkspaceBriefCollection();
  const briefs = briefCollection.items;
  const stats = collectionStats(briefs);

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <Link
        to="/home"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        My Research
      </Link>

      <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="info">Briefing Room</Badge>
              <Badge>{countLabel(briefCollection.total, "brief")}</Badge>
            </div>
            <Link
              to="/briefs/new"
              className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New brief
            </Link>
          </div>
          <div className="space-y-2">
            <h1 className="type-display-small text-ink-strong">Atlas Briefs</h1>
            <p className="type-body-large text-ink-soft max-w-3xl">
              Meetings, memos, and field follow-up with receipts attached.
            </p>
          </div>
        </div>

        <section className="border-outline-variant bg-surface-container-lowest space-y-3 rounded-lg border p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-civic h-5 w-5" aria-hidden="true" />
            <h2 className="type-title-medium text-ink-strong">Coverage</h2>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="type-label-small text-ink-muted">Actors</dt>
              <dd className="type-title-small text-ink-strong">{stats.actorCount}</dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-title-small text-ink-strong">{stats.sourceCount}</dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Runs</dt>
              <dd className="type-title-small text-ink-strong">{stats.runCount}</dd>
            </div>
          </dl>
        </section>
      </header>

      {briefs.length > 0 ? (
        <ul className="space-y-4">
          {briefs.map((brief) => (
            <BriefListItem key={brief.id} brief={brief} />
          ))}
        </ul>
      ) : (
        <section className="border-outline-variant bg-surface-container-lowest flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5">
          <div className="flex items-center gap-3">
            <FileText className="text-civic h-5 w-5" aria-hidden="true" />
            <p className="type-body-medium text-ink-strong">No briefs yet.</p>
          </div>
          <Link
            to="/discovery"
            className="type-label-large bg-ink-strong text-surface hover:bg-ink inline-flex min-h-10 items-center justify-center rounded-lg px-4 transition-colors"
          >
            Research
          </Link>
        </section>
      )}
    </div>
  );
}
