"""Tests for atlas_scout.scraper.extractor."""

from atlas_scout.scraper.extractor import extract_content, is_quality_content


def test_extract_content_from_html():
    html = (
        "<html><body><article><p>"
        + "housing policy debate in Austin Texas. " * 40
        + "</p></article></body></html>"
    )
    result = extract_content(html, url="https://example.com/article")
    assert result is not None
    assert "housing" in result.text.lower()


def test_extract_content_returns_none_for_empty():
    assert extract_content("", url="https://example.com") is None


def test_is_quality_content_passes_good_text():
    assert is_quality_content(" ".join(["word"] * 250)) is True


def test_is_quality_content_rejects_short_text():
    assert is_quality_content("Too short.") is False


def test_is_quality_content_rejects_login_wall():
    assert (
        is_quality_content(
            "Please log in to continue reading this article. Sign up for a free account."
        )
        is False
    )
