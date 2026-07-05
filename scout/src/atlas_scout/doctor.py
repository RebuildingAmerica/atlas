"""Read-only Scout readiness checks."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast

import httpx

from atlas_scout.atlas_urls import DEFAULT_ATLAS_URL
from atlas_scout.auth import ScoutSession, load_session
from atlas_scout.config import SCOUT_CONFIG_DIR, ScoutConfig
from atlas_scout.credentials import CredentialStoreError, SystemCredentialStore
from atlas_scout.local_models import (
    LOCAL_PROVIDER_NAMES,
    LocalProviderName,
    is_local_provider,
    probe_local_model,
    provider_label,
)
from atlas_scout.search_keys import has_search_api_key

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

DoctorStatus = Literal["ok", "warn", "fail"]

WORKER_STATE_PATH = SCOUT_CONFIG_DIR / "worker.json"
DOCTOR_CREDENTIAL_PROBE_ACCOUNT = "doctor-probe"


@dataclass(frozen=True, slots=True)
class ProbeResult:
    """Raw result from one read-only external probe."""

    status: DoctorStatus
    message: str
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class DoctorCheck:
    """One grouped readiness check displayed by Scout doctor."""

    id: str
    group: str
    label: str
    status: DoctorStatus
    message: str
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class DoctorCapability:
    """One user-facing thing Scout can or cannot do from this machine."""

    id: str
    label: str
    ready: bool
    message: str
    remediation: str | None = None


@dataclass(frozen=True, slots=True)
class DoctorReport:
    """Complete Scout doctor result."""

    checks: tuple[DoctorCheck, ...]
    capabilities: tuple[DoctorCapability, ...]

    @property
    def exit_code(self) -> int:
        """Return the process exit code implied by hard failures."""
        return 1 if any(check.status == "fail" for check in self.checks) else 0

    def check(self, check_id: str) -> DoctorCheck | None:
        """Return one check by id."""
        return next((check for check in self.checks if check.id == check_id), None)

    def capability(self, capability_id: str) -> DoctorCapability | None:
        """Return one capability by id."""
        return next(
            (capability for capability in self.capabilities if capability.id == capability_id),
            None,
        )

    def to_json(self) -> str:
        """Return a stable JSON representation without secrets."""
        payload = {
            "checks": [asdict(check) for check in self.checks],
            "capabilities": [asdict(capability) for capability in self.capabilities],
            "exit_code": self.exit_code,
        }
        return json.dumps(payload, indent=2, sort_keys=True)


@dataclass(frozen=True, slots=True)
class DoctorDependencies:
    """Injectable read-only dependencies for Scout doctor."""

    check_credential_store: Callable[[], ProbeResult] = lambda: _default_check_credential_store()
    has_search_key: Callable[[], bool] = has_search_api_key
    load_session: Callable[[], ScoutSession | None] = load_session
    load_worker_state: Callable[[], dict[str, object]] = lambda: _default_load_worker_state()
    probe_atlas: Callable[[str], ProbeResult] = lambda atlas_url: _default_probe_atlas(atlas_url)
    probe_model: Callable[[ScoutConfig], ProbeResult] = lambda config: _default_probe_model(config)
    process_is_running: Callable[[int], bool] = lambda process_id: _process_is_running(process_id)
    env: Mapping[str, str] = field(default_factory=lambda: os.environ)


def run_doctor(
    config: ScoutConfig,
    *,
    include_worker: bool,
    dependencies: DoctorDependencies | None = None,
) -> DoctorReport:
    """Run read-only Scout readiness checks."""
    deps = dependencies or DoctorDependencies()
    checks: list[DoctorCheck] = []

    credential_result = deps.check_credential_store()
    checks.append(
        DoctorCheck(
            id="credential-storage",
            group="Credential storage",
            label="OS credential store",
            status=credential_result.status,
            message=credential_result.message,
            remediation=credential_result.remediation,
        )
    )

    session = _load_session_check(deps, checks)
    atlas_url = _atlas_url(config, session)
    checks.append(
        _probe_check("atlas-connection", "Atlas connection", "Atlas", deps.probe_atlas(atlas_url))
    )

    model_result = deps.probe_model(config)
    checks.append(
        _probe_check(
            "model",
            "Local model",
            f"{config.llm.provider}:{config.llm.model}",
            model_result,
        )
    )

    search_key_ready = _append_search_check(deps, checks)
    checks.append(_database_check(config))

    capabilities = _discovery_capabilities(
        config=config,
        checks=checks,
        session=session,
        search_key_ready=search_key_ready,
        env=deps.env,
    )
    if include_worker:
        worker_check, worker_capabilities = _worker_readiness(
            config=config,
            dependencies=deps,
            session=session,
            search_key_ready=search_key_ready,
            model_ready=_check_ready(checks, "model"),
        )
        checks.append(worker_check)
        capabilities.extend(worker_capabilities)

    return DoctorReport(checks=tuple(checks), capabilities=tuple(capabilities))


def _load_session_check(
    dependencies: DoctorDependencies,
    checks: list[DoctorCheck],
) -> ScoutSession | None:
    """Load the saved session and append the account check."""
    try:
        session = dependencies.load_session()
    except CredentialStoreError as exc:
        checks.append(
            DoctorCheck(
                id="atlas-account",
                group="Atlas account",
                label="Account",
                status="fail",
                message=str(exc),
                remediation="Run `scout logout` and `scout login` after fixing credential storage.",
            )
        )
        return None

    if session is None:
        checks.append(
            DoctorCheck(
                id="atlas-account",
                group="Atlas account",
                label="Account",
                status="warn",
                message="Not logged in.",
                remediation="Run `scout login`.",
            )
        )
        return None

    target = session.default_upload_target or "public"
    checks.append(
        DoctorCheck(
            id="atlas-account",
            group="Atlas account",
            label="Account",
            status="ok",
            message=(f"Signed in as {session.user_email}. Uploads default to {target}."),
            remediation=None,
        )
    )
    return session


def _probe_check(
    check_id: str,
    group: str,
    label: str,
    result: ProbeResult,
) -> DoctorCheck:
    """Convert a probe result into a grouped doctor check."""
    return DoctorCheck(
        id=check_id,
        group=group,
        label=label,
        status=result.status,
        message=result.message,
        remediation=result.remediation,
    )


def _append_search_check(
    dependencies: DoctorDependencies,
    checks: list[DoctorCheck],
) -> bool:
    """Append search-backed discovery readiness and return whether search is available."""
    try:
        search_key_ready = dependencies.has_search_key()
    except CredentialStoreError as exc:
        checks.append(
            DoctorCheck(
                id="search",
                group="Search",
                label="Search connection",
                status="fail",
                message=str(exc),
                remediation="Run `scout search disconnect`, then `scout search connect`.",
            )
        )
        return False

    if search_key_ready:
        checks.append(
            DoctorCheck(
                id="search",
                group="Search",
                label="Search connection",
                status="ok",
                message="Search-backed discovery is available.",
                remediation=None,
            )
        )
        return True

    checks.append(
        DoctorCheck(
            id="search",
            group="Search",
            label="Search connection",
            status="warn",
            message="Search-backed discovery is not connected.",
            remediation="Run `scout search connect`.",
        )
    )
    return False


def _database_check(config: ScoutConfig) -> DoctorCheck:
    """Check whether Scout can use the configured local database path."""
    db_path = Path(config.store.path).expanduser()
    nearest_parent = _nearest_existing_parent(db_path.parent)
    if nearest_parent is None:
        return DoctorCheck(
            id="database",
            group="Local data",
            label="Database",
            status="fail",
            message=f"No existing parent directory for {db_path}.",
            remediation="Choose a database path under a writable directory.",
        )
    if os.access(nearest_parent, os.W_OK):
        return DoctorCheck(
            id="database",
            group="Local data",
            label="Database",
            status="ok",
            message=f"Local database path is {db_path}.",
            remediation=None,
        )
    return DoctorCheck(
        id="database",
        group="Local data",
        label="Database",
        status="fail",
        message=f"Scout cannot write under {nearest_parent}.",
        remediation="Choose a writable database path with `scout config set store.path ...`.",
    )


def _discovery_capabilities(
    *,
    config: ScoutConfig,
    checks: list[DoctorCheck],
    session: ScoutSession | None,
    search_key_ready: bool,
    env: Mapping[str, str],
) -> list[DoctorCapability]:
    """Return Scout-initiated discovery and sync capabilities."""
    model_ready = _check_ready(checks, "model")
    database_ready = _check_ready(checks, "database")
    direct_ready = model_ready and database_ready
    sync_ready = _sync_ready(config, session, env)

    return [
        DoctorCapability(
            id="direct-url-runs",
            label="Direct URL runs",
            ready=direct_ready,
            message=(
                "Ready to run `scout run https://example.org`."
                if direct_ready
                else "Direct URL runs need a working model and local database."
            ),
            remediation=None if direct_ready else _first_remediation(checks, ["model", "database"]),
        ),
        DoctorCapability(
            id="search-discovery",
            label="Search discovery",
            ready=direct_ready and search_key_ready,
            message=(
                "Ready to run search-backed discovery."
                if direct_ready and search_key_ready
                else "Search discovery needs a working model, local database, and search connection."
            ),
            remediation=(
                None
                if direct_ready and search_key_ready
                else _first_remediation(checks, ["model", "database", "search"])
            ),
        ),
        DoctorCapability(
            id="atlas-sync",
            label="Atlas sync",
            ready=sync_ready,
            message=(
                "Ready to sync completed runs to Atlas."
                if sync_ready
                else "Atlas sync needs browser login or an Atlas API key."
            ),
            remediation=None if sync_ready else "Run `scout login` or set `ATLAS_API_KEY`.",
        ),
    ]


def _worker_readiness(
    *,
    config: ScoutConfig,
    dependencies: DoctorDependencies,
    session: ScoutSession | None,
    search_key_ready: bool,
    model_ready: bool,
) -> tuple[DoctorCheck, list[DoctorCapability]]:
    """Return optional passive worker readiness."""
    state = dependencies.load_worker_state()
    worker_check = _worker_state_check(state, dependencies.process_is_running)
    local_provider_ready = is_local_provider(config.llm.provider)
    base_ready = session is not None and local_provider_ready and model_ready
    remediation = _worker_remediation(
        session=session,
        local_provider_ready=local_provider_ready,
        model_ready=model_ready,
    )

    return (
        worker_check,
        [
            DoctorCapability(
                id="seeded-worker-jobs",
                label="Seeded Atlas worker jobs",
                ready=base_ready,
                message=(
                    "Ready for seeded Atlas worker jobs."
                    if base_ready
                    else "Seeded worker jobs need login and a local model provider."
                ),
                remediation=None if base_ready else remediation,
            ),
            DoctorCapability(
                id="search-worker-jobs",
                label="Search Atlas worker jobs",
                ready=base_ready and search_key_ready,
                message=(
                    "Ready for search-backed Atlas worker jobs."
                    if base_ready and search_key_ready
                    else "Search worker jobs need login, a local model provider, and a search connection."
                ),
                remediation=(
                    None
                    if base_ready and search_key_ready
                    else remediation or "Run `scout search connect`."
                ),
            ),
        ],
    )


def _worker_state_check(
    state: dict[str, object],
    process_is_running: Callable[[int], bool],
) -> DoctorCheck:
    """Summarize the local worker state file."""
    status = str(state.get("status", "stopped"))
    process_id = state.get("process_id")
    if status == "running" and isinstance(process_id, int):
        if process_is_running(process_id):
            return DoctorCheck(
                id="worker-state",
                group="Worker",
                label="Worker",
                status="ok",
                message=f"Worker is running with PID {process_id}.",
                remediation=None,
            )
        return DoctorCheck(
            id="worker-state",
            group="Worker",
            label="Worker",
            status="warn",
            message="Worker state is stale.",
            remediation="Run `scout worker stop`, then `scout worker start`.",
        )
    if status == "error":
        return DoctorCheck(
            id="worker-state",
            group="Worker",
            label="Worker",
            status="warn",
            message=f"Worker last reported an error: {state.get('last_error', 'unknown error')}.",
            remediation="Run `scout worker status` for details.",
        )
    return DoctorCheck(
        id="worker-state",
        group="Worker",
        label="Worker",
        status="warn",
        message="Worker is not running.",
        remediation="Run `scout worker start` when you want Atlas to assign background work.",
    )


def _worker_remediation(
    *,
    session: ScoutSession | None,
    local_provider_ready: bool,
    model_ready: bool,
) -> str:
    """Return the first action needed to make worker mode ready."""
    if session is None:
        return "Run `scout login`."
    if not local_provider_ready:
        allowed = ", ".join(LOCAL_PROVIDER_NAMES)
        return f"Run `scout config llm` to choose a local model provider ({allowed})."
    if not model_ready:
        return "Run `scout config llm` to choose a working local model."
    return "Run `scout search connect`."


def _sync_ready(
    config: ScoutConfig,
    session: ScoutSession | None,
    env: Mapping[str, str],
) -> bool:
    """Return whether sync has an authentication path."""
    return bool(
        session is not None
        or config.contribution.api_key.strip()
        or env.get("ATLAS_API_KEY", "").strip()
    )


def _check_ready(checks: list[DoctorCheck], check_id: str) -> bool:
    """Return whether a check exists and passed."""
    return any(check.id == check_id and check.status == "ok" for check in checks)


def _first_remediation(checks: list[DoctorCheck], check_ids: list[str]) -> str | None:
    """Return the first remediation for a failed or warning dependency."""
    for check_id in check_ids:
        for check in checks:
            if check.id == check_id and check.status != "ok":
                return check.remediation
    return None


def _atlas_url(config: ScoutConfig, session: ScoutSession | None) -> str:
    """Return the Atlas URL doctor should probe."""
    if session is not None and session.atlas_url.strip():
        return session.atlas_url.rstrip("/")
    if config.contribution.atlas_url.strip():
        return config.contribution.atlas_url.rstrip("/")
    return DEFAULT_ATLAS_URL


def _nearest_existing_parent(path: Path) -> Path | None:
    """Return the nearest existing parent directory."""
    candidate = path
    while not candidate.exists():
        if candidate.parent == candidate:
            return None
        candidate = candidate.parent
    return candidate if candidate.is_dir() else candidate.parent


def _default_check_credential_store() -> ProbeResult:
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


def _default_probe_atlas(atlas_url: str) -> ProbeResult:
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


def _default_probe_model(config: ScoutConfig) -> ProbeResult:
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
        "Run `scout config llm` to choose a visible LM Studio model.",
    )


def _default_load_worker_state() -> dict[str, object]:
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


def _process_is_running(process_id: int) -> bool:
    """Return whether a local process is still alive."""
    try:
        os.kill(process_id, 0)
    except OSError:
        return False
    return True
