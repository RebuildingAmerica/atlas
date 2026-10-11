"""A raw response probe isolating Python timer lifetime from ASGI and PostgreSQL."""

import asyncio
import math


async def cancelled_timer_probe(*, delay_seconds: float = 30.0) -> dict[str, object]:
    """Return immediately after canceling a deadline; compare hosted DO wall time.

    Invoke before installing cleanup for the baseline, and after installing it
    for the fixed version. The response contains no environment or request data.
    """
    if not math.isfinite(delay_seconds) or delay_seconds <= 0:
        raise ValueError("Probe delay must be finite and positive")
    handle = asyncio.get_running_loop().call_later(delay_seconds, lambda: None)
    handle.cancel()
    return {
        "probe": "cancelled-timer",
        "delay_seconds": delay_seconds,
        "cancelled": handle.cancelled(),
    }
