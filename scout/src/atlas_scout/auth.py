"""Scout authentication session helpers."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Literal

import httpx

from atlas_scout.config import SCOUT_CONFIG_DIR

if TYPE_CHECKING:
    from pathlib import Path

UploadTarget = Literal["public", "workspace"]

SESSION_PATH = SCOUT_CONFIG_DIR / "session.json"
SCOUT_CLIENT_ID = "atlas-scout-cli"
SCOUT_LOGIN_SCOPE = (
    "openid profile email discovery:read discovery:write entities:write offline_access"
)
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"


class DeviceAuthError(RuntimeError):
    """Raised when the Atlas device authorization flow returns an OAuth error."""

    def __init__(self, *, error: str, description: str) -> None:
        self.error = error
        self.description = description
        super().__init__(f"{error}: {description}")


def _payload_int(payload: dict[str, object], key: str) -> int:
    """Return an integer field from a JSON payload or raise a response error."""
    value = payload[key]
    if isinstance(value, int | float | str):
        return int(value)
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


@dataclass(frozen=True, slots=True)
class DeviceCode:
    """Device authorization code response."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


@dataclass(frozen=True, slots=True)
class DeviceToken:
    """Device authorization token response."""

    access_token: str
    token_type: str
    expires_in: int
    scope: str


@dataclass(frozen=True, slots=True)
class ScoutTokenExchange:
    """Atlas API token exchanged from a Scout browser-approved session."""

    token: str
    user_id: str
    user_email: str
    workspace_id: str | None = None


@dataclass(frozen=True, slots=True)
class ScoutSession:
    """Logged-in Atlas Scout worker session."""

    atlas_url: str
    access_token: str
    worker_id: str
    user_id: str
    user_email: str
    default_upload_target: UploadTarget | None = None
    workspace_id: str | None = None


class DeviceAuthClient:
    """HTTP client for Scout's browser-approved Atlas login flow."""

    async def request_device_code(self, atlas_url: str) -> DeviceCode:
        """Request a device code from Atlas.

        Parameters
        ----------
        atlas_url:
            Base URL for the Atlas app/auth server.

        Returns
        -------
        DeviceCode
            User-facing verification code and polling metadata.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self._auth_url(atlas_url, "/device/code"),
                json={"client_id": SCOUT_CLIENT_ID, "scope": SCOUT_LOGIN_SCOPE},
            )
        payload = self._json_or_error(response)
        return DeviceCode(
            device_code=str(payload["device_code"]),
            user_code=str(payload["user_code"]),
            verification_uri=str(payload["verification_uri"]),
            verification_uri_complete=str(payload["verification_uri_complete"]),
            expires_in=_payload_int(payload, "expires_in"),
            interval=_payload_int(payload, "interval"),
        )

    async def request_device_token(self, atlas_url: str, *, device_code: str) -> DeviceToken:
        """Poll Atlas for the device-flow session token.

        Parameters
        ----------
        atlas_url:
            Base URL for the Atlas app/auth server.
        device_code:
            Opaque code returned by :meth:`request_device_code`.

        Returns
        -------
        DeviceToken
            Browser-approved bearer session token.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self._auth_url(atlas_url, "/device/token"),
                json={
                    "grant_type": DEVICE_GRANT_TYPE,
                    "device_code": device_code,
                    "client_id": SCOUT_CLIENT_ID,
                },
            )
        payload = self._json_or_error(response)
        return DeviceToken(
            access_token=str(payload["access_token"]),
            token_type=str(payload["token_type"]),
            expires_in=_payload_int(payload, "expires_in"),
            scope=str(payload.get("scope", "")),
        )

    async def exchange_session_for_api_token(
        self,
        atlas_url: str,
        *,
        session_token: str,
    ) -> ScoutTokenExchange:
        """Exchange a Scout device session for an API JWT accepted by FastAPI.

        Parameters
        ----------
        atlas_url:
            Base URL for the Atlas app/auth server.
        session_token:
            Bearer session token returned by the device authorization flow.

        Returns
        -------
        ScoutTokenExchange
            Short-lived Atlas API token plus user/workspace metadata.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                self._auth_url(atlas_url, "/scout/token"),
                headers={"Authorization": f"Bearer {session_token}"},
            )
        payload = self._json_or_error(response)
        user = payload.get("user")
        if not isinstance(user, dict):
            raise ValueError("Atlas Scout token response is missing user metadata")
        workspace_id = payload.get("workspace_id")
        if workspace_id is not None and not isinstance(workspace_id, str):
            raise ValueError("Atlas Scout token response field workspace_id must be a string")
        return ScoutTokenExchange(
            token=str(payload["token"]),
            user_id=str(user["id"]),
            user_email=str(user["email"]),
            workspace_id=workspace_id,
        )

    def _auth_url(self, atlas_url: str, path: str) -> str:
        """Build a Better Auth endpoint URL from the Atlas base URL."""
        return f"{atlas_url.rstrip('/')}/api/auth{path}"

    def _json_or_error(self, response: httpx.Response) -> dict[str, object]:
        """Return JSON for successful responses or raise a device auth error."""
        try:
            payload = response.json()
        except ValueError as exc:
            raise DeviceAuthError(
                error=f"http_{response.status_code}",
                description=response.text,
            ) from exc
        if response.is_error:
            error = str(payload.get("error", f"http_{response.status_code}"))
            description = str(payload.get("error_description", response.text))
            raise DeviceAuthError(error=error, description=description)
        if not isinstance(payload, dict):
            raise ValueError("Atlas auth response must be a JSON object")
        return payload


class FileSessionStore:
    """Persist a Scout session in a local JSON file."""

    def __init__(self, path: Path = SESSION_PATH) -> None:
        self.path = path

    def load(self) -> ScoutSession | None:
        """Return the stored Scout session, if present."""
        if not self.path.exists():
            return None
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return ScoutSession(
            atlas_url=str(payload["atlas_url"]),
            access_token=str(payload["access_token"]),
            worker_id=str(payload["worker_id"]),
            user_id=str(payload["user_id"]),
            user_email=str(payload["user_email"]),
            default_upload_target=payload.get("default_upload_target"),
            workspace_id=payload.get("workspace_id"),
        )

    def save(self, session: ScoutSession) -> None:
        """Store a Scout session with user-only file permissions."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(asdict(session), handle, indent=2, sort_keys=True)
            handle.write("\n")
        self.path.chmod(0o600)

    def delete(self) -> None:
        """Remove any stored Scout session."""
        if self.path.exists():
            self.path.unlink()


def load_session() -> ScoutSession | None:
    """Load the default Scout session."""
    return FileSessionStore().load()


def save_session(session: ScoutSession) -> None:
    """Save the default Scout session."""
    FileSessionStore().save(session)


def delete_session() -> None:
    """Delete the default Scout session."""
    FileSessionStore().delete()
