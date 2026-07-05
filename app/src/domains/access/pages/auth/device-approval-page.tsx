import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/platform/ui/button";

export const deviceApprovalSearchSchema = z.object({
  user_code: z.string().optional(),
});

type DeviceDecision = "approve" | "deny";

interface DeviceApprovalPageProps {
  userCode?: string;
}

interface DeviceStatusResponse {
  status: "pending" | "approved" | "denied";
  user_code: string;
}

type DeviceApprovalStatus = DeviceStatusResponse["status"] | "entry" | "loading";

const deviceStatusResponseSchema = z.object({
  status: z.enum(["pending", "approved", "denied"]),
  user_code: z.string(),
});

function decisionEndpoint(decision: DeviceDecision): string {
  return `/api/auth/device/${decision}`;
}

/**
 * Browser approval page for Scout CLI device authorization.
 */
export function DeviceApprovalPage({ userCode }: DeviceApprovalPageProps) {
  const [codeInput, setCodeInput] = useState(userCode ?? "");
  const [verifiedCode, setVerifiedCode] = useState<string | null>(null);
  const [status, setStatus] = useState<DeviceApprovalStatus>("entry");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verifyDeviceCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedCode = codeInput.trim().toUpperCase();
    if (!trimmedCode) {
      setMessage("Enter the device code.");
      return;
    }

    setStatus("loading");
    setMessage(null);
    try {
      const params = new URLSearchParams({ user_code: trimmedCode });
      const response = await fetch(`/api/auth/device?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        setStatus("entry");
        setMessage("Device code could not be verified.");
        return;
      }
      const payload = deviceStatusResponseSchema.parse(await response.json());
      setVerifiedCode(payload.user_code);
      setCodeInput(payload.user_code);
      setStatus(payload.status);
    } catch {
      setStatus("entry");
      setMessage("Device code could not be verified.");
    }
  }

  async function submitDecision(decision: DeviceDecision) {
    if (!verifiedCode) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(decisionEndpoint(decision), {
        body: JSON.stringify({ userCode: verifiedCode }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setMessage(
          decision === "approve" ? "Device could not be approved." : "Device could not be denied.",
        );
        return;
      }
      setStatus(decision === "approve" ? "approved" : "denied");
      setMessage(decision === "approve" ? "Device approved." : "Device denied.");
    } catch {
      setMessage(
        decision === "approve" ? "Device could not be approved." : "Device could not be denied.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const isComplete = status === "approved" || status === "denied";
  const isEntry = status === "entry" || status === "loading";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">Atlas Scout</p>
        <h1 className="type-display-small text-on-surface">Approve Scout login</h1>
        <p className="type-body-large text-outline">
          {isEntry ? "Enter the code shown in Scout." : "Confirm this code before granting access."}
        </p>
      </div>

      <div className="border-border-strong bg-surface-container-lowest space-y-5 rounded-lg border p-6">
        {isEntry ? (
          <form className="space-y-4" onSubmit={(event) => void verifyDeviceCode(event)}>
            <label className="block space-y-2">
              <span className="type-label-small text-outline">Device code</span>
              <input
                className="border-border-strong text-on-surface focus:ring-primary w-full rounded-lg border bg-white px-4 py-3 font-mono text-2xl tracking-normal outline-none focus:ring-2"
                onChange={(event) => {
                  setCodeInput(event.target.value.toUpperCase());
                }}
                value={codeInput}
              />
            </label>
            <Button disabled={status === "loading" || !codeInput.trim()} type="submit">
              Continue
            </Button>
          </form>
        ) : (
          <div>
            <p className="type-label-small text-outline">Code</p>
            <p className="text-on-surface font-mono text-3xl tracking-normal">{verifiedCode}</p>
          </div>
        )}

        {!isEntry && !isComplete ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isSubmitting}
              onClick={() => {
                void submitDecision("approve");
              }}
            >
              Approve
            </Button>
            <Button
              disabled={isSubmitting}
              onClick={() => {
                void submitDecision("deny");
              }}
              variant="secondary"
            >
              Deny
            </Button>
          </div>
        ) : null}

        {message ? <p className="type-body-medium text-on-surface">{message}</p> : null}
      </div>
    </div>
  );
}
