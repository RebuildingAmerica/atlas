"""Tests for article URL canonicalization."""

from atlas_scout.articles.urls import canonicalize_article_url


def test_canonicalize_article_url_normalizes_http_to_https() -> None:
    assert (
        canonicalize_article_url("http://www.dailynews.com/2017/09/05/how-to-submit-a-letter")
        == "https://www.dailynews.com/2017/09/05/how-to-submit-a-letter"
    )


def test_canonicalize_article_url_removes_widget_and_tracking_query_params() -> None:
    assert (
        canonicalize_article_url(
            "https://www.wsj.com/buyside/personal-finance/mortgage/how-to-save-for-a-house"
            "?article=how-to-save-for-a-house&category=personal-finance"
            "&mod=wsj_article_buy_widget&subcategory=mortgage"
            "&gaa_at=eafs&gaa_sig=abc&utm_source=homepage"
        )
        == "https://www.wsj.com/buyside/personal-finance/mortgage/how-to-save-for-a-house"
    )
