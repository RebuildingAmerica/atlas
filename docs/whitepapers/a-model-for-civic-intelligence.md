# A Model for Civic Intelligence

_Funding and governing source-linked civic data as AI agents become its primary
readers._

## Abstract

Across the United States, people are doing the work of rebuilding public life.
They organize tenants, build worker cooperatives, expand access to health care,
defend local water, and hold neighborhoods together through institutions most of
the country will never hear about. The Rebuilding America Project maintains
Atlas, a source-linked map of these people and organizations, because that work
is scattered across the public record, easy to overlook, and rarely visible
beyond the community it serves.

A change in how the web gets read now threatens that map and, at the same time,
offers a way to sustain it. The fastest-growing readers of any public dataset
are automated software agents, and they do not read the way people do. The
bargain that funded the web for thirty years, content in exchange for human
attention, means nothing to a reader that never sees an advertisement and never
comes back. For an ordinary publisher that is a revenue problem. For a civic
dataset it is also a safety problem, because the easiest thing to sell a machine
is a clean list of names, contacts, and locations with the sources stripped off,
and a civic record stripped of its sources is a tool for finding and pressuring
the people it names.

Atlas answers that change without bending the mission. Nobody pays to read
public civic data; the public map is free and stays that way. What Atlas meters
is heavy automated use, and it requires that use to identify itself, keeps every
record attached to its sources, and returns the money to the public map. The
model is written down, and the software is open, because every steward of
public-interest data is about to face the same choice.

## 1. The Mission

### Civic invisibility

Picture an organizer in Detroit. For three years she has helped tenants in a
handful of buildings win repairs and fight off eviction. She knows her block,
her landlords, and the two other groups doing similar work across town. She does
not know the tenant organizer in Toledo up against the same corporate landlord,
or the legal-aid clinic one neighborhood over that could take her cases, or the
small foundation that funds exactly this kind of work and has never heard her
name. The information that would connect them exists. It just lives in a dozen
unconnected places: a local news story, a coalition's membership page, a grant
announcement, a podcast episode, a council sign-in sheet.

This is the ordinary condition of civic work in America, and the Rebuilding
America Project has a name for it. Civic invisibility. Good work stays isolated
when local knowledge lives only in staff memory, when field maps go stale, when
funders miss the groups nobody has heard of, when reporters call the same
familiar sources, and when every new coalition redoes the same basic research
from scratch. The cost is not just wasted effort. Invisibility decides who gets
heard, who gets funded, who gets interviewed, who gets invited into the room,
and who gets protected when things turn hard.

At the scale of the country, that is an intelligence gap in the movement to keep
democratic life healthy, and it is not a symmetric one. Actors who work against
open participation tend to treat data and coordination as infrastructure worth
investing in. Many of the institutions defending civic life still run on
spreadsheets, personal memory, aging PDFs, and disconnected contact lists. A
movement that cannot find its own people is easy to isolate. Atlas exists to
close that gap while refusing the practices that make civic intelligence
dangerous in the first place.

### What Atlas is

Atlas is a searchable, source-linked map of the people, organizations, and
initiatives doing public-interest work across the country. Its central
discipline is that it documents rather than asserts. It does not rank who
matters, it takes no side, and it never claims to have personally verified every
statement it carries. It gathers what is already public, ties each fact to the
source it came from, and arranges it so an ordinary person can search by place
and by issue, look at the evidence behind a record, and see who is active near
them.

The point of the map is what a person can do with it. Find the people doing the
work. Trust what they see, because every claim shows where it came from.
Understand how local civic power connects across a place and an issue. Act on
that, whether by reaching out, writing a story, directing a grant, or building a
coalition. A resident in a mid-sized city should be able to open Atlas, search
for housing work in their area, and come away with a clearer, sourced picture of
who is doing it, without needing to know a single person in advance.

The Rebuilding America Project keeps the map because its own work depends on it.
But the map is worth more than any one organization's use of it, which is why
Atlas is open-source and built to stand on its own. It should be useful to a
newsroom that has never heard of the Rebuilding America Project, to a small
foundation two states away, and to a researcher studying civic life at national
scale. The record it organizes is the public's, and so, in the end, is the map.

### Funding

None of this is free to build or to keep true. A national map that stays current
requires steady, unglamorous work: discovery, verification, correction, safety
review, and the constant labor of keeping records fresh. Without durable
funding, a project like this stays a fragile volunteer directory that rots the
moment attention moves on. Revenue is what lets it become lasting infrastructure
instead.

That makes funding a mission question, not a business detail bolted on beside
the mission. How a public resource earns money shapes what it becomes. A funding
model can quietly turn a commons into private property, teach users that money
buys exceptions, or drag an organization toward the surveillance logic it was
built to oppose. So the Rebuilding America Project treats revenue as packaging
around the public work rather than as a product of its own. Paid work has to
fund, improve, or protect public civic discovery, and the rule is short enough
to remember: revenue funds the map, and it does not privatize the public civic
graph.

The rest of this paper is an attempt to keep that rule while answering a
question the mission cannot dodge. As automated agents become the main readers
of public data, how should a civic map let itself be read by machines, in a way
that funds the work, protects the people in it, and keeps the map open to
everyone?

## 2. The Shift

For most of the web's history, content was funded by attention. A publisher gave
material away and the reader paid indirectly, through an advertisement, a
subscription prompt, or a click that could be measured and sold. The arrangement
frayed over the years, under ad blocking and paywalls and platform middlemen,
but its logic held: there was a person on the other end of the request, that
person's attention was worth something, and the publisher could capture a slice
of it. Everything about web monetization rested on that one assumption, that the
reader was a human being with finite attention to spend.

Automated agents break the assumption. An agent, in the sense used here, is
software acting on a person's behalf: an assistant that answers questions, a
research tool that gathers material, a program that keeps a database current.
When such a thing answers a question about local housing, it sees no
advertisement, holds no subscription, and never returns to be converted later.
It reads once, takes what it needs, and moves on.

And it rarely reads just once. A single question put to an assistant can fan out
into dozens or hundreds of separate fetches as the tool searches, follows links,
and gathers enough to answer well. Point every assistant and research tool and
nightly refresh job at a useful dataset and the machine traffic can dwarf the
human traffic to the same pages. To the server, these requests look nothing like
a person's. They arrive fast, in volume, usually without the browser signals a
human leaves behind, and they do not linger.

Infrastructure companies have started to charge for this traffic directly, per
request rather than per reader. Cloudflare, which sits in front of a large share
of the web, is building a way for a site to collect a fraction of a cent each
time an agent fetches a page. The mechanism revives a piece of the web's
original design that sat unused for decades: the HTTP status code 402, "Payment
Required," reserved since the early specification for a moment exactly like this
one, and idle for years mostly because no payment system was cheap enough to
make a sub-penny charge worth collecting.

The premise is that agents are becoming the primary buyers of content and will
pay by the call. It is a plausible premise, and it turns ordinary content into a
metered resource. For most publishers that is a straightforward opportunity: get
paid by readers who used to take everything for free. For a civic map it opens a
harder question, because the obvious ways to charge a machine run straight into
the mission.

## 3. The Stakes for Civic Data

A record in Atlas describes a real, named actor and links what it says to public
sources. Maria Gonzalez, who founded and runs a worker cooperative in Garden
City, Kansas, is the kind of subject a record represents: a specific person,
doing specific work, in a specific place, described in terms that trace back to
where the information was found. Atlas is careful about what it claims. It does
not say she is important or effective; it says what the public record shows and
points to where it found it. That restraint is a safety measure as much as an
editorial one, because a directory that ranked importance or vouched for people
would be making judgments it cannot support about identifiable human beings.

Because the subjects are real people, the bar is high, and a record that looks
authoritative with nothing behind it is worse than no record at all. It lends
false confidence to a claim about someone's name. So the sources, and the
confidence they support, are the product itself. What a reader is handed, every
time, is the evidence: where each fact came from, how recent it is, how well it
holds up, and what is still uncertain.

This is what separates civic _intelligence_ from a list. Anyone with time can
compile names. What takes work, and what is easy to destroy, is the sourcing and
the trust it earns. A record that carries its evidence can be checked,
corrected, and relied on. The same record with the evidence stripped away is
only an assertion, no different from a rumor.

A structured feed of names, contacts, and locations, handed over with no record
of where each fact came from or how it may be used, is a targeting dataset. The
map that helps a resident find a tenants' union is, in a different format and
the wrong hands, a way to assemble a list of tenant organizers to intimidate,
and stripping the sources is exactly what makes the second use easier, because
it throws away the context and the obligations that would otherwise slow a bad
actor down.

Some of the people in Atlas are organizers at real risk, and the project is one
careless bulk export away from harming the people it's meant to protect. That is
why the Rebuilding America Project draws a hard line around a set of uses no
matter who is asking: no doxxing, no harassment, no surveillance, no
private-person targeting, no resale of stripped-provenance data, no research
that removes context and safety. The caution runs all the way down into how
records get published. A claim about a named person is held to a higher standard
than a claim about an organization, and when the discovery pipeline is unsure, a
person's record is held for review rather than pushed out. The rule inside the
system is blunt: when there is doubt about a person, the record waits. A project
that careful about publishing a person cannot then turn around and sell that
same person, in bulk and stripped of context, to whoever pays.

## 4. The Obvious Answers

Three obvious ways to bring the agent economy to civic data present themselves,
and each one fails the mission in its own way.

The simplest is to charge for reading. It fails on principle, and the principle
is the whole point of the project. The public record belongs to the public, and
asking a person to pay in order to learn who is organizing in their own town
rebuilds the wall of invisibility Atlas was built to knock down. This has
nothing to do with the price. Any arrangement that puts basic sight of the civic
map behind a fee is disqualified, which is why free reading is treated here as
fixed rather than up for negotiation.

The second is worse, and it is the one an automated buyer would actually ask
for: sell the data in bulk, clean and convenient, with the sources removed. This
is what a data broker does, and for civic data it is dangerous rather than
merely tacky, for the reasons already given. It also destroys the thing being
sold. Strip the sources and what remains is an assertion nobody can check, less
valuable as intelligence in the same motion that makes it more useful as a
target list. A civic map that sold this feed would be undermining its own
trustworthiness and endangering its own subjects at once. No price makes that
worth doing.

The third is to do nothing and hope the traffic stays small. It won't. Ignore
the agents and you either drown in unpaid scraping or fall back on blocking them
wholesale, and either way the extraction most dangerous to the people in the
data goes right on happening, unseen, because the parties most eager to harvest
organizers are the least likely to honor a polite request to stop.

Charge for reads and you betray the mission. Sell stripped data and you endanger
the people in it. Do nothing and you hand the field to whoever is least careful.
So there has to be a fourth path: treat machine readers as something to govern,
not something to exploit or ignore.

## 5. A New Model for Civic Data

Start from a goal Atlas already had, before revenue entered the picture at all:
stop the bulk automated harvesting of organizers' contacts and locations. The
usual way to stop harvesting is to block the traffic that does it, and blocking
is a blunt tool. It fails silently, so you learn nothing about what was tried.
It catches legitimate builders alongside bad actors, because at the network
level they look the same. And it leaves you with no relationship to the agents
reading you and no say over what they do with what they take.

Metering is a sharper tool for the same job. It swaps outright blocking for a
conditional exchange: the agent identifies itself, agrees to a use policy,
receives data with its sources attached, and pays for the load it puts on the
system. Now the traffic you would have spent effort fighting pays instead, and
it arrives with an identity, a policy, and a record of use. The paid path is
just the supervised, accountable version of what unmanaged scrapers already do
without asking.

Six rules describe how it works.

**Free reading.** Human browsing, casual reads, and a generous allowance for
light automated use cost nothing, now and forever, and they return the same
records, the same sources, and the same confidence as any paid request. The free
tier is not a teaser that runs out. It is sized around real civic use: a
neighborhood group building a local resource guide, a class studying civic
participation, a reporter pulling profiles for a story, a small app that looks
up an organization when someone searches for it. All of that stays free, because
keeping reading free is the whole point, and it is the only thing that earns
Atlas the standing to charge for anything at all.

**Metering.** The meter starts only when use turns heavy and automated, well
past the free line: sustained, high-volume, machine-speed access of a kind no
person produces by hand. Below the line, nothing is billed. Above it, an account
gets an included allowance and then pays for more, as measured overage or as
credits bought in advance. Take an organization that wants to keep its own
internal database in sync with Atlas, refreshing tens of thousands of records
every night. That is a legitimate use, and it also puts a real, continuous load
on the system that a casual reader never does. It is charged for the volume and
the automation, not for the civic facts, which anyone can still read one at a
time for free. It pays for the convenience of pulling the whole map on a
schedule. The map it pulls from stays open to everyone else.

**Sources.** Every metered response carries its evidence: the source link, the
publication, the date, the confidence, the freshness, the review state, the
terms of use, and a stable reference the agent can cite. There is no
sources-removed version of the feed at any price, because that version is the
data-broker product the mission rejects. This is the part that makes the
difference between selling civic intelligence and selling ammunition. Carrying
the sources through the paid channel keeps the downstream use honest, since an
agent that repeats an Atlas claim can show where it came from, and it stops the
paid channel from becoming a laundry, taking in sourced evidence and handing
back anonymous rows, so the same trust standard reaches every machine that reads
Atlas.

**Identity.** How much access a caller gets scales with how accountable it is
willing to be, not with how much it pays. Anonymous callers stay at the free
threshold. Callers who sign in get more. Agents that prove who they are get the
fastest lane. When traffic has to be slowed to protect the map, the anonymous
high-volume traffic is the first to go. A known research group that says who it
is and what it is doing can move quickly through large volumes, because it can
be reached if something goes wrong. An anonymous client hammering the contact
fields of every organizer in a state cannot, and should not, and paying does not
change that. What buys the fast lane is accountability, and money is no
substitute for it.

**Sponsorship.** Not every good use can pay, and the mission is usually better
served by more reach than less. So a funder can sponsor open access to a defined
scope: a place, an issue, a particular dataset. Inside that scope the data is
free to whoever uses it, still measured for accounting, still carrying its
sources, and openly labeled as sponsored. This is the public-broadcasting model
applied to civic data. A regional foundation that underwrites the civic records
for its area is not buying a private copy; it is paying so that nobody has to
pay, and being named for it. The map grows in the places sponsors care about,
and it grows in the open.

**Reinvestment.** Every paid feature has to clear one test before it ships: it
must fund or improve the public map without weakening it. Customers can buy
speed, privacy, workflow, and support. They cannot buy exclusive ownership of
public facts, a sources-removed feed, an exemption from the safety rules, or
preferential treatment of any kind. Payment buys service around the record; it
never buys the record, or an exception to how the record is governed. This is
the rule that holds the other five together. The paid layer exists to fund the
free map, so any feature that would privatize part of that map, or make it worse
to sell the paid product by comparison, fails the test automatically. The
business only works if it makes the public map stronger.

## 6. Trust and Provenance

Behind every claim about an actor sits a set of sources, and each source arrives
with its link, its title, the publication when it is known, the date it was
published or observed, and the specific passage that tied the source to the
claim, the sentence or row or fragment that explains why Atlas made the
connection. Around the claim sit its freshness, when it was last seen and last
confirmed and how stale it might now be, and its review state. Each record also
carries a stable reference an agent can use to point back at the exact evidence,
so a citation resolves to something real instead of a dead assertion. Atlas will
also say, in plain words, how it knows what it claims: who an actor is, what
they do, where, why they show up in the public record, and how confident the
evidence is, rendered as something a person can read at a glance, like "three
sources, corroborated, as of March." A machine gets the same account. It does
not just receive a name and an address. It receives the name, the address, the
evidence behind the address, and an honest statement of how sure that evidence
is.

That honesty is enforced, not hoped for. A record sits in one of four tiers. It
is _subject-verified_ when the person or organization it describes has claimed
the profile and confirmed it. It is _atlas-verified_ when Atlas's own review has
confirmed it. It is _corroborated_ when at least two independent sources support
it. Otherwise it is _unverified_, and it is labeled that way rather than dressed
up. An entry found on a single web page is unverified, plainly, and nothing
downstream is allowed to make it sound like more.

This matters more when the reader is a machine, not less. A person skimming a
thin profile applies judgment and senses when something is shaky. An agent tends
to take what it is handed and repeat it with the flat confidence of software. If
the data overstated its own certainty, the agent would launder a weak claim into
a confident one and carry it off. Because Atlas won't claim more than its
sources support, and because the confidence travels with the record, an agent
can be exactly as careful as the evidence warrants, and can tell its own user
when a claim rests on two independent sources and when it rests on one.

Provenance is only half of trust, though. The other half is what happens when a
record is wrong. Atlas treats correction as part of the system rather than an
apology for it. A record can be disputed, corrected, or, where safety demands,
suppressed, and that state travels with it the same way its sources do. The
people described have standing here: a person or organization can claim their
own profile, which both raises its trust tier and lets them fix what is said
about them. The paid channel carries all of this. A customer paying for heavy
access does not get a frozen snapshot that ignores later corrections; it gets
the same living record, dispute marks and all, that a person would see. Selling
access to civic data while hiding that a claim was contested would be its own
dishonesty, and the model does not allow it.

## 7. How It Works in Practice

An agent starts by reading. It searches Atlas for groups working on water
quality in a river valley, opens a handful of profiles, follows the sources
behind a few claims. None of it costs anything or needs an account, and the
responses come back whole, each with its evidence attached, exactly as they
would to a person at the website. For most readers, human or machine, that is
the entire story.

Now suppose the agent is working at scale, walking tens of thousands of records
to keep an outside database current. As it crosses the free threshold, Atlas
returns a plain, machine-readable response: the free allowance is spent, here is
how to keep going. Sign in, draw on an included allowance, or buy credits. The
response names the limit and the way forward instead of just failing. Today the
operator satisfies it by holding an account and paying in ordinary money. As
agent-payment standards mature, the same response can carry a price and a
payment endpoint, and the agent can settle it and retry on its own, with no
person in the loop.

Identity colors the whole thing. Anonymous, the caller stays at the free
threshold and is first to be slowed if the system is protecting itself. Signed
in, it goes further. Verified, it goes furthest and fastest. And if a funder has
underwritten the water-quality records for that valley, an agent working inside
that scope reads them freely, sources still attached, still counted so the
sponsor and the public can see the access their support paid for. One thing
never changes across any of these paths: every record comes with its evidence,
and no amount of money produces a version without it.

## 8. Fairness

A funding model for a public resource has to answer to more than the people
paying for it. Four groups have a stake in this one.

The people named in the map come first, especially the organizers and small
groups the whole project exists to surface, because they are the most exposed to
harm. For them, metering means that harvesting their contacts and locations gets
harder and more traceable, not cheaper. High-volume access to that information
is limited, tied to identity, and watched for harvesting, and none of those
protections lift for a paying customer. The Detroit organizer is safer under
this model than under a blocking-only defense, because the traffic that would
come for her details now has to say who it is before it can move at volume, and
can be cut off when it misbehaves. There is a deeper consistency at work: a
project that holds a person's record for careful review on the way in cannot
coherently sell that same record, stripped and in bulk, on the way out. The
protections the mission demands and the protections a customer meets are the
same protections.

The public gets the plainest deal. The map stays free and whole, nobody pays to
learn who is doing civic work in their area, and the free tier is never quietly
degraded to nudge people toward paying.

Developers meet uniform, published terms. Prices, the size of the free
allowance, and the line between free and metered use are all stated in the open,
and no private deal hands one party an advantage over the commons. The person
building a tool to connect tenant organizers across cities is exactly who the
model means to serve, not to bill.

Funders buy reach and public credit, and nothing else. A sponsor is disclosed on
the access it underwrites, and it has no say over what the records report. This
limit protects the funder as much as the map: an underwriter that could shape
the content would inherit responsibility for what the records say and would
poison the neutrality that made the map worth funding to begin with. Keeping
sponsorship to disclosure and reach lets a foundation back civic visibility as a
public good without taking on editorial judgments it has no business making.

## 9. Settlement

None of this depends on a particular way of moving money. Atlas settles today in
ordinary currency through the billing system it already runs, with allowances,
measured overage, and prepaid credits charged to the account that used them. No
new financial infrastructure, no digital assets, nothing speculative. The model
works in full right now.

It is also ready for what is coming. The same point in the system that returns
an over-limit response today can later return the HTTP 402 exchange from Section
2, answering with a price and a payment endpoint so an agent can pay and retry
on its own. That would change how value settles and nothing else. It would not
change what is free, where the meter starts, or the rule that every metered
response carries its sources. Settlement sits underneath the model and can be
swapped without touching it, which is why the choice of payment rail is an
engineering detail here and not a matter of principle.

## 10. Boundaries

Some uses are ruled out no matter who is asking or what they would pay, and the
boundaries are the substance of the model rather than fine print attached to it.

Atlas does not sell civic records with the sources removed. It does not run as a
surveillance or targeting system, and it does not let its data be marketed for
targeting, surveillance, or opposition research against private people. It does
not sell exclusive rights to public facts, sell exemptions from its safety
rules, or let payment shape what the record says. Access can be cut off for
harmful use regardless of what has been paid, because the use policy governs the
money and not the other way around.

Some callers are sensitive without being forbidden. Political parties and
campaigns can use the standard product, but only on equal terms, at ordinary
rates, and for understanding the public civic landscape rather than targeting
voters. Money never buys preferential political treatment, and the same records,
rules, and prices apply to everyone.

Underneath the specific rules is a single test for the hard cases: if a use
depends on removing context, evidence, freshness, dispute state, or safety
limits, it is not compatible with Atlas. A polished output with the provenance
stripped out is not a success but a trust failure, and a customer who needs the
safety removed is asking for something the project cannot sell without ceasing
to be itself. Drop any of these boundaries for money and Atlas stops being worth
funding, because the limits are what make the data trustworthy in the first
place.

## 11. Precedents

None of these ideas is new. Each has a precedent.

The sponsorship rule is public broadcasting. For decades, listeners have heard
that a program was brought to them by some foundation or company, understood the
arrangement, and trusted the content anyway, because the underwriter's role was
disclosed and bounded. Sponsored civic access works the same way. A funder pays
so the material can reach everyone, the sponsorship is named, and the content
stays out of the sponsor's hands.

The refusal to enclose the map belongs to a longer tradition: the commons, and
the open licenses built to defend it. Atlas is open-source under a permissive
license, and the map it maintains is meant to be a civic commons, not a private
holding. Openly licensed reference works assembled by volunteers proved that a
shared body of knowledge can be free and durable at once, as long as the license
that keeps it open travels with every copy. The open-access movement in
scholarship made the neighboring argument, that research funded for the public
good should be readable by the public and not fenced behind fees. Both learned
the same hard lesson that shapes this model. Openness does not maintain itself.
It has to be defended at the level of the license and the norm, because there is
always pressure to enclose a valuable commons, strip its terms, and resell it.
Keeping the sources attached to every civic record is the same move as keeping
the license attached to an openly licensed work: it is what stops the commons
from being privatized one download at a time. The twist Atlas has to handle is
that the copies are no longer made by people choosing to share. They are made by
agents fetching at scale, so the terms have to travel automatically.

Charging for load rather than for access, finally, is ordinary infrastructure.
Utilities and cloud services and countless public systems meter heavy use,
exempt light use, and price consumption rather than the right to exist. What is
genuinely new is only the payment layer for machine readers, the per-request
settlement now being built on that long-dormant 402 code, and the model keeps it
in exactly that role: a way to let agents pay for the load they create, and
nothing more.

## 12. Limits and Open Questions

Several real questions stay open, and only running the model will answer them.

The first is where the free line sits. "Generous" has to become a specific
number, and setting it fairly is a standing judgment, not a solved problem. Too
low and it starts charging for use that should be free, breaking the visibility
promise. Too high and harvesting hides inside the free tier. The line will have
to move as real usage teaches what ordinary and abusive access actually look
like, and the honest position is that it is a dial to be tuned in the open, not
a constant to be declared once.

The second is identity, which the whole model leans on, and which the wider
world has not finished building. Until an agent can prove who it is in a way
that is hard to forge and widely supported, the strongest lane reaches fewer
callers than the model would like, and the line between a well-behaved anonymous
reader and a harvester will sometimes blur. The model is built to take advantage
of better identity as it arrives. In the meantime it lives with the limits of
what identity can currently prove.

Then there is what happens downstream, and it is the hardest of the three. Atlas
can attach provenance to everything it hands out. It cannot, by itself, stop a
bad actor who receives sourced data from stripping the sources off and
republishing the result. Terms of use, revocation, and the flat refusal to sell
a stripped feed all raise the cost of that abuse. None of them drives it to
zero. Keeping provenance attached across a whole ecosystem of downstream tools
is a collective problem no single publisher solves alone.

A few more sit behind those. Sponsorship, handled carelessly, could let a large
funder's priorities quietly shape which parts of the map are most open, and
guarding against that capture takes ongoing attention. It is not yet clear how
readily agents and their operators will pay for governed civic data rather than
reach for whatever is cheapest and least encumbered, which means the revenue the
model depends on is a hypothesis and not a fact. And if many publishers begin
charging agents at once, a map that asks more of its readers, an identity, a use
policy, could find itself at a disadvantage against sources that ask nothing and
check nothing. Whether shared conventions emerge that let good provenance
compete on fair footing, rather than losing to whatever is easiest to scrape, is
not something Atlas decides on its own.

Under all of it sits a permanent tension between openness and protection. Every
measure that makes the map safer for the people in it also makes it, at the
margin, a little harder to use. The model does not make that tension disappear.
It aims to strike the balance in a sensible place, and to be honest that it will
always need adjusting.

## 13. Adoption

Atlas is a product of the Rebuilding America Project, released as open-source
software under a permissive license. The model here is published, not kept as a
private operating habit, because the problem is not Atlas's alone. Newsrooms,
libraries, research institutions, and other stewards of public-interest data
face the same three-way choice: allow unpaid scraping, wall the material off, or
find a way to be read by machines that funds the work and protects the people in
the data.

For a civic map, only the third path fits the mission, and the parts that matter
most are discipline more than technology. Meter heavy automated use, not basic
reading. Keep the sources on every response. Let accountability, not payment
alone, decide how much access a caller earns. Let sponsorship widen open access
instead of narrowing it. Hold the line that revenue has to strengthen the public
resource rather than privatize it. The particular software Atlas uses to enforce
these is open and there to study and adapt, but the discipline behind it travels
more easily than any code.

The Rebuilding America Project builds the map so that the organizer in Detroit,
the cooperative in Garden City, and the thousands of others doing this work are
easy for the right people to find and hard for the wrong people to exploit.
Machine readers are going to shape which of those wins out. This model is how
Atlas keeps funding the first and preventing the second as the readers change.
