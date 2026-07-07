"""Run sync resolution and execution for Scout."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TYPE_CHECKING

from atlas_scout.auth import DeviceAuthClient, load_session
from atlas_scout.auth.errors import DeviceAuthError
from atlas_scout.auth_commands import (
    _default_worker_name,
    _load_session_or_exit,
    _search_key_configured,
)
from atlas_scout.cli_common import (
    ScoutSyncError,
    _exit_with_error,
    _print_credential_store_error,
)
from atlas_scout.cli_context import err_console
from atlas_scout.cli_errors import CliError
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.runs.receipt import _print_sync_receipt

if TYPE_CHECKING:
    from atlas_scout.auth import UploadTarget
    from atlas_scout.config import ScoutConfig


def _device_auth_sync_error(exc: DeviceAuthError, *, atlas_url: str) -> CliError:
    """Return a user-facing sync error for Scout login token exchange failures."""
    hint_parts: list[str] = []
    if exc.url:
        hint_parts.append(f"Atlas auth URL: {exc.url}")
    if exc.status_code is not None:
        hint_parts.append(f"HTTP status: {exc.status_code}")
    hint_parts.append(
        f"Run `scout login --atlas-url {atlas_url.rstrip('/')}` again for this environment, "
        "or pass --api-key for automation."
    )
    return CliError(
        title="Sync failed",
        message="Could not exchange your Scout login for an Atlas API token.",
        hint=" ".join(hint_parts),
    )


def _should_sync_after_run(
    config: ScoutConfig,
    *,
    result_artifacts_available: bool,
    sync_after_run: bool | None,
) -> bool:
    """Return whether a completed run should be synced automatically."""
    if sync_after_run is False:
        return False
    if not result_artifacts_available:
        if sync_after_run is True:
            err_console.print(
                "[yellow]Sync skipped:[/] this run did not produce canonical Atlas artifacts."
            )
        return False
    if sync_after_run is True:
        return True
    if config.contribution.enabled:
        return False
    try:
        return load_session() is not None
    except CredentialStoreError as exc:
        _print_credential_store_error(exc)
        return False


async def _resolve_sync_run_ids(
    config: ScoutConfig,
    *,
    run_ids: tuple[str, ...],
    all_ready: bool,
) -> list[str]:
    """Resolve top-level sync selectors into concrete local run IDs."""
    if all_ready and run_ids:
        raise ScoutSyncError("Use either explicit run ids or --all-ready, not both.")
    if run_ids and run_ids != ("latest",) and not all_ready:
        return list(run_ids)

    from atlas_scout.store import ScoutStore

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        limit = None if all_ready else 1
        resolved = await store.list_syncable_run_ids(limit=limit)
    finally:
        await store.close()

    if not resolved:
        raise ScoutSyncError("No completed runs with ready artifacts.")
    return resolved


async def _sync_runs(
    config: ScoutConfig,
    run_ids: tuple[str, ...],
    *,
    all_ready: bool,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None,
    workspace: str | None,
) -> None:
    """Sync one or more local runs to Atlas."""
    try:
        resolved_run_ids = await _resolve_sync_run_ids(
            config,
            run_ids=run_ids,
            all_ready=all_ready,
        )
        for run_id in resolved_run_ids:
            await _runs_sync(
                config,
                run_id,
                atlas_url=atlas_url,
                api_key=api_key,
                target=target,
                workspace=workspace,
            )
    except ScoutSyncError as exc:
        _exit_with_error(CliError(title="Sync failed", message=str(exc)))


async def _runs_sync(
    config: ScoutConfig,
    run_id: str,
    *,
    atlas_url: str | None,
    api_key: str | None,
    target: UploadTarget | None = None,
    workspace: str | None = None,
) -> None:
    """Load a local run bundle and sync it to Atlas."""
    from atlas_scout.steps.contribute import sync_run_artifacts
    from atlas_scout.store import ScoutStore

    session = None
    resolved_api_key = api_key or config.contribution.api_key
    if not resolved_api_key:
        session = _load_session_or_exit()

    resolved_atlas_url = atlas_url or config.contribution.atlas_url
    if session is not None:
        resolved_atlas_url = atlas_url or session.atlas_url or config.contribution.atlas_url

    if not resolved_atlas_url:
        err_console.print(
            "[red]Atlas URL required:[/] set contribution.atlas_url or pass --atlas-url."
        )
        sys.exit(1)
    if not resolved_api_key and session is None:
        err_console.print(
            "[red]Authentication required:[/] Log in with `scout login` or pass --api-key."
        )
        sys.exit(1)

    resolved_target = target or (session.default_upload_target if session else None)
    resolved_workspace = workspace or (session.workspace_id if session else None)
    if session is not None and resolved_target is None:
        resolved_target = "public"
    if resolved_target == "public":
        resolved_workspace = None
    if session is not None and resolved_target == "workspace" and not resolved_workspace:
        err_console.print(
            "[red]Workspace required:[/] pass --workspace for workspace-private sync."
        )
        sys.exit(1)

    store = ScoutStore(str(Path(config.store.path).expanduser()))
    await store.initialize()
    try:
        try:
            await store.get_run(run_id)
        except KeyError:
            err_console.print(f"[red]Run not found:[/] {run_id}")
            sys.exit(1)

        artifacts = await store.get_run_artifacts(run_id)
        if artifacts is None:
            err_console.print(f"[red]Run artifacts missing:[/] {run_id}")
            sys.exit(1)

        await store.update_run_sync(run_id, sync_status="syncing")
        if session is not None:
            if resolved_target is None:
                raise ScoutSyncError("Upload target was not resolved for logged-in sync.")
            session_target: UploadTarget = resolved_target
            try:
                token_exchange = await DeviceAuthClient().exchange_session_for_api_token(
                    resolved_atlas_url,
                    session_token=session.access_token,
                    worker_id=session.worker_id,
                    worker_name=session.worker_name or _default_worker_name(),
                    default_upload_target=session_target,
                    workspace_id=resolved_workspace,
                    search_key_configured=_search_key_configured(),
                )
            except DeviceAuthError as exc:
                await store.update_run_sync(
                    run_id,
                    sync_status="failed",
                    last_error=str(exc),
                )
                _exit_with_error(_device_auth_sync_error(exc, atlas_url=resolved_atlas_url))
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key="",
                bearer_token=token_exchange.token,
                target=resolved_target,
                workspace_id=resolved_workspace,
            )
        else:
            result = await sync_run_artifacts(
                artifacts,
                atlas_url=resolved_atlas_url,
                api_key=resolved_api_key,
            )
        if result.errors:
            sync_error = "; ".join(result.errors)
            await store.update_run_sync(
                run_id,
                sync_status="failed",
                last_error=sync_error,
            )
            _exit_with_error(CliError(title="Sync failed", message=sync_error))

        await store.update_run_sync(
            run_id,
            sync_status=result.sync_status or "synced",
            remote_run_id=result.run_id,
        )
    finally:
        await store.close()

    _print_sync_receipt(
        local_run_id=run_id,
        atlas_url=resolved_atlas_url,
        result=result,
    )
