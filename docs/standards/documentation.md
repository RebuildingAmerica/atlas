# Documentation Standard (Diátaxis)

[Docs](../README.md) > [Standards](./README.md) > Documentation

Atlas documentation follows [Diátaxis](https://diataxis.fr/). Every page serves **one** of four user needs. Knowing which one you're writing is the single most important decision — it determines the page's voice, shape, and what belongs in it.

## The four modes

| Mode | Serves | Oriented to | Answers | Voice |
|---|---|---|---|---|
| **Tutorial** | Study + action | Learning | "Teach me by doing" | A lesson; you take the reader by the hand |
| **How-to guide** | Work + action | A task | "How do I do X?" | A recipe; assume competence, get to the goal |
| **Reference** | Work + cognition | Information | "What exactly is X?" | Dry, accurate, exhaustive; describe, don't explain |
| **Explanation** | Study + cognition | Understanding | "Why is it this way?" | Discursive; discuss alternatives, context, reasons |

Where each lives in our tree:

- **Tutorials** → `getting-started/`
- **How-to guides** → `development/`, `deployment/`, `runbooks/`
- **Reference** → `architecture/data-model.md` and `api-reference.md`, `standards/`, `reference/`
- **Explanation** → `experience-first.md`, `the-atlas-product.md`, `the-atlas-system-design.md`, `the-atlas-taxonomy.md`, `design/`, and the narrative `architecture/` pages (`system-overview`, `pipeline`, `app`, `organization-and-enterprise-sso`)

## Rules

1. **One page, one mode.** Don't teach *and* specify *and* explain on the same page. If a page is doing two jobs, split it. A page may *link* to a neighbor in another mode (a tutorial linking to reference is good); it must not *become* it.
2. **Don't repeat content across pages — link to one canonical home.** This is the rule the project most often breaks. A concept is explained once, in one Explanation page, and every other page references it. Copy-pasting the same paragraph (or callout) into many files is the anti-pattern Diátaxis exists to prevent. If you find yourself restating something, replace the restatement with a link.
3. **State the page's mode at the top.** A one-line framing ("This is a how-to for…", "Reference for…") tells the reader what kind of help they're getting and keeps the author honest about scope.
4. **Reference is descriptive, not instructive.** It says what *is*, not what to *do*. Move "how to use it" into a how-to guide and link.
5. **Explanation is the home of the *why*.** Rationale, trade-offs, history, and principles belong here — not scattered through how-tos and reference as asides.

## Worked example: the "Experience First" principle

It is a **principle** — pure Explanation. It lives in exactly one page, [`experience-first.md`](../experience-first.md). `AGENTS.md` and `CLAUDE.md` carry a concise self-contained copy because they are agent-instruction files read directly (outside this docs tree). Everywhere else — the docs hub, the product vision, the design specs — *links* to it rather than restating it. That is the rule in rule 2, applied.

## When you're not sure which mode you're in

Ask what the reader is doing *right now*:

- Following along to learn → **tutorial**
- Trying to finish a specific task → **how-to**
- Checking a fact mid-task → **reference**
- Sitting back to understand → **explanation**

If a draft answers more than one, it's more than one page.

---

*See also: [Diátaxis](https://diataxis.fr/) · [Documentation hub organized by these modes](../README.md)*
