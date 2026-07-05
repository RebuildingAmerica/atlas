"""Scout login device-token polling tests."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

import atlas_scout.cli as cli_module
from atlas_scout.auth import DeviceAuthError, DeviceCode, DeviceToken
from atlas_scout.cli import _poll_device_token

if TYPE_CHECKING:
    from collections.abc import Sequence


def _code(*, interval: int = 5, expires_in: int = 30) -> DeviceCode:
    return DeviceCode(
        device_code="device-code",
        user_code="ABCD-EFGH",
        verification_uri="https://atlas.example/device",
        verification_uri_complete="https://atlas.example/device?user_code=ABCD-EFGH",
        expires_in=expires_in,
        interval=interval,
    )


def _token() -> DeviceToken:
    return DeviceToken(
        access_token="device-session-token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile email",
    )


class SequencedTokenClient:
    def __init__(self, results: Sequence[DeviceToken | DeviceAuthError]) -> None:
        self.results = list(results)

    async def request_device_token(self, atlas_url: str, *, device_code: str) -> DeviceToken:
        assert atlas_url == "https://atlas.example"
        assert device_code == "device-code"
        result = self.results.pop(0)
        if isinstance(result, DeviceAuthError):
            raise result
        return result


def _freeze_monotonic(monkeypatch: pytest.MonkeyPatch, values: Sequence[float]) -> None:
    readings = list(values)

    class FakeTime:
        @staticmethod
        def monotonic() -> float:
            if len(readings) > 1:
                return readings.pop(0)
            return readings[0]

    monkeypatch.setattr(cli_module, "time", FakeTime)


def _capture_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr(cli_module.asyncio, "sleep", fake_sleep)
    return sleeps


@pytest.mark.asyncio
async def test_pending_authorization_waits_before_polling_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pending browser approval waits for the server-provided interval."""
    sleeps = _capture_sleep(monkeypatch)
    _freeze_monotonic(monkeypatch, [0.0, 0.0, 1.0])
    client = SequencedTokenClient(
        [
            DeviceAuthError(error="authorization_pending", description="Pending"),
            _token(),
        ]
    )

    token = await _poll_device_token(client, "https://atlas.example", _code(interval=0))

    assert token.access_token == "device-session-token"
    assert sleeps == [1]


@pytest.mark.asyncio
async def test_slow_down_extends_the_poll_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    """Better Auth can ask Scout to slow polling without failing login."""
    sleeps = _capture_sleep(monkeypatch)
    _freeze_monotonic(monkeypatch, [0.0, 0.0, 1.0])
    client = SequencedTokenClient(
        [
            DeviceAuthError(error="slow_down", description="Slow down"),
            _token(),
        ]
    )

    token = await _poll_device_token(client, "https://atlas.example", _code(interval=2))

    assert token.access_token == "device-session-token"
    assert sleeps == [7]


@pytest.mark.asyncio
async def test_network_error_backs_off_before_polling_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transient auth transport failures reduce polling frequency instead of ending login."""
    sleeps = _capture_sleep(monkeypatch)
    _freeze_monotonic(monkeypatch, [0.0, 0.0, 1.0])
    client = SequencedTokenClient(
        [
            DeviceAuthError(error="network_error", description=""),
            _token(),
        ]
    )

    token = await _poll_device_token(client, "https://atlas.example", _code(interval=2))

    assert token.access_token == "device-session-token"
    assert sleeps == [4]


@pytest.mark.asyncio
async def test_access_denied_stops_polling(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-retryable OAuth errors should surface immediately."""
    _freeze_monotonic(monkeypatch, [0.0, 0.0])
    client = SequencedTokenClient([DeviceAuthError(error="access_denied", description="Denied")])

    with pytest.raises(DeviceAuthError) as exc_info:
        await _poll_device_token(client, "https://atlas.example", _code())

    assert exc_info.value.error == "access_denied"


@pytest.mark.asyncio
async def test_expired_device_code_stops_polling(monkeypatch: pytest.MonkeyPatch) -> None:
    """Scout exits when approval does not arrive before the device code expires."""
    _freeze_monotonic(monkeypatch, [0.0, 1.0])
    client = SequencedTokenClient([])

    with pytest.raises(DeviceAuthError) as exc_info:
        await _poll_device_token(
            client,
            "https://atlas.example",
            _code(expires_in=0),
        )

    assert exc_info.value.error == "expired_token"
