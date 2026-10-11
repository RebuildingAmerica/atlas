"""Canceled Python deadlines must release Workers timers and callback references."""

import asyncio
import contextvars
import importlib
import importlib.util
import math
import sys
from types import ModuleType

import pytest


def cleanup_module():
    assert importlib.util.find_spec("timer_cleanup") is not None, (
        "Timer cleanup is missing"
    )
    return importlib.import_module("timer_cleanup")


class OnceProxy:
    def __init__(self, callback, owner):
        self.callback = callback
        self.owner = owner
        self.destroyed = False
        owner.proxies.add(self)

    def __call__(self):
        assert not self.destroyed
        try:
            self.callback()
        finally:
            self.destroy()

    def destroy(self):
        assert not self.destroyed
        self.destroyed = True
        self.callback = None
        self.owner.proxies.remove(self)


class WorkersTimers:
    """The JS boundary retains callbacks until firing or explicit destruction."""

    def __init__(self):
        self.pending = {}
        self.proxies = set()
        self.next_id = 0
        self.fail_schedule = False

    def set_timeout(self, callback, milliseconds):
        if self.fail_schedule:
            raise RuntimeError("Timer scheduling failed")
        self.next_id += 1
        self.pending[self.next_id] = (callback, milliseconds)
        return self.next_id

    def clear_timeout(self, identifier):
        self.pending.pop(identifier, None)

    def once(self, callback, *, _may_syncify=False):
        assert _may_syncify is True
        return OnceProxy(callback, self)

    def fire(self):
        identifier = next(iter(self.pending))
        callback, _ = self.pending.pop(identifier)
        callback()


@pytest.fixture
def web_runtime(monkeypatch):
    timers = WorkersTimers()

    class WebLoop(asyncio.AbstractEventLoop):
        _system_exit_handler = None
        _keyboard_interrupt_handler = None

        def get_debug(self):
            return False

        def time(self):
            return 100.0

        def _install_running_loop(self):
            pass

        def _install_asyncgen_hooks(self):
            pass

        def call_later(self, delay, callback, *args, context=None):
            # Characterize the pinned WebLoop: cancellation leaves the JS timer pending.
            if delay < 0:
                raise ValueError("Can't schedule in the past")
            handle = asyncio.Handle(callback, args, self, context=context)
            if delay != math.inf:
                proxy = timers.once(
                    lambda: None if handle.cancelled() else handle._run(),
                    _may_syncify=True,
                )
                timers.set_timeout(proxy, min(delay * 1000, 2**31 - 1))
            return handle

        def call_at(self, when, callback, *args, context=None):
            return self.call_later(when - self.time(), callback, *args, context=context)

        def call_exception_handler(self, context):
            self.errors.append(context)

    webloop = ModuleType("pyodide.webloop")
    webloop.WebLoop = WebLoop
    webloop._MAX_TIMEOUT_MS = 2**31 - 1
    ffi = ModuleType("pyodide.ffi")
    ffi.create_once_callable = timers.once
    pyodide = ModuleType("pyodide")
    pyodide.webloop = webloop
    js = ModuleType("js")
    js.setTimeout = timers.set_timeout
    js.clearTimeout = timers.clear_timeout
    monkeypatch.setitem(sys.modules, "pyodide", pyodide)
    monkeypatch.setitem(sys.modules, "pyodide.webloop", webloop)
    monkeypatch.setitem(sys.modules, "pyodide.ffi", ffi)
    monkeypatch.setitem(sys.modules, "js", js)
    monkeypatch.setattr(sys, "platform", "emscripten")
    loop = WebLoop()
    loop.errors = []
    return loop, timers


def test_cancel_releases_timer_and_callback_proxy(web_runtime):
    loop, timers = web_runtime
    assert cleanup_module().install_timer_cleanup(loop) is True
    handle = loop.call_later(30, pytest.fail, "Canceled callback fired")
    handle.cancel()
    handle.cancel()
    assert handle.cancelled()
    assert not timers.pending
    assert not timers.proxies


def test_unpatched_webloop_reproduces_retained_timer(web_runtime):
    loop, timers = web_runtime
    handle = loop.call_later(30, pytest.fail, "Canceled callback fired")
    handle.cancel()
    assert len(timers.pending) == 1
    assert len(timers.proxies) == 1
    timers.fire()
    assert not timers.pending
    assert not timers.proxies


def test_firing_preserves_arguments_and_explicit_context_and_releases_proxy(
    web_runtime,
):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    visitor = contextvars.ContextVar("visitor", default="none")
    context = contextvars.copy_context()
    context.run(visitor.set, "first")
    seen = []
    handle = loop.call_at(
        105, lambda value: seen.append((visitor.get(), value)), 7, context=context
    )
    visitor.set("second")
    assert next(iter(timers.pending.values()))[1] == 5000
    timers.fire()
    handle.cancel()
    assert seen == [("first", 7)]
    assert not timers.pending
    assert not timers.proxies


def test_implicit_context_does_not_capture_later_visitor(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    visitor = contextvars.ContextVar("visitor", default="first")
    seen = []
    loop.call_later(5, lambda: seen.append(visitor.get()))
    visitor.set("second")
    timers.fire()
    assert seen == ["first"]


def test_callback_error_reaches_loop_handler_and_releases_proxy(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)

    def fail():
        raise RuntimeError("Callback failed")

    loop.call_later(5, fail)
    timers.fire()
    assert isinstance(loop.errors[0]["exception"], RuntimeError)
    assert not timers.proxies


@pytest.mark.parametrize(
    "exception,attribute",
    [
        (SystemExit, "_system_exit_handler"),
        (KeyboardInterrupt, "_keyboard_interrupt_handler"),
    ],
)
def test_special_exception_handler_is_preserved(web_runtime, exception, attribute):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    seen = []
    setattr(
        loop,
        attribute,
        seen.append if exception is SystemExit else lambda: seen.append("interrupt"),
    )

    def fail():
        raise exception(7)

    loop.call_later(5, fail)
    timers.fire()
    assert seen == ([7] if exception is SystemExit else ["interrupt"])
    assert not timers.proxies


def test_schedule_failure_releases_proxy(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    timers.fail_schedule = True
    with pytest.raises(RuntimeError, match="Timer scheduling failed"):
        loop.call_later(30, lambda: None)
    assert not timers.pending
    assert not timers.proxies


def test_install_is_idempotent_and_affects_only_selected_instance(web_runtime):
    loop, timers = web_runtime
    module = cleanup_module()
    assert module.install_timer_cleanup(loop)
    installed = loop.call_later
    assert module.install_timer_cleanup(loop)
    assert loop.call_later is installed
    other = type(loop)()
    handle = other.call_later(30, lambda: None)
    handle.cancel()
    assert len(timers.pending) == 1
    timers.fire()


def test_native_loop_is_unchanged_even_on_emscripten(web_runtime):
    loop = asyncio.new_event_loop()
    try:
        method = loop.call_later
        assert cleanup_module().install_timer_cleanup(loop) is False
        assert loop.call_later == method
    finally:
        loop.close()


def test_native_python_does_not_import_workers_modules(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    assert cleanup_module().install_timer_cleanup() is False


def test_infinite_and_short_delays_keep_upstream_scheduler(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    infinite = loop.call_later(math.inf, lambda: None)
    infinite.cancel()
    assert not timers.pending
    short = loop.call_later(0, lambda: None)
    short.cancel()
    assert len(timers.pending) == 1
    timers.fire()
    with pytest.raises(ValueError, match="past"):
        loop.call_at(99, lambda: None)


def test_long_delay_keeps_upstream_timeout_limit(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    handle = loop.call_later(1e12, lambda: None)
    assert next(iter(timers.pending.values()))[1] == 2**31 - 1
    handle.cancel()
    assert not timers.pending


def test_cancel_during_callback_does_not_double_destroy_proxy(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    handle = loop.call_later(5, lambda: handle.cancel())
    timers.fire()
    assert handle.cancelled()
    assert not timers.pending
    assert not timers.proxies


def test_cancel_one_request_preserves_other_request_deadline(web_runtime):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)
    seen = []
    first = loop.call_later(30, seen.append, "first")
    loop.call_later(30, seen.append, "second")
    first.cancel()
    timers.fire()
    assert seen == ["second"]
    assert not timers.pending
    assert not timers.proxies


@pytest.mark.parametrize("exception", [SystemExit, KeyboardInterrupt])
def test_unhandled_special_exception_propagates_and_releases_proxy(
    web_runtime, exception
):
    loop, timers = web_runtime
    cleanup_module().install_timer_cleanup(loop)

    def fail():
        raise exception(7)

    loop.call_later(5, fail)
    with pytest.raises(exception):
        timers.fire()
    assert not timers.pending
    assert not timers.proxies


def test_raw_probe_exposes_cancelled_timer_without_asgi_or_database(
    web_runtime, monkeypatch
):
    loop, timers = web_runtime
    assert importlib.util.find_spec("timer_probe") is not None, (
        "Raw timer probe is missing"
    )
    probe = importlib.import_module("timer_probe").cancelled_timer_probe
    monkeypatch.setattr(asyncio, "get_running_loop", lambda: loop)
    coroutine = probe()
    with pytest.raises(StopIteration) as result:
        coroutine.send(None)
    assert result.value.value == {
        "probe": "cancelled-timer",
        "delay_seconds": 30.0,
        "cancelled": True,
    }
    assert len(timers.pending) == 1
    timers.fire()
    cleanup_module().install_timer_cleanup(loop)
    coroutine = probe(delay_seconds=5)
    with pytest.raises(StopIteration) as result:
        coroutine.send(None)
    assert result.value.value["cancelled"] is True
    assert result.value.value["delay_seconds"] == 5
    assert not timers.pending
    assert not timers.proxies


@pytest.mark.parametrize("delay", [-1, 0, math.nan, math.inf])
def test_raw_probe_rejects_invalid_delays(delay):
    assert importlib.util.find_spec("timer_probe") is not None, (
        "Raw timer probe is missing"
    )
    probe = importlib.import_module("timer_probe").cancelled_timer_probe
    with pytest.raises(ValueError, match="finite and positive"):
        asyncio.run(probe(delay_seconds=delay))
