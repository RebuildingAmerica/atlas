"""Model attempts preserve grounded evidence and charge actual provider turns."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from atlas.domains.discovery.pipeline.web_checkpoints import _Checkpoints

from .test_web_checkpoints import _claim, _settings


def _client(monkeypatch, replies) -> tuple[AsyncMock, AsyncMock, list[dict[str, object]]]:
    import anthropic

    request = AsyncMock(side_effect=replies)
    close = AsyncMock()
    options = []

    class Client:
        def __init__(self, **kwargs: object) -> None:
            options.append(kwargs)
            self.messages = SimpleNamespace(create=request)

        async def __aenter__(self) -> Client:
            return self

        async def __aexit__(self, *_args: object) -> None:
            await close()

    monkeypatch.setattr(anthropic, "AsyncAnthropic", Client)
    return request, close, options


def _reply(text) -> SimpleNamespace:
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


@pytest.mark.asyncio
async def test_passes_resume_grounding_and_no_repeated_model_calls(test_db, monkeypatch) -> None:
    from atlas.domains.discovery.pipeline.extraction_checkpoints import advance_source_extraction

    job_id, job = await _claim(test_db)
    store = _Checkpoints(test_db, job_id, "alarm-1", job.run_id, "frozen-source")
    request, close, options = _client(
        monkeypatch,
        [
            _reply(
                '[{"name":"Housing Trust","type":"organization","quote":"Housing Trust helps"}]'
            ),
            _reply(
                '{"entries":[{"name":"Housing Trust","type":"organization"},'
                '{"name":"Invented Name","type":"person"}]}'
            ),
        ],
    )
    kwargs = {
        "store": store,
        "index": 0,
        "url": "https://example.org",
        "content": "Housing Trust helps",
        "city": "Las Vegas",
        "state": "NV",
        "api_key": "private",
        "settings": _settings(),
    }
    assert await advance_source_extraction(**kwargs) is None
    assert request.await_count == 1
    result = await advance_source_extraction(**kwargs)
    assert [entry.name for entry in result] == ["Housing Trust"]
    assert result[0].source_url == "https://example.org"
    assert await advance_source_extraction(**kwargs) == result
    assert request.await_count == close.await_count == 2
    assert all(option["max_retries"] == 0 for option in options)
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger")
    assert (await cursor.fetchone())[0] == 2
    cursor = await test_db.execute("SELECT result FROM discovery_web_checkpoints")
    assert "private" not in str(await cursor.fetchall())


@pytest.mark.asyncio
@pytest.mark.parametrize("identify_first", [True, False])
async def test_failed_attempts_yield_and_exhaust_same_three_attempt_limit(
    test_db, monkeypatch, identify_first
) -> None:
    from atlas.domains.discovery.pipeline.extraction_checkpoints import advance_source_extraction

    job_id, job = await _claim(test_db)
    store = _Checkpoints(test_db, job_id, "alarm-1", job.run_id, "frozen-source")
    replies = [] if identify_first else [_reply('[{"name":"Housing Trust"}]')]
    request, close, _ = _client(monkeypatch, [*replies, ValueError(), ValueError(), ValueError()])
    kwargs = {
        "store": store,
        "index": 0,
        "url": "https://example.org",
        "content": "Housing Trust helps",
        "city": "Las Vegas",
        "state": "NV",
        "api_key": "private",
        "settings": _settings(),
    }
    for _ in range(2 + len(replies)):
        assert await advance_source_extraction(**kwargs) is None
    assert await advance_source_extraction(**kwargs) == []
    assert await advance_source_extraction(**kwargs) == []
    assert request.await_count == close.await_count == 3 + len(replies)
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger")
    assert (await cursor.fetchone())[0] == 3 + len(replies)


@pytest.mark.asyncio
@pytest.mark.parametrize(("content", "key"), [("text", None), ("", "key"), ("text", "key")])
async def test_empty_input_or_identification_finishes_without_enrichment(
    test_db, monkeypatch, content, key
) -> None:
    from atlas.domains.discovery.pipeline.extraction_checkpoints import advance_source_extraction

    job_id, job = await _claim(test_db)
    store = _Checkpoints(test_db, job_id, "alarm-1", job.run_id, "frozen-source")
    request, _, _ = _client(monkeypatch, [_reply("[]")])
    assert (
        await advance_source_extraction(
            store=store,
            index=0,
            url="https://example.org",
            content=content,
            city="",
            state="",
            api_key=key,
            settings=_settings(),
        )
        == []
    )
    assert request.await_count == int(bool(content and key))


@pytest.mark.asyncio
async def test_cancellation_preserves_cost_without_checkpointing_a_failed_attempt(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline.extraction_checkpoints import advance_source_extraction

    job_id, job = await _claim(test_db)
    store = _Checkpoints(test_db, job_id, "alarm-1", job.run_id, "frozen-source")
    request, close, _ = _client(monkeypatch, [asyncio.CancelledError(), _reply("[]")])
    kwargs = {
        "store": store,
        "index": 0,
        "url": "https://example.org",
        "content": "Housing Trust helps",
        "city": "Las Vegas",
        "state": "NV",
        "api_key": "private",
        "settings": _settings(),
    }
    with pytest.raises(asyncio.CancelledError):
        await advance_source_extraction(**kwargs)
    assert await advance_source_extraction(**kwargs) == []
    assert request.await_count == close.await_count == 2
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger")
    assert (await cursor.fetchone())[0] == 2


@pytest.mark.asyncio
async def test_reassigned_lease_discards_late_model_output_and_replays_only_unfinished_pass(
    test_db, monkeypatch
) -> None:
    from atlas.domains.discovery.pipeline.extraction_checkpoints import advance_source_extraction
    from atlas.domains.discovery.pipeline.web_checkpoints import CheckpointLeaseLostError

    job_id, job = await _claim(test_db)
    store = _Checkpoints(test_db, job_id, "alarm-1", job.run_id, "frozen-source")
    request, close, _ = _client(monkeypatch, [_reply('[{"name":"Housing Trust"}]')])
    kwargs = {
        "store": store,
        "index": 0,
        "url": "https://example.org",
        "content": "Housing Trust helps",
        "city": "Las Vegas",
        "state": "NV",
        "api_key": "private",
        "settings": _settings(),
    }
    assert await advance_source_extraction(**kwargs) is None

    async def reassigned(**_args: object) -> object:
        await test_db.execute(
            "UPDATE discovery_jobs SET claimed_by = 'alarm-2' WHERE id = ?", (job_id,)
        )
        await test_db.commit()
        return _reply('{"entries":[{"name":"Housing Trust","type":"organization"}]}')

    request.side_effect = reassigned
    with pytest.raises(CheckpointLeaseLostError):
        await advance_source_extraction(**kwargs)
    kwargs["store"] = _Checkpoints(test_db, job_id, "alarm-2", job.run_id, "frozen-source")
    request.side_effect = [_reply('{"entries":[{"name":"Housing Trust","type":"organization"}]}')]
    result = await advance_source_extraction(**kwargs)
    assert result[0].name == "Housing Trust"
    assert request.await_count == close.await_count == 3
    assert "IDENTIFIED ENTITIES" in request.await_args.kwargs["messages"][0]["content"]
    cursor = await test_db.execute("SELECT COUNT(*) FROM cost_ledger")
    assert (await cursor.fetchone())[0] == 3


def test_importing_checkpoint_module_does_not_load_model_sdk() -> None:
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import atlas.domains.discovery.pipeline.extraction_checkpoints; assert 'anthropic' not in sys.modules",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
