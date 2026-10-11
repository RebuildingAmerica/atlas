"""Canonical artifacts distinguish complete targets from untargeted evidence."""

import pytest

from atlas_shared import DiscoveryRunInput


@pytest.mark.parametrize("state", ["", "NV"])
def test_empty_target_evidence_run_roundtrips_without_invented_location(state) -> None:
    run = DiscoveryRunInput(location_query="", state=state, issue_areas=[])
    assert DiscoveryRunInput.model_validate_json(run.model_dump_json()) == run


@pytest.mark.parametrize(
    ("location", "state", "issues"),
    [
        ("Las Vegas", "", ["housing_affordability"]),
        ("Las Vegas", "N", ["housing_affordability"]),
        ("", "NV", ["housing_affordability"]),
        ("Las Vegas", "NV", []),
        ("", "N", []),
    ],
)
def test_targeted_run_still_requires_complete_target(location, state, issues) -> None:
    with pytest.raises(ValueError):
        DiscoveryRunInput(location_query=location, state=state, issue_areas=issues)
