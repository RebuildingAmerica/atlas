"""Authentication and search credential commands for Scout."""

from __future__ import annotations

import asyncio
import os
import platform
import sys
import time
import webbrowser

import click

from atlas_scout.auth import (
    DeviceAuthClient,
    DeviceAuthError,
    DeviceCode,
    DeviceToken,
    ScoutSession,
    UploadTarget,
    delete_session,
    load_session,
    save_session,
)
from atlas_scout.auth_output import (
    format_device_auth_error,
    format_verification_uri_complete,
    print_login_instructions,
    print_login_success,
)
from atlas_scout.cli_common import (
    _credential_store_cli_error,
    _exit_with_error,
    _print_credential_store_error,
    _run_async,
)
from atlas_scout.cli_context import console
from atlas_scout.cli_errors import CliError
from atlas_scout.credentials import CredentialStoreError
from atlas_scout.login_flow import LoginExecutionError, begin_login, complete_login
from atlas_scout.search_keys import (
    delete_stored_search_api_key,
    has_search_api_key,
    resolve_search_api_key,
    save_search_api_key,
)
from atlas_scout.shared.atlas_urls import DEFAULT_ATLAS_URL


def _default_worker_name() -> str:
    """Return the display name Scout should use for this host device."""
    name = platform.node().strip()
    return name or "Scout worker"


def _search_key_configured() -> bool:
    """Return whether this process has search-backed discovery available."""
    return has_search_api_key()


def _resolve_search_connection(search_api_key: str | None) -> str:
    """Resolve the search credential from an override, environment, or OS storage."""
    try:
        return resolve_search_api_key(search_api_key)
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))


def _search_connection_required_error() -> CliError:
    """Return the standard missing-search-connection error."""
    return CliError(
        title="Search-backed discovery is not connected",
        message="Run `scout search connect`, or set SEARCH_API_KEY for automation.",
    )


def _require_search_connection(search_api_key: str | None) -> str:
    """Resolve a search credential or stop with the standard user-facing guidance."""
    resolved_search_key = _resolve_search_connection(search_api_key)
    if resolved_search_key:
        return resolved_search_key
    _exit_with_error(_search_connection_required_error())
    raise AssertionError("unreachable")


def _login_failure_cli_error(exc: DeviceAuthError) -> CliError:
    """Return a structured Scout login error."""
    return CliError(title="Login failed", message=format_device_auth_error(exc))


def _load_session_or_exit() -> ScoutSession | None:
    """Load the Scout session or exit with a clear credential-store error."""
    try:
        return load_session()
    except CredentialStoreError as exc:
        _print_credential_store_error(exc)
        sys.exit(1)


def _load_session_or_click_exception() -> ScoutSession | None:
    """Load the Scout session or raise a Click error for worker commands."""
    try:
        return load_session()
    except CredentialStoreError as exc:
        raise click.ClickException(f"Credential storage error: {exc}") from exc


async def _poll_device_token(
    client: DeviceAuthClient,
    atlas_url: str,
    code: DeviceCode,
) -> DeviceToken:
    """Poll Atlas until the browser-approved device session is ready."""
    interval = max(code.interval, 1)
    deadline = time.monotonic() + code.expires_in
    while time.monotonic() <= deadline:
        try:
            return await client.request_device_token(atlas_url, device_code=code.device_code)
        except DeviceAuthError as exc:
            if exc.error == "authorization_pending":
                await asyncio.sleep(interval)
                continue
            if exc.error == "slow_down":
                interval += 5
                await asyncio.sleep(interval)
                continue
            if exc.error == "network_error":
                interval *= 2
                await asyncio.sleep(interval)
                continue
            raise
    raise DeviceAuthError(
        error="expired_token",
        description="The device code expired before approval.",
    )


async def _login(
    *,
    atlas_url: str | None,
    target: UploadTarget | None,
    workspace: str | None,
    open_browser: bool,
) -> None:
    """Run Scout's browser-approved login flow."""
    resolved_atlas_url, _ = await _resolve_login_atlas_url(atlas_url)

    client = DeviceAuthClient()
    try:
        pending = await begin_login(
            client=client,
            atlas_url=resolved_atlas_url,
            target=target,
            workspace=workspace,
        )
    except DeviceAuthError as exc:
        _exit_with_error(_login_failure_cli_error(exc))

    print_login_instructions(console, pending.code)
    if open_browser:
        webbrowser.open(format_verification_uri_complete(pending.code))

    worker_name = _default_worker_name()
    try:
        session = await complete_login(
            pending,
            poll_device_token=_poll_device_token,
            worker_name=worker_name,
            search_key_configured=_search_key_configured(),
        )
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    except DeviceAuthError as exc:
        _exit_with_error(_login_failure_cli_error(exc))
    except LoginExecutionError as exc:
        _exit_with_error(CliError(title=exc.title, message=exc.message))

    try:
        save_session(session)
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    print_login_success(console, session.user_email)


async def _resolve_login_atlas_url(atlas_url: str | None) -> tuple[str, bool]:
    """Resolve the Atlas URL for a login command and whether it was auto-detected."""
    if atlas_url:
        return atlas_url.rstrip("/"), False
    return DEFAULT_ATLAS_URL, False


@click.command("login")
@click.option(
    "--atlas-url",
    default=None,
    help=(f"Atlas app URL to authenticate against. Defaults to {DEFAULT_ATLAS_URL}."),
)
@click.option(
    "--target",
    type=click.Choice(["public", "workspace"]),
    default=None,
    help="Default upload destination to remember. Defaults to public unless --workspace is passed.",
)
@click.option("--workspace", default=None, help="Workspace id for workspace-private sync.")
@click.option("--no-browser", is_flag=True, help="Print the approval URL without opening it.")
def login(
    atlas_url: str | None, target: UploadTarget | None, workspace: str | None, no_browser: bool
) -> None:
    """Log in to Atlas from the browser and remember this computer."""
    _run_async(
        _login(
            atlas_url=atlas_url,
            target=target,
            workspace=workspace,
            open_browser=not no_browser,
        )
    )


@click.group("auth")
def auth_group() -> None:
    """Manage Scout authentication."""


@auth_group.command("status")
def auth_status() -> None:
    """Show the current Scout login state."""
    session = _load_session_or_exit()
    if session is None:
        console.print("[yellow]Not logged in.[/]")
        return
    console.print("[bold]Scout auth[/]")
    console.print(f"  Atlas: {session.atlas_url}")
    console.print(f"  User: {session.user_email}")
    console.print(f"  Worker: {session.worker_name or session.worker_id}")
    console.print(f"  Worker id: {session.worker_id}")
    console.print(f"  Upload target: {session.default_upload_target or 'not set'}")
    console.print("  Credential storage: OS credential store")
    if session.workspace_id:
        console.print(f"  Workspace: {session.workspace_id}")


@click.command("whoami")
def whoami() -> None:
    """Show the signed-in Atlas user."""
    session = _load_session_or_exit()
    if session is None:
        console.print("[yellow]Not logged in.[/]")
        return
    console.print(session.user_email)


@click.command("logout")
def logout() -> None:
    """Remove the local Scout login session."""
    try:
        delete_session()
    except CredentialStoreError as exc:
        _exit_with_error(
            CliError(
                title="Logout failed",
                message="Scout could not remove local credentials from the OS credential store.",
                hint=str(exc),
            )
        )
    console.print("[green]Logged out.[/]")


@click.group("search")
def search_group() -> None:
    """Manage search-backed discovery."""


@search_group.command("connect")
@click.option("--key", "search_key", default=None, help="Search provider API key.")
def search_connect(search_key: str | None) -> None:
    """Connect Scout to search-backed discovery."""
    key = search_key or click.prompt("Search provider API key", hide_input=True)
    try:
        save_search_api_key(key)
    except (CredentialStoreError, ValueError) as exc:
        _exit_with_error(CliError(title="Search not connected", message=str(exc)))
    console.print("[green]Search-backed discovery connected.[/]")
    console.print("  Source: OS credential store")


@search_group.command("status")
def search_status() -> None:
    """Show whether Scout can run search-backed discovery."""
    if os.environ.get("SEARCH_API_KEY", "").strip():
        console.print("[green]Search-backed discovery available.[/]")
        console.print("  Source: SEARCH_API_KEY")
        return
    try:
        if has_search_api_key():
            console.print("[green]Search-backed discovery available.[/]")
            console.print("  Source: OS credential store")
            return
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    console.print("[yellow]Search-backed discovery not connected.[/]")
    console.print("  Run `scout search connect`.")


@search_group.command("disconnect")
def search_disconnect() -> None:
    """Disconnect Scout from stored search-backed discovery credentials."""
    try:
        deleted = delete_stored_search_api_key()
    except CredentialStoreError as exc:
        _exit_with_error(_credential_store_cli_error(exc))
    env_key_configured = bool(os.environ.get("SEARCH_API_KEY", "").strip())
    if deleted:
        console.print("[green]Search-backed discovery disconnected.[/]")
        if env_key_configured:
            console.print("  SEARCH_API_KEY is still set for this shell.")
        return
    console.print("[yellow]No stored search connection.[/]")
    if env_key_configured:
        console.print("  SEARCH_API_KEY is still set for this shell.")
