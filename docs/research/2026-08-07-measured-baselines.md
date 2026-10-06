# Measured baselines — the approach validated on our own hardware

> Measured 2026-08-07 on the development laptop (14-thread CPU, no GPU,
> offline), against a synthetic stress harness built over the cached base1
> set, plus a public-benchmark dry run of the figurine engine. This note
> turns the 2026-08-06 research verdicts from *cited* numbers into *our*
> numbers, and records what graduated into the codebase as a result.
> Companions: [approach synthesis](2026-08-06-approach-synthesis.md) ·
> [card frontier check](2026-08-06-card-recognition-frontier.md) ·
> [figurine frontier check](2026-08-06-figurine-recognition-frontier.md) ·
> [explainability check](2026-08-06-live-explainability-frontier.md).

## Card lane: hash → vote → verify, stress-tested

Synthetic webcam scenes (dark backdrop, card composited at angle) across
five conditions — clean, ±10° rotation, perspective skew, mild glare
(1 highlight, α=0.55), harsh glare (2 highlights, α=0.85 — the holo-hotspot
stand-in). 25 cards × 5 conditions, plus junk probes and 30-frame
sequences.

**Geometric verify (ORB + RANSAC homography) separates decisively.**
Per-scene, correct card vs the best impostor in the hash top-5:

| Condition | correct beats best impostor | median correct inliers | median best impostor |
|---|---|---|---|
| clean | 25/25 | 699 | 20 |
| rot ±10° | 25/25 | 677 | 18 |
| skew | 25/25 | 608 | 19 |
| glare mild | 25/25 | 426 | 18 |
| glare harsh | 24/25 | 225 | 16 |

Accept rule **≥30 inliers AND ≥2× the runner-up**: accepts every correct
card with zero impostor accepts on all conditions except harsh glare
(23/25 correct, 1 impostor accept in isolation — and verify only ever runs
on the *voted* winner, so a wrong final answer needs the impostor to also
win the temporal vote; observed wrong locks: none). Featureless junk
probes: **0 inliers, always rejected** — the verify gate doubles as the
junk killer the hash margin needed careful calibration for.

**Temporal voting fixes what glare breaks.** Under harsh drifting glare,
single-frame hash top-1 is right only **73%** of the time — but a 6-of-10
vote over raw top-1s locked **10/10 cards, all correct, at the earliest
possible frame**, and verify confirmed all 10. Design consequence
(measured, not assumed): the vote must consume **raw** top-1s; gating votes
by the accept threshold starves the buffer (1/10 locks on the same data).

**A production bug found and fixed: 90° presentations.** Cards at 90° were
unrecoverable (0/15) no matter how many hash orientations were tried —
the rectify step was warping landscape quads into the portrait canvas,
aspect-squashing the content ~1.38×. Aspect-aware rectify (landscape
canvas, then rotate both ways, hash both candidates) recovers **15/15**.

**Costs (median, this laptop):** detect+rectify ~3.1 ms/frame · hash +
full-102-card search ~2–3 ms/frame · ORB verify ~10.7 ms/candidate
(top-5 ≈ 50–125 ms, once at lock-on) · two-candidate 90° path ~35 ms when
triggered. The live layer has an order of magnitude of headroom against
the 15 fps bar.

## Explainability budget: measured, and the sanity gate works

| Display cost | median ms (this laptop) | verdict |
|---|---|---|
| Grad-CAM (ResNet18, 224²) | 56 | fine once-per-visitor at lock-on; marginal vs the ≤50 ms bar — use a smaller backbone if it matters |
| EigenCAM | 50 | fallback, with honest captioning only |
| kNN over 10,000 refs (384-d cosine) | **0.12** | free — exemplar strip and similarity bars cost nothing |
| XFeat extract (640×480) | 66 | lock-on only |
| XFeat match pair | 136 | lock-on only; **ORB (10.7 ms/candidate) stays the per-frame/default verifier** |

**The no-theatre gate is live:** Grad-CAM maps from trained vs
randomised weights correlate at **−0.19 to −0.45** across runs — clearly
different, which is exactly what the randomise-weights sanity check
demands before any heatmap is captioned as reasoning. The harness for that
check now exists and applies to every future display.

## Figurine engine dry run on a public benchmark

Before any figurine exists, the exact planned engine (frozen DINOv2
ViT-S/14-reg + cosine kNN) and the exact planned evaluation protocol
(held-out sessions, reference-count ablation, unknown rejection) ran on
CORe50 — 50 hand-held household objects filmed across 11
background/lighting sessions. Structurally our problem, but *harder* than
the exhibit setting: raw 128 px full frames with cluttered real-world
backgrounds, in-hand occlusion, no crop, no controlled stand.

- Single-frame top-1, 40-way, held-out sessions: **82.2%** (k=5 majority
  83.2%).
- **Burst-of-10 vote — the pipeline's actual decision unit: 96.2%**
  (n=346 bursts). Temporal aggregation does for figurines exactly what it
  measured as doing for cards.
- Reference-count ablation: 8 refs/object → 70.3% · 24 → 74.9% ·
  40 → 76.7% · 80 → 79.6% · ~240 → 82.2%. The knee sits around ~80
  references — which prices real capture at minutes per figurine, from a
  measured curve rather than a guess.
- Unknown rejection at 95% known-acceptance: **66%** for never-seen object
  *categories* (and only 17% for the pathological split holding out
  sibling instances nearly identical to known objects). Read honestly:
  whole-frame embeddings let cluttered backgrounds make unknowns look
  familiar; the exhibit's matte backdrop + crop removes exactly that
  confounder, and margin gating (not raw similarity) is the production
  rule. Unknown rejection stays a hard gate in spike (b′) before the
  event — this number is the reason it must.

The engine, the protocol, and the eval harness all work end to end;
figurine day is data collection, not development.

## What graduated into the codebase off the back of this

- `app/recognisers/card_matcher.py` — aspect-aware `rectify_candidates`
  (the 90° fix) + hash `shortlist` in the explanation payload.
- `app/recognisers/voting.py` — 6-of-10 `VoteBuffer` over raw top-1s.
- `app/recognisers/verify.py` — `CardVerifier`, ORB+RANSAC accept gate
  (≥30 inliers, ≥2× runner-up), graceful when the image cache is absent.
- Lock-on flow in the dev harness; `locked`/`verified_*` keys in the
  frontend contract (INTERFACES.md).
- Tests: voting logic, 90° regression (cache-free), selftest gates for the
  90° case, verify acceptance (720 inliers vs 6 on the reference scene),
  and junk rejection (0 inliers).

## Correction (2026-09-15)

The card-lane section below is measured on **synthetic** scenes and reads
more confidently than real photographs support. Testing on 70 real card
photos found glare defeats retrieval outright, and surfaced a detector bug
that synthetic scenes structurally could not: see
[the real-photo note](2026-09-15-card-lane-real-photos.md). The numbers here
stand as synthetic results; the conclusions drawn from them do not.

## What this does NOT yet prove

Synthetic scenes bound the pipeline from the optimistic side. Real webcam
frames — sensor noise, motion blur, actual holo foil, sleeves, hands —
are spike (a′)'s job, on real cards, on the event camera. The figurine
numbers below are a *methodology* validation on stand-in objects; the
event-set numbers come from spike (b′) after the reference capture.
