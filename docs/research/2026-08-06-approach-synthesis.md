# The approach — synthesis of the 2026-08-06 frontier spikes

> Written 2026-08-06, cross-reading the three frontier checks:
> [cards](2026-08-06-card-recognition-frontier.md) ·
> [figurines](2026-08-06-figurine-recognition-frontier.md) ·
> [explainability](2026-08-06-live-explainability-frontier.md).
> This is the **recommended technical approach** going into the build,
> superseding the candidate lists in the 2026-07-29 research where they
> differ. Still pre-client-meeting; the client can move goalposts, the
> evidence here doesn't move with them.

## The one-line architecture

Both paths become the same *kind* of system: **retrieval against references
we control, with calibrated distance thresholds, temporal aggregation, and
a decision mechanism that doubles as the on-screen explanation.**

That last property is the thesis of the whole exhibit: we don't bolt an
explanation onto a black box — we pick mechanisms whose actual computation
is showable. Match lines ARE the card verifier. Exemplar neighbours ARE the
figurine classifier. The distance race IS the confidence.

## Card path (final shape)

Per frame (live layer, ≥15 fps): contour quad detect → perspective rectify
→ pHash+dHash in **all 4 orientations** → Hamming search of the whole DB →
top-5 shortlist + margin → **temporal vote ring buffer** (≈6-of-10 frames).

At lock-on (once, <300 ms): **keypoint geometric verification** of the
top-K — ORB + RANSAC homography first (zero new dependencies), **XFeat (+
LighterGlue) as the upgrade** if ORB inliers prove flaky on holo cards.
Accept iff inlier count ≥ T and beats runner-up by ratio; otherwise the
scripted unsure beat.

Why: every maintained open-source scanner is still hash-based; the only
2026 academic card system (TCG-AR) shows trained embeddings reach just
85.1% open-set top-1 at 20k cards — so embeddings don't replace the hash
core, they're a future *shortlister* if we ever scale past one set, with
the keypoint verifier staying as decider. Glare is attacked physically
first (ring light; cross-polarisation film is the cheap robustness win),
then by temporal voting, then by RANSAC's tolerance of local corruption.

## Figurine path (final shape — supersedes "CLIP-kNN vs fine-tuned ViT")

**Primary: frozen DINOv2 ViT-S/14 (with registers) + cosine kNN** over
~150–300 reference frames per figurine, captured on the actual event
camera/stand via turntable protocol (session-diverse: elevations ×
lightings; hold out one full session for eval). Backdrop-subtraction crop
(~1 ms; the matte backdrop is load-bearing) — **no SAM-class segmentation
at inference** (2–10 s CPU, budget-killer). Burst decision over ~10 frames
with mean-similarity + margin thresholds; below threshold → "I don't
recognise this one yet!"

**Control arm** (cheap, keeps us honest): linear probe on the same DINO
embeddings + one ConvNeXt-Tiny fine-tune from **ImageNet** weights. The
1,025-class Pokémon-artwork checkpoint from the July plan is demoted to a
curiosity ablation: it publishes no accuracy, and artwork→toy is exactly
the rendition shift classifiers fail on.

Why DINO over CLIP/SigLIP: instance identity is a *visual-structure*
problem, not a semantic one — DINO-family features beat CLIP-family by
wide margins on fine-grained/instance benchmarks (70% vs 15% on
iNaturalist in one 2025 head-to-head). DINOv2 stays Apache-2.0; DINOv3 is
a challenger to benchmark but ships a gated custom licence. kNN also gives
us: add-a-figurine-with-zero-retraining (an ops requirement AND a live
exhibit moment), meaningful distances for the unsure gate, and the
faithful-by-construction exemplar-strip explanation.

## The explainability stack (rulings)

**Card:** live quad + rectified crop → animated top-5 distance race →
match lines at lock-on (staggered draw; inliers green, rejected grey) →
one plain-language honesty sentence ("the runner-up was 3× further away").
ORB-vs-XFeat side-by-side as operator "geek mode". No heatmap here — there
is no classifier to attribute over; faking one would be theatre.

**Figurine:** exemplar strip (winner's neighbours **plus the runner-up's**
— PCNN evidence: showing top-K classes' examples reduces over-reliance) →
similarity bars → **one** Grad-CAM at lock-on, targeted at *cosine
similarity to the matched exemplar* (~25–41 ms CPU, measured), never per
frame. DINOv3-style PCA parts-map and the PCA embedding-map dot are
stretch goals with strict caption discipline.

**Refused on honesty grounds:** raw ViT self-attention maps (register
artifacts glow on empty background; plausible-not-faithful) and live
UMAP/t-SNE projections (museum study: visitors invent axis meanings;
single-point transform takes seconds). These refusals are evidence-backed
and belong in the report as design decisions.

**Discipline that ships with the code:** every heatmap must pass the
randomise-weights / swap-target sanity test before it goes on screen;
captions written before code, ≤8 words, literally true of the computation;
explanations arrive unprompted; the unsure state is a scripted first-class
beat with its own voice line.

## Architectural consequences for the repo

1. **Lock-on event in the contract.** The live layer (cheap, per-frame) and
   the explanation layer (expensive, once) are different phases; the
   `Identification` payload and INTERFACES.md need a lock-on concept with
   new explanation keys (`match_lines`, `exemplars`, `similarity_cam`,
   `votes`) when those land.
2. **PyTorch stays in-process for lock-on explanations.** Gradients don't
   cross ONNX Runtime; either the figurine model runs its explanation pass
   in PyTorch, or we ship no gradient-based display. Decide per the ONNX
   check in the explainability spike list.
3. **Temporal voting is a shared component** — same ring-buffer logic for
   both paths; it is also a display (the voting strip).
4. **The 30-second show is the frontend spec.** The beat table in the
   explainability note (attract → track → lock → race → evidence → verdict
   → reset, with the unsure branch) is what the UI workstream builds to;
   fold it into INTERFACES.md when the frontend work starts.

## What changed vs the 2026-07-29 docs

| Was (July) | Now (August, evidence-backed) |
|---|---|
| Card: single-frame pHash, temporal voting "planned" | pHash core confirmed; voting + keypoint verify **promoted to the design**, 4-orientation hashing added |
| Figurine spike: CLIP/SigLIP-kNN vs fine-tuned artwork-checkpoint ViT | **DINOv2-kNN primary**; CLIP demoted (semantic vs instance mismatch); artwork checkpoint demoted to ablation; ≥90% kill bar raised to ≥95% |
| Explainability: Grad-CAM heatmap + drawMatches + top-5 bars, per frame where possible | Exemplars-and-distances **primary**, one similarity-CAM **at lock-on only**; attention maps and live UMAP **refused**; sanity-test gate added |
| "AI-powered means classical CV for cards" framing | Unchanged — and now the figurine path is *also* honest retrieval, so the whole exhibit story is "the machine compares, and shows you the comparison" |

## The unified week-1 spike (replaces spikes a/b/c)

One harness, three days, all falsifiable (full check lists live in each
frontier note):

- **Day 1 — cards under stress** (needs: real cards, webcam): margin
  separation on glare/sleeve/skew video; voting beats single-frame; ORB
  inlier gap correct-vs-impostor; XFeat fps on our laptop.
- **Day 2 — figurines** (needs: ~5 home figurines photographed): DINOv2-kNN
  ≥95% held-out-session; backbone ordering DINO > SigLIP2/CLIP on our data;
  unknown-object rejection ≥90%; reference-count curve.
- **Day 3 — the show** (needs: day 1+2 artifacts): CAM ≤50 ms and passes
  sanity tests; match-line render ≤80 ms; exemplar indices == decision
  indices asserted; 15 fps sustained live layer; n≥3 legibility pilot.

Kill criteria are in the frontier notes; each maps to a named fallback
(ORB stays; ViT-B or linear head; drop a display rather than caption it
dishonestly).

## Addendum (2026-08-06, later) — the generalisation challenge

The technical lead formally challenged the closed-set framing ("there must
be an existing dataset or a stronger generalised attempt"). An adversarial
spike attempted to refute the three underlying claims — full note:
[figurine data sources](2026-08-06-figurine-data-sources.md). Outcome:

- **"No public figurine photo dataset exists" survived** a wider net than
  the original check (Zenodo, IEEE DataPort, GitHub, full HF sweep). The
  claim is now adversarially reviewed, not just asserted.
- **The corollary "only self-captured photos can work" fell.** Renders of
  the actual game models (~900–1,000 species rippable) matched via frozen
  DINOv2 is measured SOTA technology (CNOS on BOP; Brickognize's
  renders+~20-real recipe). Artwork≠renders; the rendition-shift argument
  was being over-applied.
- **"Generalised any-merch recognition ≥90% offline" remains nonexistent**
  anywhere, cloud included; FOCI (EMNLP 2024) shows vision-LLMs
  *underperform* CLIP-style retrieval at fine-grained ID.

Plan changes adopted:

1. Turntable capture for the event set **stands** (only evidence-backed
   path to the demo bar), but spike b′ gains a **frame-count ablation**
   (10/25/50/150) — capture may drop from ~10 to ~2 min per figurine.
2. **New stretch tier: render-template species fallback** — CNOS-style ~40
   Blender viewpoints per species, same DINOv2, same kNN index, lower
   trust weight, confidence-gated "best-effort guess" voice line. This is
   the sanctioned "generalised" lane; it is never the headline promise.
   IP: ripped-model renders are internal-only, never redistributed —
   added to the client sign-off list.
3. **New experiment worth owning:** renders-only vs renders+20-real vs
   150-real on 5 figurines — no measured Pokémon sim-to-real datapoint
   exists anywhere; ours would be a report highlight.
4. Marketplace-photo scraping **dropped** (ToS-dirty, curation-heavy,
   worse domain match than 10 minutes of turntable).
