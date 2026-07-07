"""Errors for the Atlas worker job-claim protocol."""

from __future__ import annotations


class WorkerJobError(RuntimeError):
    """Raised when a claimed Atlas worker job or its API response is malformed."""
