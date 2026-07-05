import { MonitorUp, Trash2 } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { AccountRow, AccountSection, AccountSubsection, AccountSurface } from "./rows";

export interface AccountScoutDeviceRecord {
  createdAt: string;
  defaultUploadTarget: "public" | "workspace";
  id: string;
  lastSeenAt: string;
  revokedAt: string | null;
  searchKeyConfigured: boolean;
  workerName: string;
  workspaceId: string | null;
}

interface AccountScoutSectionProps {
  devices: AccountScoutDeviceRecord[] | undefined;
  isError: boolean;
  isRevokePending: boolean;
  onRevoke: (id: string) => void;
}

export function AccountScoutSection({
  devices,
  isError,
  isRevokePending,
  onRevoke,
}: AccountScoutSectionProps) {
  return (
    <AccountSection id="scout" title="Scout">
      <AccountSubsection title="Scout devices">
        <AccountScoutDevices
          devices={devices}
          isError={isError}
          isRevokePending={isRevokePending}
          onRevoke={onRevoke}
        />
      </AccountSubsection>
    </AccountSection>
  );
}

interface AccountScoutDevicesProps {
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

export function AccountScoutDevices({
  devices,
  isError,
  isRevokePending,
  onRevoke,
}: AccountScoutDevicesProps) {
  const deviceCount = devices?.length;

  return (
    <AccountSurface>
      <AccountRow label="Devices">
        <span className="inline-flex items-center gap-2">
          <MonitorUp aria-hidden="true" className="text-civic h-4 w-4" />
          <span>{isError ? "Unavailable" : (deviceCount ?? 0)}</span>
        </span>
      </AccountRow>
      {devices?.map((device) => (
        <article key={device.id} className="flex items-start justify-between gap-3 px-4 py-3.5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-1">
              <p className="type-title-small text-ink-strong truncate">{device.workerName}</p>
              <p className="type-body-small text-ink-soft">
                Last seen {formatLastSeen(device.lastSeenAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="type-label-small bg-surface-container-low text-ink-strong rounded-full px-3 py-1">
                {targetLabel(device.defaultUploadTarget)}
              </span>
              <span
                className={
                  device.searchKeyConfigured
                    ? "type-label-small bg-civic text-surface rounded-full px-3 py-1"
                    : "type-label-small bg-surface-container-low text-ink-strong rounded-full px-3 py-1"
                }
              >
                {device.searchKeyConfigured ? "Search enabled" : "Search key needed"}
              </span>
            </div>
          </div>
          <Button
            ariaLabel="Revoke device"
            variant="ghost"
            disabled={isRevokePending}
            onClick={() => {
              onRevoke(device.id);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Revoke device
            </span>
          </Button>
        </article>
      ))}

      {isError ? (
        <p className="type-body-medium text-ink-soft px-4 py-3">Could not load Scout devices.</p>
      ) : null}
      {!isError && devices?.length === 0 ? (
        <p className="type-body-medium text-ink-soft px-4 py-3">No Scout devices.</p>
      ) : null}
    </AccountSurface>
  );
}
