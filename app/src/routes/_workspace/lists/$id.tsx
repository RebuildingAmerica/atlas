import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import {
  useAddSavedListItem,
  useRemoveSavedListItem,
  useSavedList,
} from "@/domains/catalog/hooks/use-claims";
import { useAtlasSession } from "@/domains/access";
import { buildNewsroomAssignmentPacket } from "@/domains/workspace/newsroom-handoff";
import { buildNonprofitSystemsPacket } from "@/domains/workspace/nonprofit-systems-bridge";
import {
  exportSavedList,
  getExportSavedListUrl,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { Badge } from "@/platform/ui/badge";
import {
  buildCrmHandoffPacket,
  buildEvidencePack,
  buildInstitutionalExport,
  buildProjectMetadata,
  buildResearchThreadSummary,
  buildSpreadsheetExport,
  countLabel,
  downloadCsvFile,
  downloadJsonFile,
  evidenceLocation,
  firstNextAction,
  savedListCrmFilename,
  savedListCsvFilename,
  savedListInstitutionalCsvFilename,
  savedListJsonFilename,
} from "./list-detail-page-utils";
import { SavedListItemsSection } from "./list-detail-page-panels";
import { WorkflowSections } from "./list-detail-page-workflow";

export const Route = createFileRoute("/_workspace/lists/$id")({
  component: ListDetailRoute,
});

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

      <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info">Brief</Badge>
          <Badge>{countLabel(researchThread.actorCount, "saved actor")}</Badge>
          <Badge>{countLabel(researchThread.noteCount, "note")}</Badge>
          <Badge>{countLabel(researchThread.sourceCount, "source packet")}</Badge>
        </div>
        <p className="type-body-medium text-ink-soft">
          Saved actors grouped with notes and source counts for one research thread.
        </p>
      </section>

      <WorkflowSections
        completedFollowUps={completedFollowUps}
        evidencePack={evidencePack}
        crmPacketText={crmPacketText}
        institutionalExport={institutionalExport}
        isTeamWorkspace={isTeamWorkspace}
        newsroomAssignmentPacket={newsroomAssignmentPacket}
        nonprofitSystemsPacket={nonprofitSystemsPacket}
        onCopyCrmPacket={() => {
          void copyCrmPacket();
        }}
        onCopyEvidencePack={() => {
          void copyEvidencePack();
        }}
        onCopyInstitutionalExport={() => {
          void copyInstitutionalExport();
        }}
        onCopyNewsroomPacket={(packetText) => {
          void copyNewsroomPacket(packetText);
        }}
        onCopyNonprofitSystemsPacket={(packetText) => {
          void copyNonprofitSystemsPacket(packetText);
        }}
        onCopySpreadsheetExport={() => {
          void copySpreadsheetExport();
        }}
        onDownloadCrmPacket={downloadCrmPacket}
        onDownloadInstitutionalExport={downloadInstitutionalExport}
        onDownloadSavedListExport={() => {
          void downloadSavedListExport();
        }}
        onDownloadSpreadsheetExport={() => {
          void downloadSpreadsheetExport();
        }}
        onToggleFollowUp={toggleFollowUp}
        researchThread={researchThread}
        workspaceName={workspaceName}
      />

      <SavedListItemsSection
        dataId={data.id}
        editingEntryId={editingEntryId}
        items={items}
        noteDraft={noteDraft}
        noteErrorEntryId={noteErrorEntryId}
        saveItemPending={saveItem.isPending}
        onBeginNoteEdit={beginNoteEdit}
        onCancelNoteEdit={cancelNoteEdit}
        onDraftChange={setNoteDraft}
        onSaveNote={(listId, entryId) => {
          void saveNote(listId, entryId);
        }}
        onRemoveItem={(entryId) => {
          void removeItem.mutateAsync({ listId: data.id, entryId });
        }}
      />
    </div>
  );
}
