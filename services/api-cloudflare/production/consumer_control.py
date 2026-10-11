"""Release-bound consumer controls preserve inbox updates through publication.

Fresh objects are paused. Pausing waits for the entire current alarm unit, so
publication can verify a stopped consumer before replacing its release.
Producer receipts remain durable while work is paused.
"""

import asyncio
import re
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

    def _desired_enabled(self):
        active = getattr(self.env, "ATLAS_ACTIVE_RELEASE_SHA", None)
        if not isinstance(active, str) or (
            active and re.fullmatch("[a-f0-9]{40}", active) is None
        ):
            raise RuntimeError("Invalid consumer activation binding.")
        return active == self.release_sha

    async def _state_unlocked(self):
        state = await self.storage.get(_STATE_KEY)
        if state is not None and (
            not isinstance(state, dict)
            or set(state) != {"releaseSha", "enabled"}
            or not isinstance(state["releaseSha"], str)
            or re.fullmatch("[a-f0-9]{40}", state["releaseSha"]) is None
            or type(state["enabled"]) is not bool
        ):
            raise RuntimeError("Invalid durable consumer state.")
        return state

    async def _enabled_unlocked(self):
        state = await self._state_unlocked()
        return bool(
            self._desired_enabled()
            and state is not None
            and state["releaseSha"] == self.release_sha
            and state["enabled"]
        )

    async def _reconcile_unlocked(self):
        desired = {"releaseSha": self.release_sha, "enabled": self._desired_enabled()}
        if await self._state_unlocked() != desired:
            if desired["enabled"]:
                # The deployment authorizes activation. Arm first, then retain
                # its receipt; interruption cannot run work before reconciliation.
                await self.storage.setAlarm(int(self.clock() * 1000) + 1)
            await self.storage.put(_STATE_KEY, desired)
        if not desired["enabled"]:
            # Persist the pause before deleting its alarm. A canceled readback
            # leaves the deployment paused and retained receipts untouched.
            await self.storage.deleteAlarm()

    async def is_enabled(self):
        async with self._state_gate:
            return await self._enabled_unlocked()

    def _response(self, body, status=200):
        return Response.json(body, status=status, headers=_HEADERS)

    async def handle_request(self, request):
        """Read deployment-authorized state after the entire alarm unit drains.

        This endpoint is reachable only through bindings. The public Worker
        refuses every request and the operations edge independently checks Access.
        Consumer authority belongs to exact Cloudflare deployment configuration,
        never to a header supplied by the visitor or an HTTP mutation.
        """
        if request.method != "GET":
            return self._response({"error": "Method not allowed"}, 405)
        async with self._unit_gate:
            async with self._state_gate:
                await self._reconcile_unlocked()
                return self._response(
                    {
                        "releaseSha": self.release_sha,
                        "activeReleaseSha": self.env.ATLAS_ACTIVE_RELEASE_SHA,
                        "enabled": await self._enabled_unlocked(),
                    }
                )

    async def run_alarm(self, run_one):
        """Run one bounded unit only while this release is durably enabled."""
        async with self._unit_gate:
            async with self._state_gate:
                await self._reconcile_unlocked()
                if not await self._enabled_unlocked():
                    await self.storage.deleteAlarm()
                    return None
                # Cover configuration/package failures before an adapter can
                # arrange its own lease recovery. No database access occurs here.
                await self.storage.setAlarm(int(self.clock() * 1000) + 60_000)
            return await run_one()
