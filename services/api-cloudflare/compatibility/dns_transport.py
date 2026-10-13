"""Verify public handle and organization ownership with DNS over HTTPS."""

import dns.exception
import dns.message
import dns.rcode
import dns.rdatatype
import httpx


async def workers_dns_txt_lookup(name):
    """Return correlated TXT answers without system resolver files or UDP.

    Each request owns its client. The fixed public resolver receives only the
    DNS question, never application credentials or visitor headers. DNS wire
    format retains standard record parsing and response correlation so moving
    hosts cannot weaken the evidence behind verified identities.
    """
    query = dns.message.make_query(name, dns.rdatatype.TXT)
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            response = await client.post(
                "https://cloudflare-dns.com/dns-query",
                content=query.to_wire(),
                headers={
                    "Accept": "application/dns-message",
                    "Content-Type": "application/dns-message",
                },
            )
        if response.status_code != 200:
            return ()
        answer = dns.message.from_wire(response.content)
    except (httpx.HTTPError, dns.exception.DNSException):
        return ()
    if not query.is_response(answer) or answer.rcode() != dns.rcode.NOERROR:
        return ()
    records = []
    for rrset in answer.answer:
        if rrset.rdtype == dns.rdatatype.TXT:
            for record in rrset:
                try:
                    records.append(b"".join(record.strings).decode("utf-8").strip())
                except UnicodeDecodeError:
                    continue
    return tuple(records)
