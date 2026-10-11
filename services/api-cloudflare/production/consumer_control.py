"""Release-bound consumer controls preserve inbox updates through publication.

Fresh objects are paused. Pausing waits for the entire current alarm unit, so
publication can verify a stopped consumer before replacing its release.
Producer receipts remain durable while work is paused.
"""

import asyncio
import re
from secrets import compare_digest
from time import time

from workers import Response


_STATE_KEY = "atlas:consumers:v1"
_HEADERS = {"Cache-Control": "private, no-store"}


def release_identity(env, runtime_role):
    """Return validated release metadata without reading request configuration."""
    sha = getattr(env, "ATLAS_RELEASE_SHA", None)
    digest = getattr(env, "ATLAS_SCHEMA_RECEIPT_DIGEST", None)
    if (
        runtime_role not in ("api", "discovery")
        or not isinstance(sha, str)
        or re.fullmatch("[a-f0-9]{40}", sha) is None
        or not isinstance(digest, str)
        or re.fullmatch("[a-f0-9]{64}", digest) is None
    ):
        raise RuntimeError("Invalid production release configuration.")
    return {
        "releaseSha": sha,
        "runtimeRole": runtime_role,
        "schemaReceiptDigest": digest,
    }


class _GatedStorage:
    """Delegate receipts while scheduling work only for enabled consumers."""

    def __init__(self, control):
        self.control = control

    async def get(self, key):
        return await self.control.storage.get(key)

    async def put(self, key, value):
        await self.control.storage.put(key, value)

    async def getAlarm(self):
        return await self.control.storage.getAlarm()

    async def setAlarm(self, at):
        async with self.control._state_gate:
            if await self.control._enabled_unlocked():
                await self.control.storage.setAlarm(at)

    async def deleteAlarm(self):
        async with self.control._state_gate:
            await self.control.storage.deleteAlarm()


class ConsumerControl:
    """Serialize release state changes against one complete alarm unit.

    Parameters
    ----------
    env
        Explicit release bindings and the original production settings JSON.
    storage
        This object's durable storage; receipt state is retained across pauses.
    clock
        Epoch-seconds clock used only to arm immediate and rescue alarms.
    """

    def __init__(self, env, storage, *, clock=time):
        self.env = env
        self.storage = storage
        self.release_sha = release_identity(env, "api")["releaseSha"]
        self.clock = clock
        self._unit_gate = asyncio.Lock()
        self._state_gate = asyncio.Lock()
        self.gated_storage = _GatedStorage(self)

    @property
    def settings(self):
        if not hasattr(self, "_settings"):
            from hosted_application import _settings

            try:
                self._settings = _settings(self.env)
            except Exception:
                raise RuntimeError("Invalid hosted API configuration.") from None
        return self._settings

    async def _enabled_unlocked(self):
        state = await self.storage.get(_STATE_KEY)
        if state is None:
            return False
        if (
            not isinstance(state, dict)
            or set(state) != {"releaseSha", "enabled"}
            or not isinstance(state["releaseSha"], str)
            or re.fullmatch("[a-f0-9]{40}", state["releaseSha"]) is None
            or type(state["enabled"]) is not bool
        ):
            raise RuntimeError("Invalid durable consumer state.")
        return state["releaseSha"] == self.release_sha and state["enabled"]

    async def is_enabled(self):
        async with self._state_gate:
            return await self._enabled_unlocked()

    def _response(self, body, status=200):
        return Response.json(body, status=status, headers=_HEADERS)

    async def handle_request(self, request):
        """Authenticate and report or change the exact release's durable state."""
        supplied = request.headers.get("x-atlas-internal-secret")
        expected = self.settings.auth_internal_secret
        if (
            not isinstance(supplied, str)
            or not supplied
            or not expected
            or not compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))
        ):
            return self._response({"error": "Forbidden"}, 403)
        if request.method == "GET":
            return self._response(
                {"releaseSha": self.release_sha, "enabled": await self.is_enabled()}
            )
        if request.method != "POST":
            return self._response({"error": "Method not allowed"}, 405)
        try:
            body = await request.json()
        except Exception:
            return self._response({"error": "Invalid consumer control"}, 400)
        if (
            not isinstance(body, dict)
            or set(body) != {"releaseSha", "enabled"}
            or type(body["enabled"]) is not bool
            or not isinstance(body["releaseSha"], str)
        ):
            return self._response({"error": "Invalid consumer control"}, 400)
        if body["releaseSha"] != self.release_sha:
            return self._response({"error": "Release does not match"}, 409)
        async with self._unit_gate:
            async with self._state_gate:
                if body["enabled"]:
                    # Arm first. Interruption before the durable write leaves a
                    # paused alarm which cannot perform database work.
                    await self.storage.setAlarm(int(self.clock() * 1000) + 1)
                await self.storage.put(_STATE_KEY, body)
                if not body["enabled"]:
                    # Persist the stop before deleting the alarm. Cancellation
                    # cannot leave a stale alarm authorized to claim work.
                    await self.storage.deleteAlarm()
                return self._response(
                    {
                        "releaseSha": self.release_sha,
                        "enabled": await self._enabled_unlocked(),
                    }
                )

    async def run_alarm(self, run_one):
        """Run one bounded unit only while this release is durably enabled."""
        async with self._unit_gate:
            async with self._state_gate:
                if not await self._enabled_unlocked():
                    await self.storage.deleteAlarm()
                    return None
                # Cover configuration/package failures before an adapter can
                # arrange its own lease recovery. No database access occurs here.
                await self.storage.setAlarm(int(self.clock() * 1000) + 60_000)
            return await run_one()
