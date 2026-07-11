import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/platform/ui/button";
import { useToast } from "@/platform/ui/toast";

export interface DnsRecordMetadata {
  challenge_host?: string;
  challenge_value?: string;
  domain?: string;
}

export interface ClaimDnsRecordPanelProps {
  dnsRecord: DnsRecordMetadata;
  isChecking: boolean;
  onCheck: () => Promise<boolean>;
}

const DNS_CHECK_COOLDOWN_MS = 60_000;
const DNS_COPY_CONFIRMATION_MS = 2_500;

export function ClaimDnsRecordPanel({ dnsRecord, isChecking, onCheck }: ClaimDnsRecordPanelProps) {
  const toast = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isCoolingDown, setIsCoolingDown] = useState(false);

  useEffect(() => {
    if (!isCoolingDown) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setIsCoolingDown(false);
    }, DNS_CHECK_COOLDOWN_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isCoolingDown]);

  useEffect(() => {
    if (!copiedField) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setCopiedField(null);
    }, DNS_COPY_CONFIRMATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copiedField]);

  async function copyDnsValue(label: string, value: string) {
    const ok = await copyToClipboard(value);
    if (!ok) {
      toast.error(`Could not copy ${label}.`);
      return;
    }
    setCopiedField(label);
    toast.success(`${label} copied`);
  }

  async function checkDnsRecord() {
    const didCheck = await onCheck();
    if (didCheck) {
      setIsCoolingDown(true);
    }
  }

  const checkDisabled = isChecking || isCoolingDown;

  return (
    <div className="border-outline-variant bg-surface-container-lowest rounded-lg border p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="type-label-medium text-ink-strong">DNS record</p>
          <p className="type-body-small text-ink-soft max-w-lg">
            Add this TXT record to the organization domain, then check DNS. Updates can take a few
            minutes.
          </p>
        </div>
        <Button
          onClick={() => {
            void checkDnsRecord();
          }}
          disabled={checkDisabled}
          variant="secondary"
        >
          {dnsCheckButtonLabel(isChecking, isCoolingDown)}
        </Button>
      </div>
      {isCoolingDown ? (
        <p className="type-body-small text-ink-soft mt-3" role="status">
          DNS checked. Try again in about a minute.
        </p>
      ) : null}
      <dl className="mt-4 grid gap-3">
        <DnsRecordValue
          label="Host"
          value={dnsRecord.challenge_host}
          copied={copiedField === "Host"}
          onCopy={() => {
            void copyDnsValue("Host", dnsRecord.challenge_host ?? "");
          }}
        />
        <DnsRecordValue
          label="TXT value"
          value={dnsRecord.challenge_value}
          copied={copiedField === "TXT value"}
          onCopy={() => {
            void copyDnsValue("TXT value", dnsRecord.challenge_value ?? "");
          }}
        />
      </dl>
    </div>
  );
}

function dnsCheckButtonLabel(isChecking: boolean, isCoolingDown: boolean): string {
  if (isChecking) {
    return "Checking...";
  }
  return isCoolingDown ? "Check again soon" : "Check DNS";
}

interface DnsRecordValueProps {
  copied: boolean;
  label: string;
  onCopy: () => void;
  value?: string;
}

function DnsRecordValue({ copied, label, onCopy, value }: DnsRecordValueProps) {
  if (!value) {
    return null;
  }
  return (
    <div className="bg-surface-container rounded-lg p-3">
      <dt className="type-label-small text-ink-muted">{label}</dt>
      <dd className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="type-body-small text-ink-strong border-outline-variant bg-surface-container-lowest min-w-0 flex-1 rounded-md border px-2 py-1 break-all">
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="border-outline-variant text-ink-soft hover:text-ink-strong inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border"
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
        >
          {copied ? (
            <Check className="text-on-success-container h-4 w-4" aria-hidden />
          ) : (
            <Copy className="h-4 w-4" aria-hidden />
          )}
        </button>
      </dd>
    </div>
  );
}
