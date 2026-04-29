import { useState } from "react";
import { Button } from "@/platform/ui/button";
import { Textarea } from "@/platform/ui/textarea";

interface SamlCertificateRotationFormProps {
  isPending: boolean;
  providerId: string;
  onSubmit: (providerId: string, certificate: string) => Promise<void>;
}

/**
 * Inline rotation form rendered inside the SAML provider card.  Keeping
 * it collapsed by default avoids cluttering the list while still letting
 * an admin update the certificate without losing the verified domain or
 * primary-provider state.
 */
export function SamlCertificateRotationForm({
  isPending,
  providerId,
  onSubmit,
}: SamlCertificateRotationFormProps) {
  const [certificate, setCertificate] = useState("");

  async function handleSubmit() {
    await onSubmit(providerId, certificate);
    setCertificate("");
  }

  return (
    <details className="text-outline space-y-2">
      <summary className="type-label-medium cursor-pointer">Rotate signing certificate</summary>
      <p className="type-body-small text-outline">
        Paste the new PEM-encoded X.509 certificate the IdP just issued. Atlas keeps the existing
        domain verification, primary-provider marker, and SP signing key.
      </p>
      <p className="type-body-small rounded-2xl bg-amber-50 px-3 py-2 text-amber-800">
        Browser sessions started before the rotation stay valid until they expire — Atlas can't
        pre-validate the new certificate against the IdP's published metadata yet, so we recommend
        scheduling rotations during a low-traffic window and re-running the health check immediately
        after.
      </p>
      <Textarea
        label="New X.509 certificate"
        rows={8}
        autoExpand
        maxRows={32}
        value={certificate}
        onChange={setCertificate}
        placeholder="-----BEGIN CERTIFICATE-----"
        className="font-mono text-sm"
      />
      <Button
        type="button"
        variant="secondary"
        disabled={isPending || !certificate.trim()}
        onClick={() => {
          void handleSubmit();
        }}
      >
        Replace certificate
      </Button>
    </details>
  );
}
