export interface OAuthClientInfo {
  name: string;
  icon?: string;
  uri?: string;
}

interface OAuthClientSummaryProps {
  clientInfo: OAuthClientInfo | null;
  redirectHostname: string | null;
}

/**
 * Header block for the OAuth consent card.  Renders the application
 * icon, client name, and "X is requesting access" copy with the eventual
 * redirect host.
 */
export function OAuthClientSummary({ clientInfo, redirectHostname }: OAuthClientSummaryProps) {
  const clientName = clientInfo?.name ?? "Unknown app";

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
