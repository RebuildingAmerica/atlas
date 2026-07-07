"""Run-once ingestion for configured Firehose sources."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import TYPE_CHECKING
from xml.etree import ElementTree as ET

from .models import (
    FirehoseArtifactCreate,
    FirehoseArtifactCRUD,
    FirehoseObservationCreate,
    FirehoseObservationCRUD,
    FirehoseSourceTargetCRUD,
    FirehoseSourceTargetModel,
)
from .signal_materializer import create_signals_for_observation

if TYPE_CHECKING:
    import aiosqlite

UNKNOWN_SOURCE_TARGET_MESSAGE = "Unknown Firehose source target."


@dataclass(slots=True)
class FirehoseFetchResult:
    """Fetched source content supplied to the run-once ingestion path."""

    body: str
    content_type: str | None
    etag: str | None
    fetched_at: str
    last_modified: str | None
    status_code: int
    url: str


@dataclass(slots=True)
class FirehoseCollectedArtifact:
    """Normalized artifact candidate extracted from fetched source content."""

    canonical_url: str
    content_hash: str
    fingerprint: str
    published_at: str | None
    relevant_text: str
    source_url: str
    title: str


@dataclass(slots=True)
class FirehoseRunOnceResult:
    """Summary of one source target check."""

    artifacts_created: int
    routes_created: int
    signals_created: int
    unchanged: bool


def _sha256(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode('utf-8')).hexdigest()}"


def _text(element: ET.Element, child_name: str) -> str | None:
    child = element.find(child_name)
    if child is None or child.text is None:
        return None
    stripped = child.text.strip()
    return stripped or None


def _iso_datetime(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return value
    return parsed.isoformat().replace("+00:00", "Z")


def _rss_items(root: ET.Element) -> list[ET.Element]:
    return list(root.findall("./channel/item"))


def _atom_items(root: ET.Element) -> list[ET.Element]:
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    return list(root.findall("./atom:entry", namespace))


def _atom_text(element: ET.Element, child_name: str) -> str | None:
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    child = element.find(f"atom:{child_name}", namespace)
    if child is None or child.text is None:
        return None
    return child.text.strip() or None


def _atom_link(element: ET.Element) -> str | None:
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    link = element.find("atom:link", namespace)
    if link is None:
        return None
    href = link.attrib.get("href")
    return href.strip() if href else None


def _feed_artifacts(
    target: FirehoseSourceTargetModel,
    fetched: FirehoseFetchResult,
) -> list[FirehoseCollectedArtifact]:
    root = ET.fromstring(fetched.body)
    if target.source_kind == "atom":
        return [
            _collected_artifact(
                fetched=fetched,
                item_id=_atom_text(item, "id"),
                link=_atom_link(item),
                published_at=_atom_text(item, "updated") or _atom_text(item, "published"),
                summary=_atom_text(item, "summary") or _atom_text(item, "content"),
                title=_atom_text(item, "title"),
            )
            for item in _atom_items(root)
        ]

    return [
        _collected_artifact(
            fetched=fetched,
            item_id=_text(item, "guid"),
            link=_text(item, "link"),
            published_at=_iso_datetime(_text(item, "pubDate")),
            summary=_text(item, "description"),
            title=_text(item, "title"),
        )
        for item in _rss_items(root)
    ]


def _collected_artifact(  # noqa: PLR0913
    *,
    fetched: FirehoseFetchResult,
    item_id: str | None,
    link: str | None,
    published_at: str | None,
    summary: str | None,
    title: str | None,
) -> FirehoseCollectedArtifact:
    resolved_title = title or "Untitled public source"
    resolved_text = summary or resolved_title
    canonical_url = link or fetched.url
    fingerprint_source = item_id or canonical_url or resolved_text
    return FirehoseCollectedArtifact(
        canonical_url=canonical_url,
        content_hash=_sha256(f"{resolved_title}\n{resolved_text}"),
        fingerprint=fingerprint_source,
        published_at=published_at,
        relevant_text=resolved_text,
        source_url=canonical_url,
        title=resolved_title,
    )


def _web_page_artifacts(
    target: FirehoseSourceTargetModel,
    fetched: FirehoseFetchResult,
) -> list[FirehoseCollectedArtifact]:
    title = target.label
    return [
        FirehoseCollectedArtifact(
            canonical_url=fetched.url,
            content_hash=_sha256(fetched.body),
            fingerprint=_sha256(f"{fetched.url}\n{fetched.body}"),
            published_at=None,
            relevant_text=fetched.body.strip(),
            source_url=fetched.url,
            title=title,
        )
    ]


def collect_artifacts(
    target: FirehoseSourceTargetModel,
    fetched: FirehoseFetchResult,
) -> list[FirehoseCollectedArtifact]:
    """Collect normalized artifact candidates from a fetched source."""
    if target.source_kind in {"rss", "atom"}:
        return _feed_artifacts(target, fetched)
    return _web_page_artifacts(target, fetched)


def _signal_type(text: str) -> str:
    lowered = text.lower()
    if "coalition" in lowered:
        return "coalition_activity"
    if any(term in lowered for term in ("meeting", "hearing", "agenda", "forum")):
        return "public_meeting"
    if "grant" in lowered or "award" in lowered:
        return "grant_award"
    return "new_source"


def _observation_input(
    *,
    artifact_id: str,
    target: FirehoseSourceTargetModel,
    artifact: FirehoseCollectedArtifact,
    fetched_at: str,
) -> FirehoseObservationCreate:
    signal_type = _signal_type(f"{artifact.title}\n{artifact.relevant_text}")
    return FirehoseObservationCreate(
        producer="source_target",
        observation_type="watched_source_artifact",
        subject_type="source_target",
        subject_id=target.id,
        org_id=target.org_id,
        coverage_target_id=target.coverage_target_id,
        source_class=target.source_class,
        occurred_at=artifact.published_at,
        observed_at=fetched_at,
        dedupe_key=f"{target.id}:{artifact.fingerprint}",
        public_realm_basis="Published public civic source",
        places=target.places,
        issues=target.issues,
        confidence=0.72,
        sensitivity=0.12,
        payload={
            "artifact_id": artifact_id,
            "public_route_enabled": target.public_route_enabled,
            "review_state": "not_required",
            "signal_type": signal_type,
            "summary": artifact.relevant_text,
            "title": artifact.title,
            "visibility": "workspace",
        },
        evidence=[
            {
                "captured_at": fetched_at,
                "content_hash": artifact.content_hash,
                "locator": None,
                "passage": artifact.relevant_text,
                "published_at": artifact.published_at,
                "publisher": target.label,
                "source_class": target.source_class,
                "source_url": artifact.source_url,
                "title": artifact.title,
            }
        ],
    )


async def _fingerprint_exists(
    conn: aiosqlite.Connection,
    *,
    fingerprint: str,
    source_target_id: str,
) -> bool:
    cursor = await conn.execute(
        """
        SELECT 1 FROM firehose_artifacts
        WHERE source_target_id = ? AND fingerprint = ?
        LIMIT 1
        """,
        (source_target_id, fingerprint),
    )
    return await cursor.fetchone() is not None


async def run_source_target_once(
    conn: aiosqlite.Connection,
    *,
    target_id: str,
    fetched: FirehoseFetchResult,
) -> FirehoseRunOnceResult:
    """Parse, classify, store, and route one fetched Firehose source target."""
    target = await FirehoseSourceTargetCRUD.get_by_id(conn, target_id)
    if target is None:
        raise ValueError(UNKNOWN_SOURCE_TARGET_MESSAGE)

    artifacts_created = 0
    signals_created = 0
    routes_created = 0
    body_hash = _sha256(fetched.body)
    for artifact_candidate in collect_artifacts(target, fetched):
        exists = await _fingerprint_exists(
            conn,
            fingerprint=artifact_candidate.fingerprint,
            source_target_id=target.id,
        )
        if exists:
            continue
        artifact = await FirehoseArtifactCRUD.create(
            conn,
            FirehoseArtifactCreate(
                source_target_id=target.id,
                org_id=target.org_id,
                coverage_target_id=target.coverage_target_id,
                source_url=artifact_candidate.source_url,
                canonical_url=artifact_candidate.canonical_url,
                title=artifact_candidate.title,
                publisher=target.label,
                source_kind=target.source_kind,
                source_class=target.source_class,
                published_at=artifact_candidate.published_at,
                detected_at=fetched.fetched_at,
                fetched_at=fetched.fetched_at,
                content_hash=artifact_candidate.content_hash,
                fingerprint=artifact_candidate.fingerprint,
                relevant_text=artifact_candidate.relevant_text,
                raw_content=None,
                http_status=fetched.status_code,
                metadata={"content_type": fetched.content_type or ""},
            ),
        )
        observation = await FirehoseObservationCRUD.create(
            conn,
            _observation_input(
                artifact_id=artifact.id,
                target=target,
                artifact=artifact_candidate,
                fetched_at=fetched.fetched_at,
            ),
        )
        signal_result = await create_signals_for_observation(conn, observation_id=observation.id)
        artifacts_created += 1
        signals_created += signal_result.signals_created
        routes_created += signal_result.routes_created

    await FirehoseSourceTargetCRUD.record_check_result(
        conn,
        target_id=target.id,
        checked_at=fetched.fetched_at,
        content_hash=body_hash,
        etag=fetched.etag,
        http_status=fetched.status_code,
        last_modified=fetched.last_modified,
    )
    return FirehoseRunOnceResult(
        artifacts_created=artifacts_created,
        routes_created=routes_created,
        signals_created=signals_created,
        unchanged=artifacts_created == 0,
    )
