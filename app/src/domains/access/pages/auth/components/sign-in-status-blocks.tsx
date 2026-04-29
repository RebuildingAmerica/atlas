import { DevMailCaptureBanner } from "../dev-mail-capture-banner";

interface SignInStatusBlocksProps {
  captureMailboxUrl: string | null;
  errorCode: string | undefined;
  errorMessage: string | null;
  oauthOriginSignIn: boolean;
  ssoErrorMessage: string | null;
  statusMessage: string | null;
}

/**
 * Renders the stack of post-submit feedback blocks below the email
 * form: the magic-link status, dev-mail-capture banner, MCP/OAuth
 * origin notice, magic-link error, and SSO failure block with the
 * reference code.  Pulled out so the page module's render reads as a
 * stack of named pieces instead of a long ladder of conditionals.
 */
export function SignInStatusBlocks({
  captureMailboxUrl,
  errorCode,
  errorMessage,
  oauthOriginSignIn,
  ssoErrorMessage,
  statusMessage,
}: SignInStatusBlocksProps) {
  return (
    <>
      {statusMessage ? (
        <p className="type-body-medium bg-surface-container-lowest text-on-surface rounded-2xl px-4 py-3">
          {statusMessage}
        </p>
      ) : null}

      {captureMailboxUrl && statusMessage ? <DevMailCaptureBanner url={captureMailboxUrl} /> : null}

      {oauthOriginSignIn && statusMessage ? (
        <p className="type-body-small text-outline rounded-2xl bg-blue-50 px-4 py-3 text-blue-900">
          Connecting an MCP client? If a sign-in link doesn&rsquo;t arrive within a minute, your
          email may not be approved yet.{" "}
          <a href="/docs/mcp" className="text-accent type-label-small hover:underline">
            See connection requirements &rarr;
          </a>
        </p>
      ) : null}

      {errorMessage ? (
        <p className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {errorCode ? (
        <div className="type-body-medium rounded-2xl bg-red-50 px-4 py-3 text-red-800" role="alert">
          <p>
            {ssoErrorMessage ??
              "Atlas couldn't complete the SSO sign-in.  Try again, or contact your workspace admin if it keeps failing."}
          </p>
          <p className="type-body-small mt-1 text-red-700">
            Reference code: <code>{errorCode}</code>
          </p>
        </div>
      ) : null}
    </>
  );
}
