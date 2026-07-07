"""Shared helpers for Scout command modules."""

from __future__ import annotations

import asyncio
import sys
from typing import TYPE_CHECKING, NoReturn

import click

from atlas_scout.cli_context import err_console
from atlas_scout.cli_errors import CliError
from atlas_scout.cli_output import print_cli_error

if TYPE_CHECKING:
    from collections.abc import Coroutine
    from typing import Any

    from atlas_scout.config import ConfigMutationError
    from atlas_scout.credentials import CredentialStoreError


class ScoutSyncError(RuntimeError):
    """Raised when a local run cannot be synced to Atlas."""


def _run_async[AsyncResult](coro: Coroutine[Any, Any, AsyncResult]) -> AsyncResult:
    """Run an async command through Scout's shared interrupt boundary."""
    try:
        return asyncio.run(coro)
    except KeyboardInterrupt as exc:
        raise click.Abort from exc


def _exit_with_error(error: CliError) -> NoReturn:
    """Render a structured CLI error to stderr and stop command execution."""
    print_cli_error(err_console, error)
    sys.exit(error.exit_code)


def _credential_store_cli_error(exc: CredentialStoreError) -> CliError:
    """Return a structured credential-storage error."""
    return CliError(title="Credential storage error", message=str(exc))


def _config_mutation_cli_error(exc: ConfigMutationError) -> CliError:
    """Return a structured config mutation error."""
    return CliError(title=exc.title, message=exc.message, hint=exc.hint)


def _print_credential_store_error(exc: CredentialStoreError) -> None:
    """Render a credential-store error without exposing secret values."""
    print_cli_error(err_console, _credential_store_cli_error(exc))
