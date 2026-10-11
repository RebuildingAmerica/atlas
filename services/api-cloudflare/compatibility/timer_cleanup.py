"""Release canceled Pyodide deadlines so completed Atlas requests can finish.

Pyodide 314.0.7's WebLoop cancels the Python Handle but retains its JS timer:
https://github.com/pyodide/pyodide/blob/314.0.7/src/py/pyodide/webloop.py#L454
Only delayed timers on the explicitly selected WebLoop instance are adapted.
"""

import asyncio
import math
import sys
from types import MethodType


def install_timer_cleanup(loop: asyncio.AbstractEventLoop | None = None) -> bool:
    """Install cancellation cleanup on one running Pyodide WebLoop, idempotently.

    Native Python loops are unchanged. Call during request execution, before
    opening database connections; Workers forbids scheduling I/O at module load.
    """
    if sys.platform != "emscripten":
        return False

    from pyodide.webloop import _MAX_TIMEOUT_MS, WebLoop

    if loop is None:
        loop = asyncio.get_running_loop()
    if not isinstance(loop, WebLoop):
        return False
    if getattr(loop, "_atlas_timer_cleanup_installed", False):
        return True

    from js import clearTimeout, setTimeout
    from pyodide.ffi import create_once_callable

    original_call_later = loop.call_later

    class WorkersTimerHandle(asyncio.Handle):
        """Own both the Python callback and its cancellable Workers timer."""

        def __init__(self, callback, args, owner, context):
            super().__init__(callback, args, owner, context=context)
            self.timer_id = None
            self.proxy = None

        def cancel(self):
            super().cancel()
            timer_id, self.timer_id = self.timer_id, None
            proxy, self.proxy = self.proxy, None
            try:
                if timer_id is not None:
                    clearTimeout(timer_id)
            finally:
                if proxy is not None:
                    proxy.destroy()

        def fire(self):
            # OnceProxy releases itself after invocation. Detach first so a
            # callback canceling its own handle cannot destroy an active proxy.
            self.timer_id = None
            self.proxy = None
            self._loop._install_running_loop()
            self._loop._install_asyncgen_hooks()
            if self.cancelled():
                return
            try:
                self._run()
            except SystemExit as error:
                if self._loop._system_exit_handler:
                    self._loop._system_exit_handler(error.code)
                else:
                    raise
            except KeyboardInterrupt:
                if self._loop._keyboard_interrupt_handler:
                    self._loop._keyboard_interrupt_handler()
                else:
                    raise

    def call_later(owner, delay, callback, *args, context=None):
        # Retain Pyodide's immediate scheduler, infinity handling, and validation.
        if delay <= 0.002 or not math.isfinite(delay):
            return original_call_later(delay, callback, *args, context=context)
        handle = WorkersTimerHandle(callback, args, owner, context)
        handle.proxy = create_once_callable(handle.fire, _may_syncify=True)
        try:
            handle.timer_id = setTimeout(
                handle.proxy, min(delay * 1000, _MAX_TIMEOUT_MS)
            )
        except BaseException:
            handle.cancel()
            raise
        return handle

    # WebLoop.call_at and call_soon dispatch through this instance method. The
    # class and other loop instances retain their original behavior.
    loop.call_later = MethodType(call_later, loop)
    loop._atlas_timer_cleanup_installed = True
    return True
