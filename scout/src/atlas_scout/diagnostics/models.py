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
    """Injectable read-only dependencies for Scout doctor.

    Deliberately has no field defaults: this keeps the dependency contract
    free of any concrete adapter (httpx, OS credential store, local-model
    probing). The orchestrator wires real adapters in when the caller does
    not supply a DoctorDependencies of its own.
    """

    check_credential_store: Callable[[], ProbeResult]
    has_search_key: Callable[[], bool]
    load_session: Callable[[], ScoutSession | None]
    load_worker_state: Callable[[], dict[str, object]]
    probe_atlas: Callable[[str], ProbeResult]
    probe_model: Callable[[ScoutConfig], ProbeResult]
    process_is_running: Callable[[int], bool]
    env: Mapping[str, str]
