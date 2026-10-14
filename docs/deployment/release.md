# Release process

[Docs](../README.md) > [Deployment](./README.md) > Release process

Atlas's web app, API, and discovery run on Cloudflare Workers. The PDS is a
separate Google-hosted dependency. Use the protected
[Cloudflare publication workflow](./cloudflare-publication.md) for staging,
production, and rollback. A passing build is not proof that source-linked
profiles or existing accounts work on the public site.

## Prepare a release

1. Land the intended commit on `main` and run the checks relevant to the change.
   For workflow changes run `pnpm actionlint`; for app, API, or auth changes run
   their focused tests and hosted acceptance.
2. Use **Deploy Staging** for the appropriate operation and verify the real
   Worker, directory, sign-in, private-route denial, and API/discovery versions.
3. Tag a commit already on `main` as `vYYYY.MM.DD.N` and push the tag. Main
   pushes and tags do not start production deployment automatically.
4. Run **Deploy Production** against that tag. Select `doctor` first, then the
   required publication operation with its completed `source-run-id`. A new web
   release uses `web-candidate`, followed by `promote-web` with the successful
   current production run as `rollback-run-id`.
5. Verify the canonical site after the operation: searchable profiles and source
   links, sign-in and workspace isolation, `/health`, `/openapi.json`, MCP
   challenges, billing controls, and the PDS. Record any failed dependency as
   unresolved rather than calling the release complete.

The initial Cloudflare cutover uses `adopt-web-baseline` once to record the
already-routed Worker. This operation reads Cloudflare and retains the exact
candidate; it does not deploy or switch traffic. Use its successful run as the
rollback source for later `promote-web` operations. The initial cutover itself
has no promotion journal; follow the version-based recovery procedure in the
[publication guide](./cloudflare-publication.md#restore-an-existing-worker-version).

Keep Cloudflare on Free. A quota or hosted-journey failure blocks a new
publication. The PDS remains on Google, and this workflow does not change Google
billing.
