import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { BellPlus, FileJson2, FilePlus, FileText, Table2, Target } from "lucide-react";
import { canCreateBriefFromRun } from "@/domains/discovery/brief-request";
import {
  canCreateCoverageTargetFromRun,
  topLeadEntryIdsFromRun,
} from "@/domains/discovery/coverage-target-request";
import {
  blindSpotsForSummary,
  CONFIDENCE_LABELS,
  confidenceFromLead,
  type DiscoveryRunRecord,
} from "@rebuildingamerica/atlas-catalog/discovery/discovery-run-summary";
import {
  buildAgentJsonExport,
  buildLeadCsvExport,
  buildMarkdownBriefExport,
} from "@rebuildingamerica/atlas-catalog/discovery/research-artifacts";
import { copyToClipboard } from "@/lib/clipboard";
import type {
  DiscoveryResearchGoal,
  DiscoveryResearchSummary,
} from "@rebuildingamerica/atlas-api-client";

export interface CreatedBriefLink {
  id: string;
  title: string;
}

export interface CreatedCoverageTargetLink {
  id: string;
  name: string;
}

interface ResearchSummaryBlockProps {
  createdBrief?: CreatedBriefLink;
  createdCoverageTarget?: CreatedCoverageTargetLink;
  createBriefError?: string | null;
  createCoverageTargetError?: string | null;
  isCreatingBrief: boolean;
  isCreatingCoverageTarget: boolean;
  isWatchingLeads: boolean;
  onCreateBrief?: () => void;
  onCreateCoverageTarget?: () => void;
  onWatchTopLeads?: () => void;
  researchGoal: DiscoveryResearchGoal;
  run: DiscoveryRunRecord;
  summary: DiscoveryResearchSummary;
  watchedLeadCount?: number;
  watchLeadError?: string | null;
}

interface ResearchArtifactExportsProps {
  createdBrief?: CreatedBriefLink;
  createdCoverageTarget?: CreatedCoverageTargetLink;
  createBriefError?: string | null;
  createCoverageTargetError?: string | null;
  isCreatingBrief: boolean;
  isCreatingCoverageTarget: boolean;
  isWatchingLeads: boolean;
  onCreateBrief?: () => void;
  onCreateCoverageTarget?: () => void;
  onWatchTopLeads?: () => void;
  run: DiscoveryRunRecord;
  watchedLeadCount?: number;
  watchLeadError?: string | null;
}

function ResearchArtifactExports({
  createdBrief,
  createdCoverageTarget,
  createBriefError,
  createCoverageTargetError,
  isCreatingBrief,
  isCreatingCoverageTarget,
  isWatchingLeads,
  onCreateBrief,
  onCreateCoverageTarget,
  onWatchTopLeads,
  run,
  watchedLeadCount,
  watchLeadError,
}: ResearchArtifactExportsProps) {
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const canSaveBrief = canCreateBriefFromRun(run) && onCreateBrief != null;
  const canCreateCoverageTarget =
    canCreateCoverageTargetFromRun(run) && onCreateCoverageTarget != null;
  const canWatchTopLeads = topLeadEntryIdsFromRun(run).length > 0 && onWatchTopLeads != null;

  async function copyArtifact(label: string, text: string) {
    const copied = await copyToClipboard(text);
    setStatusLabel(copied ? `${label} copied.` : "Copy failed.");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="type-label-medium border-border text-ink-strong hover:bg-surface-container inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
          onClick={() => {
            void copyArtifact("Agent JSON", buildAgentJsonExport(run));
          }}
        >
          <FileJson2 className="h-4 w-4" aria-hidden />
          Copy agent JSON
        </button>
        <button
          type="button"
          className="type-label-medium border-border text-ink-strong hover:bg-surface-container inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
          onClick={() => {
            void copyArtifact("Editorial brief", buildMarkdownBriefExport(run));
          }}
        >
          <FileText className="h-4 w-4" aria-hidden />
          Copy editorial brief
        </button>
        <button
          type="button"
          className="type-label-medium border-border text-ink-strong hover:bg-surface-container inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
          onClick={() => {
            void copyArtifact("Leads CSV", buildLeadCsvExport(run));
          }}
        >
          <Table2 className="h-4 w-4" aria-hidden />
          Copy leads CSV
        </button>
        {canSaveBrief ? (
          <button
            type="button"
            className="type-label-medium bg-ink-strong text-surface hover:bg-ink inline-flex items-center gap-2 rounded-full px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCreatingBrief}
            onClick={() => {
              onCreateBrief();
            }}
          >
            <FilePlus className="h-4 w-4" aria-hidden />
            {isCreatingBrief ? "Saving..." : "Save as Atlas Brief"}
          </button>
        ) : null}
        {canCreateCoverageTarget ? (
          <button
            type="button"
            className="type-label-medium bg-ink-strong text-surface hover:bg-ink inline-flex items-center gap-2 rounded-full px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCreatingCoverageTarget}
            onClick={() => {
              onCreateCoverageTarget();
            }}
          >
            <Target className="h-4 w-4" aria-hidden />
            {isCreatingCoverageTarget ? "Creating target..." : "Create coverage target"}
          </button>
        ) : null}
        {canWatchTopLeads ? (
          <button
            type="button"
            className="type-label-medium border-border text-ink-strong hover:bg-surface-container inline-flex items-center gap-2 rounded-full border px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isWatchingLeads}
            onClick={() => {
              onWatchTopLeads();
            }}
          >
            <BellPlus className="h-4 w-4" aria-hidden />
            {isWatchingLeads ? "Watching..." : "Watch top leads"}
          </button>
        ) : null}
      </div>
      {statusLabel ? (
        <p className="type-label-small text-ink-muted" role="status">
          {statusLabel}
        </p>
      ) : null}
      {createdBrief ? (
        <p className="type-label-small text-ink-muted" role="status">
          Saved as Atlas Brief.{" "}
          <Link
            to="/briefs/$briefId"
            params={{ briefId: createdBrief.id }}
            className="text-civic hover:text-civic-deep underline-offset-4 hover:underline"
          >
            Open brief
          </Link>
        </p>
      ) : null}
      {createBriefError ? (
        <p className="type-label-small text-rose-700" role="alert">
          {createBriefError}
        </p>
      ) : null}
      {createdCoverageTarget ? (
        <p className="type-label-small text-ink-muted" role="status">
          Coverage target created.{" "}
          <Link
            to="/coverage/$targetId"
            params={{ targetId: createdCoverageTarget.id }}
            className="text-civic hover:text-civic-deep underline-offset-4 hover:underline"
          >
            Open coverage
          </Link>
        </p>
      ) : null}
      {createCoverageTargetError ? (
        <p className="type-label-small text-rose-700" role="alert">
          {createCoverageTargetError}
        </p>
      ) : null}
      {watchedLeadCount ? (
        <p className="type-label-small text-ink-muted" role="status">
          Watching {watchedLeadCount} {watchedLeadCount === 1 ? "lead" : "leads"}.{" "}
          <Link
            to="/watching"
            className="text-civic hover:text-civic-deep underline-offset-4 hover:underline"
          >
            Open watching
          </Link>
        </p>
      ) : null}
      {watchLeadError ? (
        <p className="type-label-small text-rose-700" role="alert">
          {watchLeadError}
        </p>
      ) : null}
    </div>
  );
}

function ResearchSummaryBlock({
  createdBrief,
  createdCoverageTarget,
  createBriefError,
  createCoverageTargetError,
  isCreatingBrief,
  isCreatingCoverageTarget,
  isWatchingLeads,
  onCreateBrief,
  onCreateCoverageTarget,
  onWatchTopLeads,
  researchGoal,
  run,
  summary,
  watchedLeadCount,
  watchLeadError,
}: ResearchSummaryBlockProps) {
  const blindSpots = blindSpotsForSummary(researchGoal, summary);

  return (
    <div className="border-border space-y-4 border-t pt-4">
      <div className="space-y-1">
        <p className="type-label-large text-ink-strong">Research brief</p>
        <p className="type-body-medium text-ink-soft">{summary.brief}</p>
      </div>

      {summary.ranked_leads.length > 0 ? (
        <div className="space-y-2">
          <p className="type-label-large text-ink-strong">Ranked leads</p>
          <ul className="space-y-2">
            {summary.ranked_leads.slice(0, 3).map((lead) => (
              <li key={lead.entry_id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-title-small text-ink-strong">{lead.name}</span>
                  <span className="type-label-medium border-border text-ink-muted rounded-full border px-2 py-0.5">
                    {lead.source_count} sources
                  </span>
                  <span className="type-label-medium border-border text-ink-muted rounded-full border px-2 py-0.5">
                    {CONFIDENCE_LABELS[confidenceFromLead(lead)]}
                  </span>
                </div>
                <p className="type-body-small text-ink-soft">{lead.why_it_matters}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ResearchArtifactExports
        createdBrief={createdBrief}
        createdCoverageTarget={createdCoverageTarget}
        createBriefError={createBriefError}
        createCoverageTargetError={createCoverageTargetError}
        isCreatingBrief={isCreatingBrief}
        isCreatingCoverageTarget={isCreatingCoverageTarget}
        isWatchingLeads={isWatchingLeads}
        onCreateBrief={onCreateBrief}
        onCreateCoverageTarget={onCreateCoverageTarget}
        onWatchTopLeads={onWatchTopLeads}
        run={run}
        watchedLeadCount={watchedLeadCount}
        watchLeadError={watchLeadError}
      />

      {summary.key_sources.length > 0 ? (
        <div className="space-y-2">
          <p className="type-label-large text-ink-strong">Key sources</p>
          <ul className="space-y-2">
            {summary.key_sources.slice(0, 3).map((source) => (
              <li key={source.source_id} className="space-y-1">
                <a
                  className="type-title-small text-primary hover:text-on-primary-container"
                  href={source.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.title}
                </a>
                <p className="type-body-small text-ink-soft">{source.why_it_matters}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blindSpots.length > 0 ? (
        <div className="space-y-2">
          <p className="type-label-large text-ink-strong">Blind spots</p>
          <ul className="space-y-2">
            {blindSpots.map((blindSpot) => (
              <li key={blindSpot.label} className="space-y-1">
                <p className="type-title-small text-ink-strong">{blindSpot.label}</p>
                <p className="type-body-small text-ink-soft">{blindSpot.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function DiscoveryRunsPanelSummary(props: ResearchSummaryBlockProps) {
  return <ResearchSummaryBlock {...props} />;
}
