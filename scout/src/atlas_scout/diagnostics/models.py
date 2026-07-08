"""Data models and dependency contract for Scout doctor readiness checks."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from atlas_scout.auth import ScoutSession
    from atlas_scout.config import ScoutConfig

DoctorStatus = Literal["ok", "warn", "fail"]


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

    def exit_code_for(self, required_capability_ids: tuple[str, ...] = ()) -> int:
        """Return the process exit code for hard failures and required capabilities."""
        if self.exit_code != 0:
            return self.exit_code
        for capability_id in required_capability_ids:
            capability = self.capability(capability_id)
            if capability is None or not capability.ready:
                return 1
        return 0

    def check(self, check_id: str) -> DoctorCheck | None:
        """Return one check by id."""
        return next((check for check in self.checks if check.id == check_id), None)

    def capability(self, capability_id: str) -> DoctorCapability | None:
        """Return one capability by id."""
        return next(
            (capability for capability in self.capabilities if capability.id == capability_id),
            None,
        )

    def to_json(self, *, exit_code: int | None = None) -> str:
        """Return a stable JSON representation without secrets."""
        payload = {
            "checks": [asdict(check) for check in self.checks],
            "capabilities": [asdict(capability) for capability in self.capabilities],
            "exit_code": self.exit_code if exit_code is None else exit_code,
        }
        return json.dumps(payload, indent=2, sort_keys=True)


@dataclass(frozen=True, slots=True)
class DoctorDependencies:
    """Injectable dependencies for Scout doctor.

    Deliberately has no field defaults: this keeps the dependency contract free
    of any concrete adapter (httpx, OS credential store, local-model probing,
    upload-token probing). Doctor may validate a saved login by minting and
    discarding a short-lived upload token, but it does not ingest or sync run
    data. The orchestrator wires real adapters in when the caller does not
    supply a DoctorDependencies of its own.
    """

    check_credential_store: Callable[[], ProbeResult]
    has_search_key: Callable[[], bool]
    load_session: Callable[[], ScoutSession | None]
    load_worker_state: Callable[[], dict[str, object]]
    probe_atlas: Callable[[str], ProbeResult]
    probe_model: Callable[[ScoutConfig], ProbeResult]
    probe_session_sync_token: Callable[[str, ScoutSession, bool], ProbeResult]
    process_is_running: Callable[[int], bool]
    env: Mapping[str, str]
