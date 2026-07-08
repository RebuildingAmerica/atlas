"""Shared support for Atlas issue-area taxonomy data."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

__all__ = ["_ISSUE_AREAS", "IssueArea", "_register_issues"]


class IssueArea(BaseModel):
    """An issue area within a domain."""

    model_config = ConfigDict(frozen=True)

    slug: str
    name: str
    description: str
    domain: str


_ISSUE_AREAS: dict[str, IssueArea] = {}


def _register_issues(domain: str, issues: list[tuple[str, str, str]]) -> None:
    """Register issue areas for a domain."""
    for slug, name, description in issues:
        _ISSUE_AREAS[slug] = IssueArea(
            slug=slug,
            name=name,
            description=description,
            domain=domain,
        )
