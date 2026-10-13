"""Workers verifies real DNS wire replies without a filesystem or UDP sockets."""

import importlib

import dns.message
import dns.rcode
import dns.rrset
import httpx
import pytest


def resolver(monkeypatch, mode="valid"):
    module = importlib.import_module("dns_transport")
    calls = []
    client_factory = httpx.AsyncClient

    def respond(request):
        calls.append(request)
        assert request.url == "https://cloudflare-dns.com/dns-query"
        assert request.headers["content-type"] == "application/dns-message"
        assert request.headers["accept"] == "application/dns-message"
        query = dns.message.from_wire(request.content)
        assert str(query.question[0].name) == "_atproto.example.org."
        assert query.question[0].rdtype == 16
        if mode == "network":
            raise httpx.ConnectError("network")
        if mode == "redirect":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/"})
        if mode == "malformed":
            return httpx.Response(200, content=b"invalid DNS")
        reply = dns.message.make_response(query)
        if mode == "wrong-question":
            reply = dns.message.make_response(dns.message.make_query("attacker.example", "TXT"))
        if mode == "nxdomain":
            reply.set_rcode(dns.rcode.NXDOMAIN)
        if mode == "valid":
            reply.answer.append(
                dns.rrset.from_text(
                    "_atproto.example.org.", 60, "IN", "TXT", '"did=" "did:plc:verified"', '"\\255"'
                )
            )
            reply.answer.append(
                dns.rrset.from_text("_atproto.example.org.", 60, "IN", "A", "192.0.2.1")
            )
        return httpx.Response(200, content=reply.to_wire())

    monkeypatch.setattr(
        module.httpx,
        "AsyncClient",
        lambda **kwargs: client_factory(transport=httpx.MockTransport(respond), **kwargs),
    )
    return module.workers_dns_txt_lookup, calls


@pytest.mark.asyncio
async def test_workers_txt_lookup_decodes_valid_chunked_records(monkeypatch):
    lookup, calls = resolver(monkeypatch)
    assert await lookup("_atproto.example.org") == ("did=did:plc:verified",)
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode", ["network", "redirect", "malformed", "wrong-question", "nxdomain", "empty"]
)
async def test_workers_txt_lookup_never_accepts_unverified_answers(monkeypatch, mode):
    lookup, calls = resolver(monkeypatch, mode)
    assert await lookup("_atproto.example.org") == ()
    assert len(calls) == 1
