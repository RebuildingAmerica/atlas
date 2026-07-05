import { MonitorUp, Trash2 } from "lucide-react";
import { Button } from "@/platform/ui/button";
import { AccountSettingsRow, AccountSettingsSurface } from "./account-settings-section";

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

export function AccountScoutDevicesSection({
  devices,
  isError,
  isRevokePending,
  onRevoke,
}: AccountScoutDevicesSectionProps) {
  const deviceCount = devices?.length;

  return (
    <div className="space-y-3">
      <AccountSettingsSurface>
        <AccountSettingsRow label="Scout devices">
          <span className="inline-flex items-center gap-2">
            <MonitorUp aria-hidden="true" className="text-civic h-4 w-4" />
            <span>{isError ? "Unavailable" : (deviceCount ?? 0)}</span>
          </span>
        </AccountSettingsRow>
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
      </AccountSettingsSurface>
    </div>
  );
}
