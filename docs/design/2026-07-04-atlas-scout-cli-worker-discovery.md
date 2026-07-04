# Atlas Scout CLI Worker Auth And Discovery Spec

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
  enrolls the current machine as a revocable Scout worker.
- The enrolled worker can process Atlas jobs with the host device, similar in
  spirit to SETI@home: Atlas queues work; trusted local workers claim, process,
  and return source-linked artifacts.
- Public worker mode uses local model providers only. Atlas does not send paid
  vendor model credentials to volunteer machines.
- Search API keys are optional but strongly recommended. Workers with a search
  key can claim exploratory discovery jobs; workers without one can claim
  seeded, direct-URL, or evidence-packet jobs.
- Upload destination is explicit. On first upload or sync, Scout asks whether
  results go to the Atlas public contribution queue or to the active workspace,
  remembers the answer, and supports `--target public|workspace` for scripts.
- Public uploads never publish directly. They are staged for review with source
  packets, confidence data, dedup signals, and contributor attribution.
- Workspace uploads import into the user's selected workspace as private
  resources. Publishing to a workspace public directory remains a separate,
  reviewed, source-gated action.

## CLI Experience

### Auth Commands

```bash
scout login [--atlas-url https://atlas.rebuildingus.org] [--no-browser]
scout auth status
scout whoami
scout logout
```

`scout login` requests a device code from the Atlas app auth server, opens the
browser when possible, and prints a fallback URL plus code. After browser
approval, Scout exchanges the approved device session for a narrow worker
credential and stores it in the OS credential store.

`scout auth status` shows the signed-in account, worker name, Atlas URL,
workspace destination preference, search capability, local model provider, and
last successful heartbeat. It must not print raw secrets.

`scout logout` revokes the worker credential in Atlas and removes local secrets.
If Atlas is unreachable, Scout removes the local credential and records that
remote revocation is still needed.

### Search Key Commands

```bash
scout search-key set
scout search-key status
scout search-key delete
```

The search key is stored separately from the Atlas worker credential. Scout
shows whether search-backed discovery is available and warns when no search key
is configured, but it still permits seeded/direct-URL work.

### Worker Commands

```bash
scout worker start [--concurrency N]
scout worker status
scout worker stop
```

`scout worker start` registers current capabilities, heartbeats while running,
claims compatible jobs, executes them with the local Scout pipeline, and returns
canonical discovery artifacts. In public worker mode it refuses non-local model
providers.

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

If `--target` is omitted and no preference exists, Scout prompts once:

- Public contribution queue: send source-backed artifacts to Atlas review.
- Workspace private import: save artifacts to the selected workspace.

Scout remembers the destination in the active profile settings. Scripts can pass
the explicit flag and bypass prompting.

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
against product API-key limits, are named by device, and are revocable from both
CLI and account settings.

Local storage must prefer the OS credential store. A plaintext token file is
allowed only with an explicit CLI flag and a clear warning. Config files may
store non-secret values such as Atlas URL, worker id, destination preference,
and profile name.

## Discovery Worker Contract

Atlas owns durable job state. Scout owns local execution. The API should expose
worker-specific endpoints rather than making volunteer workers use internal
database access.

Required worker operations:

- Register or refresh worker capabilities.
- Claim one compatible job with a lease.
- Send heartbeat and progress updates before the lease expires.
- Complete a job with canonical artifacts.
- Fail a job with retryable/non-retryable error metadata.
- Revoke a worker and release outstanding leases.

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
- `scout logout` revokes the worker credential.
- Legacy API-key sync still works.
