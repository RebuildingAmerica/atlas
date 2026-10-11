"""Authorization: what an authenticated caller may do, decided in one place."""

from .actions import Action
from .dependency import ActionGuard, require_action
from .policy import Decision, authorize, is_granted

__all__ = ["Action", "ActionGuard", "Decision", "authorize", "is_granted", "require_action"]
