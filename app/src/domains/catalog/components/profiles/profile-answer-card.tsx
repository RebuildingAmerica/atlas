import { humanize } from "@/domains/catalog/catalog";
import { formatProfileLocation } from "@/domains/catalog/components/profiles/detail/profile-detail-primitives";
import type { ClaimEvidenceInfo, Entry, Source } from "@/types";

interface ProfileAnswerCardProps {
  entry: Entry;
  issueAreaLabels: Record<string, string>;
}

interface AnswerItem {
  label: string;
  value: string;
}

function entryTypeLabel(entry: Entry): string {
  if (entry.type === "person") {
    return "Person";
  }
  if (entry.type === "organization") {
    return "Organization";
  }
  return humanize(entry.type);
}

function sourceLabel(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

function formatEvidenceDate(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatClaimEvidence(evidence: ClaimEvidenceInfo | undefined, entry: Entry): string {
  if (!evidence) {
    return sourceLabel(entry.source_count);
  }

  const dateLabel = formatEvidenceDate(evidence.as_of);
  return [sourceLabel(evidence.source_count), evidence.confidence, dateLabel]
    .filter(Boolean)
    .join(" · ");
}

function issueLabels(entry: Entry, labels: Record<string, string>): string[] {
  return entry.issue_areas.map((slug) => labels[slug] ?? humanize(slug));
}

function sourceContext(sources: Source[] | undefined): string | null {
  const source = sources?.find((item) => item.extraction_context);
  return source?.extraction_context ?? null;
}

function describeWork(entry: Entry, labels: Record<string, string>): string {
  if (entry.description) {
    return entry.description;
  }

  const context = sourceContext(entry.sources);
  if (context) {
    return context;
  }

  const issues = issueLabels(entry, labels);
  return issues.length > 0 ? issues.join(", ") : "Public civic actor";
}

function describeWhy(entry: Entry, labels: Record<string, string>): string {
  const parts = [sourceLabel(entry.source_count), ...issueLabels(entry, labels).slice(0, 2)];
  return parts.join(" · ");
}

function buildAnswers(entry: Entry, labels: Record<string, string>): AnswerItem[] {
  if (entry.profile_answers) {
    return [
      { label: "Who", value: entry.profile_answers.who },
      { label: "What they do", value: entry.profile_answers.what_they_do },
      { label: "Where", value: entry.profile_answers.where },
      { label: "Why they matter", value: entry.profile_answers.why_they_matter },
      { label: "How Atlas knows", value: entry.profile_answers.how_atlas_knows },
    ];
  }

  return [
    { label: "Who", value: entryTypeLabel(entry) },
    { label: "What they do", value: describeWork(entry, labels) },
    { label: "Where", value: formatProfileLocation(entry) },
    { label: "Why they matter", value: describeWhy(entry, labels) },
    { label: "How Atlas knows", value: formatClaimEvidence(entry.claim_evidence?.summary, entry) },
  ];
}

export function ProfileAnswerCard({ entry, issueAreaLabels }: ProfileAnswerCardProps) {
  const answers = buildAnswers(entry, issueAreaLabels);

  return (
    <section
      aria-label="Profile answers"
      className="border-border-taupe bg-surface-container-lowest border px-6 py-5 sm:px-8"
    >
      <p className="text-ink-soft font-mono text-xs font-semibold tracking-[0.14em] uppercase">
        Profile at a glance
      </p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {answers.map((answer) => (
          <div
            key={answer.label}
            className="border-border bg-surface-container-low border px-4 py-3"
          >
            <dt className="type-label-small text-ink-muted">{answer.label}</dt>
            <dd className="type-body-medium text-ink-strong mt-1">{answer.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
