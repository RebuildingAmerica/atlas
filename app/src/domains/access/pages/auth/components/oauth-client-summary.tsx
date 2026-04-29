import { isUrlShapedClientId } from "../oauth-consent-helpers";

export interface OAuthClientInfo {
  name: string;
  icon?: string;
  uri?: string;
}

interface OAuthClientSummaryProps {
  clientId: string;
  clientInfo: OAuthClientInfo | null;
  redirectHostname: string | null;
}

/**
 * Header block for the OAuth consent card.  Renders the application
 * icon (or initial fallback), the client name + URI, the CIMD client
 * ID line when applicable, and the "X is requesting access" copy with
 * the eventual redirect host.
 */
export function OAuthClientSummary({
  clientId,
  clientInfo,
  redirectHostname,
}: OAuthClientSummaryProps) {
  const clientName = clientInfo?.name ?? "Unknown app";
  const isCimdClient = isUrlShapedClientId(clientId);

  return (
    <>
      <div className="flex items-center gap-4">
        {clientInfo?.icon ? (
          <img src={clientInfo.icon} alt="" className="border-border h-10 w-10 rounded-xl border" />
        ) : (
          <div className="border-border bg-surface-container-lowest text-ink-muted flex h-10 w-10 items-center justify-center rounded-xl border">
            <span className="type-title-small">{clientName.charAt(0).toUpperCase()}</span>
          </div>
        )}
        <div>
          <p className="type-title-medium text-ink-strong">{clientName}</p>
          {clientInfo?.uri ? (
            <p className="type-body-small text-ink-muted">{clientInfo.uri}</p>
          ) : null}
          {isCimdClient ? (
            <p className="type-body-small text-ink-muted break-all">
              Client ID document: {clientId}
            </p>
          ) : null}
        </div>
      </div>

      <p className="type-body-medium text-ink-soft">
        <span className="text-ink-strong font-medium">{clientName}</span> is requesting access to
        your Atlas account.
        {redirectHostname ? (
          <>
            {" "}
            After approval, Atlas will send you back to{" "}
            <span className="text-ink-strong font-medium">{redirectHostname}</span>.
          </>
        ) : null}
      </p>
    </>
  );
}
