import type {
  DiscoveryResearchGoal,
  DiscoveryResearchSummary,
  DiscoveryRun,
  DiscoveryStatus,
} from "@/types";

export interface AgentResearchArtifactRun {
  id: string;
  location_query: string;
  state: string;
  research_goal: DiscoveryResearchGoal;
  issue_areas: string[];
  status: DiscoveryStatus;
  started_at: string;
  completed_at?: string;
}

export interface AgentResearchArtifactWorkflow {
  primary_use: string;
  export_formats: string[];
  next_actions: string[];
}

export interface AgentResearchArtifact {
  schema_version: "atlas.research_artifact.v1";
  run: AgentResearchArtifactRun;
  outputs: DiscoveryResearchSummary;
  workflow: AgentResearchArtifactWorkflow;
}

const PRIMARY_USE_LABELS: Record<DiscoveryResearchGoal, string> = {
  ecosystem_map: "Local ecosystem map",
  interview_leads: "Interview source list",
  landscape_scan: "Local landscape brief",
  partner_scan: "Partner qualification scan",
};

const GOAL_LABELS: Record<DiscoveryResearchGoal, string> = {
  ecosystem_map: "Ecosystem map",
  interview_leads: "Interview leads",
  landscape_scan: "Landscape scan",
  partner_scan: "Partner scan",
};

function requireSummary(run: DiscoveryRun): DiscoveryResearchSummary {
  if (!run.research_summary) {
    throw new Error("Research artifacts require a completed run summary.");
  }
  return run.research_summary;
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function buildAgentResearchArtifact(run: DiscoveryRun): AgentResearchArtifact {
  const summary = requireSummary(run);
  return {
    schema_version: "atlas.research_artifact.v1",
    run: {
      id: run.id,
      location_query: run.location_query,
      state: run.state,
      research_goal: run.research_goal,
      issue_areas: run.issue_areas,
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at,
    },
    outputs: summary,
    workflow: {
      primary_use: PRIMARY_USE_LABELS[run.research_goal],
      export_formats: ["json", "markdown", "csv"],
      next_actions: [
        "Review source links before outreach",
        "Contact the highest-confidence leads first",
        "Use gaps to guide a follow-up search",
      ],
    },
  };
}

export function buildAgentJsonExport(run: DiscoveryRun): string {
  return JSON.stringify(buildAgentResearchArtifact(run), null, 2);
}

export function buildMarkdownBriefExport(run: DiscoveryRun): string {
  const summary = requireSummary(run);
  const lines = [
    `# ${run.location_query} research brief`,
    "",
    `Goal: ${GOAL_LABELS[run.research_goal]}`,
    `State: ${run.state}`,
    `Issues: ${run.issue_areas.join(", ")}`,
    "",
    summary.brief,
    "",
    "## Ranked leads",
    ...summary.ranked_leads.map(
      (lead, index) =>
        `${index + 1}. ${lead.name} (${lead.type}) — ${lead.why_it_matters} ${lead.source_count} ${lead.source_count === 1 ? "source" : "sources"}.`,
    ),
    "",
    "## Key sources",
    ...summary.key_sources.map(
      (source) => `- [${source.title}](${source.url}) — ${source.why_it_matters}`,
    ),
    "",
    "## Gaps",
    ...summary.gaps.map((gap) => `- ${gap.label}: ${gap.detail}`),
  ];

  if (summary.reasoning_signals.length > 0) {
    lines.push(
      "",
      "## Reasoning signals",
      ...summary.reasoning_signals.map((signal) => `- ${signal}`),
    );
  }

  return lines.join("\n");
}

export function buildLeadCsvExport(run: DiscoveryRun): string {
  const summary = requireSummary(run);
  const rows = summary.ranked_leads.map((lead, index) =>
    [
      csvCell(index + 1),
      csvCell(lead.name),
      csvCell(lead.type),
      csvCell(lead.confidence ?? ""),
      csvCell(lead.source_count),
      csvCell(lead.latest_source_date ?? ""),
      csvCell(lead.why_it_matters),
    ].join(","),
  );

  return ["rank,name,type,confidence,source_count,latest_source_date,why_it_matters", ...rows].join(
    "\n",
  );
}
