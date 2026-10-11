"""Secret-free lifecycle timings for the protected hosted evaluation only."""

import sys
from contextlib import contextmanager
from time import perf_counter
from uuid import uuid4

_isolate_boot = None
_isolate_requests = 0


class RuntimeProbe:
    """Allocate IDs during requests so deployment snapshots cannot freeze them."""

    def __init__(self):
        global _isolate_boot
        if _isolate_boot is None:
            _isolate_boot = uuid4().hex
        self.object_boot = uuid4().hex
        self.requests = 0
        self.timings = {}
        self.counts = {}

    def begin_request(self):
        global _isolate_requests
        _isolate_requests += 1
        self.requests += 1

    @contextmanager
    def measure(self, phase):
        started = perf_counter()
        self.counts[phase] = self.counts.get(phase, 0) + 1
        try:
            yield
        finally:
            self.timings[phase] = round((perf_counter() - started) * 1000, 3)

    def snapshot(self, *, application_cached):
        return {
            "isolate_boot": _isolate_boot,
            "object_boot": self.object_boot,
            "isolate_requests": _isolate_requests,
            "object_requests": self.requests,
            "application_cached": application_cached,
            "application_builds": self.counts.get("application", 0),
            "package_checks": self.counts.get("packages", 0),
            "last_application_ms": self.timings.get("application"),
            "last_packages_ms": self.timings.get("packages"),
            "python_module_count": len(sys.modules),
        }
