"""Native hosting preserves archive decoding and institutional-name detection."""

from native_probe import native_checks


def test_native_packages_preserve_existing_discovery_cases() -> None:
    result = native_checks()
    assert result["deflate64_decoded"] is True
    assert result["decoded_bytes"] == 4017
    assert result["name_types"] == {
        "Sarah Stone": "Person",
        "BANK OF AMERICA N A": "Corporation",
        "Sarah Stone until fall 2024": "Corporation",
    }
