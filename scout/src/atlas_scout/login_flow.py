"""Command-execution helpers for Scout login."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from atlas_scout.auth import (
    DeviceAuthClient,
    DeviceCode,
    DeviceToken,
    ScoutSession,
    UploadTarget,
)

PollDeviceToken = Callable[[DeviceAuthClient, str, DeviceCode], Awaitable[DeviceToken]]


class LoginExecutionError(RuntimeError):
    """Raised when login execution cannot produce a valid Scout session."""

    def __init__(self, *, title: str, message: str) -> None:
        self.title = title
        self.message = message
        super().__init__(f"{title}: {message}")


@dataclass(frozen=True, slots=True)
class PendingLogin:
    """Login state after Atlas returns a browser approval code."""

    client: DeviceAuthClient
    atlas_url: str
    target: UploadTarget
    workspace: str | None
    code: DeviceCode


async def begin_login(
    *,
    client: DeviceAuthClient,
    atlas_url: str,
    target: UploadTarget | None,
    workspace: str | None,
) -> PendingLogin:
    """Start browser-approved login without rendering CLI output."""
    resolved_atlas_url = atlas_url.rstrip("/")
    resolved_target: UploadTarget = target or ("workspace" if workspace else "public")
    code = await client.request_device_code(resolved_atlas_url)
    return PendingLogin(
        client=client,
        atlas_url=resolved_atlas_url,
        target=resolved_target,
        workspace=workspace,
        code=code,
    )


async def complete_login(
    pending: PendingLogin,
    *,
    poll_device_token: PollDeviceToken,
    worker_name: str,
    search_key_configured: bool,
) -> ScoutSession:
    """Finish browser-approved login and return the session to persist."""
    token = await poll_device_token(pending.client, pending.atlas_url, pending.code)
    exchange = await pending.client.exchange_session_for_api_token(
        pending.atlas_url,
        session_token=token.access_token,
        worker_name=worker_name,
        default_upload_target=pending.target,
        workspace_id=pending.workspace,
        search_key_configured=search_key_configured,
    )

    resolved_workspace = pending.workspace or exchange.workspace_id
    if pending.target == "workspace" and not resolved_workspace:
        raise LoginExecutionError(
            title="Workspace required",
            message="pass --workspace for workspace-private sync.",
        )

    return ScoutSession(
        atlas_url=pending.atlas_url,
        access_token=token.access_token,
        worker_id=exchange.worker_id,
        user_id=exchange.user_id,
        user_email=exchange.user_email,
        worker_name=worker_name,
        default_upload_target=pending.target,
        workspace_id=resolved_workspace,
    )
