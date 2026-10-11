"""Deployment-bound consumers preserve receipts and drain work before pause readback."""

import asyncio
import copy
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

SHA = "a" * 40
DIGEST = "b" * 64


class Storage:
    def __init__(self):
        self.values = {}
        self.alarm_at = None

    async def get(self, key):
        return copy.deepcopy(self.values.get(key))

    async def put(self, key, value):
        self.values[key] = copy.deepcopy(value)

    async def setAlarm(self, at):
        self.alarm_at = at

    async def getAlarm(self):
        return self.alarm_at

    async def deleteAlarm(self):
        self.alarm_at = None


def request(method="GET", *, body=None, **kwargs):
    return SimpleNamespace(method=method, headers={}, json=AsyncMock(return_value=body))


@pytest.fixture
def control_module(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / "production"))
    monkeypatch.setitem(
        sys.modules,
        "workers",
        SimpleNamespace(
            Response=SimpleNamespace(
                json=lambda body, **kw: (kw.get("status", 200), body)
            )
        ),
    )
    sys.modules.pop("consumer_control", None)
    yield importlib.import_module("consumer_control")
    sys.modules.pop("consumer_control", None)


def make_control(module, storage=None, *, sha=SHA, active=""):
    return module.ConsumerControl(
        SimpleNamespace(
            ATLAS_RELEASE_SHA=sha,
            ATLAS_ACTIVE_RELEASE_SHA=active,
            ATLAS_SCHEMA_RECEIPT_DIGEST=DIGEST,
        ),
        storage or Storage(),
        clock=lambda: 1000,
    )


def readback(active="", enabled=False, sha=SHA):
    return (200, {"releaseSha": sha, "activeReleaseSha": active, "enabled": enabled})


@pytest.mark.asyncio
async def test_fresh_restart_and_changed_release_are_paused(control_module):
    storage = Storage()
    first = make_control(control_module, storage)
    assert await first.handle_request(request()) == readback()
    callback = AsyncMock()
    await first.run_alarm(callback)
    callback.assert_not_awaited()
    active = make_control(control_module, storage, active=SHA)
    assert await active.handle_request(request()) == readback(SHA, True)
    assert storage.alarm_at == 1000001
    assert await make_control(control_module, storage, active=SHA).is_enabled()
    # A retained old enable receipt cannot override the new deployment binding.
    paused = make_control(control_module, storage)
    assert not await paused.is_enabled()
    assert await paused.handle_request(request()) == readback()
    replacement = make_control(control_module, storage, sha="c" * 40, active=SHA)
    assert await replacement.handle_request(request()) == readback(SHA, False, "c" * 40)
    await replacement.run_alarm(callback)
    callback.assert_not_awaited()
    assert storage.alarm_at is None


@pytest.mark.asyncio
async def test_paused_producers_retain_receipts_without_arming(control_module):
    control = make_control(control_module)
    await control.gated_storage.put("wake-receipts", ["pending-observation"])
    await control.gated_storage.setAlarm(123)
    assert await control.gated_storage.getAlarm() is None
    control.env.ATLAS_ACTIVE_RELEASE_SHA = SHA
    await control.handle_request(request())
    await control.gated_storage.setAlarm(123)
    assert await control.gated_storage.getAlarm() == 123
    control.env.ATLAS_ACTIVE_RELEASE_SHA = ""
    await control.handle_request(request())
    assert await control.gated_storage.get("wake-receipts") == ["pending-observation"]
    assert await control.gated_storage.getAlarm() is None


@pytest.mark.asyncio
async def test_pause_readback_waits_for_entire_alarm_and_blocks_new_arming(
    control_module,
):
    control = make_control(control_module, active=SHA)
    await control.handle_request(request())
    started, finish = asyncio.Event(), asyncio.Event()

    async def unit():
        started.set()
        await finish.wait()
        await control.gated_storage.setAlarm(9000)

    running = asyncio.create_task(control.run_alarm(unit))
    await started.wait()
    control.env.ATLAS_ACTIVE_RELEASE_SHA = ""
    pause = asyncio.create_task(control.handle_request(request()))
    await asyncio.sleep(0)
    assert not pause.done()
    assert not await control.is_enabled()
    # Producers remain responsive while readback waits for the running unit.
    await control.gated_storage.put("receipt", "committed")
    finish.set()
    await running
    assert await pause == readback()
    assert control.storage.alarm_at is None
    callback = AsyncMock()
    await control.run_alarm(callback)
    callback.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_unit_retains_rescue_and_releases_readback_lock(control_module):
    control = make_control(control_module, active=SHA)
    await control.handle_request(request())
    started = asyncio.Event()

    async def unit():
        started.set()
        await asyncio.Event().wait()

    running = asyncio.create_task(control.run_alarm(unit))
    await started.wait()
    assert control.storage.alarm_at == 1060000
    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running
    control.env.ATLAS_ACTIVE_RELEASE_SHA = ""
    assert await control.handle_request(request()) == readback()
    assert control.storage.alarm_at is None


@pytest.mark.asyncio
async def test_cancelled_pause_readback_persists_disabled_before_alarm_deletion(
    control_module,
):
    storage = Storage()
    control = make_control(control_module, storage, active=SHA)
    await control.handle_request(request())
    deleting = asyncio.Event()

    async def blocked_delete():
        deleting.set()
        await asyncio.Event().wait()

    storage.deleteAlarm = blocked_delete
    control.env.ATLAS_ACTIVE_RELEASE_SHA = ""
    pause = asyncio.create_task(control.handle_request(request()))
    await deleting.wait()
    pause.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pause
    assert storage.values[control_module._STATE_KEY]["enabled"] is False
    assert not await make_control(control_module, storage).is_enabled()


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE", "PATCH"])
async def test_http_mutations_never_read_body_or_change_state(control_module, method):
    control = make_control(control_module)
    incoming = request(method, body={"releaseSha": SHA, "enabled": True})
    incoming.headers = {
        "Authorization": "Bearer machine",
        "x-atlas-internal-secret": "app-secret",
    }
    assert await control.handle_request(incoming) == (
        405,
        {"error": "Method not allowed"},
    )
    incoming.json.assert_not_awaited()
    assert control.storage.values == {}
    assert control.storage.alarm_at is None


@pytest.mark.asyncio
async def test_failed_activation_never_persists_enabled(control_module):
    control = make_control(control_module, active=SHA)
    control.storage.setAlarm = AsyncMock(side_effect=OSError("storage unavailable"))
    with pytest.raises(OSError):
        await control.handle_request(request())
    assert not await control.is_enabled()


@pytest.mark.asyncio
async def test_cancelled_activation_retries_only_under_exact_deployment_authority(
    control_module,
):
    control = make_control(control_module, active=SHA)
    writing = asyncio.Event()
    original = control.storage.put

    async def blocked_put(*_args):
        writing.set()
        await asyncio.Event().wait()

    control.storage.put = blocked_put
    activation = asyncio.create_task(control.handle_request(request()))
    await writing.wait()
    assert control.storage.alarm_at is not None
    activation.cancel()
    with pytest.raises(asyncio.CancelledError):
        await activation
    assert not await control.is_enabled()
    # Re-deployment to paused cancels the incomplete activation without losing receipts.
    control.storage.put = original
    control.env.ATLAS_ACTIVE_RELEASE_SHA = ""
    callback = AsyncMock()
    await control.run_alarm(callback)
    callback.assert_not_awaited()
    assert control.storage.alarm_at is None
    # A new exact authorized activation recovers and schedules retained work.
    control.env.ATLAS_ACTIVE_RELEASE_SHA = SHA
    assert await control.handle_request(request()) == readback(SHA, True)
    await control.run_alarm(callback)
    callback.assert_awaited_once()


@pytest.mark.asyncio
async def test_invalid_state_never_authorizes_alarm(control_module):
    control = make_control(control_module, active=SHA)
    control.storage.values[control_module._STATE_KEY] = {
        "releaseSha": SHA,
        "enabled": "true",
    }
    callback = AsyncMock()
    with pytest.raises(RuntimeError, match="Invalid durable consumer state"):
        await control.run_alarm(callback)
    callback.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("active", [None, True, "invalid-private-value"])
async def test_missing_or_invalid_active_binding_fails_closed(control_module, active):
    control = make_control(control_module, active=active)
    with pytest.raises(RuntimeError, match="activation binding") as error:
        await control.handle_request(request())
    assert "invalid-private-value" not in str(error.value)
    assert control.storage.values == {}


@pytest.mark.parametrize("name", ["ATLAS_RELEASE_SHA", "ATLAS_SCHEMA_RECEIPT_DIGEST"])
def test_release_identity_requires_exact_bindings_without_disclosing_input(
    control_module, name
):
    control = make_control(control_module)
    setattr(control.env, name, "invalid-private-value")
    with pytest.raises(RuntimeError) as error:
        control_module.release_identity(control.env, "api")
    assert "invalid-private-value" not in str(error.value)


def test_release_identity_reports_only_exact_metadata(control_module):
    control = make_control(control_module)
    assert control_module.release_identity(control.env, "api") == {
        "releaseSha": SHA,
        "runtimeRole": "api",
        "schemaReceiptDigest": DIGEST,
    }
