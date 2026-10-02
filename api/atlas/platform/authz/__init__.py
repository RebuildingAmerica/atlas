"""Authorization: what an authenticated caller may do, decided in one place."""

from .actions import Action
from .audit import AuditEntry, AuditLogCRUD, AuditRecord, Plane, actor_plane
from .dependency import ActionGuard, require_action
from .policy import Decision, authorize, is_granted

__all__ = [
    "Action",
    "ActionGuard",
    "AuditEntry",
    "AuditLogCRUD",
    "AuditRecord",
    "Decision",
    "Plane",
    "actor_plane",
    "authorize",
    "is_granted",
    "require_action",
]
