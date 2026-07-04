import { useEffect, useState } from "react";
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
  const [status, setStatus] = useState<DeviceStatusResponse["status"] | "loading" | "missing">(
    userCode ? "loading" : "missing",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!userCode) {
      setStatus("missing");
      return;
    }

    const code = userCode;
    let active = true;

    async function loadDeviceCode() {
      try {
        const params = new URLSearchParams({ user_code: code });
        const response = await fetch(`/api/auth/device?${params.toString()}`, {
          credentials: "include",
        });
        if (!active) return;
        if (!response.ok) {
          setMessage("Device code could not be loaded.");
          return;
        }
        const payload = deviceStatusResponseSchema.parse(await response.json());
        setStatus(payload.status);
      } catch {
        if (active) {
          setMessage("Device code could not be loaded.");
        }
      }
    }

    void loadDeviceCode();

    return () => {
      active = false;
    };
  }, [userCode]);

  async function submitDecision(decision: DeviceDecision) {
    if (!userCode) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch(decisionEndpoint(decision), {
        body: JSON.stringify({ userCode }),
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

  if (status === "missing") {
    return <p className="type-body-large text-on-surface">Device code missing.</p>;
  }

  const isComplete = status === "approved" || status === "denied";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="type-label-medium text-outline">Atlas Scout</p>
        <h1 className="type-display-small text-on-surface">Approve Scout login</h1>
        <p className="type-body-large text-outline">Confirm this code before granting access.</p>
      </div>

      <div className="border-border-strong bg-surface-container-lowest space-y-5 rounded-lg border p-6">
        <div>
          <p className="type-label-small text-outline">Code</p>
          <p className="text-on-surface font-mono text-3xl tracking-normal">{userCode}</p>
        </div>

        {!isComplete ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={isSubmitting || status === "loading"}
              onClick={() => {
                void submitDecision("approve");
              }}
            >
              Approve
            </Button>
            <Button
              disabled={isSubmitting || status === "loading"}
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
