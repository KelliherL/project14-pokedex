# Figurine lane, measured on real figurines — and built

> Verdict: the figurine recogniser is **built and shipping in this repo**.
> Frozen DINOv2 + cosine kNN over turntable captures of nine 3D-printed
> figurines. It identifies all nine, refuses everything that is not one of
> them, and speaks the Pokédex entry. Two things are not yet proven and are
> called out in full below: every accuracy number is **same-session**, and
> the recogniser identifies **specific figurines, not species**.
> Companions: [measured baselines](2026-08-07-measured-baselines.md) ·
> [figurine frontier check](2026-08-06-figurine-recognition-frontier.md) ·
> [approach synthesis](2026-08-06-approach-synthesis.md).

## What was measured on

Ten turntable clips (iPhone, 1080p30, 15–23 s) of nine 3D-printed figurines
on a white turntable against a card backdrop, all filmed in one sitting on
2026-08-27. Nine objects, eight species: there are two *different* Jolteon
prints, which turned out to be the single most informative thing in the set.

Pipeline: per-pixel temporal-median background plate → subtract → largest
connected component → square crop + 16% margin → frozen DINOv2 ViT-S/14-reg →
L2-normalised cosine kNN. 942 frames extracted, 24 per figurine shipped as
the reference index (335 KB).

Nothing is trained. "Building the model" is embedding reference frames once.
Adding a figurine is an entry in `data/figurines/sources.json` and a re-run of
`scripts/build_figurine_index.py`.

## Closed-set accuracy: saturated, and that is the honest reading

Held-out contiguous rotation arc (25%, with a 3-frame guard band so test
views are genuinely unseen angles):

| | single-frame | burst-of-10 |
|---|---|---|
| arc holdout | 1.000 | 1.000 |
| random split (leakage control) | 1.000 | 1.000 |
| 10 references per figurine | 0.991 | 1.000 |

**100% is not a capability claim.** Ten brightly coloured objects under one
lighting setup against one backdrop is a saturated task, and the arc holdout
varies viewpoint only. The useful conclusions are the cheap ones: **10–20
reference frames per figurine is enough** on a controlled stand (minutes of
turntable, not the ~80 frames the CORe50 curve implied), and the reference
budget question is closed.

## The gate is relative, because an absolute one does not survive a new room

There is no second capture session, so session shift was simulated: perturb
the held-out arc the way a different room would, re-embed, re-query against
the clean index, with thresholds still calibrated on clean data — which is
what a lab-calibrated kiosk actually ships with.

| condition | top-1 | burst-10 | absolute gate accepts | margin gate accepts |
|---|---|---|---|---|
| clean | 1.000 | 1.000 | 0.944 | 0.970 |
| dim 0.6× | 1.000 | 1.000 | 0.948 | 0.970 |
| bright 1.5× | 0.953 | 0.947 | **0.185** | **0.841** |
| warm white balance | 0.996 | 1.000 | 0.931 | 0.884 |
| blur | 1.000 | 1.000 | 0.923 | 0.936 |
| rotated 15° | 0.936 | 0.947 | **0.000** | **0.738** |
| JPEG q30 | 0.987 | 1.000 | 0.618 | 0.760 |
| combined "new room" | 0.970 | 1.000 | 0.549 | 0.657 |

**Ranking is robust; an absolute threshold is not.** Under every
perturbation the engine still puts the right figurine first, but an absolute
cosine threshold calibrated in the lab rejects 81% of its own correct answers
under a brightness shift and **100% of them under a 15° rotation**. The
failure mode is a kiosk that is right and refuses to say so, showing "not
sure" to every visitor.

The shipped accept rule is therefore **margin-based**: the best match must
beat the best match *giving a different answer* by ≥ 0.05, with a loose
absolute floor of 0.50 to reject input that is not a figurine at all. This
mirrors the card lane's "≥30 inliers AND ≥2× the runner-up", relative for the
same reason.

**"Different answer", not "different reference class"** — this distinction is
load-bearing and cost a bug to find. Two prints of the same Pokémon are
different reference classes but the same answer. Letting them compete made
the gate refuse a Jolteon at 0.97 similarity on a margin of 0.021, because
the *other* Jolteon print was the runner-up. Grouping by dex id fixes it.
The card lane has the identical hazard with reprints and holo variants of one
artwork; it is recorded in the card scaling note.

## Unknown rejection

Leave-one-object-out, thresholds calibrated to accept 95% of known queries:
**89.5% of a never-seen figurine's frames rejected** (worst object 60.5%),
against 66% for CORe50. The improvement is consistent with the prediction
that a controlled stand plus a crop removes the background confound.

**Out-of-domain probes: all 70 card photos rejected**, peak similarity
**0.269** against known matches at **0.873**. Enormous headroom, which is
what the absolute floor is set from.

## The limit that matters most: objects, not species

Index one Jolteon print, query the other:

| query | lands on the other Jolteon |
|---|---|
| Jolteon-A → index holding Jolteon-B | **6.2%** (it prefers Vaporeon) |
| Jolteon-B → index holding Jolteon-A | **41.6%** (it prefers Vulpix) |

An unseen print of a known species is **not** recognised as that species.
This is the artwork→toy rendition shift the figurine frontier note flagged,
now measured on our own objects.

Two consequences, and they pull in opposite directions:

- **The curated design is unaffected.** We photograph the exact figurines the
  event uses, which is what the architecture has always said. Whatever is on
  the table on the day is what must be filmed.
- **The stretch "best-effort guess on unknown merch" tier is dead via this
  route.** A visitor's own Pikachu will not match our Pikachu unless it is
  the same print. That tier should not be promised to the client.

## Operational finding: the background plate is not optional

The kiosk captures a plate of the empty stand (`b` in the dev harness). Without
one the classifier centre-crops, and for physically small figurines the crop
is mostly backdrop. Measured on real frames:

| figurine | centre crop | with plate |
|---|---|---|
| Jolteon-B | refused, margin 0.021 | **Jolteon**, margin 0.133 |
| Bulbasaur | refused, margin 0.029 | **Bulbasaur**, margin 0.138 |
| Pikachu | Pikachu, margin 0.061 | Pikachu, margin **0.222** |

Capturing the plate is a required setup step, and the UI shows a prompt until
it is done.

## What shipped

- `app/recognisers/figurine_knn.py` — `FigurineClassifier`, the crop, the
  index, and the margin gate. torch is imported lazily so the card lane still
  runs without it.
- `scripts/build_figurine_index.py` — rebuilds from turntable clips or from a
  folder of photos per figurine.
- `data/figurines/` — the index (240 references, 335 KB), labels, exemplar
  thumbnails, and `sources.json`.
- Burst voting in the figurine lane, reusing the card lane's `VoteBuffer`
  unchanged.
- `data/dex.json` extended to 74 species: five figurine species (Eevee,
  Vaporeon, Jolteon, Flareon, Sprigatito) had no entry, so the kiosk
  identified them correctly and then said it was not sure.
- Tests and selftest gates that run without torch or a weights download.

## What this does NOT prove

**Every accuracy number here is same-session.** All ten clips were filmed in
one sitting, six minutes end to end. The b′ kill criterion in ARCHITECTURE.md
— "kNN < 95% top-1 on a held-out session" — **cannot be evaluated against
this data**, and the two Jolteon clips do not help because they are different
objects. The stress table is a simulation of session shift, not a measurement
of it.

A second capture of the same nine figurines in a different room, roughly ten
minutes of filming, converts every number above from indicative to real. It
is the highest-value ten minutes available to this project right now.
