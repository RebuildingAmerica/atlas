"""Production consumers remain paused until their exact release is enabled."""

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
SECRET = "internal-test-secret"


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


def request(method="GET", *, secret=SECRET, body=None):
    return SimpleNamespace(
        method=method,
        headers={"x-atlas-internal-secret": secret},
        json=AsyncMock(return_value=body),
    )


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
    monkeypatch.setitem(
        sys.modules,
        "hosted_application",
        SimpleNamespace(
            _settings=lambda env: SimpleNamespace(auth_internal_secret=SECRET)
        ),
    )
    sys.modules.pop("consumer_control", None)
    yield importlib.import_module("consumer_control")
    sys.modules.pop("consumer_control", None)


def make_control(module, storage=None, *, sha=SHA):
    return module.ConsumerControl(
        SimpleNamespace(ATLAS_RELEASE_SHA=sha, ATLAS_SCHEMA_RECEIPT_DIGEST=DIGEST),
        storage or Storage(),
        clock=lambda: 1000,
    )


@pytest.mark.asyncio
async def test_fresh_restart_and_other_release_are_paused(control_module):
    storage = Storage()
    first = make_control(control_module, storage)
    callback = AsyncMock()
    assert await first.handle_request(request()) == (
        200,
        {"releaseSha": SHA, "enabled": False},
    )
    await first.run_alarm(callback)
    callback.assert_not_awaited()
    assert await first.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": True})
    ) == (200, {"releaseSha": SHA, "enabled": True})
    assert storage.alarm_at == 1000001
    restarted = make_control(control_module, storage)
    assert await restarted.is_enabled()
    replacement = make_control(control_module, storage, sha="c" * 40)
    assert not await replacement.is_enabled()
    await replacement.run_alarm(callback)
    callback.assert_not_awaited()
    assert storage.alarm_at is None


@pytest.mark.asyncio
async def test_paused_producers_retain_receipts_without_arming(control_module):
    control = make_control(control_module)
    await control.gated_storage.put("wake-receipts", ["pending-observation"])
    await control.gated_storage.setAlarm(123)
    assert await control.gated_storage.get("wake-receipts") == ["pending-observation"]
    assert await control.gated_storage.getAlarm() is None
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": True})
    )
    await control.gated_storage.setAlarm(123)
    assert await control.gated_storage.getAlarm() == 123
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": False})
    )
    assert await control.gated_storage.get("wake-receipts") == ["pending-observation"]
    assert await control.gated_storage.getAlarm() is None


@pytest.mark.asyncio
async def test_pause_waits_for_entire_alarm_unit(control_module):
    control = make_control(control_module)
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": True})
    )
    started, finish = asyncio.Event(), asyncio.Event()

    async def unit():
        started.set()
        await finish.wait()
        await control.gated_storage.setAlarm(9000)

    running = asyncio.create_task(control.run_alarm(unit))
    await started.wait()
    pause = asyncio.create_task(
        control.handle_request(
            request("POST", body={"releaseSha": SHA, "enabled": False})
        )
    )
    await asyncio.sleep(0)
    assert not pause.done()
    assert await control.is_enabled()
    # Producers remain responsive while the unit runs.
    await control.gated_storage.put("receipt", "committed")
    finish.set()
    await running
    assert await pause == (200, {"releaseSha": SHA, "enabled": False})
    assert control.storage.alarm_at is None
    callback = AsyncMock()
    await control.run_alarm(callback)
    callback.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancelled_unit_retains_rescue_and_releases_pause_lock(control_module):
    control = make_control(control_module)
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": True})
    )
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
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": False})
    )
    assert not await control.is_enabled()
    assert control.storage.alarm_at is None


@pytest.mark.asyncio
async def test_cancelled_pause_persists_disabled_before_alarm_deletion(control_module):
    storage = Storage()
    control = make_control(control_module, storage)
    await control.handle_request(
        request("POST", body={"releaseSha": SHA, "enabled": True})
    )
    deleting = asyncio.Event()

    async def blocked_delete():
        deleting.set()
        await asyncio.Event().wait()

    storage.deleteAlarm = blocked_delete
    pause = asyncio.create_task(
        control.handle_request(
            request("POST", body={"releaseSha": SHA, "enabled": False})
        )
    )
    await deleting.wait()
    pause.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pause
    assert not await make_control(control_module, storage).is_enabled()


@pytest.mark.asyncio
@pytest.mark.parametrize("secret", [None, "forged", "non-ascii-\u00e9"])
async def test_forged_control_does_not_read_body_or_change_state(
    control_module, secret
):
    control = make_control(control_module)
    incoming = request("POST", secret=secret, body={"releaseSha": SHA, "enabled": True})
    status, body = await control.handle_request(incoming)
    assert status == 403
    assert SECRET not in str(body)
    incoming.json.assert_not_awaited()
    assert not control.storage.values
    assert control.storage.alarm_at is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body,status",
    [
        ({"releaseSha": "c" * 40, "enabled": True}, 409),
        ({"releaseSha": SHA, "enabled": "true"}, 400),
        ({"releaseSha": SHA, "enabled": 1}, 400),
        ({"releaseSha": SHA, "enabled": True, "extra": "private"}, 400),
        ([], 400),
    ],
)
async def test_stale_or_invalid_control_is_rejected(control_module, body, status):
    control = make_control(control_module)
    response = await control.handle_request(request("POST", body=body))
    assert response[0] == status
    assert not control.storage.values


@pytest.mark.asyncio
async def test_failed_enable_never_persists_enabled(control_module):
    control = make_control(control_module)
    control.storage.setAlarm = AsyncMock(side_effect=OSError("storage unavailable"))
    with pytest.raises(OSError):
        await control.handle_request(
            request("POST", body={"releaseSha": SHA, "enabled": True})
        )
    assert not await control.is_enabled()


@pytest.mark.parametrize(
    "name,value",
    [
        ("ATLAS_RELEASE_SHA", "invalid-private-value"),
        ("ATLAS_SCHEMA_RECEIPT_DIGEST", "invalid-private-value"),
    ],
)
def test_release_identity_requires_exact_bindings_without_disclosing_input(
    control_module, name, value
):
    env = SimpleNamespace(ATLAS_RELEASE_SHA=SHA, ATLAS_SCHEMA_RECEIPT_DIGEST=DIGEST)
    setattr(env, name, value)
    with pytest.raises(RuntimeError) as error:
        control_module.release_identity(env, "api")
    assert value not in str(error.value)


def test_release_identity_reports_only_exact_metadata(control_module):
    control = make_control(control_module)
    assert control_module.release_identity(control.env, "api") == {
        "releaseSha": SHA,
        "runtimeRole": "api",
        "schemaReceiptDigest": DIGEST,
    }


@pytest.mark.asyncio
async def test_cancelled_enable_leaves_alarm_unauthorized(control_module):
    control = make_control(control_module)
    writing = asyncio.Event()

    async def blocked_put(*_args):
        writing.set()
        await asyncio.Event().wait()

    control.storage.put = blocked_put
    enable = asyncio.create_task(
        control.handle_request(
            request("POST", body={"releaseSha": SHA, "enabled": True})
        )
    )
    await writing.wait()
    assert control.storage.alarm_at is not None
    enable.cancel()
    with pytest.raises(asyncio.CancelledError):
        await enable
    callback = AsyncMock()
    await control.run_alarm(callback)
    callback.assert_not_awaited()
    assert not await control.is_enabled()
    assert control.storage.alarm_at is None


@pytest.mark.asyncio
async def test_invalid_state_never_authorizes_alarm(control_module):
    control = make_control(control_module)
    control.storage.values[control_module._STATE_KEY] = {
        "releaseSha": SHA,
        "enabled": "true",
    }
    callback = AsyncMock()
    with pytest.raises(RuntimeError, match="Invalid durable consumer state"):
        await control.run_alarm(callback)
    callback.assert_not_awaited()


@pytest.mark.asyncio
async def test_invalid_json_and_methods_do_not_change_state(control_module):
    control = make_control(control_module)
    incoming = request("POST")
    incoming.json.side_effect = ValueError("private input")
    assert await control.handle_request(incoming) == (
        400,
        {"error": "Invalid consumer control"},
    )
    assert await control.handle_request(request("PUT")) == (
        405,
        {"error": "Method not allowed"},
    )
    assert not control.storage.values


@pytest.mark.asyncio
async def test_invalid_settings_error_never_discloses_input(
    control_module, monkeypatch
):
    def invalid(_env):
        raise ValueError("private-input-secret")

    monkeypatch.setitem(
        sys.modules, "hosted_application", SimpleNamespace(_settings=invalid)
    )
    control = make_control(control_module)
    with pytest.raises(RuntimeError, match="Invalid hosted API configuration") as error:
        await control.handle_request(request())
    assert "private-input-secret" not in str(error.value)
    assert error.value.__suppress_context__
