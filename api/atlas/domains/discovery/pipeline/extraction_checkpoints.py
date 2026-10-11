"""Keep validated source evidence while yielding between individual model attempts."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Literal

from anthropic import AsyncAnthropic
from atlas_discovery_engine import (
    build_extraction_system_prompt,
    build_identify_system_prompt,
    parse_extraction_response,
    parse_identify_response,
    validate_entries,
)
from atlas_shared import PageContent, RawEntry
from pydantic import BaseModel, TypeAdapter

from .extractor import _EXTRACTION_MODEL, _MAX_ATTEMPTS, _extract_text

if TYPE_CHECKING:
    from atlas.platform.config import Settings

    from .web_checkpoints import _Checkpoints


class _Extraction(BaseModel):
    phase: Literal["identify", "enrich", "complete"] = "identify"
    attempts: int = 0
    identified: list[dict[str, str]] = []
    entries: list[RawEntry] = []


def _enrichment_text(identified: list[dict[str, str]], page: PageContent) -> str:
    summary = "\n".join(
        f'- {e["name"]} ({e.get("type", "unknown")}): "{e.get("quote", "")}"' for e in identified
    )
    return (
        f"Source URL: {page.url}\n\n"
        "These entities were identified in the text below. "
        "For each one, extract the full structured entry.\n\n"
        f"IDENTIFIED ENTITIES:\n{summary}\n\n"
        f"SOURCE TEXT:\n{page.text}"
    )


async def advance_source_extraction(  # noqa: PLR0913
    *,
    store: _Checkpoints,
    index: int,
    url: str,
    content: str,
    city: str,
    state: str,
    api_key: str | None,
    settings: Settings,
) -> list[RawEntry] | None:
    """Perform at most one billable request with the existing two-pass prompts.

    Parameters
    ----------
    store, index
        Lease-fenced checkpoint namespace, bound to immutable source inputs.
    url, content, city, state
        The retained source and original research target.
    api_key, settings
        Invocation-owned credentials and current cost ceilings.

    Returns
    -------
    list[RawEntry] | None
        Grounded entries once both passes finish, otherwise None to yield.
        Each pass retains the existing three-attempt limit. Cancellation is
        charged but does not consume a completed-attempt checkpoint.
    """
    codec = TypeAdapter(_Extraction)
    key = f"extract-progress:{index}"
    progress = await store.load(key, codec) or _Extraction()
    if progress.phase == "complete":
        return progress.entries
    if not api_key or not content.strip():
        progress.phase = "complete"
    else:
        page = PageContent(
            url=url, text=content, task_id=None, publication=None, published_date=None
        )
        identifying = progress.phase == "identify"
        system = (
            build_identify_system_prompt()
            if identifying
            else build_extraction_system_prompt(city, state)
        )
        user = page.text if identifying else _enrichment_text(progress.identified, page)
        await store.reserve(kind="llm", units=float(len(user.split())), settings=settings)
        try:
            async with (
                asyncio.timeout(120),
                AsyncAnthropic(api_key=api_key, max_retries=0) as client,
            ):
                response = await client.messages.create(
                    model=_EXTRACTION_MODEL,
                    max_tokens=4000 if identifying else 8000,
                    system=system,
                    messages=[{"role": "user", "content": user}],
                )
            if identifying:
                progress.identified = parse_identify_response(_extract_text(response))
                progress.phase = "enrich" if progress.identified else "complete"
                progress.attempts = 0
            else:
                progress.entries = validate_entries(
                    parse_extraction_response(_extract_text(response)), page
                )
                for entry in progress.entries:
                    entry.source_url = url
                progress.phase = "complete"
        except Exception:
            progress.attempts += 1
            if progress.attempts >= _MAX_ATTEMPTS:
                progress.phase = "complete"
    await store.save(key, progress, codec)
    return progress.entries if progress.phase == "complete" else None
