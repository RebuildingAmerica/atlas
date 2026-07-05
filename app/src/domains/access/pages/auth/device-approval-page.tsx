import { useState, type FormEvent } from "react";
import { CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { normalizeDeviceUserCode } from "@/domains/access/device-code";
import { deviceAuthPath, deviceResultPath } from "@/domains/access/device-auth-paths";
import { Button } from "@/platform/ui/button";

const DEVICE_APPROVAL_RESULTS = ["denied", "failed"] as const;
const DEVICE_AUTH_STATUSES = ["pending", "approved", "denied"] as const;

type DeviceApprovalAction = "approve" | "deny";
type DeviceApprovalResult = (typeof DEVICE_APPROVAL_RESULTS)[number];

export const deviceApprovalSearchSchema = z.object({
  status: z.enum(DEVICE_APPROVAL_RESULTS).optional(),
  user_code: z.string().optional(),
});

export interface DeviceApprovalPageProps {
  redirect?: DeviceApprovalRedirect;
  status?: DeviceApprovalResult;
  userCode?: string;
}

type DeviceApprovalRedirect = (path: string) => void;

const deviceStatusResponseSchema = z.object({
  status: z.enum(DEVICE_AUTH_STATUSES),
  user_code: z.string(),
});

function redirectBrowser(path: string): void {
  window.location.assign(path);
}

/**
 * Browser approval page for Scout CLI device authorization.
 */
export function DeviceApprovalPage({
  redirect = redirectBrowser,
  status,
  userCode,
}: DeviceApprovalPageProps) {
  const [codeInput, setCodeInput] = useState(() => normalizeDeviceUserCode(userCode ?? ""));
  const [message, setMessage] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] = useState<DeviceApprovalAction | null>(null);
  const hasPrefilledCode = Boolean(userCode?.trim());

  async function submitDeviceCode(action: DeviceApprovalAction) {
    const trimmedCode = normalizeDeviceUserCode(codeInput);
    if (!trimmedCode) {
      setMessage("Enter the device code.");
      return;
    }

    setSubmittingAction(action);
    setMessage(null);
    try {
      const params = new URLSearchParams({ user_code: trimmedCode });
      const statusResponse = await fetch(`${deviceAuthPath("status")}?${params.toString()}`, {
        credentials: "include",
      });
      if (!statusResponse.ok) {
        redirect(deviceResultPath("failed"));
        return;
      }
      const payload = deviceStatusResponseSchema.parse(await statusResponse.json());
      if (payload.status === "approved") {
        redirect(deviceAuthPath("approved"));
        return;
      }
      if (payload.status === "denied") {
        redirect(deviceResultPath("denied"));
        return;
      }

      const actionResponse = await fetch(deviceAuthPath(action), {
        body: JSON.stringify({ userCode: payload.user_code }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!actionResponse.ok) {
        redirect(deviceResultPath("failed"));
        return;
      }
      redirect(action === "approve" ? deviceAuthPath("approved") : deviceResultPath("denied"));
    } catch {
      redirect(deviceResultPath("failed"));
    } finally {
      setSubmittingAction(null);
    }
  }

  function submitApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitDeviceCode("approve");
  }

  if (status === "failed") {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="type-display-small text-on-surface">Scout login failed</h1>
          <p className="type-body-large text-outline">Device could not be approved.</p>
        </div>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="type-display-small text-on-surface">Scout login denied</h1>
          <p className="type-body-large text-outline">
            This computer was not connected to your Atlas account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="type-display-small text-on-surface">Approve Scout login</h1>
        <p className="type-body-large text-outline">
          {hasPrefilledCode
            ? "Confirm this code matches Scout before approving this computer."
            : "Enter the code shown in Scout."}
        </p>
      </div>

      <div className="border-border-strong bg-surface-container-lowest rounded-lg border p-6">
        <form className="space-y-5" onSubmit={submitApproval}>
          <input
            aria-label="Code shown in Scout"
            className="border-border-strong text-on-surface focus:ring-primary w-full rounded-md border bg-white px-4 py-3 font-mono text-2xl tracking-normal outline-none focus:ring-2"
            onChange={(event) => {
              setCodeInput(normalizeDeviceUserCode(event.target.value));
            }}
            value={codeInput}
          />
          <div className="flex flex-wrap gap-3">
            <Button disabled={Boolean(submittingAction) || !codeInput.trim()} type="submit">
              Approve Scout login
            </Button>
            <Button
              disabled={Boolean(submittingAction) || !codeInput.trim()}
              onClick={() => {
                void submitDeviceCode("deny");
              }}
              type="button"
              variant="secondary"
            >
              Deny Scout login
            </Button>
          </div>
        </form>

        {message ? <p className="type-body-medium text-on-surface">{message}</p> : null}
      </div>
    </div>
  );
}

export function DeviceApprovalCompletePage() {
  return (
    <section className="mx-auto w-full max-w-md space-y-8 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm">
        <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
      </div>

      <div className="space-y-3">
        <h1 className="type-display-small text-on-surface">Scout login approved</h1>
        <p className="type-body-large text-outline">
          You're done in the browser. Return to Scout to continue.
        </p>
      </div>

      <p className="border-border bg-surface-container-lowest text-outline rounded-lg border px-5 py-4 text-sm">
        You can close this tab.
      </p>
    </section>
  );
}
