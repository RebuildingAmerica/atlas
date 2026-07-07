"""Read-only Scout readiness checks.

Public API facade over the diagnostics/ package: DTOs and the injectable
dependency contract (models), concrete real-world adapters (probes),
individual check builders (checks), capability readiness scoring
(capabilities), and the run_doctor orchestrator (report).
"""

from __future__ import annotations

from atlas_scout.diagnostics.models import (
    DoctorCapability,
    DoctorCheck,
    DoctorDependencies,
    DoctorReport,
    DoctorStatus,
    ProbeResult,
)
from atlas_scout.diagnostics.probes import DOCTOR_CREDENTIAL_PROBE_ACCOUNT, WORKER_STATE_PATH
from atlas_scout.diagnostics.report import run_doctor

__all__ = [
    "DOCTOR_CREDENTIAL_PROBE_ACCOUNT",
    "WORKER_STATE_PATH",
    "DoctorCapability",
    "DoctorCheck",
    "DoctorDependencies",
    "DoctorReport",
    "DoctorStatus",
    "ProbeResult",
    "run_doctor",
]
