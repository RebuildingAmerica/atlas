"""Scout auth command tests."""

from __future__ import annotations

from click.testing import CliRunner

from atlas_scout.auth import ScoutSession
from atlas_scout.cli import main


def test_auth_status_logged_out(monkeypatch) -> None:
    """Auth status reports when no session exists."""
    import atlas_scout.cli as cli_module

    monkeypatch.setattr(cli_module, "load_session", lambda: None)

    result = CliRunner().invoke(main, ["auth", "status"])

    assert result.exit_code == 0
    assert "Not logged in" in result.output


def test_auth_status_logged_in_with_workspace(monkeypatch) -> None:
    """Auth status shows session metadata without leaking the token."""
    import atlas_scout.cli as cli_module

    monkeypatch.setattr(
        cli_module,
        "load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="secret-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
            default_upload_target="workspace",
            workspace_id="org-123",
        ),
    )

    result = CliRunner().invoke(main, ["auth", "status"])

    assert result.exit_code == 0
    assert "user@example.org" in result.output
    assert "worker-123" in result.output
    assert "org-123" in result.output
    assert "OS credential store" in result.output
    assert "secret-token" not in result.output


def test_auth_status_logged_in_without_workspace(monkeypatch) -> None:
    """Auth status marks upload target as unset when the user has not chosen one."""
    import atlas_scout.cli as cli_module

    monkeypatch.setattr(
        cli_module,
        "load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="secret-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        ),
    )

    result = CliRunner().invoke(main, ["auth", "status"])

    assert result.exit_code == 0
    assert "not set" in result.output
    assert "Workspace:" not in result.output


def test_whoami_logged_out(monkeypatch) -> None:
    """whoami reports when Scout is logged out."""
    import atlas_scout.cli as cli_module

    monkeypatch.setattr(cli_module, "load_session", lambda: None)

    result = CliRunner().invoke(main, ["whoami"])

    assert result.exit_code == 0
    assert "Not logged in" in result.output


def test_whoami_logged_in(monkeypatch) -> None:
    """whoami prints the signed-in Atlas email."""
    import atlas_scout.cli as cli_module

    monkeypatch.setattr(
        cli_module,
        "load_session",
        lambda: ScoutSession(
            atlas_url="https://atlas.example",
            access_token="secret-token",
            worker_id="worker-123",
            user_id="user-123",
            user_email="user@example.org",
        ),
    )

    result = CliRunner().invoke(main, ["whoami"])

    assert result.exit_code == 0
    assert "user@example.org" in result.output


def test_logout_deletes_local_session(monkeypatch) -> None:
    """logout removes the local Scout credentials."""
    import atlas_scout.cli as cli_module

    deleted: list[bool] = []
    monkeypatch.setattr(cli_module, "delete_session", lambda: deleted.append(True))

    result = CliRunner().invoke(main, ["logout"])

    assert result.exit_code == 0
    assert deleted == [True]
    assert "Logged out" in result.output


def test_logout_reports_local_credential_delete_failure(monkeypatch) -> None:
    """Credential store failures stay visible when logout cannot clear secrets."""
    import atlas_scout.cli as cli_module
    from atlas_scout.credentials import CredentialStoreError

    def fail_delete_session() -> None:
        raise CredentialStoreError("Keychain unavailable")

    monkeypatch.setattr(cli_module, "delete_session", fail_delete_session)

    result = CliRunner().invoke(main, ["logout"])

    assert result.exit_code != 0
    assert "could not remove local credentials" in result.output
