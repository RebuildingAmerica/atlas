import { useState } from "react";
import { Clipboard, FileJson2, FileText, Table2 } from "lucide-react";
import {
  buildAgentJsonExport,
  buildLeadCsvExport,
  buildMarkdownBriefExport,
} from "@/domains/discovery/research-artifacts";
import {
  blindSpotsForSummary,
  CONFIDENCE_LABELS,
  confidenceFromLead,
  RESEARCH_GOAL_LABELS,
  type DiscoveryRunRecord,
} from "@/domains/discovery/discovery-run-summary";
import { copyToClipboard } from "@/lib/clipboard";
import type { DiscoveryResearchGoal, DiscoveryResearchSummary } from "@/types";

interface DiscoveryRunsPanelProps {
  isLoading: boolean;
  runs: DiscoveryRunRecord[];
}

interface ResearchSummaryBlockProps {
  researchGoal: DiscoveryResearchGoal;
  run: DiscoveryRunRecord;
  summary: DiscoveryResearchSummary;
}

function ResearchArtifactExports({ run }: { run: DiscoveryRunRecord }) {
  const [statusLabel, setStatusLabel] = useState<string | null>(null);

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
      </div>
      {statusLabel ? (
        <p className="type-label-small text-ink-muted" role="status">
          {statusLabel}
        </p>
      ) : null}
    </div>
  );
}

function ResearchSummaryBlock({ researchGoal, run, summary }: ResearchSummaryBlockProps) {
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

      <ResearchArtifactExports run={run} />

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

export function DiscoveryRunsPanel({ isLoading, runs }: DiscoveryRunsPanelProps) {
  return (
    <section className="border-border-strong bg-surface space-y-5 rounded-[1rem] border p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="type-headline-small text-ink-strong">Recent research</h1>
          <p className="type-body-medium text-ink-muted">Briefs, source counts, and gaps.</p>
        </div>
        <span className="border-border type-label-large text-ink-soft inline-flex items-center gap-2 rounded-full border px-3 py-1">
          <Clipboard className="h-4 w-4" aria-hidden />
          {runs.length} requests
        </span>
      </div>

      {isLoading ? (
        <p className="type-body-medium text-ink-muted">Loading...</p>
      ) : runs.length > 0 ? (
        <div className="divide-border divide-y">
          {runs.map((run) => (
            <article key={run.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="type-title-small text-ink-strong">{run.location_query}</h2>
                  <p className="type-body-small text-ink-muted mt-1">
                    {new Date(run.started_at).toLocaleString()} · {run.state}
                  </p>
                  <p className="type-label-medium text-ink-soft mt-2">
                    {RESEARCH_GOAL_LABELS[run.research_goal ?? "landscape_scan"]}
                  </p>
                </div>
                <span className="type-label-large border-border text-ink-soft rounded-full border px-3 py-1">
                  {run.status}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-4">
                <p className="type-body-medium text-ink-soft">
                  {run.issue_areas.length} issue areas
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.entries_extracted} entries extracted
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.sources_fetched} sources fetched
                </p>
                <p className="type-body-medium text-ink-soft">
                  {run.entries_after_dedup} entries after dedup
                </p>
              </div>

              {run.error_message ? (
                <p className="type-body-small text-red-700">{run.error_message}</p>
              ) : null}

              {run.research_summary ? (
                <ResearchSummaryBlock
                  researchGoal={run.research_goal ?? "landscape_scan"}
                  run={run}
                  summary={run.research_summary}
                />
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="type-body-medium text-ink-muted">No research yet.</p>
      )}
    </section>
  );
}
