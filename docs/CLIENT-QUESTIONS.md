# Pokédex AI Outreach Activity — First Client Meeting Questions

> COMPX374-26B, Project 14 (client: Awhi Goodall, University of Waikato).
> For the team spokesperson. The client is assumed non-technical, so every
> question is phrased in plain language; the indented *why* line underneath is
> for the team — it says which technical decision the answer feeds. Don't read
> the *why* lines out in the meeting.
>
> The brief we're working from: visitors hold a Pokémon card or figurine in
> front of a camera; the app identifies the Pokémon, reads its Pokédex entry
> aloud, and shows a visual of how the AI recognised it. Live activity at
> Nerdfest 2026 (late October).

---

## 1. The event itself

**Where will the activity run, and what's the space like?**
(Indoors? A stall/table? How much room? Is it a loud hall?)
> *Why: lighting drives camera/model reliability; noise decides speakers vs
> screen captions vs headphones; table space decides hardware form factor.*

**Will there be reliable internet at the venue, or should we assume none?**
> *Why: this is the single biggest technical fork. Venue Wi-Fi at public
> events is notoriously flaky, so we would default to fully offline unless
> told otherwise — that rules some cloud AI services in or out on day one.*

**Is the activity staffed the whole time, or does it need to run unattended?**
> *Why: unattended means kiosk-mode software (auto-restart, no keyboard,
> nothing crashable); staffed means the explainability display can be a
> talking point a person walks visitors through.*

**Roughly how many people do you expect, and in what bursts?**
(A queue of kids at peak? One at a time?)
> *Why: sets the identify→speak cycle time budget and whether we need a
> "next person" reset flow.*

**How long does the event run, and is there power at the stand?**
> *Why: battery vs mains; thermal throttling on a laptop running a model for
> 6 hours matters.*

## 2. Hardware and equipment

**Does the University provide the hardware, or do we?**
(A laptop? A webcam? A screen the audience watches? Speakers?)
> *Why: the brief lists equipment as TBC. The answer decides our whole
> deployment target — a laptop app, a browser app, or a small device.*

**How would you like it to *look*? Is a plain laptop fine, or do you want
something that feels like a real Pokédex?**
(e.g. a screen in a red 3D-printed shell, a tablet in a case)
> *Why: a themed enclosure (e.g. Raspberry Pi + small screen) is very doable
> and hugely popular at outreach events, but it changes the hardware and
> performance budget, and needs lead time for printing/assembly.*

**Is there budget for parts, and how is it accessed?**
> *Why: webcam quality, a second display, a Pi, an enclosure — small costs,
> but we need to know the approval path early.*

## 3. The cards and figurines

**Is it cards, figurines, or both? Which matters more to you?**
> *Why: these are two different recognition problems under the hood. Cards
> can be matched against a database of every printed card; figurines need a
> model trained to recognise the physical toys. "Both" is fine but we'd
> stage delivery.*

**Can you (or we) lock in the exact set of figurines/cards that will be at
the stand, and can we borrow them well before the event?**
> *Why: the most reliable systems are tuned on photos of the actual objects
> under realistic conditions. Early access to the exact figurines is the
> single cheapest way to make the demo feel magic instead of flaky. This is
> our most important ask.*

**How many different Pokémon do you want it to recognise?**
(All 1000+, or a curated set of favourites, say 20–50?)
> *Why: sets accuracy expectations honestly. A curated set can be near
> flawless; "any Pokémon ever" means visible mistakes. For a public demo we
> would push for curated-and-flawless with a graceful answer when it's
> unsure.*

**For cards: will they be in sleeves? Shiny/holographic cards too?**
> *Why: glare and sleeve reflections are the classic failure modes for card
> scanners; we'd test for them specifically.*

**Should visitors be able to bring their own cards/toys and try them?**
> *Why: changes the problem from closed-set (we know every object) to
> open-set (anything could show up) — big reliability implication, worth an
> explicit expectation-setting conversation.*

## 4. The audience experience

**Who's the core audience — young kids, teens, families?**
> *Why: reading level of on-screen text, height of the camera, how much
> patience we can assume, and how much explanation the AI visual needs.*

**When the app reads the Pokédex entry aloud — what should that feel like?**
(A robotic "Pokédex voice" like the show, or a natural human voice?
English only, or other languages — e.g. te reo Māori greetings/framing?)
> *Why: decides the text-to-speech technology. The classic robotic Pokédex
> voice is actually easier and more thematic. Multi-language support exists
> for the entry text in ~10 languages, but te reo would be custom content we'd
> write with the client.*

**Should there be captions/subtitles alongside the voice?**
> *Why: accessibility (deaf/hard-of-hearing visitors, loud hall) — cheap to
> add if planned early, annoying to retrofit.*

**When the AI shows "how it recognised the Pokémon" — how deep do you want
that to go?**
(A colour heatmap of where it looked? A "top 5 guesses" bar race? Lines
matching the card to the database? A staffed 30-second explanation?)
> *Why: this is an explicit deliverable and the most open-ended one. The
> answer decides which technique we build — some visuals are prettier, some
> are more truthful, some are both. We'll bring mockups of 2–3 options to a
> follow-up meeting.*

## 5. Rules, safety, and content

**The camera will have children in front of it. What are the University's
requirements around cameras at public events?**
(Signage? Parental consent? Can we guarantee no images are ever stored?)
> *Why: NZ Privacy Act + university ethics. Technically we can process frames
> live and store nothing — we'd like to promise that in writing on a sign.
> We need to know who signs this off.*

**Pokémon is Nintendo/The Pokémon Company's property. Has the University run
outreach with third-party characters before — who checks that side?**
> *Why: free non-commercial educational use of names/entries/card images is
> common in fan tools, but a university event should get a yes from whoever
> handles this. We flag it now so it's not a week-before surprise. (There is
> precedent: the data sources we'd use are long-running public fan projects.)*

**Some Pokédex entries are genuinely dark (ghost stories, "it carries dead
children" style lore). Are you happy for us to curate which entries are
read out?**
> *Why: each Pokémon has ~30 entry variants across games; we'd whitelist
> kid-friendly ones. Cheap to do, needs client blessing.*

## 6. Delivery and what happens after

**After Nerdfest, what happens to this? Do you want to run it again at
future events without us?**
> *Why: decides how much we invest in packaging (one-click start, a written
> run-book, spare-parts list) vs a one-night build.*

**Who on your side can meet us regularly, and can we schedule a full dress
rehearsal at the actual venue (or similar) before the event?**
> *Why: a live-conditions test run is the difference between a demo that
> works in the lab and one that works at 7pm in a hall full of kids. We want
> it on the calendar from day one.*

**What does success look like to you?**
(If Nerdfest goes perfectly, what did people see/feel/say?)
> *Why: keeps us honest about must-have vs nice-to-have. E.g. "20 figurines,
> instant, never wrong, kids giggle at the voice" is a different build from
> "any card ever printed".*

---

## The one-paragraph summary the spokesperson can close with

> "Our plan is to research two recognition approaches — one tuned for cards,
> one for figurines — build a small working demo early, and bring it to you
> for feedback rather than describing it in the abstract. The three things
> that most help us right now are: (1) knowing the internet situation at the
> venue, (2) borrowing the exact figurines/cards early, and (3) a named
> contact for the privacy/IP sign-offs."
