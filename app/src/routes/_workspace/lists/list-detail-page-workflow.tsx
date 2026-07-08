import { NewsroomHandoffPanel } from "@/domains/workspace/components/newsroom-handoff-panel";
import { NonprofitSystemsBridgePanel } from "@/domains/workspace/components/nonprofit-systems-bridge-panel";
import type { ResearchThreadSummary } from "./list-detail-page-utils";

interface WorkflowSectionsProps {
  completedFollowUps: string[];
  evidencePack: string;
  crmPacketText: string;
  institutionalExport: string;
  isTeamWorkspace: boolean;
  newsroomAssignmentPacket: string;
  nonprofitSystemsPacket: string;
  onCopyCrmPacket: () => void;
  onCopyEvidencePack: () => void;
  onCopyInstitutionalExport: () => void;
  onCopyNewsroomPacket: (packetText: string) => void;
  onCopyNonprofitSystemsPacket: (packetText: string) => void;
  onCopySpreadsheetExport: () => void;
  onDownloadCrmPacket: () => void;
  onDownloadInstitutionalExport: () => void;
  onDownloadSavedListExport: () => void;
  onDownloadSpreadsheetExport: () => void;
  onToggleFollowUp: (followUp: string) => void;
  researchThread: ResearchThreadSummary;
  workspaceName: string;
}

export function WorkflowSections({
  completedFollowUps,
  evidencePack,
  crmPacketText,
  institutionalExport,
  isTeamWorkspace,
  newsroomAssignmentPacket,
  nonprofitSystemsPacket,
  onCopyCrmPacket,
  onCopyEvidencePack,
  onCopyInstitutionalExport,
  onCopyNewsroomPacket,
  onCopyNonprofitSystemsPacket,
  onCopySpreadsheetExport,
  onDownloadCrmPacket,
  onDownloadInstitutionalExport,
  onDownloadSavedListExport,
  onDownloadSpreadsheetExport,
  onToggleFollowUp,
  researchThread,
  workspaceName,
}: WorkflowSectionsProps) {
  return (
    <>
      <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
        <p className="type-label-medium text-ink-muted">Follow-up context</p>
        <ul className="type-body-small text-ink-soft space-y-2">
          {researchThread.followUps.map((followUp) => (
            <li key={followUp}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={completedFollowUps.includes(followUp)}
                  onChange={() => {
                    onToggleFollowUp(followUp);
                  }}
                  className="mt-0.5"
                />
                <span>{followUp}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-surface-container space-y-3 rounded-[1rem] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="type-label-medium text-ink-muted">Evidence pack</p>
            <h2 className="type-title-large text-ink-strong">Shareable source summary</h2>
          </div>
          <button
            type="button"
            onClick={onCopyEvidencePack}
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
              onClick={onCopySpreadsheetExport}
              className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
            >
              Copy CSV
            </button>
            <button
              type="button"
              onClick={onDownloadSpreadsheetExport}
              className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
            >
              Download CSV
            </button>
            <button
              type="button"
              onClick={onDownloadSavedListExport}
              className="type-label-small border-outline-variant text-ink-strong hover:bg-surface-container-low rounded-full border px-3 py-1.5 transition-colors"
            >
              Download JSON
            </button>
          </div>
        </div>
        <pre className="type-body-small bg-surface-container-lowest text-ink-soft overflow-x-auto rounded-lg p-3 whitespace-pre-wrap">
          {""}
        </pre>
      </section>

      <NewsroomHandoffPanel
        actorCount={researchThread.actorCount}
        sourceCount={researchThread.sourceCount}
        noteCount={researchThread.noteCount}
        nextAction={researchThread.followUps[0] ?? "Review lead"}
        packetText={newsroomAssignmentPacket}
        onCopyPacket={onCopyNewsroomPacket}
      />

      {isTeamWorkspace ? (
        <div className="space-y-4">
          <NonprofitSystemsBridgePanel
            actorCount={researchThread.actorCount}
            sourceCount={researchThread.sourceCount}
            noteCount={researchThread.noteCount}
            workspaceName={workspaceName}
            packetText={nonprofitSystemsPacket}
            onCopyPacket={onCopyNonprofitSystemsPacket}
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
                    onClick={onCopyInstitutionalExport}
                    className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
                  >
                    Copy institutional CSV
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadInstitutionalExport}
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
                    onClick={onCopyCrmPacket}
                    className="type-label-small bg-ink-strong text-surface hover:bg-ink rounded-full px-3 py-1.5 transition-colors"
                  >
                    Copy CRM packet
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadCrmPacket}
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
    </>
  );
}
