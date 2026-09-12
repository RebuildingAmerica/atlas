"""Discovery run lifecycle CRUD helpers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import aiosqlite

from atlas.platform.database import db

from .models_run_core import DiscoveryRunCRUDCore


class DiscoveryRunCRUDOps:
    """Discovery run lifecycle CRUD helpers."""

    @staticmethod
    async def update_research_summary(
        conn: aiosqlite.Connection,
        run_id: str,
        research_summary: dict[str, Any],
    ) -> bool:
        """
        Persist the structured research output for a discovery run.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        research_summary : dict[str, Any]
            Source-linked brief, ranked leads, gaps, and reasoning signals.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUDCore.update(
            conn,
            run_id,
            research_summary=research_summary,
        )

    @staticmethod
    async def complete(  # noqa: PLR0913
        conn: aiosqlite.Connection,
        run_id: str,
        queries_generated: int = 0,
        sources_fetched: int = 0,
        sources_processed: int = 0,
        entries_extracted: int = 0,
        entries_after_dedup: int = 0,
        entries_confirmed: int = 0,
    ) -> bool:
        """
        Mark a discovery run as completed.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        queries_generated : int, optional
            Number of search queries generated. Default is 0.
        sources_fetched : int, optional
            Number of sources fetched. Default is 0.
        sources_processed : int, optional
            Number of sources processed. Default is 0.
        entries_extracted : int, optional
            Number of entries extracted. Default is 0.
        entries_after_dedup : int, optional
            Number of entries after deduplication. Default is 0.
        entries_confirmed : int, optional
            Number of entries confirmed. Default is 0.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUDCore.update(
            conn,
            run_id,
            status="completed",
            completed_at=db.now_iso(),
            queries_generated=queries_generated,
            sources_fetched=sources_fetched,
            sources_processed=sources_processed,
            entries_extracted=entries_extracted,
            entries_after_dedup=entries_after_dedup,
            entries_confirmed=entries_confirmed,
        )

    @staticmethod
    async def note_empty_fetch(
        conn: aiosqlite.Connection,
        *,
        run_id: str,
        reason: str,
    ) -> bool:
        """Record why a run reached the end of search holding no sources.

        The run still completes, because finding nothing is an outcome rather
        than a fault. Writing the reason onto the run is what lets an operator
        tell a spent search quota from a revoked key without reading Cloud Run
        logs.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            The run that fetched nothing.
        reason : str
            What the search vendor reported, or that it reported nothing.

        Returns
        -------
        bool
            True when the run row was updated.
        """
        return await DiscoveryRunCRUDCore.update(conn, run_id, error_message=reason)

    @staticmethod
    async def fail(
        conn: aiosqlite.Connection,
        run_id: str,
        error_message: str,
    ) -> bool:
        """
        Mark a discovery run as failed.

        Parameters
        ----------
        conn : aiosqlite.Connection
            Database connection.
        run_id : str
            Discovery run ID.
        error_message : str
            Error message.

        Returns
        -------
        bool
            True if updated, False if not found.
        """
        return await DiscoveryRunCRUDCore.update(
            conn,
            run_id,
            status="failed",
            error_message=error_message,
            completed_at=db.now_iso(),
        )
