"""Resumed filing research keeps exact returns without repeating archive scans."""

from __future__ import annotations

from pydantic import TypeAdapter

from atlas_discovery_engine.filing_checkpoints import FilingCheckpoint, advance_filing_lookup

from .support import FakeHost, build_zip, filing_xml, officer
from .test_filings import (
    ARCHIVE_2024,
    ARCHIVE_2025,
    ARCHIVE_2025_B,
    IRS_DOWNLOADS_PAGE,
    NEW,
    OLD,
    ORG_URL,
    _downloads_page,
    _org_page,
    _provider,
)


async def test_restart_between_every_unit_preserves_fallback_and_skips_finished_archives():
    host = FakeHost(
        pages={
            f"{ORG_URL}/111": _org_page(NEW, OLD),
            IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025, ARCHIVE_2025_B, ARCHIVE_2024),
        },
        archives={
            ARCHIVE_2025: build_zip({f"{NEW}_public.xml": filing_xml()}),
            ARCHIVE_2025_B: build_zip({"unrelated.xml": b"x"}),
            ARCHIVE_2024: build_zip(
                {f"{OLD}_public.xml": filing_xml(officer("Ana Ortiz", "Chair"))}
            ),
        },
    )
    state = FilingCheckpoint(eins=("111",))
    codec = TypeAdapter(FilingCheckpoint)
    for _ in range(20):
        before = len(host.requests)
        state = await advance_filing_lookup(_provider(host), state)
        # One listing, one directory (HEAD + ranges), or one return per turn.
        assert len(host.requests) - before <= 4
        state = codec.validate_json(codec.dump_json(state))
        if state.done:
            break
    assert state.done
    assert [(f.ein, f.object_id, f.officers[0].name) for f in state.filings] == [
        ("111", OLD, "Ana Ortiz")
    ]
    assert host.requests.count(f"HEAD {ARCHIVE_2025}") == 1
    assert host.requests.count(f"HEAD {ARCHIVE_2024}") == 1
    assert not any(ARCHIVE_2025_B in request for request in host.requests)
    assert host.requests.count(f"GET {ORG_URL}/111") == 1
    before = list(host.requests)
    assert await advance_filing_lookup(_provider(host), state) == state
    assert host.requests == before


async def test_multiple_eins_and_missing_archives_match_original_provider():
    newer = "202510729349300101"
    host = FakeHost(
        pages={
            f"{ORG_URL}/111": _org_page(NEW, OLD),
            f"{ORG_URL}/222": _org_page(newer),
            f"{ORG_URL}/333": _org_page("202310729349300100"),
            IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025, ARCHIVE_2024),
        },
        archives={
            ARCHIVE_2025: build_zip(
                {
                    f"{NEW}_public.xml": filing_xml(officer("Ana Ortiz", "Chair")),
                    f"{newer}_public.xml": filing_xml(officer("Ben Lee", "Director")),
                }
            ),
            ARCHIVE_2024: build_zip(
                {f"{OLD}_public.xml": filing_xml(officer("Old Name", "Chair"))}
            ),
        },
    )
    expected = await _provider(host).filings_for(["111", "222", "333"])
    host.requests.clear()
    state = FilingCheckpoint(eins=("111", "222", "333"))
    for _ in range(20):
        state = await advance_filing_lookup(_provider(host), state)
        if state.done:
            break
    assert list(state.filings) == expected
    assert len(state.filings) == 2
    assert host.requests.count(f"HEAD {ARCHIVE_2025}") == 1
    assert host.requests.count(f"GET {ORG_URL}/333") == 1
    assert len(state.attempted) == 2


async def test_failed_directory_is_checkpointed_and_empty_or_unknown_eins_finish():
    host = FakeHost(
        pages={f"{ORG_URL}/111": _org_page(NEW), IRS_DOWNLOADS_PAGE: _downloads_page(ARCHIVE_2025)},
        archives={ARCHIVE_2025: b"not a zip"},
    )
    state = FilingCheckpoint(eins=("111",))
    for _ in range(10):
        state = await advance_filing_lookup(_provider(host), state)
        if state.done:
            break
    assert state.done and not state.filings
    assert state.scanned == (ARCHIVE_2025,)
    assert host.requests.count(f"HEAD {ARCHIVE_2025}") == 1
    for eins in [(), ("missing",)]:
        state = FilingCheckpoint(eins=eins)
        for _ in range(2):
            state = await advance_filing_lookup(_provider(host), state)
        assert state.done and not state.filings


async def test_cancelled_unit_keeps_input_replayable(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock

    import pytest

    host = FakeHost(pages={f"{ORG_URL}/111": _org_page(NEW)})
    provider = _provider(host)
    state = FilingCheckpoint(eins=("111",))
    original = provider._object_ids
    monkeypatch.setattr(provider, "_object_ids", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await advance_filing_lookup(provider, state)
    assert state.object_ids == {}
    monkeypatch.setattr(provider, "_object_ids", original)
    next_state = await advance_filing_lookup(provider, state)
    assert next_state.object_ids == {"111": [NEW]}
    assert state.object_ids == {}
