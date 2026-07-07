"""Scout authentication session helpers.

Public API facade over the auth/ package: the browser-approved device
authorization flow (device_client, errors, models), local session
persistence (session_store), and credential-store backend selection
(credential_store).
"""

from __future__ import annotations

from atlas_scout.auth.credential_store import (
    E2E_FILE_CREDENTIAL_STORE,
    E2E_FILE_CREDENTIAL_STORE_ENV,
    SESSION_CREDENTIAL_STORE,
    E2EFileCredentialStore,
    default_session_credential_store,
)
from atlas_scout.auth.device_client import (
    ATLAS_AUTH_BASE_PATH,
    DEVICE_CODE_PATH,
    DEVICE_GRANT_TYPE,
    DEVICE_TOKEN_PATH,
    SCOUT_CLIENT_ID,
    SCOUT_LOGIN_SCOPE,
    SCOUT_TOKEN_PATH,
    DeviceAuthClient,
)
from atlas_scout.auth.errors import DeviceAuthError
from atlas_scout.auth.models import (
    DeviceCode,
    DeviceToken,
    ScoutSession,
    ScoutTokenExchange,
    UploadTarget,
)
from atlas_scout.auth.session_store import (
    SESSION_PATH,
    FileSessionStore,
    delete_session,
    load_session,
    save_session,
)

__all__ = [
    "ATLAS_AUTH_BASE_PATH",
    "DEVICE_CODE_PATH",
    "DEVICE_GRANT_TYPE",
    "DEVICE_TOKEN_PATH",
    "E2E_FILE_CREDENTIAL_STORE",
    "E2E_FILE_CREDENTIAL_STORE_ENV",
    "SCOUT_CLIENT_ID",
    "SCOUT_LOGIN_SCOPE",
    "SCOUT_TOKEN_PATH",
    "SESSION_CREDENTIAL_STORE",
    "SESSION_PATH",
    "DeviceAuthClient",
    "DeviceAuthError",
    "DeviceCode",
    "DeviceToken",
    "E2EFileCredentialStore",
    "FileSessionStore",
    "ScoutSession",
    "ScoutTokenExchange",
    "UploadTarget",
    "default_session_credential_store",
    "delete_session",
    "load_session",
    "save_session",
]
