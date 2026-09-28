import { useState, type FormEvent } from "react";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { Input } from "@rebuildingamerica/atlas-ui/ui/input";
import { Select } from "@rebuildingamerica/atlas-ui/ui/select";
import { Textarea } from "@rebuildingamerica/atlas-ui/ui/textarea";
import { AdminInlineStatus } from "./admin-portal";
import type { EditorialCandidateInput } from "./discovery-reviews.functions";

interface IssueAreaOption {
  name: string;
  slug: string;
}

interface EditorialCandidateFormProps {
  error?: string;
  issueAreas: IssueAreaOption[];
  onSubmit: (candidate: EditorialCandidateInput) => void;
  pending: boolean;
}

const SCOPE_OPTIONS = [
  { label: "City or neighborhood", value: "local" },
  { label: "Metro area or region", value: "regional" },
  { label: "Statewide", value: "statewide" },
  { label: "National", value: "national" },
];

type GeographicScope = EditorialCandidateInput["geo_specificity"];

function officialHost(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function EditorialCandidateForm({
  error,
  issueAreas,
  onSubmit,
  pending,
}: EditorialCandidateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("Las Vegas");
  const [state, setState] = useState("NV");
  const [scope, setScope] = useState<GeographicScope>("local");
  const [region, setRegion] = useState("");
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [issueToAdd, setIssueToAdd] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceContext, setSourceContext] = useState("");
  const [actionUrl, setActionUrl] = useState("");
  const [sourcesChecked, setSourcesChecked] = useState(false);

  const sourceHost = officialHost(sourceUrl.trim());
  const actionHost = officialHost(actionUrl.trim());
  const sameOfficialSite = sourceHost !== null && sourceHost === actionHost;
  const placeReady =
    (scope === "local" || scope === "regional" ? city.trim() : true) && state.trim().length === 2;
  const ready = Boolean(
    name.trim().length >= 3 &&
    description.trim().length >= 10 &&
    sourceContext.trim().length >= 10 &&
    selectedIssues.length > 0 &&
    sameOfficialSite &&
    placeReady &&
    sourcesChecked,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      city: city.trim() || null,
      state: state.trim().toUpperCase(),
      geo_specificity: scope,
      region: region.trim() || null,
      issue_areas: selectedIssues,
      source_url: sourceUrl.trim(),
      source_context: sourceContext.trim(),
      action_url: actionUrl.trim(),
      sources_checked: true,
    });
  }

  return (
    <form
      className="border-border bg-surface-container-lowest space-y-5 rounded-lg border p-5"
      onSubmit={submit}
    >
      <div className="space-y-1">
        <h2 className="type-title-large text-ink-strong">Add an organization for review</h2>
        <p className="type-body-small text-ink-soft">
          Cite its own page for the work you describe and a page with a useful next step. An editor
          must approve the profile before it appears in public search.
        </p>
      </div>
      <Input label="Organization name" onChange={setName} required value={name} />
      <Textarea
        label="What the organization does"
        onChange={setDescription}
        required
        rows={3}
        value={description}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="City" onChange={setCity} value={city} />
        <Input label="State" onChange={setState} value={state} />
        <Select
          label="Geographic scope"
          onChange={(value) => {
            setScope(value as GeographicScope);
          }}
          options={SCOPE_OPTIONS}
          value={scope}
        />
      </div>
      <Input
        label="Region, if needed"
        onChange={setRegion}
        placeholder="Las Vegas Valley"
        value={region}
      />
      <fieldset className="space-y-3">
        <legend className="type-label-large text-ink-strong">Issue areas</legend>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Select
              label="Issue area"
              onChange={setIssueToAdd}
              options={issueAreas
                .filter((issue) => !selectedIssues.includes(issue.slug))
                .map((issue) => ({ label: issue.name, value: issue.slug }))}
              placeholder="Choose an issue"
              value={issueToAdd}
            />
          </div>
          <Button
            ariaLabel="Add issue area"
            disabled={!issueToAdd || selectedIssues.includes(issueToAdd)}
            onClick={() => {
              setSelectedIssues((current) => [...current, issueToAdd]);
              setIssueToAdd("");
            }}
            size="sm"
            variant="secondary"
          >
            Add issue
          </Button>
        </div>
        {issueAreas.length === 0 ? (
          <p className="type-body-small text-ink-soft">Issue areas unavailable.</p>
        ) : null}
        {selectedIssues.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {selectedIssues.map((slug) => (
              <li key={slug}>
                <Button
                  ariaLabel={`Remove ${issueAreas.find((issue) => issue.slug === slug)?.name ?? slug}`}
                  onClick={() => {
                    setSelectedIssues((current) => current.filter((item) => item !== slug));
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {issueAreas.find((issue) => issue.slug === slug)?.name ?? slug} ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </fieldset>
      <Input
        label="Official page supporting this work"
        onChange={setSourceUrl}
        placeholder="https://example.org/about"
        required
        type="url"
        value={sourceUrl}
      />
      <Textarea
        label="What the page supports"
        onChange={setSourceContext}
        required
        rows={2}
        value={sourceContext}
      />
      <Input
        label="Official next step"
        onChange={setActionUrl}
        placeholder="https://example.org/join"
        required
        type="url"
        value={actionUrl}
      />
      {sourceHost && actionHost && !sameOfficialSite ? (
        <p className="type-body-small text-on-error-container">
          The next step must be on the same official site as the source.
        </p>
      ) : null}
      <label className="type-body-small text-ink-strong flex items-start gap-2">
        <input
          checked={sourcesChecked}
          className="mt-1"
          onChange={(event) => {
            setSourcesChecked(event.target.checked);
          }}
          type="checkbox"
        />
        I checked both official pages and the place, issue, and next step above.
      </label>
      <AdminInlineStatus message={error} />
      <Button disabled={!ready || pending} type="submit">
        Add to review queue
      </Button>
    </form>
  );
}
