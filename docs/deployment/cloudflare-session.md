# Cloudflare deployment credential sessions

Use a session around a trusted deployment command to avoid repeated Keychain
prompts while publishing and verifying the runtime that serves Atlas users:

```sh
ATLAS_CF_PROFILE=atlas pnpm cf:session -- node scripts/deploy/web-candidate.mjs publish
```

Keep the deployment command's existing account, artifact and release arguments.
The session does not deploy anything itself. Provider operations still use the
new `cf` CLI. An existing `CLOUDFLARE_API_TOKEN` passes through without
importing the credential loader or accessing Keychain, even if
`ATLAS_CF_PROFILE` is set. Do not supply credentials in command arguments.

For several deployment and verification commands in one trusted Node process,
create the session once and reuse it. Do not print `session.env` or pass it to
untrusted programs:

```js
import {
  createCloudflareSession,
  runCloudflareSession,
} from "./scripts/deploy/cloudflare-session.mjs";

const session = await createCloudflareSession({ profile: "atlas" });
// Only this expiry metadata is safe to display; never display session.env.
session.expiresAt;
await runCloudflareSession(
  ["node", "scripts/deploy/web-hosting.mjs", "doctor"],
  {
    session,
  },
);
// Reuse the same session for the next authorized deployment or readback.
```

`profile` and optional `accountId` override only those selections; the loader
inherits the module process environment, including PATH and HOME. An explicit
`accountId` must contain 32 hexadecimal characters. Provider commands still
require their existing explicit account configuration.

The bearer stays in process memory and child environments. The wrapper writes no
credential files, adds no bearer arguments, suppresses credential-loader
diagnostics, and redacts the bearer from streamed child stdout and stderr,
including when split across chunks. Session JSON and ordinary inspection omit
the environment. Trusted child programs must also keep credentials out of their
own files, arguments and unrelated output channels. The wrapper leaves Keychain
and its security settings untouched and retains the existing OAuth scopes.

The pinned CLI currently has no supported auth token-export command. The bridge
therefore deliberately depends on **`cf@1.0.0-beta.14`'s private**
`dist/oauth-BUr8bPwo.mjs` exports: `p` selects the named profile and `d` reads
its stored credentials exactly once. The wrapper checks the exact package
version and private export contract and fails closed if they change. Review this
bridge against the installed CLI before changing that dependency. It never calls
`s`, the token getter that can refresh and read/write credentials again.

OAuth sessions require a valid stored bearer and future `expiration_time`.
Expired credentials fail before a child starts. Reused sessions check expiry
before every command, without rereading Keychain. A command already running at
expiry may receive an authentication failure from Cloudflare; it is not retried
or interrupted automatically. Explicit API tokens have no locally available
expiry metadata. There is no automatic refresh, login, retry loop or paid
fallback. Renew authentication explicitly when needed and then create a new
session. This wrapper does not claim that provider validation has passed merely
because local session tests pass.
