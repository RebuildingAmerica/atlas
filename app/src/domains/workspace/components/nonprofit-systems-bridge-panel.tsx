import { BadgeDollarSign, Landmark, Network, SendToBack } from "lucide-react";

interface NonprofitSystemsBridgePanelProps {
  actorCount: number;
  sourceCount: number;
  noteCount: number;
  workspaceName: string;
  packetText: string;
  onCopyPacket: (packetText: string) => void;
}

interface NonprofitSystemLane {
  label: string;
  body: string;
  readyLabel: string;
  Icon: typeof SendToBack;
}

const SYSTEM_LANES: readonly NonprofitSystemLane[] = [
  {
    label: "Advocacy CRM",
    body: "Move Atlas-vetted actors into outreach systems with source count, place, and note context intact.",
    readyLabel: "Ready for tags and outreach queues",
    Icon: SendToBack,
  },
  {
    label: "Grant diligence",
    body: "Carry enough provenance into grant memos to distinguish sourced leads from relationship memory.",
    readyLabel: "Ready for diligence rows",
    Icon: BadgeDollarSign,
  },
  {
    label: "Coalition ops",
    body: "Give organizers a compact handoff for partner mapping, follow-up ownership, and meeting prep.",
    readyLabel: "Ready for field planning",
    Icon: Network,
  },
] as const;

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function NonprofitSystemsBridgePanel({
  actorCount,
  sourceCount,
  noteCount,
  workspaceName,
  packetText,
  onCopyPacket,
}: NonprofitSystemsBridgePanelProps) {
  return (
    <section
      aria-label="Nonprofit systems bridge"
      className="border-civic/30 bg-surface-container-lowest border px-5 py-5"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="bg-paper-deep border-border-taupe space-y-5 border p-5">
          <div className="flex items-center gap-2">
            <Landmark
              data-testid="nonprofit-systems-bridge-icon"
              className="text-civic h-4 w-4"
              aria-hidden
            />
            <p className="type-label-small text-ink-muted tracking-widest uppercase">
              Nonprofit systems bridge
            </p>
          </div>
          <div>
            <p className="type-label-medium text-civic">{workspaceName}</p>
            <h2 className="type-title-large text-ink-strong mt-2">Adjacent system packet</h2>
            <p className="type-body-small text-ink-soft mt-2 leading-relaxed">
              Package sourced actors for the systems nonprofit teams already use, without stripping
              away trust context.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="type-label-small text-ink-muted">Actors</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(actorCount, "actor")}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Sources</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(sourceCount, "source")}
              </dd>
            </div>
            <div>
              <dt className="type-label-small text-ink-muted">Notes</dt>
              <dd className="type-title-small text-ink-strong mt-1 font-semibold">
                {countLabel(noteCount, "note")}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            onClick={() => {
              onCopyPacket(packetText);
            }}
            className="type-label-medium bg-civic hover:bg-civic-deep rounded-full px-4 py-2 text-white transition-colors"
          >
            Copy systems packet
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {SYSTEM_LANES.map((lane) => (
            <div key={lane.label} className="border-border bg-paper space-y-4 border p-4">
              <lane.Icon
                data-testid="nonprofit-systems-bridge-icon"
                className="text-civic h-5 w-5"
                aria-hidden
              />
              <div>
                <h3 className="type-title-small text-ink-strong font-semibold">{lane.label}</h3>
                <p className="type-body-small text-ink-soft mt-2 leading-relaxed">{lane.body}</p>
              </div>
              <p className="type-label-small border-border-taupe text-ink-muted border-t pt-3">
                {lane.readyLabel}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
