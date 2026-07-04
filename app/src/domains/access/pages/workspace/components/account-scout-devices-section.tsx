import { MonitorUp, Trash2 } from "lucide-react";
import { Button } from "@/platform/ui/button";

export interface AccountScoutDeviceRecord {
  id: string;
  workerName: string;
  defaultUploadTarget: "public" | "workspace";
  workspaceId: string | null;
  searchKeyConfigured: boolean;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

interface AccountScoutDevicesSectionProps {
  devices: AccountScoutDeviceRecord[] | undefined;
  isError: boolean;
  isRevokePending: boolean;
  onRevoke: (id: string) => void;
}

function formatLastSeen(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function targetLabel(target: AccountScoutDeviceRecord["defaultUploadTarget"]): string {
  return target === "workspace" ? "Workspace uploads" : "Public uploads";
}

/**
 * Account-page card for host computers approved to run Atlas Scout locally.
 */
export function AccountScoutDevicesSection({
  devices,
  isError,
  isRevokePending,
  onRevoke,
}: AccountScoutDevicesSectionProps) {
  return (
    <div className="border-outline bg-surface space-y-4 rounded-[1.5rem] border p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <MonitorUp className="text-primary h-5 w-5" />
          <h2 className="type-title-large text-on-surface">Scout devices</h2>
        </div>
        <p className="type-body-medium text-outline">
          Approved computers that can upload Scout results.
        </p>
      </div>

      <div className="space-y-3">
        {devices?.map((device) => (
          <article
            key={device.id}
            className="border-outline-variant flex items-start justify-between gap-3 rounded-2xl border bg-white/70 px-4 py-3"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="space-y-1">
                <p className="type-title-small text-on-surface truncate">{device.workerName}</p>
                <p className="type-body-small text-outline">
                  Last seen {formatLastSeen(device.lastSeenAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="type-label-small bg-surface-container-low text-on-surface rounded-full px-3 py-1">
                  {targetLabel(device.defaultUploadTarget)}
                </span>
                <span
                  className={
                    device.searchKeyConfigured
                      ? "type-label-small bg-primary-container text-on-primary-container rounded-full px-3 py-1"
                      : "type-label-small bg-surface-container-low text-on-surface rounded-full px-3 py-1"
                  }
                >
                  {device.searchKeyConfigured ? "Search enabled" : "Search key needed"}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              disabled={isRevokePending}
              onClick={() => {
                onRevoke(device.id);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Revoke device
              </span>
            </Button>
          </article>
        ))}

        {isError ? (
          <p className="type-body-medium text-outline">
            Atlas could not load your Scout devices right now.
          </p>
        ) : null}

        {devices?.length === 0 ? (
          <p className="type-body-medium text-outline">No Scout devices connected.</p>
        ) : null}
      </div>
    </div>
  );
}
