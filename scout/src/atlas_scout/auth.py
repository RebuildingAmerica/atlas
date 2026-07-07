"""Scout authentication session helpers."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Literal

import httpx

from atlas_scout.config import SCOUT_CONFIG_DIR
from atlas_scout.credentials import (
    SESSION_TOKEN_ACCOUNT,
    CredentialStore,
    CredentialStoreError,
    SystemCredentialStore,
)
from atlas_scout.shared.atlas_urls import verify_for_atlas_url

if TYPE_CHECKING:
    from pathlib import Path

UploadTarget = Literal["public", "workspace"]

SESSION_PATH = SCOUT_CONFIG_DIR / "session.json"
SESSION_CREDENTIAL_STORE = "system"
E2E_FILE_CREDENTIAL_STORE = "e2e-file"
E2E_FILE_CREDENTIAL_STORE_ENV = "ATLAS_SCOUT_E2E_FILE_CREDENTIAL_STORE"
SCOUT_CLIENT_ID = "atlas-scout-cli"
SCOUT_LOGIN_SCOPE = (
    "openid profile email discovery:read discovery:write entities:write offline_access"
)
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
ATLAS_AUTH_BASE_PATH = "/api/auth"
DEVICE_CODE_PATH = "/device/code"
DEVICE_TOKEN_PATH = "/device/token"
SCOUT_TOKEN_PATH = "/scout/token"


class DeviceAuthError(RuntimeError):
    """Raised when the Atlas device authorization flow returns an OAuth error."""

    def __init__(
        self,
        *,
        error: str,
        description: str,
        status_code: int | None = None,
        url: str | None = None,
        content_type: str | None = None,
    ) -> None:
        self.error = error
        self.description = description
        self.status_code = status_code
        self.url = url
        self.content_type = content_type
        message = f"{error}: {description}" if description else error
        super().__init__(message)


def _payload_int(payload: dict[str, object], key: str) -> int:
    """Return an integer field from a JSON payload or raise a response error."""
    value = payload.get(key)
    if isinstance(value, bool):
        raise DeviceAuthError(
            error="invalid_response",
            description=f"Atlas returned an invalid {key} value.",
        )
    if isinstance(value, int | float | str):
        try:
            return int(value)
        except (TypeError, ValueError) as exc:
            raise DeviceAuthError(
                error="invalid_response",
                description=f"Atlas returned an invalid {key} value.",
            ) from exc
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def _payload_str(payload: dict[str, object], key: str) -> str:
    """Return a string field from a JSON payload or raise a response error."""
    value = payload.get(key)
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def _optional_payload_str(payload: dict[str, object], key: str, default: str = "") -> str:
    """Return an optional string field from a JSON payload."""
    value = payload.get(key, default)
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def _optional_payload_str_or_none(payload: dict[str, object], key: str) -> str | None:
    """Return an optional nullable string field from a JSON payload."""
    value = payload.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        return value
    raise DeviceAuthError(
        error="invalid_response",
        description=f"Atlas returned an invalid {key} value.",
    )


def _optional_payload_int(payload: dict[str, object], key: str, default: int) -> int:
    """Return an optional integer field from a JSON payload."""
    if key not in payload:
        return default
    return _payload_int(payload, key)


@dataclass(frozen=True, slots=True)
class DeviceCode:
    """Device authorization code response."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str | None
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
    worker_id: str
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
    worker_name: str | None = None
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
        try:
            async with httpx.AsyncClient(
                timeout=30.0,
                verify=verify_for_atlas_url(atlas_url),
            ) as client:
                response = await client.post(
                    self._device_url(atlas_url, DEVICE_CODE_PATH),
                    json={"client_id": SCOUT_CLIENT_ID, "scope": SCOUT_LOGIN_SCOPE},
                )
        except httpx.RequestError as exc:
            raise self._request_error(exc, self._device_url(atlas_url, DEVICE_CODE_PATH)) from exc
        payload = self._json_or_error(response)
        return DeviceCode(
            device_code=_payload_str(payload, "device_code"),
            user_code=_payload_str(payload, "user_code"),
            verification_uri=_payload_str(payload, "verification_uri"),
            verification_uri_complete=_optional_payload_str_or_none(
                payload, "verification_uri_complete"
            ),
            expires_in=_payload_int(payload, "expires_in"),
            interval=_optional_payload_int(payload, "interval", 5),
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
        try:
            async with httpx.AsyncClient(
                timeout=30.0,
                verify=verify_for_atlas_url(atlas_url),
            ) as client:
                response = await client.post(
                    self._device_url(atlas_url, DEVICE_TOKEN_PATH),
                    json={
                        "grant_type": DEVICE_GRANT_TYPE,
                        "device_code": device_code,
                        "client_id": SCOUT_CLIENT_ID,
                    },
                )
        except httpx.RequestError as exc:
            raise self._request_error(exc, self._device_url(atlas_url, DEVICE_TOKEN_PATH)) from exc
        payload = self._json_or_error(response)
        return DeviceToken(
            access_token=_payload_str(payload, "access_token"),
            token_type=_payload_str(payload, "token_type"),
            expires_in=_payload_int(payload, "expires_in"),
            scope=_optional_payload_str(payload, "scope"),
        )

    async def exchange_session_for_api_token(
        self,
        atlas_url: str,
        *,
        session_token: str,
        worker_name: str,
        default_upload_target: UploadTarget,
        worker_id: str | None = None,
        workspace_id: str | None = None,
        search_key_configured: bool = False,
    ) -> ScoutTokenExchange:
        """Exchange a Scout device session for an API JWT accepted by FastAPI.

        Parameters
        ----------
        atlas_url:
            Base URL for the Atlas app/auth server.
        session_token:
            Bearer session token returned by the device authorization flow.
        worker_name:
            Human-recognizable name for this host device.
        default_upload_target:
            Destination Scout should use when syncing runs without an override.
        worker_id:
            Existing device enrollment id, when refreshing a saved session.
        workspace_id:
            Workspace to remember for workspace-private uploads, if selected.
        search_key_configured:
            Whether this Scout host currently has local search credentials.

        Returns
        -------
        ScoutTokenExchange
            Short-lived Atlas API token plus user/workspace metadata.
        """
        try:
            async with httpx.AsyncClient(
                timeout=30.0,
                verify=verify_for_atlas_url(atlas_url),
            ) as client:
                response = await client.post(
                    self._auth_url(atlas_url, SCOUT_TOKEN_PATH),
                    headers={"Authorization": f"Bearer {session_token}"},
                    json={
                        "default_upload_target": default_upload_target,
                        "search_key_configured": search_key_configured,
                        "worker_id": worker_id,
                        "worker_name": worker_name,
                        "workspace_id": workspace_id,
                    },
                )
        except httpx.RequestError as exc:
            raise self._request_error(exc, self._auth_url(atlas_url, SCOUT_TOKEN_PATH)) from exc
        payload = self._json_or_error(response)
        user = payload.get("user")
        if not isinstance(user, dict):
            raise ValueError("Atlas Scout token response is missing user metadata")
        workspace_id_value = payload.get("workspace_id")
        if workspace_id_value is not None and not isinstance(workspace_id_value, str):
            raise ValueError("Atlas Scout token response field workspace_id must be a string")
        resolved_workspace_id = workspace_id_value if isinstance(workspace_id_value, str) else None
        return ScoutTokenExchange(
            token=_payload_str(payload, "token"),
            worker_id=_payload_str(payload, "worker_id"),
            user_id=_payload_str(user, "id"),
            user_email=_payload_str(user, "email"),
            workspace_id=resolved_workspace_id,
        )

    def _auth_url(self, atlas_url: str, path: str) -> str:
        """Build a Better Auth endpoint URL from the Atlas base URL."""
        return f"{atlas_url.rstrip('/')}{ATLAS_AUTH_BASE_PATH}{path}"

    def _device_url(self, atlas_url: str, path: str) -> str:
        """Build a canonical Atlas device authorization URL."""
        return f"{atlas_url.rstrip('/')}{path}"

    def _request_error(self, exc: httpx.RequestError, fallback_url: str) -> DeviceAuthError:
        """Convert transport failures into structured auth errors."""
        request = exc.request
        url = str(request.url) if request is not None else fallback_url
        return DeviceAuthError(error="network_error", description="", url=url)

    def _response_url(self, response: httpx.Response) -> str:
        """Return the concrete URL used for an HTTP auth response."""
        try:
            return str(response.request.url)
        except RuntimeError:
            return str(response.url)

    def _http_error_description(self, payload: dict[str, object] | None = None) -> str:
        """Build a concrete auth error message from an HTTP response."""
        if payload is not None:
            for key in ("error_description", "message", "detail"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return ""

    def _json_or_error(self, response: httpx.Response) -> dict[str, object]:
        """Return JSON for successful responses or raise a device auth error."""
        response_url = self._response_url(response)
        content_type = response.headers.get("content-type")
        try:
            payload = response.json()
        except ValueError as exc:
            raise DeviceAuthError(
                error=f"http_{response.status_code}",
                description=self._http_error_description(),
                status_code=response.status_code,
                url=response_url,
                content_type=content_type,
            ) from exc
        if response.is_error:
            if not isinstance(payload, dict):
                raise DeviceAuthError(
                    error=f"http_{response.status_code}",
                    description="",
                    status_code=response.status_code,
                    url=response_url,
                    content_type=content_type,
                )
            error_value = payload.get("error")
            error = str(error_value).strip() if error_value else f"http_{response.status_code}"
            description = self._http_error_description(payload)
            raise DeviceAuthError(
                error=error,
                description=description,
                status_code=response.status_code,
                url=response_url,
                content_type=content_type,
            )
        if not isinstance(payload, dict):
            raise DeviceAuthError(
                error="invalid_response",
                description="Atlas auth response must be a JSON object",
                status_code=response.status_code,
                url=response_url,
                content_type=content_type,
            )
        return payload


class FileSessionStore:
    """Persist a Scout session in a local JSON file."""

    def __init__(
        self,
        path: Path = SESSION_PATH,
        credential_store: CredentialStore | None = None,
        credential_store_name: str | None = None,
    ) -> None:
        self.path = path
        default_store, default_name = default_session_credential_store(path)
        self.credential_store = credential_store or default_store
        self.credential_store_name = credential_store_name or (
            SESSION_CREDENTIAL_STORE if credential_store is not None else default_name
        )

    def load(self) -> ScoutSession | None:
        """Return the stored Scout session, if present."""
        if not self.path.exists():
            return None
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if "access_token" in payload:
            raise CredentialStoreError(
                "Legacy plaintext Scout session file found. Delete it and run `scout login`."
            )
        if payload.get("credential_store") != self.credential_store_name:
            raise CredentialStoreError(
                "Scout session metadata uses a different credential store. "
                "Delete it and run `scout login`."
            )
        access_token = self.credential_store.load_secret(SESSION_TOKEN_ACCOUNT)
        if access_token is None:
            raise CredentialStoreError(
                "Scout session metadata exists, but the OS credential store token is missing. "
                "Run `scout logout` and `scout login`."
            )
        worker_name = payload.get("worker_name")
        if worker_name is not None and not isinstance(worker_name, str):
            raise ValueError("Scout session field worker_name must be a string")
        return ScoutSession(
            atlas_url=str(payload["atlas_url"]),
            access_token=access_token,
            worker_id=str(payload["worker_id"]),
            user_id=str(payload["user_id"]),
            user_email=str(payload["user_email"]),
            worker_name=worker_name,
            default_upload_target=payload.get("default_upload_target"),
            workspace_id=payload.get("workspace_id"),
        )

    def save(self, session: ScoutSession) -> None:
        """Store session metadata on disk and the token in OS credential storage."""
        self.credential_store.save_secret(SESSION_TOKEN_ACCOUNT, session.access_token)
        payload = asdict(session)
        payload.pop("access_token")
        payload["credential_store"] = self.credential_store_name
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        self.path.chmod(0o600)

    def delete(self) -> None:
        """Remove any stored Scout session."""
        self.credential_store.delete_secret(SESSION_TOKEN_ACCOUNT)
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


class E2EFileCredentialStore:
    """Non-interactive credential store used only by Playwright e2e runs."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def save_secret(self, account: str, value: str) -> None:
        """Store one secret value in the e2e credential file."""
        secret = value.strip()
        if not secret:
            raise CredentialStoreError("Secret value is required.")
        credentials = self._read()
        credentials[account] = secret
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as handle:
            json.dump(credentials, handle, indent=2, sort_keys=True)
            handle.write("\n")
        self.path.chmod(0o600)

    def load_secret(self, account: str) -> str | None:
        """Return one secret value from the e2e credential file."""
        value = self._read().get(account)
        return value.strip() if isinstance(value, str) and value.strip() else None

    def delete_secret(self, account: str) -> bool:
        """Delete one secret value from the e2e credential file."""
        credentials = self._read()
        if account not in credentials:
            return False
        credentials.pop(account)
        if credentials:
            with self.path.open("w", encoding="utf-8") as handle:
                json.dump(credentials, handle, indent=2, sort_keys=True)
                handle.write("\n")
            self.path.chmod(0o600)
        elif self.path.exists():
            self.path.unlink()
        return True

    def _read(self) -> dict[str, str]:
        if not self.path.exists():
            return {}
        with self.path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise CredentialStoreError("E2E credential file must contain a JSON object.")
        return {str(key): str(value) for key, value in payload.items()}


def default_session_credential_store(path: Path) -> tuple[CredentialStore, str]:
    """Return the credential store Scout should use for session persistence."""
    if os.environ.get(E2E_FILE_CREDENTIAL_STORE_ENV) == "1":
        return E2EFileCredentialStore(
            path.with_suffix(".credentials.json")
        ), E2E_FILE_CREDENTIAL_STORE
    return SystemCredentialStore(), SESSION_CREDENTIAL_STORE
