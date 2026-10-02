# Internal Apps

[Docs](../README.md) > [Standards](./README.md) > Internal apps

Reference for how an app only Rebuilding America operators use is hosted, gated
and authorized. The Atlas platform admin is the first; any later internal tool
follows the same rules. The one-time setup is in
[Put Cloudflare Access in front of the platform admin](../runbooks/platform-admin-access.md).

The pattern is the one Las Vegans for Better Transit and the personal `wpp`
project already run in production, adapted for an app that also has data to
protect inside it.

## Layers

| Layer         | Decides                                       | Implemented by                                              |
| ------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Gate          | Who may reach the app at all                  | Cloudflare Access with Google Workspace sign-in             |
| Second lock   | That the request really came through the gate | The app verifies `Cf-Access-Jwt-Assertion` on every request |
| Authorization | What that person may do                       | The app's own action policy and audit log                   |

The gate never grants an Atlas permission, and the app never trusts a request
the gate did not sign.

## Hosting

- Internal apps run as Cloudflare Workers on their own host, such as
  `atlas-admin.rebuildingus.org`, with `custom_domain = true`.
- `workers_dev = false` and `preview_urls = false`, so the Worker has no second
  address that skips the gate.
- `run_worker_first` lists every protected path, because static assets are
  served before the Worker runs.
- `invocation_logs = false`, so URLs carrying tokens are not logged.
- Vercel is not used for internal apps: Vercel advises against a proxy in front
  of it, and neither Access nor IAP can front it.
- Deploys use the pinned `cf` CLI (`cf deploy`) from GitHub Actions with a token
  scoped to Workers Scripts Edit and Zone Workers Routes Edit for one account
  and zone.

## The gate

| Setting            | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| Application type   | Self-hosted, one public destination per host, empty path             |
| Identity providers | Google Workspace only; instant authentication on                     |
| Session duration   | 8 hours                                                              |
| Cookies            | Binding cookie, HTTP-only, SameSite=Lax                              |
| App Launcher       | Hidden                                                               |
| Allow policy       | Include each operator email; require the organization's email domain |
| MFA                | Enforced by Google 2-step verification, never an Access rule         |
| Country rules      | None                                                                 |

Provisioning and drift checks run through `pnpm bootstrap --access-gate`
(`scripts/bootstrap/phases/access-gate*.ts`). The phase reads every page of each
list, changes only what differs, and makes no changes on a second run.

## The second lock

`CloudflareAccessVerifier` in
`packages/atlas-access/src/perimeter/cloudflare-access.ts` implements
`PerimeterVerifier`. A request is admitted only when:

- the `Cf-Access-Jwt-Assertion` header is present (the `CF_Authorization` cookie
  is ignored);
- the token has three segments and an `RS256` header with a key id;
- `aud` contains the application's audience tag and `iss` is
  `https://<team>.cloudflareaccess.com`;
- `exp` is in the future and `nbf`, when present, is no more than 60 seconds
  ahead;
- `email` is a valid address (a service token, which has `common_name` and no
  email, is refused);
- the signature verifies against a key the team publishes at
  `/cdn-cgi/access/certs`.

Keys are cached for an hour. A token naming an unknown key refetches at most
once a minute. Any failure refuses the request; the reason is logged server side
and never sent to the caller.

Settings come from two non-secret variables, read at startup:

| Variable                   | Format                        |
| -------------------------- | ----------------------------- |
| `ATLAS_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `ATLAS_ACCESS_AUD`         | 64 hex characters             |

A missing or malformed value stops the app from starting.

## Order of checks in the app

Every request to a protected path runs, in order: the local-development bypass
check, refusal with 503 when the gate is not configured, the verifier, then 403
for anything it refuses. This runs in middleware, never inside individual
routes, so an unauthenticated caller cannot learn which routes exist.

## Local development

The only bypass is a flag in a gitignored `.dev.vars`. It is never keyed on an
empty audience tag (that once left an admin page open for a deploy in another
project) or on the hostname (`wrangler dev` and `cf dev` rewrite it). The app
refuses to start when the bypass is set in a hosted deployment, and a test
asserts it.

## Authorization and audit

The gate's verified email becomes a staff principal. The app maps it to actions
through its own policy, with an explicit allowlist, so removing a person from
the app's configuration takes effect on the next request even inside an Access
session. Every decision that changes data is written to an append-only audit log
before the change runs.

## Removal and recovery

Access re-checks a person only at sign-in, so removal also needs a revoked
session (see the runbook). Recovery never depends on the internal app: rollback,
billing repair and logs are GitHub workflow dispatches, and the database is
reachable from the Neon console. There is no second identity provider and no
fail-open switch.

## Machine callers

A machine never becomes a staff principal. An internal app calling the Atlas API
presents its own signed credential, verified through
`ATLAS_MACHINE_TRUSTED_ISSUERS`, alongside the forwarded gate assertion that
names the person it acts for.
