"""HTTP client for Scout's browser-approved Atlas device authorization flow."""

from __future__ import annotations

import httpx

from atlas_scout.auth.errors import (
    DeviceAuthError,
    optional_payload_int,
    optional_payload_str,
    optional_payload_str_or_none,
    payload_int,
    payload_str,
)
from atlas_scout.auth.models import DeviceCode, DeviceToken, ScoutTokenExchange, UploadTarget
from atlas_scout.shared.atlas_urls import verify_for_atlas_url

SCOUT_CLIENT_ID = "atlas-scout-cli"
SCOUT_LOGIN_SCOPE = (
    "openid profile email discovery:read discovery:write entities:write offline_access"
)
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
ATLAS_AUTH_BASE_PATH = "/api/auth"
DEVICE_CODE_PATH = "/device/code"
DEVICE_TOKEN_PATH = "/device/token"
SCOUT_TOKEN_PATH = "/scout/token"


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
            device_code=payload_str(payload, "device_code"),
            user_code=payload_str(payload, "user_code"),
            verification_uri=payload_str(payload, "verification_uri"),
            verification_uri_complete=optional_payload_str_or_none(
                payload, "verification_uri_complete"
            ),
            expires_in=payload_int(payload, "expires_in"),
            interval=optional_payload_int(payload, "interval", 5),
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
            access_token=payload_str(payload, "access_token"),
            token_type=payload_str(payload, "token_type"),
            expires_in=payload_int(payload, "expires_in"),
            scope=optional_payload_str(payload, "scope"),
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
            token=payload_str(payload, "token"),
            worker_id=payload_str(payload, "worker_id"),
            user_id=payload_str(user, "id"),
            user_email=payload_str(user, "email"),
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
