import { useState } from "react";
import { parseSamlIdpMetadata } from "../../saml-metadata-parser";
import { Button } from "@/platform/ui/button";
import { Textarea } from "@/platform/ui/textarea";

interface SamlMetadataPasteFieldProps {
  onPrefill: (metadata: { certificate: string; entryPoint: string; issuer: string }) => void;
}

/**
 * Optional XML-paste shortcut that lifts issuer, sign-in URL, and signing
 * certificate out of an IdP metadata document so admins do not have to
 * extract those three fields by hand.  The textarea is collapsed by default
 * inside an Advanced disclosure to keep the form clean for IdPs that only
 * surface those values via copy/paste.
 *
 * @param props.onPrefill - Called with the parsed values so the parent
 *   form can apply them to its own state.
 */
export function SamlMetadataPasteField({ onPrefill }: SamlMetadataPasteFieldProps) {
  const [xml, setXml] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function applyPaste() {
    const result = parseSamlIdpMetadata(xml);
    if (!result.ok) {
      setStatus({ ok: false, message: result.error });
      return;
    }
    onPrefill(result.metadata);
    const filled: string[] = [];
    if (result.metadata.issuer) filled.push("issuer");
    if (result.metadata.entryPoint) filled.push("sign-in URL");
    if (result.metadata.certificate) filled.push("certificate");
    setStatus({
      ok: true,
      message: `Filled ${filled.join(", ") || "no fields"} from the pasted metadata. Review the values before saving.`,
    });
  }

  return (
    <div className="border-outline-variant bg-surface-container-lowest space-y-2 rounded-2xl border p-4">
      <div className="space-y-1">
        <p className="type-label-medium text-on-surface">Paste IdP metadata XML (recommended)</p>
        <p className="type-body-small text-outline">
          Atlas pulls the issuer, sign-in URL, and signing certificate out of the metadata so you
          don't have to copy three fields by hand.
        </p>
      </div>
      <Textarea
        label="IdP metadata XML"
        rows={10}
        autoExpand
        maxRows={32}
        value={xml}
        onChange={setXml}
        placeholder='<EntityDescriptor entityID="..."> ... </EntityDescriptor>'
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={applyPaste} disabled={!xml.trim()}>
          Prefill from metadata
        </Button>
        {status ? (
          <p className={status.ok ? "type-body-small text-outline" : "type-body-small text-error"}>
            {status.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
