"""What a return says about the names it lists, read without judging them."""

from __future__ import annotations

from datetime import date

import pytest
from defusedxml import DefusedXmlException

from atlas_discovery_engine.filing_returns import (
    FilingOfficer,
    FilingPosition,
    NameField,
    parse_return,
)

from .support import filing_xml, officer

HEADER = "<TaxPeriodEndDt>2025-06-30</TaxPeriodEndDt><ReturnTypeCd>990</ReturnTypeCd>"


def _business(line1: str, line2: str | None = None, flags: tuple[str, ...] = ()) -> str:
    second = f"<BusinessNameLine2Txt>{line2}</BusinessNameLine2Txt>" if line2 else ""
    checked = "".join(f"<{flag}>X</{flag}>" for flag in flags)
    return (
        "<Form990PartVIISectionAGrp><BusinessName>"
        f"<BusinessNameLine1Txt>{line1}</BusinessNameLine1Txt>{second}</BusinessName>"
        f"<TitleTxt>Trustee</TitleTxt>{checked}</Form990PartVIISectionAGrp>"
    )


class TestParseReturn:
    def test_reads_the_header_the_currency_of_a_role_depends_on(self) -> None:
        parsed = parse_return(filing_xml(officer("Ana Ortiz", "Chair"), header=HEADER))

        assert parsed.return_type == "990"
        assert parsed.tax_period_end == date(2025, 6, 30)

    @pytest.mark.parametrize("header", ["", "<TaxPeriodEndDt>June 2025</TaxPeriodEndDt>"])
    def test_leaves_a_missing_or_garbled_period_unknown(self, header: str) -> None:
        parsed = parse_return(filing_xml(officer("Ana Ortiz"), header=header))

        assert parsed.tax_period_end is None

    def test_leaves_the_header_unknown_when_a_document_has_none(self) -> None:
        document = b"<r><OfficerDirTrstKeyEmplGrp><PersonNm>Cy Diaz</PersonNm></OfficerDirTrstKeyEmplGrp></r>"

        parsed = parse_return(document)

        assert (parsed.return_type, parsed.tax_period_end) == (None, None)
        assert parsed.officers == (FilingOfficer("Cy Diaz", None),)

    def test_reads_rows_from_each_return_form(self) -> None:
        """Form 990, 990-EZ and 990-PF each name officers under a different tag."""
        parsed = parse_return(
            filing_xml(
                officer("Ana Ortiz", "President"),
                officer("Ben Lee", "Treasurer", tag="OfficerDirectorTrusteeEmplGrp"),
                officer("Cy Diaz", "Trustee", tag="OfficerDirTrstKeyEmplGrp"),
            )
        )

        assert [(o.name, o.title) for o in parsed.officers] == [
            ("Ana Ortiz", "President"),
            ("Ben Lee", "Treasurer"),
            ("Cy Diaz", "Trustee"),
        ]

    def test_records_the_boxes_the_filer_checked(self) -> None:
        row = officer("Ana Ortiz", "Chair", flags=("OfficerInd", "IndividualTrusteeOrDirectorInd"))

        (parsed,) = parse_return(filing_xml(row)).officers

        assert parsed.positions == {FilingPosition.OFFICER, FilingPosition.TRUSTEE_OR_DIRECTOR}
        assert parsed.name_field is NameField.PERSON

    def test_keeps_a_business_row_typed_as_a_business(self) -> None:
        """A corporate trustee is kept and labelled, so nothing downstream guesses."""
        parsed = parse_return(
            filing_xml(
                _business("Bank of America", "N A", flags=("InstitutionalTrusteeInd",)),
                "<Form990PartVIISectionAGrp><BusinessName/></Form990PartVIISectionAGrp>",
                "<Form990PartVIISectionAGrp><TitleTxt>Blank</TitleTxt></Form990PartVIISectionAGrp>",
            )
        )

        assert parsed.officers == (
            FilingOfficer(
                "Bank of America N A",
                "Trustee",
                NameField.BUSINESS,
                frozenset({FilingPosition.INSTITUTIONAL_TRUSTEE}),
            ),
        )

    def test_keeps_a_contradictory_row_as_the_filer_wrote_it(self) -> None:
        """A person name flagged as an institution is real data, and resolution holds it."""
        row = officer("JAMIE CLARK", "Trustee", flags=("InstitutionalTrusteeInd",))

        (parsed,) = parse_return(filing_xml(row)).officers

        assert parsed.name_field is NameField.PERSON
        assert FilingPosition.INSTITUTIONAL_TRUSTEE in parsed.positions

    @pytest.mark.parametrize("title", ["FORMER PRESI", "Treasurer (resigned)", "Deceased"])
    def test_reads_a_departure_stated_in_the_title(self, title: str) -> None:
        (parsed,) = parse_return(filing_xml(officer("Ben Lee", title))).officers

        assert parsed.left_role

    def test_reads_a_departure_from_the_former_box(self) -> None:
        row = officer("Old Chair", "Chair", flags=("FormerOfcrDirectorTrusteeInd",))

        (parsed,) = parse_return(filing_xml(row)).officers

        assert parsed.left_role
        assert not FilingOfficer("Ana Ortiz", "Chair").left_role
        assert not FilingOfficer("Ana Ortiz", None).left_role

    def test_lists_a_name_once_and_cleans_the_text(self) -> None:
        parsed = parse_return(
            filing_xml(
                officer("  Dana   O&apos;Neil ", "   "),
                officer("DANA O'NEIL", "Director", flags=("IndividualTrusteeOrDirectorInd",)),
                officer("Eli Park"),
            )
        )

        assert parsed.officers == (
            FilingOfficer(
                "Dana O'Neil",
                "Director",
                positions=frozenset({FilingPosition.TRUSTEE_OR_DIRECTOR}),
            ),
            FilingOfficer("Eli Park", None),
        )

    def test_a_name_listed_as_former_and_current_holds_the_current_role(self) -> None:
        """An officer who moved from treasurer to chair mid-year still serves."""
        parsed = parse_return(
            filing_xml(
                officer("Ana Ortiz", "Treasurer", flags=("FormerOfcrDirectorTrusteeInd",)),
                officer("Ana Ortiz", "Chair", flags=("OfficerInd",)),
                officer("Ben Lee", "Chair", flags=("OfficerInd",)),
                officer("Ben Lee", "Former Treasurer"),
            )
        )

        ana, ben = parsed.officers
        assert (ana.title, ana.left_role) == ("Chair", False)
        assert ana.positions == {FilingPosition.OFFICER}
        assert (ben.title, ben.left_role) == ("Chair", False)

    def test_a_name_every_listing_marks_as_gone_stays_gone(self) -> None:
        parsed = parse_return(
            filing_xml(
                officer("Old Chair", "Chair", flags=("FormerOfcrDirectorTrusteeInd",)),
                officer("Old Chair", flags=("FormerOfcrDirectorTrusteeInd", "OfficerInd")),
            )
        )

        (gone,) = parsed.officers
        assert gone.left_role
        assert gone.title == "Chair"

    def test_refuses_a_return_that_expands_entities(self) -> None:
        """A hostile document is rejected rather than expanded in memory."""
        bomb = (
            b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]>'
            b"<r><Form990PartVIISectionAGrp><PersonNm>&b;</PersonNm></Form990PartVIISectionAGrp></r>"
        )

        with pytest.raises(DefusedXmlException):
            parse_return(bomb)
