import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import {
  useAddSavedListItem,
  useRemoveSavedListItem,
  useSavedList,
  useSetSavedListSharing,
} from "@/domains/catalog/hooks/use-claims";
import { useAtlasSession } from "@/domains/access";
import { buildNewsroomAssignmentPacket } from "@/domains/workspace/newsroom-handoff";
import { buildNonprofitSystemsPacket } from "@/domains/workspace/nonprofit-systems-bridge";
import {
  exportSavedList,
  getExportSavedListUrl,
} from "@rebuildingamerica/atlas-api-client/generated/atlas";
import { Badge } from "@rebuildingamerica/atlas-ui/ui/badge";
import { Button } from "@rebuildingamerica/atlas-ui/ui/button";
import { userFacingErrorMessage } from "@rebuildingamerica/atlas-api-client/user-facing-errors";
import { useDateTimeFormatter } from "@rebuildingamerica/atlas-ui/format/date-time";
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
  head: () => ({ meta: [{ title: "Research list | Atlas" }] }),
  component: ListDetailRoute,
});

function ListDetailRoute() {
  const { id } = Route.useParams();
  const format = useDateTimeFormatter();
  const session = useAtlasSession();
  const list = useSavedList(id, true);
  const removeItem = useRemoveSavedListItem();
  const saveItem = useAddSavedListItem();
  const setSharing = useSetSavedListSharing();
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
  const capabilities = session.data?.workspace.resolvedCapabilities.capabilities ?? [];
  const canWriteNotes = capabilities.includes("workspace.notes");
  const canExport = capabilities.includes("workspace.export");
  const isTeamWorkspace = activeOrganization?.workspaceType === "team";
  const isShared = Boolean(data.org_id);
  const canShare =
    isTeamWorkspace &&
    capabilities.includes("workspace.shared") &&
    data.user_id === session.data?.user?.id;
  const workspaceName = isShared ? (activeOrganization?.name ?? "Your team") : "You";
  const workspaceBadge = isShared ? "Shared team list" : "Private research list";
  const researchThread = buildResearchThreadSummary(items);
  const projectMetadata = buildProjectMetadata(format, items, data.updated_at, workspaceName);
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

  async function copyWithFeedback(content: string, label: string) {
    setActionError(null);
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      setActionError(`Could not copy ${label}. Try again.`);
    }
  }

  async function downloadSpreadsheetExport() {
    setActionError(null);
    try {
      const response = await fetch(getExportSavedListUrl(data.id, { format: "csv" }), {
        headers: { Accept: "text/csv" },
      });
      if (!response.ok) {
        throw new Error("CSV export failed.");
      }
      downloadCsvFile(savedListCsvFilename(data.name, data.id), await response.text());
    } catch {
      setActionError("Could not download CSV. Try again.");
    }
  }

  async function downloadSavedListExport() {
    setActionError(null);
    try {
      const exportPayload = await exportSavedList(data.id);
      downloadJsonFile(
        savedListJsonFilename(data.name, data.id),
        JSON.stringify(exportPayload, null, 2),
      );
    } catch {
      setActionError("Could not download JSON. Try again.");
    }
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
        <p className="type-body-small text-ink-soft">
          {isShared
            ? `Everyone in ${activeOrganization?.name ?? "your team"} can read and edit this list and its notes.`
            : "Only you can see this list and its notes."}
        </p>
        {canShare ? (
          <div className="space-y-2">
            <Button
              type="button"
              variant="secondary"
              disabled={setSharing.isPending}
              onClick={() => {
                setSharingError(null);
                void setSharing
                  .mutateAsync({ listId: data.id, shared: !isShared })
                  .catch((error: unknown) => {
                    setSharingError(userFacingErrorMessage(error, "Could not change sharing."));
                  });
              }}
            >
              {isShared ? "Stop sharing with team" : `Share with ${activeOrganization.name}`}
            </Button>
            {sharingError ? (
              <p role="alert" className="text-rose-700">
                {sharingError}
              </p>
            ) : null}
          </div>
        ) : null}
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
        {session.data && !canWriteNotes && !canExport ? (
          <div className="type-body-small text-ink-soft space-y-1">
            <p>Your saved list stays available on Free.</p>
            <p>
              Atlas Pro adds notes, CSV/JSON downloads, and briefs.{" "}
              <Link to="/pricing" className="text-accent-deep hover:text-accent-ink underline">
                Compare plans
              </Link>
              .
            </p>
          </div>
        ) : null}
        {items.length > 0 && canExport ? (
          <Link
            to="/briefs/new"
            search={{ list: data.id }}
            className="type-label-medium text-accent-deep hover:text-accent-ink inline-flex"
          >
            Create a brief from this list
          </Link>
        ) : null}
      </section>

      <WorkflowSections
        actionError={actionError}
        canExport={canExport}
        completedFollowUps={completedFollowUps}
        evidencePack={evidencePack}
        crmPacketText={crmPacketText}
        institutionalExport={institutionalExport}
        isTeamWorkspace={isShared}
        newsroomAssignmentPacket={newsroomAssignmentPacket}
        nonprofitSystemsPacket={nonprofitSystemsPacket}
        onCopyCrmPacket={() => {
          void copyWithFeedback(crmPacketText, "CRM packet");
        }}
        onCopyEvidencePack={() => {
          void copyWithFeedback(evidencePack, "evidence pack");
        }}
        onCopyInstitutionalExport={() => {
          void copyWithFeedback(institutionalExport, "institutional CSV");
        }}
        onCopyNewsroomPacket={(packetText) => {
          void copyWithFeedback(packetText, "newsroom packet");
        }}
        onCopyNonprofitSystemsPacket={(packetText) => {
          void copyWithFeedback(packetText, "systems packet");
        }}
        onCopySpreadsheetExport={() => {
          void copyWithFeedback(spreadsheetExport, "CSV");
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
        canWriteNotes={canWriteNotes}
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
