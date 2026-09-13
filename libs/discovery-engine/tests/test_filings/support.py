"""A fake HTTP host that serves real zip bytes through byte ranges.

Serving a genuine archive built with ``zipfile`` means the directory and
member offsets under test are the ones a real zip writer produces, rather than
bytes a test author assumed.
"""

from __future__ import annotations

import io
import struct
import zipfile
from dataclasses import dataclass, field

import httpx
import inflate64

EOCD_SIGNATURE = b"PK\x05\x06"


def build_zip(members: dict[str, bytes], *, stored: tuple[str, ...] = ()) -> bytes:
    """Write ``members`` into an in-memory zip, storing the names in ``stored``."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in members.items():
            method = zipfile.ZIP_STORED if name in stored else zipfile.ZIP_DEFLATED
            archive.writestr(name, data, compress_type=method)
    return buffer.getvalue()


def build_zip64(members: dict[str, bytes], monkeypatch_limit: object) -> bytes:
    """Write a zip whose end record defers to a zip64 record, as large IRS batches do.

    ``zipfile`` only writes zip64 end records past 65,535 members, so the test
    lowers that limit, then marks the classic record's count as overflowed the
    way a real 150,000-member archive does.
    """
    monkeypatch_limit.setattr(zipfile, "ZIP_FILECOUNT_LIMIT", 1)  # type: ignore[attr-defined]
    data = bytearray(build_zip(members))
    eocd = data.rfind(EOCD_SIGNATURE)
    struct.pack_into("<HH", data, eocd + 8, 0xFFFF, 0xFFFF)
    return bytes(data)


LOCAL_HEADER_SIGNATURE = b"PK\x03\x04"
DIRECTORY_ENTRY_SIGNATURE = b"PK\x01\x02"


def build_deflate64_zip(name: str, payload: bytes) -> bytes:
    """Write a one-member zip compressed with Deflate64, as newer IRS batches are.

    ``zipfile`` cannot write Deflate64, so the member is stored as
    already-compressed bytes and its method fields are then set to 9.
    """
    compressor = inflate64.Deflater()
    compressed = compressor.deflate(payload) + compressor.flush()
    data = bytearray(build_zip({name: compressed}, stored=(name,)))
    struct.pack_into("<H", data, data.find(LOCAL_HEADER_SIGNATURE) + 8, 9)
    struct.pack_into("<H", data, data.find(DIRECTORY_ENTRY_SIGNATURE) + 10, 9)
    return bytes(data)


def with_directory_field(archive: bytes, offset_in_entry: int, value: int) -> bytes:
    """Overwrite one 32-bit field of the first central directory entry."""
    data = bytearray(archive)
    struct.pack_into("<I", data, data.find(DIRECTORY_ENTRY_SIGNATURE) + offset_in_entry, value)
    return bytes(data)


@dataclass
class FakeHost:
    """Routes requests to canned pages and range-served archives."""

    pages: dict[str, str | int] = field(default_factory=dict)
    archives: dict[str, bytes] = field(default_factory=dict)
    failing_ranges: set[str] = field(default_factory=set)
    unsized: set[str] = field(default_factory=set)
    requests: list[str] = field(default_factory=list)

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(f"{request.method} {url}")
        if url in self.archives:
            return self._archive(request, url)
        page = self.pages.get(url, 404)
        if isinstance(page, int):
            return httpx.Response(page)
        return httpx.Response(200, text=page)

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))

    def _archive(self, request: httpx.Request, url: str) -> httpx.Response:
        data = self.archives[url]
        if request.method == "HEAD":
            if url in self.unsized:
                return httpx.Response(200)
            return httpx.Response(200, headers={"content-length": str(len(data))})
        if url in self.failing_ranges:
            return httpx.Response(503)
        start, end = (int(part) for part in request.headers["Range"][6:].split("-"))
        return httpx.Response(206, content=data[start : end + 1])


def filing_xml(*groups: str) -> bytes:
    """Wrap officer groups in the envelope an IRS return uses."""
    body = "".join(groups)
    return (
        '<?xml version="1.0"?><Return xmlns="http://www.irs.gov/efile">'
        f"<ReturnData><IRS990>{body}</IRS990></ReturnData></Return>"
    ).encode()


def officer(name: str, title: str | None = None, tag: str = "Form990PartVIISectionAGrp") -> str:
    """One officer row, with or without a title."""
    title_xml = f"<TitleTxt>{title}</TitleTxt>" if title is not None else ""
    return f"<{tag}><PersonNm>{name}</PersonNm>{title_xml}</{tag}>"
