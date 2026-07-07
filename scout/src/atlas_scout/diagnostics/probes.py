"""Concrete read-only adapters backing Scout doctor's default dependencies."""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, cast

import httpx

from atlas_scout.config import SCOUT_CONFIG_DIR
from atlas_scout.credentials import CredentialStoreError, SystemCredentialStore
from atlas_scout.diagnostics.models import ProbeResult
from atlas_scout.local_models import is_local_provider, probe_local_model, provider_label

if TYPE_CHECKING:
    from atlas_scout.config import ScoutConfig
    from atlas_scout.local_models import LocalProviderName

WORKER_STATE_PATH = SCOUT_CONFIG_DIR / "worker.json"
DOCTOR_CREDENTIAL_PROBE_ACCOUNT = "doctor-probe"


def check_credential_store() -> ProbeResult:
    """Check whether the OS credential store can be read."""
    try:
        SystemCredentialStore().load_secret(DOCTOR_CREDENTIAL_PROBE_ACCOUNT)
    except CredentialStoreError as exc:
        return ProbeResult(
            "fail",
            str(exc),
            "Configure macOS Keychain, Windows Credential Manager, or Linux Secret Service.",
        )
    return ProbeResult("ok", "OS credential store available.")


def probe_atlas(atlas_url: str) -> ProbeResult:
    """Probe Atlas reachability without authenticating."""
    normalized_url = atlas_url.rstrip("/")
    try:
        with httpx.Client(timeout=5.0, follow_redirects=True) as client:
            response = client.get(normalized_url)
    except httpx.HTTPError:
        return ProbeResult(
            "warn",
            f"Could not reach {normalized_url}.",
            "Check your connection or pass --atlas-url to the command you are running.",
        )
    if response.status_code >= 500:
        return ProbeResult(
            "warn",
            f"{normalized_url} returned HTTP {response.status_code}.",
            "Try again later or check Atlas status.",
        )
    return ProbeResult("ok", f"{normalized_url} reachable.")


def probe_model(config: ScoutConfig) -> ProbeResult:
    """Probe the configured model provider enough for local discovery readiness."""
    provider = config.llm.provider.strip().lower()
    if not is_local_provider(provider):
        return ProbeResult(
            "ok",
            f"Configured provider is {config.llm.provider}.",
        )

    local_provider = cast("LocalProviderName", provider)
    probe = probe_local_model(local_provider, config)
    label = provider_label(local_provider)
    if probe.status != "ready":
        return ProbeResult(
            "fail",
            probe.message,
            probe.remediation,
        )

    if config.llm.model in probe.models:
        return ProbeResult("ok", f"{label} model {config.llm.model} available.")

    if local_provider == "ollama":
        return ProbeResult(
            "fail",
            f"Ollama model {config.llm.model} is not available.",
            f"Install it with `ollama pull {config.llm.model}`.",
        )
    return ProbeResult(
        "fail",
        f"LM Studio model {config.llm.model} is not available.",
        "Run `scout config model` to choose a visible LM Studio model.",
    )


def load_worker_state() -> dict[str, object]:
    """Read the worker state file without mutating it."""
    if not WORKER_STATE_PATH.exists():
        return {"status": "stopped"}
    try:
        payload = json.loads(WORKER_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "error", "last_error": "Worker state file is unreadable."}
    if not isinstance(payload, dict):
        return {"status": "error", "last_error": "Worker state file is invalid."}
    return cast("dict[str, object]", payload)


def process_is_running(process_id: int) -> bool:
    """Return whether a local process is still alive."""
    try:
        os.kill(process_id, 0)
    except OSError:
        return False
    return True
