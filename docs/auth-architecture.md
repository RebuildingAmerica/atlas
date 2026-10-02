# Auth Architecture

Atlas uses a split auth architecture where the app server owns identity and the
API server verifies tokens.

## Ownership Boundary

### App (TanStack Start + Better Auth)

The app server is the authority for user identity and session management.

- User accounts, email verification, and passkey registration
- Organization (workspace) CRUD, membership, and invitations
- Session cookies and browser authentication
- JWT and OAuth access token issuance via Better Auth plugins
- API key creation and introspection
- SSO provider configuration (OIDC and SAML)
- Stripe customer creation and checkout session orchestration

### API (FastAPI)

The API server is a resource server that verifies credentials and enforces
access.

- JWT Bearer token verification via JWKS
- API key introspection via HTTP callback to the app
- Organization membership verification via HTTP callback to the app
- Capability resolution from active products
- Role-based and capability-based access control on endpoints

### Internal Bridge

The app exposes private endpoints that the API calls to verify credentials and
membership. The API authenticates those calls with `ATLAS_AUTH_CALLBACK_SECRET`,
passed in the `X-Atlas-Callback-Secret` header, and the app rejects any call
without it. The callback secret does one job and nothing else, so it is separate
from `ATLAS_AUTH_INTERNAL_SECRET`, which the app also uses as Better Auth's
signing secret.

| Endpoint                                                  | Purpose                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/api/auth/internal/memberships/{orgId}/members/{userId}` | Verify org membership, return role, workspace type, and active products |
| `/api/auth/internal/api-key`                              | Introspect an API key, return user, org, and permissions                |

## Token Flow

```
Browser → App (Better Auth session cookie)
  ↓
App issues JWT access token (via OAuth or JWT plugin)
  ↓
Client sends JWT as Bearer token to API
  ↓
API verifies JWT via JWKS → extracts user_id, email, org_id, permissions
  ↓
API calls App membership endpoint → gets role, products, workspace type
  ↓
API resolves capabilities from active products → enforces on endpoint
```

## Auth Methods

| Method             | Primary Use                   | How It Works                                        |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| Passkey (WebAuthn) | Primary sign-in               | Browser-native FIDO2 via Better Auth passkey plugin |
| Magic Link         | Sign-up and fallback sign-in  | Email with time-limited link                        |
| Enterprise SSO     | Org-managed sign-in           | OIDC or SAML via domain discovery                   |
| OAuth Access Token | MCP clients, third-party apps | Better Auth oauthProvider plugin with PKCE          |
| API Key            | Programmatic access           | Better Auth apiKey plugin, introspected by API      |
| Internal Secret    | System callers to the API     | Shared secret in header; never operator authority   |

## Organization Context in Tokens

OAuth access tokens carry `org_id` when the client requests an `org:{org_id}`
scope during authorization. The API reads this from the JWT `org_id` claim and
verifies membership via the internal endpoint.

## Configuration Alignment

Both services must agree on these values:

| Setting         | App (env var)                                | API (env var)                           |
| --------------- | -------------------------------------------- | --------------------------------------- |
| JWT issuer      | `{ATLAS_PUBLIC_URL}/api/auth` (derived)      | `{ATLAS_PUBLIC_URL}/api/auth` (derived) |
| JWT audience    | `ATLAS_AUTH_JWT_AUDIENCES`                   | `ATLAS_AUTH_JWT_AUDIENCES`              |
| JWKS URL        | `{ATLAS_PUBLIC_URL}/api/auth/jwks` (derived) | Auto-derived from issuer                |
| Internal secret | `ATLAS_AUTH_INTERNAL_SECRET`                 | `ATLAS_AUTH_INTERNAL_SECRET`            |
| Callback secret | `ATLAS_AUTH_CALLBACK_SECRET`                 | `ATLAS_AUTH_CALLBACK_SECRET`            |
| Edge origin     | `ATLAS_EDGE_ORIGIN_SECRET`                   | `ATLAS_EDGE_ORIGIN_SECRET`              |

## Shared Secrets

Each shared secret has one job, so a leak or a rotation affects only that job.
Bootstrap generates all three, and the deploy workflows refuse to run without
them.

| Secret                       | App                                                                                    | API                                                                                         | Cloudflare                                             |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `ATLAS_AUTH_INTERNAL_SECRET` | Better Auth's signing secret                                                           | Accepts it in `X-Atlas-Internal-Secret` from system callers such as the discovery scheduler | Not held                                               |
| `ATLAS_AUTH_CALLBACK_SECRET` | Requires it in `X-Atlas-Callback-Secret` on the private membership and API-key routes  | Sends it when calling back into the app                                                     | Not held                                               |
| `ATLAS_EDGE_ORIGIN_SECRET`   | The app proxy sends it in `X-Atlas-Proxy-Secret` to vouch for the visitor's IP address | Trusts `X-Atlas-Client-IP` only when it arrives with this secret                            | The API-domain transform rule sets it on every request |

The app and the API each accept exactly one value for each secret. To change one
without breaking sign-in or rate limiting, follow
[Callback and Edge Origin Secret Rotation](./runbooks/rotate-auth-secrets.md).

The API health check at `GET /api/auth/health` reports the reachability of JWKS
and membership endpoints.
