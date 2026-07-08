"""Tests for Atlas MCP elicitation helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from atlas.platform.mcp import elicitation as elicitation_module
from atlas.platform.mcp.elicitation import (
    build_first_party_elicitation_url,
    complete_url_elicitation_state,
    create_url_elicitation_state,
    get_url_elicitation_state,
    has_completed_url_elicitation,
)
from tests.support.mcp_elicitation import _assert_log_omits_private_values


class TestUrlElicitationState:
    def test_first_party_url_only_has_id(self) -> None:
        url = build_first_party_elicitation_url(
            public_url="https://atlas.example.com/app/",
            path="/account",
            elicitation_id="eli_1",
        )

        assert url == "https://atlas.example.com/account?mcpElicitationId=eli_1"

    def test_build_first_party_url_rejects_relative_public_url(self) -> None:
        with pytest.raises(ValueError, match="absolute URL"):
            build_first_party_elicitation_url(
                public_url="/relative",
                path="/account",
                elicitation_id="eli_1",
            )

    def test_url_state_is_retrievable_before_expiry(self) -> None:
        now = datetime.now(UTC)
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=now,
        )

        assert state.user_id == "user_1"
        assert state.org_id == "org_1"
        assert state.expires_at == now + timedelta(minutes=15)
        assert get_url_elicitation_state(state.elicitation_id) == state

    def test_expired_url_state_is_not_returned(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=datetime(2000, 1, 1, tzinfo=UTC),
        )

        assert get_url_elicitation_state(state.elicitation_id) is None

    def test_completed_url_state_matching_ignores_unusable_states(self) -> None:
        elicitation_module._URL_ELICITATION_STATES.clear()  # noqa: SLF001
        expired = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="api_key_settings",
            target_url="/account",
            now=datetime(2000, 1, 1, tzinfo=UTC),
        )
        expired = expired.__class__(
            elicitation_id=expired.elicitation_id,
            user_id=expired.user_id,
            org_id=expired.org_id,
            target_flow=expired.target_flow,
            target_url=expired.target_url,
            created_at=expired.created_at,
            expires_at=expired.expires_at,
            session=expired.session,
            completed_at=datetime(2000, 1, 1, tzinfo=UTC),
        )
        elicitation_module._URL_ELICITATION_STATES[expired.elicitation_id] = expired  # noqa: SLF001
        completed = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )
        completed = completed.__class__(
            elicitation_id=completed.elicitation_id,
            user_id=completed.user_id,
            org_id=completed.org_id,
            target_flow=completed.target_flow,
            target_url=completed.target_url,
            created_at=completed.created_at,
            expires_at=completed.expires_at,
            session=completed.session,
            completed_at=datetime.now(UTC),
        )
        elicitation_module._URL_ELICITATION_STATES[completed.elicitation_id] = completed  # noqa: SLF001

        assert (
            has_completed_url_elicitation(
                target_flow=expired.target_flow,
                user_id=expired.user_id,
                org_id=expired.org_id,
            )
            is False
        )
        assert (
            has_completed_url_elicitation(
                target_flow=completed.target_flow,
                user_id=completed.user_id,
                org_id="other_org",
            )
            is False
        )
        assert (
            has_completed_url_elicitation(
                target_flow=completed.target_flow,
                user_id=completed.user_id,
                org_id=completed.org_id,
            )
            is True
        )

    @pytest.mark.asyncio
    async def test_expired_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            now=datetime(2000, 1, 1, tzinfo=UTC),
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "expired"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "org_1", "mcpElicitationId"},
        )

    @pytest.mark.asyncio
    async def test_unknown_completion_logs_generic_event(self) -> None:
        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                "missing_elicitation",
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "url_completion_notification"
        assert log_mock.await_args.kwargs["action"] == "unknown"

    @pytest.mark.asyncio
    async def test_matching_actor_completes_url_state(self) -> None:
        session = SimpleNamespace(send_elicit_complete=AsyncMock())
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            session=session,
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        assert completed is not None
        assert completed.completed_at is not None
        assert completed.target_flow == "billing_settings"
        assert get_url_elicitation_state(state.elicitation_id) is None
        session.send_elicit_complete.assert_awaited_once_with(elicitation_id=state.elicitation_id)

    @pytest.mark.asyncio
    async def test_mismatched_actor_cannot_complete_state(self) -> None:
        session = SimpleNamespace(send_elicit_complete=AsyncMock())
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            session=session,
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_2",
            org_id="org_1",
        )

        assert completed is None
        assert get_url_elicitation_state(state.elicitation_id) == state
        session.send_elicit_complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_mismatched_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_2",
                org_id="org_1",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "identity_mismatch"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "user_2", "org_1", "mcpElicitationId"},
        )

    @pytest.mark.asyncio
    async def test_mismatched_org_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_2",
            )

        assert completed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "identity_mismatch"

    @pytest.mark.asyncio
    async def test_completion_notification_failure_is_logged(self) -> None:
        session = SimpleNamespace(send_elicit_complete=AsyncMock(side_effect=RuntimeError))
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
            session=session,
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            completed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is not None
        session.send_elicit_complete.assert_awaited_once_with(elicitation_id=state.elicitation_id)
        assert [call.kwargs["action"] for call in log_mock.await_args_list] == [
            "unavailable",
            "completed",
        ]

    @pytest.mark.asyncio
    async def test_completed_state_cannot_be_reused(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )

        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )
        replayed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        assert completed is not None
        assert replayed is None

    @pytest.mark.asyncio
    async def test_reused_completion_logs_event(self) -> None:
        state = create_url_elicitation_state(
            user_id="user_1",
            org_id="org_1",
            target_flow="billing_settings",
            target_url="/account",
        )
        completed = await complete_url_elicitation_state(
            state.elicitation_id,
            user_id="user_1",
            org_id="org_1",
        )

        with patch("atlas.platform.mcp.elicitation.log_operation", new=AsyncMock()) as log_mock:
            replayed = await complete_url_elicitation_state(
                state.elicitation_id,
                user_id="user_1",
                org_id="org_1",
            )

        assert completed is not None
        assert replayed is None
        log_mock.assert_awaited_once()
        assert log_mock.await_args.kwargs["interaction"] == "billing_settings"
        assert log_mock.await_args.kwargs["action"] == "already_completed"
        _assert_log_omits_private_values(
            log_mock.await_args.kwargs,
            {state.elicitation_id, "user_1", "org_1", "mcpElicitationId"},
        )
