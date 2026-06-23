# Experience First

**Atlas's first principle. It outranks every other guideline, standard, and convention in this repository.** When anything here conflicts with serving the end-user experience, the experience wins.

## The principle

> **The end-user experience is the product, and it is the reason this nonprofit exists.**

Atlas is a nonprofit. We do not exist to operate an impressive pipeline, to hold a large database, or to run elegant systems. We exist so that a person — an organizer looking for allies, a journalist finding sources, a resident trying to find who's doing the work in their community — can find the right people and trust what they see. That experience is the entire point. Everything we build is justified only by how much better it makes that experience.

Anyone can assemble a database of civic actors. The rows are a commodity; dozens of datasets and "DB tools" already have them. Our only durable advantage is the *experience*: how it feels to search, to trust a source, to understand how people connect, and to act. We protect that advantage in every decision.

## The rules (non-negotiable)

1. **Every technical and architectural decision must tie back to the end-user experience it enables or protects.** No exceptions. "Cleaner," "more scalable," "more correct," "more complete," "more efficient" are not justifications on their own — each must ladder up to something the user can **see, trust, feel, or do.** If you can't name that outcome, don't do the work. State the tie explicitly wherever the decision is recorded.

2. **We build complexity solely for the end-user experience.** Complexity is a cost we pay, never an achievement we celebrate. We take on a complex system only because — and only to the extent that — it produces a better experience. A simpler system that delivers the same experience is always the better system. Sophistication the user never feels is waste, and usually a liability.

3. **Never substitute depth or complexity for an emphasis on experience.** Engineering ambition is not a proxy for value. A deeper graph, a richer schema, a smarter pipeline mean nothing until a user benefits. **It does not matter how efficient, elegant, or complete our systems are if end users cannot benefit from them.**

4. **There is no such thing as "back-end-only work."** A schema migration, a pipeline change, an index, a job queue — these are *product* work. Each is accountable to the experience it serves. "It's just backend" is never a reason to skip that accountability or to lower the bar on the polish, trust, and clarity the user ultimately feels.

5. **Trust is the core of the experience.** Atlas publishes claims about real, named people. Wrong, stale, or unsourced information shown confidently is the worst outcome we can produce — an experience failure, not merely a data bug. Provenance and confidence are first-class, user-facing concerns.

## How to apply it

- **Before you start:** name the end-user outcome. *"A user searching Tucson for housing organizers will now see / trust / be able to do X they couldn't before."*
- **While you work:** prefer the smallest design that delivers that outcome. When two designs deliver the same experience, choose the simpler one — every time.
- **Before you call it done:** answer *"what can the end user now see, trust, or do that they couldn't before?"* If you can't, it isn't done — or it wasn't worth starting.
- **When you record it** (PR, commit body, design doc, code comment): state the experience the change serves. A `chore` or `refactor` is fine, but the *why* still points at the user.

## The test

If a task ever feels purely "technical," stop and name the experience it serves. If there isn't one, question whether it should be done at all.

## Anti-patterns

| What you catch yourself saying | The question it has to answer |
|---|---|
| "This is more scalable." | Scalable *so that what user-facing outcome holds up?* |
| "The data model is cleaner now." | Cleaner *so the user can see / trust / do what?* |
| "It's just a backend change." | There is no back-end-only work — what's the downstream experience? |
| "We'll polish the UI later." | Polish *is* the product; loading / empty / error / copy / speed are not finishing touches. |
| "This is the more complete, sophisticated architecture." | Completeness and sophistication are costs — what experience do they buy, and is there a simpler way to buy it? |

---

*This principle is restated at the top of [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md) and banners every documentation hub. It is meant to be unavoidable. If it ever changes, change it everywhere.*
