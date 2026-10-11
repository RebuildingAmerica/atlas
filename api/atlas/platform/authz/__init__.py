"""Authorization: what an authenticated caller may do, decided in one place."""

from .actions import Action
from .audit import AuditEntry, AuditLogCRUD, AuditRecord, Plane, actor_plane
from .dependency import ActionGuard, MachineActionGuard, require_action, require_machine_action
from .platform_guard import PlatformActionGuard, PlatformOperator, require_platform_action
from .policy import Decision, authorize, authorize_machine, is_granted

__all__ = [
    "Action",
    "ActionGuard",
    "AuditEntry",
    "AuditLogCRUD",
    "AuditRecord",
    "Decision",
    "MachineActionGuard",
    "Plane",
    "PlatformActionGuard",
    "PlatformOperator",
    "actor_plane",
    "authorize",
    "authorize_machine",
    "is_granted",
    "require_action",
    "require_machine_action",
    "require_platform_action",
]
