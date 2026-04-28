/**
 * Parsed values lifted from a SAML 2.0 IdP metadata XML document.  Empty
 * strings indicate the field was not present in the metadata; admins can
 * still fill those manually after using the prefill.
 */
export interface ParsedSamlIdpMetadata {
  certificate: string;
  entryPoint: string;
  issuer: string;
}

/**
 * Outcome of trying to parse pasted SAML metadata XML.
 */
export type SamlMetadataParseResult =
  | { ok: true; metadata: ParsedSamlIdpMetadata }
  | { ok: false; error: string };

const HTTP_REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const HTTP_POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";

/**
 * Wraps a base64 X.509 certificate in PEM headers and inserts line breaks
 * every 64 characters.  Better Auth's SAML config expects PEM-formatted
 * input even when the IdP metadata embeds only the raw base64 bytes.
 *
 * @param base64Body - The base64-encoded DER certificate, without PEM
 *   headers or line breaks.
 */
function wrapCertificateAsPem(base64Body: string): string {
  const trimmed = base64Body.replace(/\s+/g, "");
  if (!trimmed) {
    return "";
  }
  const lines: string[] = [];
  for (let offset = 0; offset < trimmed.length; offset += 64) {
    lines.push(trimmed.slice(offset, offset + 64));
  }
  return ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----"].join("\n");
}

/**
 * Picks the IDP SSO endpoint URL from the parsed metadata, preferring the
 * HTTP-Redirect binding (the most common AuthnRequest form), falling back to
 * HTTP-POST, and finally to the first SingleSignOnService entry.
 *
 * @param document - The parsed metadata XML document.
 */
function selectSingleSignOnLocation(document: Document): string {
  const candidates = Array.from(document.getElementsByTagNameNS("*", "SingleSignOnService"));
  const redirect = candidates.find(
    (node) => node.getAttribute("Binding") === HTTP_REDIRECT_BINDING,
  );
  if (redirect) {
    return redirect.getAttribute("Location") ?? "";
  }
  const post = candidates.find((node) => node.getAttribute("Binding") === HTTP_POST_BINDING);
  if (post) {
    return post.getAttribute("Location") ?? "";
  }
  return candidates[0]?.getAttribute("Location") ?? "";
}

/**
 * Picks the IDP signing certificate from the parsed metadata, preferring a
 * KeyDescriptor with `use="signing"` and falling back to any KeyDescriptor
 * when none is explicitly marked.  Returns the PEM-encoded certificate.
 *
 * @param document - The parsed metadata XML document.
 */
function selectSigningCertificate(document: Document): string {
  const keyDescriptors = Array.from(document.getElementsByTagNameNS("*", "KeyDescriptor"));
  const signingDescriptor =
    keyDescriptors.find((node) => node.getAttribute("use") === "signing") ?? keyDescriptors[0];
  if (!signingDescriptor) {
    return "";
  }
  const certNode = signingDescriptor.getElementsByTagNameNS("*", "X509Certificate")[0];
  if (!certNode?.textContent) {
    return "";
  }
  return wrapCertificateAsPem(certNode.textContent);
}

/**
 * Parses a pasted SAML 2.0 IdP metadata XML document and returns the issuer,
 * single sign-on URL, and signing certificate.  The function is browser-only
 * because it relies on DOMParser; call it from a client component.
 *
 * @param xml - The raw XML string the workspace admin pasted.
 */
export function parseSamlIdpMetadata(xml: string): SamlMetadataParseResult {
  const trimmed = xml.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste the IdP metadata XML to prefill the SAML fields." };
  }

  let document: Document;
  try {
    document = new DOMParser().parseFromString(trimmed, "application/xml");
  } catch {
    return { ok: false, error: "Atlas could not parse that XML. Check that it is well-formed." };
  }

  if (document.getElementsByTagName("parsererror").length > 0) {
    return { ok: false, error: "Atlas could not parse that XML. Check that it is well-formed." };
  }

  const entityDescriptor = document.getElementsByTagNameNS("*", "EntityDescriptor")[0];
  if (!entityDescriptor) {
    return {
      ok: false,
      error: "The pasted XML does not contain an EntityDescriptor element.",
    };
  }

  const issuer = entityDescriptor.getAttribute("entityID") ?? "";
  const entryPoint = selectSingleSignOnLocation(document);
  const certificate = selectSigningCertificate(document);

  if (!issuer && !entryPoint && !certificate) {
    return {
      ok: false,
      error: "The pasted XML does not contain any SAML IdP fields Atlas can use.",
    };
  }

  return {
    ok: true,
    metadata: { certificate, entryPoint, issuer },
  };
}
