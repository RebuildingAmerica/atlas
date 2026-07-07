"""PDF text extraction for fetched report documents."""

from __future__ import annotations

import logging

from atlas_shared import PageContent, SourceType

from atlas_scout.scraper.extractor import ContentExtraction, content_quality_reason

logger = logging.getLogger(__name__)


def extract_pdf_content(data: bytes, *, url: str) -> ContentExtraction:
    """Extract text from PDF bytes using pymupdf if available, otherwise skip."""
    try:
        import pymupdf  # type: ignore[import-not-found]
    except ImportError:
        logger.debug("pymupdf not installed — skipping PDF: %s", url)
        return ContentExtraction(
            page=None, reason="pdf_extraction_unavailable", discovered_links=[]
        )

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
        pages_text = [page.get_text() for page in doc]
        text = "\n\n".join(pages_text).strip()
        title = doc.metadata.get("title", "") or ""
        doc.close()
    except Exception as exc:
        logger.debug("PDF extraction failed for %s: %s", url, exc)
        return ContentExtraction(page=None, reason="pdf_extraction_failed", discovered_links=[])

    quality_reason = content_quality_reason(text) if text else "content_below_min_words"
    if quality_reason is not None:
        return ContentExtraction(page=None, reason=quality_reason, discovered_links=[])

    return ContentExtraction(
        page=PageContent(
            url=url,
            text=text,
            title=title,
            source_type=SourceType.REPORT,
        ),
        reason=None,
        discovered_links=[],
    )
