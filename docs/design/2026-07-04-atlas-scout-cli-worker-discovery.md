# Atlas Scout CLI Auth And Discovery Spec

**Date:** 2026-07-04
**Status:** Draft
**Owner:** Rebuilding America Project

## Purpose

Scout is the Atlas command-line bridge between Atlas and a user's computer. It
must feel like a professional CLI, not a script that expects users to copy API
keys before anything works. The end-user outcome is more trustworthy civic
coverage: people can lend local compute to Atlas, run research for their own
workspace, or contribute source-backed discoveries to the public database
without blurring privacy, provenance, or publication boundaries.

Scout still supports API keys for automation, CI, headless servers, and scripted
deployments. API keys are not the turnkey path for normal developers or public
volunteers.

## Product Decisions

- Public Scout users sign in with normal free Atlas accounts.
- `scout login` uses browser-based device authorization, prints a user code, and
  authorizes Scout-initiated discovery and sync workflows from the current
  machine. The same browser-approved device session can also back optional
  worker mode.
- Scout-initiated workflows are the primary CLI value: a user runs discovery
  locally, reviews the terminal receipt, and syncs source-backed artifacts to
  Atlas public review or a private workspace. Background worker mode is
  secondary: Atlas queues work; trusted local workers claim, process, and return
  source-linked artifacts.
- Public worker mode uses local model providers only. Atlas does not send paid
  vendor model credentials to volunteer machines.
- Search API keys are optional but strongly recommended. Users with a search
  key can run search-backed discovery; users without one can still run direct
  URL discovery. Workers with a search key can claim exploratory discovery
  jobs; workers without one can claim seeded, direct-URL, or evidence-packet
  jobs.
- Upload destination is turnkey by default. `scout login` remembers public
  uploads unless the user explicitly selects a workspace with
  `--target workspace` or `--workspace`; scripts can still pass
  `--target public|workspace`.
- Public uploads never publish directly. They are staged for review with source
  packets, confidence data, dedup signals, and contributor attribution.
- Workspace uploads import into the user's selected workspace as private
  resources. Publishing to a workspace public directory remains a separate,
  reviewed, source-gated action.

## CLI Experience

### Primary Scout-Initiated Path

The first-run path is discovery-first:

```bash
scout setup
scout login
scout doctor
scout run https://example.org
scout sync
```

`scout setup` is the low-decision onboarding command. It signs the user in when
needed, checks local model readiness, saves a working detected model when one
is available, and points to `scout doctor` for a read-only readiness check.
If no local model is ready, setup keeps the successful sign-in and offers
concrete next steps for Ollama and LM Studio. Users can still run the steps
individually, but they should not have to know those pieces before trying Scout.

`scout doctor` is the readiness checkpoint between login and work. Its default
view answers whether this computer can run direct URL discovery, search-backed
discovery, and Atlas sync. Worker readiness is opt-in with
`scout doctor --worker` so passive background contribution does not obscure the
Scout-initiated workflow.

Local model setup is automatic in normal use. If the active profile points at a
broken or missing local provider, `scout run` probes Ollama and LM Studio,
chooses a usable detected model when there is one clear best choice, saves that
choice to the active profile, and continues. Users only need the explicit
repair command when Scout cannot find a working local model:

```bash
scout config llm
```

`scout config llm` detects Ollama at `http://localhost:11434` and LM Studio at
`http://localhost:1234/v1`, lists available models in interactive mode, and
writes non-secret provider/model/base URL settings to the active profile.
Scout never silently installs model software, starts daemons, runs `sudo`, or
stores LM Studio API tokens in setup or configuration flows.

### Install And Update

Repo setup and Scout product setup are separate. `pnpm setup` prepares the
Atlas checkout for local development; it must not sign a user into Atlas,
configure a local model, or mutate Scout product state. Scout product onboarding
starts at `scout setup` or `scout-dev setup`.

During local development, install the current checkout as the `scout` command
with editable local libraries:

```bash
uv tool install --reinstall --editable ./scout \
  --with-editable ./libs/shared \
  --with-editable ./libs/discovery-engine
```

Verify the packaged command path without touching the real Scout config:

```bash
sh scripts/smoke-scout-install.sh
```

The smoke check installs Scout into a temporary virtualenv, runs the installed
`scout` executable, exercises `search-key` and `worker` command surfaces, checks
that search keys avoid plaintext file storage, and confirms worker startup
fails clearly before login.

For day-to-day local Atlas development, install the managed `scout-dev` command:

```bash
./install-scout-dev.sh
scout-dev setup
```

Plain `scout` is production-first: if no `--atlas-url` is passed, `scout login`
uses `https://atlas.rebuildingus.org` even when a local Atlas app is running.
Local development must go through `scout-dev` or an explicit `--atlas-url`.

`scout-dev` forwards to the installed `scout` command and injects
`--atlas-url https://atlas.localhost` for the Scout commands that support it:
`setup`, `login`, `worker start`, `worker run-internal`, `sync`, and
`runs sync`.
For Portless HTTPS aliases, it also exports `SSL_CERT_FILE` to
`~/.portless/ca.pem` when that file exists and no `SSL_CERT_FILE` override is
already set. Use `PORTLESS_CA_FILE` when the Portless CA lives somewhere else.
Explicit `--atlas-url` still wins. Acceptance tests or alternate local stacks
can bake a different default into the wrapper:

```bash
./install-scout-dev.sh --atlas-url https://atlas.localhost
SCOUT_DEV_ATLAS_URL=https://atlas.localhost scout-dev login --no-browser
PORTLESS_CA_FILE=/path/to/portless-ca.pem scout-dev login --no-browser
```

Remove the managed wrapper with:

```bash
./uninstall-scout-dev.sh
```

The uninstaller refuses to delete an unmanaged `scout-dev` command unless
`--force` is passed, so local shell aliases or hand-written wrappers are not
removed by accident.

The app acceptance suite also covers the real installed `scout` command against
the running app and API: browser-approved login, account device visibility, API
token exchange, direct-URL job queueing, `scout worker start`, worker sync, job
completion, and the resulting remote run receipt.

### Auth Commands

```bash
scout setup [--atlas-url https://atlas.rebuildingus.org] [--no-browser]
scout login [--atlas-url https://atlas.rebuildingus.org] [--no-browser]
scout doctor [--worker] [--json]
scout config llm [--interactive] [--provider ollama|lmstudio] [--model MODEL] [--base-url URL]
scout auth status
scout whoami
scout logout
```

`scout login` requests a device code from Atlas's `/device/code` endpoint,
prints the plain verification URI plus user code, and renders a QR/browser
shortcut when Atlas returns `verification_uri_complete`. The complete URI is
never printed as terminal text; users who cannot scan the QR code still get the
short approval URL and the code separately. If Atlas omits
`verification_uri_complete`, Scout continues with the plain approval URL. If
Atlas omits the polling interval, Scout uses RFC 8628's five-second default.
After browser approval, Scout exchanges the approved device session for a narrow
API token, enrolls the current host as a named Scout device, and stores the
browser-approved session token in the OS credential store.

The browser approval page follows the RFC 8628 user-interaction shape:

- `/device` accepts a typed code or a prepopulated `user_code` from the complete
  URI shortcut.
- Prepopulated codes are shown for confirmation; the page does not approve on
  load.
- The user can approve or deny the request without a second confirmation step.
- Approval redirects to `/device/approved`; denial redirects to a denied result
  state; failed verification redirects to a failed result state.
- Code input is normalized for user mistakes: lowercase, spaces, dashes, and
  other punctuation do not invalidate an otherwise correct code.

Scout polling handles `authorization_pending`, `slow_down`, `access_denied`,
and `expired_token`. Transient auth transport failures back off before retrying
instead of dumping raw HTTP or HTML content into the terminal. Unsupported
optional RFC 8628 alternatives, including Bluetooth, NFC, audio code
transmission, and companion-app handoff, are intentionally out of scope for the
v1 browser-based Scout flow.

`scout auth status` shows the signed-in account, worker name, worker id, Atlas
URL, workspace destination preference, and workspace id. It must not print raw
secrets.

`scout logout` removes the local browser-approved session. Remote device
revocation is exposed from the Atlas account page so a user can see and revoke
specific host computers.

### Doctor Command

```bash
scout doctor
scout doctor --worker
scout doctor --json
```

`scout doctor` is read-only. It does not create device codes, exchange tokens,
start workers, write config, or mutate Atlas state. It groups checks for
credential storage, Atlas account, Atlas reachability, configured model, search
key, local data path, and sync readiness. The default capability summary is
Scout-initiated: direct URL runs, search discovery, and Atlas sync. Missing
search keys are warnings, not failures, because direct URL discovery still
works.

`scout doctor --worker` adds passive worker readiness: local worker state,
local-provider requirement, seeded worker jobs, and search worker jobs. This
keeps worker mode available without making it the onboarding front door.

`scout doctor --json` emits stable machine-readable check and capability
results for tests and automation. Doctor output must never include secrets, raw
HTTP bodies, exception reprs, HTML error pages, or full credential values.

### Local Model Setup

Scout supports Ollama and LM Studio as first-class local model providers.
Ollama uses the native `/api/chat` and `/api/tags` endpoints. LM Studio uses
the OpenAI-compatible `/v1/chat/completions` and `/v1/models` endpoints.

Normal discovery commands resolve local model settings before work starts:

- If the configured local provider and model are reachable, Scout uses them.
- If the configured provider is broken but another local provider is ready,
  Scout saves the detected provider/model/base URL and continues.
- If no local model is ready, Scout stops before discovery and gives one next
  action: start Ollama, start LM Studio's server, download a model, or provide
  an LM Studio API token if that server requires one.

`scout config llm` exposes the same resolver as a direct repair command. Default
mode makes the best safe choice automatically. `--interactive` shows detected
provider/model choices for users who want to override the automatic selection.
`--provider`, `--model`, and `--base-url` support scripted setup. `scout doctor`
continues to be read-only and recommends `scout config llm` only when setup can
fix the configured local model state.

### Search Key Commands

```bash
scout search-key set
scout search-key status
scout search-key delete
```

The search key is stored separately from the Atlas worker credential in the OS
credential store. `SEARCH_API_KEY` still works and takes precedence as an
ephemeral override. Scout shows whether search-backed discovery is available and
warns when no search key is configured, but it still permits seeded/direct-URL
work.

### Optional Worker Commands

```bash
scout worker start [--atlas-url URL] [--search-api-key KEY] [--interval 10] [--lease-seconds 900]
scout worker status
scout worker stop
```

`scout worker start` resolves local model settings before launch, registers
current capabilities, heartbeats while running, claims compatible jobs, executes
them with the local Scout pipeline, and returns canonical discovery artifacts.
`scout worker status` reads a local state file with PID, mode, Atlas URL,
search-key readiness, current job id, last completed job id, heartbeat, and last
error. In public worker mode it should refuse non-local model providers before
the public launch gate.

### Upload Commands

```bash
scout run --location "Austin, TX" --issues housing_affordability --search-api-key "$SEARCH_API_KEY"
scout run --no-sync ...
scout sync [latest|RUN_ID...] [--all-ready] [--target public|workspace] [--workspace ORG_ID]
scout runs sync RUN_ID [--target public|workspace] [--workspace ORG_ID]
```

For logged-in users, `scout run` auto-syncs completed runs that produced
canonical Atlas artifacts. `--no-sync` disables that behavior. API-key
contribution mode remains explicit and does not duplicate the logged-in
auto-sync path.

`scout sync` is the primary turnkey command:

- No run id, or `latest`, syncs the newest completed local run with ready
  artifacts.
- Explicit run ids sync those local runs.
- `--all-ready` syncs every completed local run with ready artifacts.
- `scout runs sync RUN_ID` remains a stable explicit alias for scripts and
  existing operators.

If `--target` is omitted and no preference exists, Scout uses the public
contribution queue and sends source-backed artifacts to Atlas review. Workspace
private import is explicit: pass `--target workspace --workspace ORG_ID`, or use
a session that already remembers a workspace destination.

Scout remembers the destination in the active profile settings. Scripts can pass
the explicit flag and bypass the default.

Every sync prints a receipt with the remote Atlas run id, a web URL to
`/discovery?run=<remote_run_id>`, and entry receipts. Entry receipts include the
Atlas entry id, name, type, profile slug when available, visibility, and URL
when there is a public profile. Visibility is one of:

- `public`: a public profile is available.
- `existing_shared`: the synced artifact matched an already-visible public
  entry.
- `workspace_private`: the entry is private to the selected workspace.
- `held_for_review`: the entry was persisted but is not publicly visible.

## Auth And Credential Model

Atlas app auth remains the identity provider. The FastAPI service remains the
protected resource API. Scout auth bridges those surfaces through a worker
credential rather than asking users to create general-purpose API keys.

1. Scout calls the Better Auth device authorization endpoint.
2. The browser approval page requires a normal Atlas session.
3. The approval page shows the machine name, platform, requested worker scopes,
   local model requirement, optional search capability, and destination choices.
4. After approval, Scout exchanges the device session for a Scout worker
   credential.
5. The worker credential carries only the permissions needed for worker job
   claim, heartbeat, artifact return, and selected upload destination.
6. Atlas records worker id, user id, user email, active workspace when selected,
   scopes, capability metadata, created time, last seen time, and revoked time.

Worker credentials are separate from user-created API keys. They do not count
against product API-key limits, are named by device, and are revocable from
account settings.

Local storage must use the OS credential store for browser-approved session
tokens and search keys. Plaintext token and search-key files are not supported
for public launch. Config files may store non-secret values such as Atlas URL,
worker id, destination preference, and profile name.

## Discovery Worker Contract

Atlas owns durable job state. Scout owns local execution. The API should expose
worker-specific endpoints rather than making volunteer workers use internal
database access.

Implemented worker operations:

- `POST /api/discovery-runs/jobs/claim` claims the oldest queued job with a
  lease and returns the run target context. Scout sends search capability so
  workers without search keys do not receive normal exploratory discovery jobs.
- `POST /api/discovery-runs/jobs/{job_id}/heartbeat` renews the current worker's
  lease and stores progress.
- `POST /api/discovery-runs/jobs/{job_id}/complete` marks the current worker's
  leased job complete after Scout syncs canonical artifacts.
- `POST /api/discovery-runs/jobs/{job_id}/fail` reports retryable or
  non-retryable worker failures. Retryable failures requeue with backoff;
  non-retryable failures dead-letter the job.
- `POST /api/discovery-runs/jobs/workers/{worker_id}/release` releases claimed
  or running jobs for a revoked Scout worker.
- Account settings list enrolled Scout devices with worker name, last seen,
  default upload target, search capability, and a revoke action. Token exchange
  rejects a revoked worker id before minting a fresh API token, and account
  revoke asks the API to release active leases for that worker.

Still required before widening public worker enrollment:

- Rich job-mode metadata for seeded/direct-URL/evidence-packet jobs so the API
  can match more than the current search/no-search boundary.
- Release certification must verify that the deployed default Atlas URL serves
  `/device/code` and `/device/token`; the CLI reports the concrete HTTP status
  and endpoint when those routes are missing or empty.

Job compatibility is based on capability metadata:

- Local model provider and model name.
- Search key present or absent.
- Max concurrency and rough resource limits.
- Supported job modes: full discovery, seeded/direct-URL discovery, artifact
  upload, and evidence packet extraction.

Workers without search keys must not receive exploratory query-generation jobs.
They can process jobs where Atlas already has source URLs or seed pages.

## Upload Destination Semantics

### Public Contribution Queue

Public uploads create or update staged discovery artifacts and review items.
They do not set public catalog visibility by themselves.

The review item must retain:

- Contributor user id and email.
- Worker id and local run id.
- Upload target: `public`.
- Source receipts and artifact hash.
- Ranked entries, scores, dedup notes, and extraction provenance.
- Hold reason describing why review is required.
- Sync response entry receipts with `held_for_review` unless the artifact
  matched an already-public record.

The public catalog changes only after review rules approve the staged artifact.
Person records and uncorroborated web claims remain review-gated.

### Workspace Private Import

Workspace uploads create private workspace-owned discovery runs and resources.
They should use existing ownership visibility semantics: imported records start
private, and workspace publication remains a separate source-gated action.

The import must retain:

- Workspace id.
- Requesting user id and email.
- Worker id and local run id.
- Upload target: `workspace`.
- Source receipts and artifact hash.
- Mapping from local run artifacts to remote workspace resources.
- Sync response entry receipts with `workspace_private` unless the artifact
  matched an already-public shared record.

The web app accepts `/discovery?run=<remote_run_id>` and highlights the matching
research run in Recent research. This is the receipt surface for workspace
private syncs and review-held public uploads, because those entries may not have
public profile URLs.

## API-Key Compatibility

Existing API-key sync remains supported for automation:

```bash
scout runs sync RUN_ID --api-key "$ATLAS_API_KEY"
```

API-key requests continue through the existing introspection path, but API-key
metadata must store the real user email for attribution. API keys should not be
presented as the normal setup path in Scout docs or first-run UX.

## Safety And Trust

Scout exists to improve Atlas's public civic discovery experience. It must not
make it easier to publish unsupported claims about real people.

- Public worker output is never a direct publish path.
- Every uploaded artifact preserves source URLs and extraction context.
- The API rejects uploads without a destination.
- Atlas records the actor and worker behind each upload.
- Person records, sensitive claims, and uncorroborated web-only claims remain
  held for review.
- Workspace-private imports must never leak private notes, workspace-only
  artifacts, or unpublished records into public routes.

## Launch Acceptance

- A first-time user can install Scout, run `scout login`, approve in the
  browser, and see `scout auth status` without creating an API key.
- The same user can open account settings and see the enrolled Scout host with
  last-seen, upload target, search capability, and a revoke action.
- The same user can run `scout search-key set`, `scout search-key status`, and
  `scout worker start/status/stop` without creating a general API key.
- A logged-in user can run local discovery with canonical location/state
  metadata and sync it to either the public contribution queue or their
  workspace.
- A logged-in user can run `scout sync`, `scout sync latest`, or
  `scout sync --all-ready` and receive remote run and entry visibility receipts.
- A synced run URL opens the workspace discovery page with the run highlighted.
- A logged-in worker with a local model and no search key can claim seeded jobs.
- A logged-in worker with a local model and search key can claim full discovery
  jobs.
- Public uploads create review-gated artifacts and do not publish records.
- Workspace uploads create private workspace resources.
- `scout logout` removes local credentials without calling a non-standard
  device-flow revoke endpoint.
- Legacy API-key sync still works.
