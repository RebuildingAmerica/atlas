import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Check, PencilLine, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  useAddSavedListItem,
  useRemoveSavedListItem,
  useSavedList,
} from "@/domains/catalog/hooks/use-claims";
import { useAtlasSession } from "@/domains/access";
import { ActorAvatar } from "@/domains/catalog/components/profiles/actor-avatar";
import { NewsroomHandoffPanel } from "@/domains/workspace/components/newsroom-handoff-panel";
import { NonprofitSystemsBridgePanel } from "@/domains/workspace/components/nonprofit-systems-bridge-panel";
import { buildNewsroomAssignmentPacket } from "@/domains/workspace/newsroom-handoff";
import { buildNonprofitSystemsPacket } from "@/domains/workspace/nonprofit-systems-bridge";
import { exportSavedList, getExportSavedListUrl } from "@/lib/generated/atlas";
import { Badge } from "@/platform/ui/badge";

export const Route = createFileRoute("/_workspace/lists/$id")({
  component: ListDetailRoute,
});

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function ListDetailRoute() {
  const { id } = Route.useParams();
  const session = useAtlasSession();
  const list = useSavedList(id, true);
  const removeItem = useRemoveSavedListItem();
  const saveItem = useAddSavedListItem();
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteErrorEntryId, setNoteErrorEntryId] = useState<string | null>(null);
  const [completedFollowUps, setCompletedFollowUps] = useState<string[]>([]);

  function beginNoteEdit(entryId: string, note: string | null | undefined) {
    setEditingEntryId(entryId);
    setNoteDraft(note ?? "");
    setNoteErrorEntryId(null);
  }

  function cancelNoteEdit() {
    setEditingEntryId(null);
    setNoteDraft("");
    setNoteErrorEntryId(null);
  }

  async function saveNote(listId: string, entryId: string) {
    setNoteErrorEntryId(null);
    const note = noteDraft.trim();
    try {
      await saveItem.mutateAsync({
        listId,
        body: { entry_id: entryId, note: note || null },
      });
      cancelNoteEdit();
    } catch {
      setNoteErrorEntryId(entryId);
    }
  }

  function toggleFollowUp(followUp: string) {
    setCompletedFollowUps((current) =>
      current.includes(followUp)
        ? current.filter((item) => item !== followUp)
        : [...current, followUp],
    );
  }

  if (list.isLoading) {
    return (
      <div className="mx-auto max-w-4xl py-12">
        <p className="type-body-medium text-ink-soft">Loading list…</p>
      </div>
    );
  }

  if (!list.data) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 py-12">
        <h1 className="type-display-small text-ink-strong">List not found</h1>
        <p className="type-body-medium text-ink-soft">
          This list may have been deleted. Head back to{" "}
          <Link to="/lists" className="underline">
            your lists
          </Link>
          .
        </p>
      </div>
    );
  }

  const data = list.data;
  const items = data.items ?? [];
  const activeOrganization = session.data?.workspace.activeOrganization;
  const isTeamWorkspace = activeOrganization?.workspaceType === "team";
  const workspaceName = isTeamWorkspace ? activeOrganization.name : "You";
  const workspaceBadge = isTeamWorkspace ? "Team research workspace" : "Research thread";
  const researchThread = buildResearchThreadSummary(items);
  const projectMetadata = buildProjectMetadata(items, data.updated_at, workspaceName);
  const evidencePack = buildEvidencePack(data.name, data.description ?? null, items);
  const spreadsheetExport = buildSpreadsheetExport(items);
  const institutionalExport = buildInstitutionalExport(
    workspaceName,
    data.name,
    items,
    researchThread.followUps,
  );
  const newsroomAssignmentPacket = buildNewsroomAssignmentPacket({
    listName: data.name,
    description: data.description ?? null,
    actorCount: researchThread.actorCount,
    sourceCount: researchThread.sourceCount,
    noteCount: researchThread.noteCount,
    nextAction: firstNextAction(researchThread.followUps),
    items,
    locationForItem: evidenceLocation,
  });
  const nonprofitSystemsPacket = buildNonprofitSystemsPacket({
    listName: data.name,
    workspaceName,
    description: data.description ?? null,
    actorCount: researchThread.actorCount,
    sourceCount: researchThread.sourceCount,
    noteCount: researchThread.noteCount,
    nextAction: firstNextAction(researchThread.followUps),
    items,
    locationForItem: evidenceLocation,
  });
  const crmPacket = buildCrmHandoffPacket(
    workspaceName,
    data.name,
    items,
    researchThread.followUps,
  );
  const crmPacketText = JSON.stringify(crmPacket, null, 2);

  async function copyEvidencePack() {
    await navigator.clipboard?.writeText(evidencePack);
  }

  async function copySpreadsheetExport() {
    await navigator.clipboard?.writeText(spreadsheetExport);
  }

  async function copyInstitutionalExport() {
    await navigator.clipboard?.writeText(institutionalExport);
  }

  async function copyNewsroomPacket(packetText: string) {
    await navigator.clipboard?.writeText(packetText);
  }

  async function copyNonprofitSystemsPacket(packetText: string) {
    await navigator.clipboard?.writeText(packetText);
  }

  async function copyCrmPacket() {
    await navigator.clipboard?.writeText(crmPacketText);
  }

  async function downloadSpreadsheetExport() {
    const response = await fetch(getExportSavedListUrl(data.id, { format: "csv" }), {
      headers: { Accept: "text/csv" },
    });
    if (!response.ok) {
      return;
    }
    downloadCsvFile(savedListCsvFilename(data.name, data.id), await response.text());
  }

  async function downloadSavedListExport() {
    const exportPayload = await exportSavedList(data.id);
    downloadJsonFile(
      savedListJsonFilename(data.name, data.id),
      JSON.stringify(exportPayload, null, 2),
    );
  }

  function downloadInstitutionalExport() {
    downloadCsvFile(savedListInstitutionalCsvFilename(data.name, data.id), institutionalExport);
  }

  function downloadCrmPacket() {
    downloadJsonFile(savedListCrmFilename(data.name, data.id), crmPacketText);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-12">
      <Link
        to="/lists"
        className="type-label-medium text-ink-soft hover:text-ink-strong inline-flex items-center gap-2 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        All lists
      </Link>

      <div className="space-y-3">
        <Badge variant="info">{workspaceBadge}</Badge>
        <h1 className="type-display-small text-ink-strong">{data.name}</h1>
        {data.description ? (
          <p className="type-body-large text-ink-soft max-w-2xl">{data.description}</p>
        ) : null}
        <dl className="border-outline-variant bg-surface-container-lowest grid gap-3 rounded-[1rem] border p-4 sm:grid-cols-3">
          <div>
            <dt className="type-label-small text-ink-muted">Project status</dt>
            <dd className="type-title-small text-ink-strong">{projectMetadata.status}</dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Owner</dt>
            <dd className="type-title-small text-ink-strong">{projectMetadata.owner}</dd>
          </div>
          <div>
            <dt className="type-label-small text-ink-muted">Last updated</dt>
            <dd className="type-title-small text-ink-strong">{projectMetadata.lastUpdated}</dd>
          </div>
        </dl>
      </div>

      <section className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <div className="bg-surface-container space-y-3 rounded-[1rem] p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Brief</Badge>
            <Badge>{pluralize(researchThread.actorCount, "saved actor")}</Badge>
            <Badge>{pluralize(researchThread.noteCount, "note")}</Badge>
            <Badge>{pluralize(researchThread.sourceCount, "source packet")}</Badge>
          </div>
          <p className="type-body-medium text-ink-soft">
            Saved actors grouped with notes and source counts for one research thread.
          </p>
        </div>

        <div className="bg-surface-container space-y-3 rounded-[1rem] p-5">
          <p className="type-label-medium text-ink-muted">Follow-up context</p>
          <ul className="type-body-small text-ink-soft space-y-2">
            {researchThread.followUps.map((followUp) => (
              <li key={followUp}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={completedFollowUps.includes(followUp)}
                    onChange={() => {
                      toggleFollowUp(followUp);
                    }}
                    className="mt-0.5"
                  />
                  <span>{followUp}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-label-medium text-ink-muted">Evidence pack</p>
            <h2 className="type-title-large text-ink-strong">Shareable source summary</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              void copyEvidencePack();
            }}
            className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
          >
            Copy evidence pack
          </button>
        </div>
        <pre className="type-body-small bg-surface-container-lowest text-ink-soft overflow-x-auto rounded-lg p-3 whitespace-pre-wrap">
          {evidencePack}
        </pre>
      </section>

      <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-label-medium text-ink-muted">Spreadsheet export</p>
            <h2 className="type-title-large text-ink-strong">CSV research rows</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void copySpreadsheetExport();
              }}
              className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
            >
              Copy CSV
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadSpreadsheetExport();
              }}
              className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={() => {
                void downloadSavedListExport();
              }}
              className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
            >
              Download JSON
            </button>
          </div>
        </div>
        <pre className="type-body-small bg-surface-container-lowest text-ink-soft overflow-x-auto rounded-lg p-3 whitespace-pre-wrap">
          {spreadsheetExport}
        </pre>
      </section>

      <NewsroomHandoffPanel
        actorCount={researchThread.actorCount}
        sourceCount={researchThread.sourceCount}
        noteCount={researchThread.noteCount}
        nextAction={firstNextAction(researchThread.followUps)}
        packetText={newsroomAssignmentPacket}
        onCopyPacket={(packetText) => {
          void copyNewsroomPacket(packetText);
        }}
      />

      {isTeamWorkspace ? (
        <div className="space-y-4">
          <NonprofitSystemsBridgePanel
            actorCount={researchThread.actorCount}
            sourceCount={researchThread.sourceCount}
            noteCount={researchThread.noteCount}
            workspaceName={workspaceName}
            packetText={nonprofitSystemsPacket}
            onCopyPacket={(packetText) => {
              void copyNonprofitSystemsPacket(packetText);
            }}
          />

          <section className="grid gap-4 md:grid-cols-2">
            <div className="bg-surface-container space-y-3 rounded-[1rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="type-label-medium text-ink-muted">Institutional export</p>
                  <h2 className="type-title-large text-ink-strong">Selected lead rows</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void copyInstitutionalExport();
                    }}
                    className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
                  >
                    Copy institutional CSV
                  </button>
                  <button
                    type="button"
                    onClick={downloadInstitutionalExport}
                    className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
                  >
                    Download institutional CSV
                  </button>
                </div>
              </div>
              <pre className="type-body-small bg-surface-container-lowest text-ink-soft max-h-72 overflow-x-auto rounded-lg p-3 whitespace-pre-wrap">
                {institutionalExport}
              </pre>
            </div>

            <div className="bg-surface-container space-y-3 rounded-[1rem] p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="type-label-medium text-ink-muted">CRM handoff</p>
                  <h2 className="type-title-large text-ink-strong">{workspaceName}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void copyCrmPacket();
                    }}
                    className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
                  >
                    Copy CRM packet
                  </button>
                  <button
                    type="button"
                    onClick={downloadCrmPacket}
                    className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
                  >
                    Download CRM JSON
                  </button>
                </div>
              </div>
              <pre className="type-body-small bg-surface-container-lowest text-ink-soft max-h-72 overflow-x-auto rounded-lg p-3 whitespace-pre-wrap">
                {crmPacketText}
              </pre>
            </div>
          </section>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="bg-surface-container space-y-2 rounded-[1rem] p-5">
          <p className="type-body-medium text-ink-strong">No people or groups yet.</p>
          <p className="type-body-small text-ink-soft">
            Use the <span className="font-semibold">Save</span> button on any profile to add it
            here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const actor = item.entry;
            const slug = actor?.slug ?? "";
            const segment = actor?.type === "organization" ? "organizations" : "people";
            const avatarType: "person" | "organization" =
              actor?.type === "organization" ? "organization" : "person";
            const city = actor?.address?.city ?? null;
            const state = actor?.address?.state ?? null;
            const locationLabel = city && state ? `${city}, ${state}` : (state ?? "—");
            return (
              <li
                key={item.entry_id}
                className="border-outline-variant bg-surface-container-lowest flex items-start gap-4 rounded-[1rem] border p-4"
              >
                {actor ? (
                  <ActorAvatar
                    name={actor.name}
                    type={avatarType}
                    size="md"
                    photoUrl={actor.photo_url ?? undefined}
                  />
                ) : null}
                <div className="min-w-0 flex-1 space-y-1">
                  {actor && slug ? (
                    <Link
                      to={`/profiles/${segment}/$slug` as "/profiles/people/$slug"}
                      params={{ slug }}
                      className="type-title-medium text-ink-strong block truncate hover:underline"
                    >
                      {actor.name}
                    </Link>
                  ) : (
                    <p className="type-title-medium text-ink-strong">
                      {actor?.name ?? "Profile unavailable"}
                    </p>
                  )}
                  {actor ? (
                    <p className="type-body-small text-ink-soft">
                      {locationLabel}
                      {" · "}
                      {actor.source_count ?? 0}{" "}
                      {(actor.source_count ?? 0) === 1 ? "source" : "sources"}
                    </p>
                  ) : null}
                  {item.note ? (
                    <p className="type-body-small text-ink-soft italic">“{item.note}”</p>
                  ) : null}
                  <SavedListItemNoteEditor
                    actorName={actor?.name ?? "actor"}
                    entryId={item.entry_id}
                    isEditing={editingEntryId === item.entry_id}
                    isPending={saveItem.isPending}
                    note={item.note ?? null}
                    noteDraft={noteDraft}
                    showError={noteErrorEntryId === item.entry_id}
                    onCancel={cancelNoteEdit}
                    onDraftChange={setNoteDraft}
                    onEdit={() => {
                      beginNoteEdit(item.entry_id, item.note);
                    }}
                    onSave={() => {
                      void saveNote(data.id, item.entry_id);
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void removeItem.mutateAsync({ listId: data.id, entryId: item.entry_id });
                  }}
                  className="text-ink-muted hover:text-rose-700"
                  aria-label={`Remove ${actor?.name ?? "actor"} from list`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface ResearchThreadSummary {
  actorCount: number;
  noteCount: number;
  sourceCount: number;
  followUps: string[];
}

interface ProjectMetadata {
  status: string;
  owner: string;
  lastUpdated: string;
}

interface SavedListThreadItem {
  list_id?: string | null;
  entry_id: string;
  note?: string | null;
  added_at?: string | null;
  entry?: {
    address?: {
      city?: string | null;
      display?: string | null;
      state?: string | null;
    } | null;
    name?: string | null;
    slug?: string | null;
    source_count?: number | null;
    type?: string | null;
  } | null;
}

interface CrmLeadPacket {
  entryId: string;
  name: string;
  type: string;
  location: string;
  sourceCount: number;
  note: string;
  syncStatus: "ready_for_sync";
  nextAction: string;
}

interface CrmHandoffPacket {
  workspace: string;
  list: string;
  leads: CrmLeadPacket[];
}

function projectStatusForThread(summary: ResearchThreadSummary): string {
  if (summary.actorCount === 0) {
    return "Draft";
  }
  if (summary.sourceCount === 0) {
    return "Needs sources";
  }
  if (summary.noteCount < summary.actorCount) {
    return "Needs notes";
  }
  return "Ready for outreach";
}

function formatProjectDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fileSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || "atlas-list";
}

function savedListJsonFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-list-${listId}.json`;
}

function savedListCsvFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-list-${listId}.csv`;
}

function savedListInstitutionalCsvFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-institutional-${listId}.csv`;
}

function savedListCrmFilename(listName: string, listId: string): string {
  return `${fileSegment(listName)}-crm-${listId}.json`;
}

function downloadTextFile(filename: string, content: string, mediaType: string) {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }

  const blob = new Blob([content], { type: mediaType });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function downloadJsonFile(filename: string, content: string) {
  downloadTextFile(filename, content, "application/json;charset=utf-8");
}

function downloadCsvFile(filename: string, content: string) {
  downloadTextFile(filename, content, "text/csv;charset=utf-8");
}

function buildProjectMetadata(
  items: SavedListThreadItem[],
  updatedAt: string,
  owner: string,
): ProjectMetadata {
  const summary = buildResearchThreadSummary(items);
  return {
    status: projectStatusForThread(summary),
    owner,
    lastUpdated: formatProjectDate(updatedAt),
  };
}

function buildResearchThreadSummary(items: SavedListThreadItem[]): ResearchThreadSummary {
  const actorCount = items.length;
  const noteCount = items.filter((item) => Boolean(item.note?.trim())).length;
  const sourceCount = items.reduce((sum, item) => sum + (item.entry?.source_count ?? 0), 0);
  const unsortedCount = actorCount - noteCount;
  const followUps = ["Review latest source trail"];
  if (unsortedCount > 0) {
    followUps.push("Add notes for unsorted leads");
  }
  if (sourceCount === 0 && actorCount > 0) {
    followUps.push("Check source coverage");
  }
  return { actorCount, noteCount, sourceCount, followUps };
}

function evidenceLocation(item: SavedListThreadItem): string {
  const city = item.entry?.address?.city ?? null;
  const state = item.entry?.address?.state ?? null;
  if (city && state) {
    return `${city}, ${state}`;
  }
  return state ?? "Location not specified";
}

function buildEvidencePack(
  name: string,
  description: string | null,
  items: SavedListThreadItem[],
): string {
  const lines = [`${name} evidence pack`];
  if (description) {
    lines.push(description);
  }
  lines.push("");
  if (items.length === 0) {
    lines.push("No saved actors yet.");
    return lines.join("\n");
  }

  items.forEach((item) => {
    const actorName = item.entry?.name ?? "Profile unavailable";
    const sourceCount = item.entry?.source_count ?? 0;
    const sourceLabel = sourceCount === 1 ? "source" : "sources";
    lines.push(`${actorName} — ${evidenceLocation(item)} — ${sourceCount} ${sourceLabel}`);
    if (item.note) {
      lines.push(`Note: ${item.note}`);
    }
  });
  return lines.join("\n");
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildSpreadsheetExport(items: SavedListThreadItem[]): string {
  const rows = [["name", "type", "location", "source_count", "note"].join(",")];
  items.forEach((item) => {
    const actor = item.entry;
    rows.push(
      [
        csvCell(actor?.name ?? "Profile unavailable"),
        csvCell(actor?.type ?? ""),
        csvCell(evidenceLocation(item)),
        csvCell(actor?.source_count ?? 0),
        csvCell(item.note ?? ""),
      ].join(","),
    );
  });
  return rows.join("\n");
}

function firstNextAction(followUps: string[]): string {
  return followUps[0] ?? "Review lead";
}

function buildInstitutionalExport(
  workspaceName: string,
  listName: string,
  items: SavedListThreadItem[],
  followUps: string[],
): string {
  const nextAction = firstNextAction(followUps);
  const rows = [
    [
      "workspace",
      "list",
      "entry_id",
      "name",
      "type",
      "location",
      "source_count",
      "note",
      "crm_status",
      "next_action",
    ].join(","),
  ];
  items.forEach((item) => {
    const actor = item.entry;
    rows.push(
      [
        csvCell(workspaceName),
        csvCell(listName),
        csvCell(item.entry_id),
        csvCell(actor?.name ?? "Profile unavailable"),
        csvCell(actor?.type ?? ""),
        csvCell(evidenceLocation(item)),
        csvCell(actor?.source_count ?? 0),
        csvCell(item.note ?? ""),
        csvCell("ready_for_sync"),
        csvCell(nextAction),
      ].join(","),
    );
  });
  return rows.join("\n");
}

function buildCrmHandoffPacket(
  workspaceName: string,
  listName: string,
  items: SavedListThreadItem[],
  followUps: string[],
): CrmHandoffPacket {
  const nextAction = firstNextAction(followUps);
  return {
    workspace: workspaceName,
    list: listName,
    leads: items.map((item) => {
      const actor = item.entry;
      return {
        entryId: item.entry_id,
        name: actor?.name ?? "Profile unavailable",
        type: actor?.type ?? "",
        location: evidenceLocation(item),
        sourceCount: actor?.source_count ?? 0,
        note: item.note ?? "",
        syncStatus: "ready_for_sync",
        nextAction,
      };
    }),
  };
}

interface SavedListItemNoteEditorProps {
  actorName: string;
  entryId: string;
  isEditing: boolean;
  isPending: boolean;
  note: string | null;
  noteDraft: string;
  showError: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onSave: () => void;
}

function SavedListItemNoteEditor({
  actorName,
  entryId,
  isEditing,
  isPending,
  note,
  noteDraft,
  showError,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
}: SavedListItemNoteEditorProps) {
  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="type-label-small text-accent hover:text-accent-dark inline-flex items-center gap-1.5 transition-colors"
        aria-label={`${note ? "Edit" : "Add"} note for ${actorName}`}
      >
        <PencilLine className="h-3.5 w-3.5" aria-hidden />
        {note ? "Edit note" : "Add note"}
      </button>
    );
  }

  return (
    <div className="border-outline-variant bg-surface-container mt-3 space-y-2 rounded-lg border p-3">
      <label htmlFor={`saved-list-note-${entryId}`} className="sr-only">
        Note for {actorName}
      </label>
      <textarea
        id={`saved-list-note-${entryId}`}
        value={noteDraft}
        onChange={(event) => {
          onDraftChange(event.target.value);
        }}
        rows={3}
        className="border-outline-variant focus:ring-accent bg-surface-container-lowest text-on-surface type-body-small w-full resize-y rounded-md border px-3 py-2 focus:ring-2 focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="type-label-small bg-ink-strong text-surface hover:bg-ink inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
          aria-label={`Save note for ${actorName}`}
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          Save note
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="type-label-small text-ink-muted hover:text-ink-strong inline-flex items-center gap-1.5 transition-colors"
          aria-label={`Cancel note edit for ${actorName}`}
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Cancel
        </button>
        {showError ? (
          <span className="type-label-small text-rose-700" role="alert">
            Could not save note.
          </span>
        ) : null}
      </div>
    </div>
  );
}
