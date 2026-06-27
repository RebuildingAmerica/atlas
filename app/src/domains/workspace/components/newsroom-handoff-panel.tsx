import { ClipboardList, FileCheck2, Newspaper, PanelTop } from "lucide-react";

interface NewsroomHandoffPanelProps {
  actorCount: number;
  sourceCount: number;
  noteCount: number;
  nextAction: string;
  packetText: string;
  onCopyPacket: (packetText: string) => void;
}

interface NewsroomCue {
  label: string;
  body: string;
  Icon: typeof FileCheck2;
}

const NEWSROOM_CUES: readonly NewsroomCue[] = [
  {
    label: "Source check",
    body: "Confirm every lead against the packet before assignment.",
    Icon: FileCheck2,
  },
  {
    label: "Desk handoff",
    body: "Move lead, note, and next-action context into the editor queue.",
    Icon: ClipboardList,
  },
  {
    label: "CMS-ready slug",
    body: "Use the list name as a stable story or research desk handle.",
    Icon: PanelTop,
  },
] as const;

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function NewsroomHandoffPanel({
  actorCount,
  sourceCount,
  noteCount,
  nextAction,
  packetText,
  onCopyPacket,
}: NewsroomHandoffPanelProps) {
  return (
    <section
      aria-label="Newsroom handoff"
      className="border-border-taupe bg-paper-deep border px-5 py-5"
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="border-ink-strong/80 border-l-[3px] pl-5">
          <div className="flex items-center gap-2">
            <Newspaper
              data-testid="newsroom-handoff-icon"
              className="text-civic h-4 w-4"
              aria-hidden
            />
            <p className="type-label-small text-ink-muted tracking-widest uppercase">
              Newsroom handoff
            </p>
          </div>
          <h2 className="type-title-large text-ink-strong mt-3">Assignment packet</h2>
          <p className="type-body-small text-ink-soft mt-2 leading-relaxed">
            Package the list for an editor, reporter, or producer without separating leads from
            source counts and notes.
          </p>
          <button
            type="button"
            onClick={() => {
              onCopyPacket(packetText);
            }}
            className="type-label-medium bg-ink-strong text-surface hover:bg-ink mt-4 rounded-full px-4 py-2 transition-colors"
          >
            Copy assignment packet
          </button>
        </div>

        <div className="space-y-5">
          <dl className="grid grid-cols-3 gap-3">
            <div className="border-border border-b pb-3">
              <dt className="type-label-small text-ink-muted">Leads</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(actorCount, "lead")}
              </dd>
            </div>
            <div className="border-border border-b pb-3">
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(sourceCount, "source")}
              </dd>
            </div>
            <div className="border-border border-b pb-3">
              <dt className="type-label-small text-ink-muted">Notes</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(noteCount, "note")}
              </dd>
            </div>
          </dl>

          <div className="grid gap-4 sm:grid-cols-3">
            {NEWSROOM_CUES.map((cue) => (
              <div key={cue.label} className="space-y-2">
                <cue.Icon
                  data-testid="newsroom-handoff-icon"
                  className="text-civic h-4 w-4"
                  aria-hidden
                />
                <div>
                  <p className="type-title-small text-ink-strong font-semibold">{cue.label}</p>
                  <p className="type-body-small text-ink-soft mt-1 leading-relaxed">{cue.body}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="type-label-medium text-ink-soft">Next: {nextAction}</p>
        </div>
      </div>
    </section>
  );
}
