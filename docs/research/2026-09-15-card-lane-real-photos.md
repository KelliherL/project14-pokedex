# Card lane on real photographs — a detector bug, and a claim to walk back

> Verdict: the card lane is **not** "solved end-to-end", and the 2026-08-07
> confidence was built on synthetic scenes that could not surface what real
> photographs do. On 70 real card photos: clean English cards reach
> **recall@10 0.833 / top-1 0.611**, glare photos reach **top-1 0.083**, and
> Japanese cards are **unsupportable through TCGdex** for reference-data
> reasons. One genuine production bug was found and is fixed in this change.
> Companions: [measured baselines](2026-08-07-measured-baselines.md) ·
> [card frontier check](2026-08-06-card-recognition-frontier.md).

## What was measured on

The 70 card photos in `Images/` — 34 distinct cards, English and Japanese,
each shot with and without glare, so glare is a controlled variable. Each
subject was resolved to **every** TCGdex printing carrying an image (English
by name search, Japanese via PokeAPI's `ja` species name into TCGdex's `ja`
endpoint), giving 576 candidate printings, plus 1188 distractors from six
modern sets: a **1764-card database**.

Resolving to every printing rather than guessing one is deliberate. The hash
decides which printing a photo matches; a photo matching nothing is a
reportable miss rather than a wrong guess.

## The bug: the detector could return the whole frame

`detect_card_quad()` had two compounding faults, both invisible to synthetic
testing:

1. **No upper bound on quad area.** It walked contours largest-first and
   returned the first whose aspect landed in the card band (0.55–0.90). A 4:3
   frame's own aspect is **0.750**, dead centre in that band, so whenever the
   background contour beat the card's, the entire frame came back as a card
   and the pipeline hashed the whole scene. **17 of 65 detections covered
   >85% of the frame.**
2. **One threshold polarity.** `findContours` traces *white* regions, so a
   plain Otsu threshold only finds a card **brighter** than its surroundings.
   That is the synthetic harness's world — a bright card on a dark noisy
   backdrop. Photographed on a light table the card is *darker* than its
   background, making it a hole rather than a contour, so the only thing the
   detector could find was the frame.

Neither is hypothetical for the kiosk: **a 640×480 webcam frame is also
0.750**, and exhibit lighting is more likely to give a light background than
the synthetic dark one.

Fixed by searching both polarities and bounding quad area at **0.60** of the
frame. That bound is derived rather than tuned: all four corners must be in
shot for rectify to work, so the ceiling is a card filling the frame height,
which at 63:88 is 0.54 of a 4:3 frame. Measured, correct detections occupy
0.25–0.34 and failures cluster at 0.85–0.90, so 0.60 sits in a wide gap.

| | before | after |
|---|---|---|
| whole-frame quads | 17 | **0** |
| top-1, all photos | 0.138 | **0.245** |
| verify picks correct, all | 0.123 | **0.224** |
| EN glare recall@10 | 0.105 | **0.250** |
| photos reporting a detection | 65/70 | 49/70 |

The detection count falling is the fix working. 21 photos now honestly report
*no card found* instead of hashing a tablecloth, and the unsure state is
already a first-class screen in the UI contract.

## Where the lane actually stands

Shipped detector, 1764-card database, single stills:

| group | n | top-1 | recall@10 | verify picks correct |
|---|---|---|---|---|
| English, clean | 18 | 0.611 | 0.833 | 0.556 |
| English, glare | 12 | 0.083 | 0.250 | 0.083 |
| Japanese, clean | 10 | 0.000 | 0.000 | 0.000 |
| Japanese, glare | 9 | 0.000 | 0.000 | 0.000 |

**Glare defeats retrieval, not verification.** On glare photos the correct
card is usually not in the top 10 at all, so ORB verify never gets a chance —
median inlier count for the correct card is **2**, against the synthetic
calibration's 699. Verify is not failing; it is never offered the right
candidate. Real holo foil under a real light is a different phenomenon from
the synthetic model of two elliptical highlights, which degraded single-frame
top-1 to 73% and was repairable by voting. **Voting cannot repair a signal
absent from every frame.**

Stated fairly: these are single stills, the pipeline's worst case. Live video
moves the glare hotspot as the card tilts, so some frames should be clean and
the 6-of-10 vote would have something to work with. That is a plausible
argument and not a measurement, and it is precisely what spike (a′) needs
real webcam **video** to settle.

## Japanese cards are blocked on reference data

0/28 Japanese photos matched, and the cause is availability rather than the
algorithm. TCGdex's `ja` image coverage is patchy: 11 of 63 Pikachu
printings, 2 of 7 Butterfree, and whole sets with none at all (PMCG1 0/102).
Checked by eye for JP Pikachu — the photographed card is not among the
eleven references that exist.

Japanese support therefore needs a different reference source, or the event
set stays English. Worth settling with the group early, because "we support
Japanese cards too" is an easy thing to assume.

## The thresholds are calibrated for synthetic data

Correct matches on real photos score hash distances of **23–36**, against
`MAX_BEST_DISTANCE = 26`; the synthetic calibration had true matches at ≤3.
The shipped threshold rejects roughly half of its own correct answers on real
input. Recalibration is deferred until spike (a′) has webcam video, because
calibrating twice on two different worst cases is how you end up with a
threshold that fits neither.

The variant-margin hazard predicted before this spike is real but minor at
this scale: an artwork-group-aware margin accepted 3 correct matches versus 2,
with no wrong accepts. It will matter as the database grows. Note the
figurine lane hit the **identical** hazard in its own gate, where it was not
minor, and the fix there is the same one.

## Database size is not the bottleneck

| database | cards | top-1 correct of 65 detected |
|---|---|---|
| base1 only | 102 | 2 |
| candidates | 576 | 10 |
| candidates + distractors | 1764 | 9 |

576 → 1764 cards cost one photo. The hash lane's weakness is image quality,
not scale, which is the opposite of what the frontier note's "85% at 20k
cards" framing would suggest at this size.

## What this changes

- **Fixed and shipped:** the detector (both polarities, bounded area), with
  regression tests built at 640×480 because that is the aspect that triggers
  the bug.
- **Walked back:** "cards are solved end-to-end and stress-tested" is true of
  synthetic scenes and not of real photographs. README and ARCHITECTURE now
  say so.
- **Open:** threshold recalibration, glare handling, and Japanese reference
  data. Spike (a′) needs webcam video of these same cards, especially the
  glare ones — the obvious ask alongside the figurine capture.
