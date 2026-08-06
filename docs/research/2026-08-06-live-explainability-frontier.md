# Live explainability — 2026 frontier check

> Researched 2026-08-06 for **the decision: which live "how the AI saw it"
> displays to build for the two backends, judged on honesty, kid-legibility,
> CPU cost, and wow factor.** Claims tagged [Verified] / [Reported] /
> [Inference]. Companion spikes:
> [cards](2026-08-06-card-recognition-frontier.md) ·
> [figurines](2026-08-06-figurine-recognition-frontier.md) ·
> synthesis in [the approach note](2026-08-06-approach-synthesis.md).

> **Verdict.** Nothing has displaced the 2024 stack; it has been *sharpened*,
> and the sharpening happens to point exactly at our exhibit. For the **card
> path**, the honest-and-impressive core is already almost built: keep the
> quad overlay + rectified "as the AI sees it" crop as the live layer, and
> make the differentiating beat an **animated distance race over the top-5
> hash candidates** plus **progressively-drawn keypoint match lines** at
> lock-on — match lines are the single highest wow-per-honesty display
> available to us, and XFeat (CVPR 2024, Apache-2.0) gives learned match
> lines at real-time sparse rates on a laptop i5 CPU with a webcam demo
> script shipped in the repo. For the **figurine path**, choose **embedding
> + kNN** and make the primary explanation the **nearest-neighbour exemplar
> strip plus similarity bars** — for a kNN decision the neighbours *are* the
> computation, so that display is faithful by construction, whereas any
> heatmap over a kNN decision is a post-hoc approximation. Add exactly one
> heatmap, computed **once at lock-on, not per frame**: Grad-CAM on the
> *cosine similarity to the matched exemplar* (supported natively by
> pytorch-grad-cam's embedding/similarity targets), which answers "which
> pixels made this look like THAT photo" — the only saliency question our
> backend actually asks. Budget ~25–41 ms CPU per CAM call on a laptop
> (measured), which is affordable once per visitor and marginal per frame.
> Two things to refuse on honesty grounds: **raw ViT self-attention maps**
> (plausible-not-faithful, and DINOv2/CLIP-family maps are contaminated by
> high-norm background artifact tokens) and a **live UMAP/t-SNE dot moving
> on a 2-D map** — a science-museum study with 61 visitor groups aged 7–49
> documented visitors inventing meanings for the t-SNE axes, which is
> precisely the "theatre" failure we promised to avoid. If we want the map
> anyway, use **PCA** (linear, deterministic, µs-cheap) and put the true
> distances on screen next to it.

---

## The landscape (with links and dates)

### Saliency/attribution at webcam rate

**pytorch-grad-cam is still the default and is still moving.** PyPI
`grad-cam` **1.5.5, released 2025-04-07** [Verified — PyPI]. The README now
lists ~17 methods including several post-2024 additions — **KPCA-CAM**,
**FEM**, **ShapleyCAM**, **Finer-CAM**, **SegEigenCAM**, **RefineCAM** — and
cites 2025/2026 papers [Reported — README fetch]. Note the repo publishes
**no GitHub Releases/tags** [Verified], so "maintained" must be judged from
commits and PyPI, not a changelog; search surfacing indicated repository
activity into 2026 [Reported — single source, worth a 30-second re-check
before we cite it in the report]. ViT/Swin/DeiT are explicitly supported
with target-layer guidance (`model.blocks[-1].norm1` for ViT) and — critical
for us — the library documents **pixel attribution for embedding outputs,
i.e. "embedding-similarity" explanations** [Reported — README].

**The CPU numbers we needed exist and are measured on a laptop.** TorchCAM
(`frgfm/torch-cam`, v0.3.1, also maintained, also now carries LeGrad and
RefineCAM) publishes a benchmark over 100 iterations at 224×224 on an
**Intel Core i7-10750H CPU** [Verified — README]:

| Method | ResNet18 CPU | MobileNetV3-L CPU |
|---|---|---|
| CAM (plain, GAP+linear head) | **0.14 ms** | — |
| Grad-CAM | 40.66 ms | **26.64 ms** |
| Grad-CAM++ | 41.61 ms | 25.50 ms |
| XGrad-CAM | 40.63 ms | 24.21 ms |
| LayerCAM | 40.91 ms | 25.14 ms |
| SmoothGrad-CAM++ | 239.27 ms | 156.25 ms |
| Score-CAM | 6796.89 ms | 679.16 ms |

This independently confirms the 2026-07-29 prior finding (Grad-CAM/LayerCAM
~25–40 ms/frame CPU on small backbones) and re-confirms Score-CAM's
exclusion [Verified — two independent sources now]. A 2025 XAI-in-CV review
separately reports Grad-CAM at **39.0 FPS**, transformer-based XAI at
**25.0 FPS**, SmoothGrad at 5.5 FPS, RISE at **0.05 FPS**, hardware
unspecified [Reported — single source, hardware unstated, treat as ordering
not as ms].

The **plain-CAM 0.14 ms** row is the most under-appreciated number on this
page: for a CNN whose head is global-average-pool → one linear layer, CAM is
not an approximation — it is the algebraic decomposition of the class score
across spatial positions, and it costs essentially nothing [Verified —
torch-cam benchmark; Inference for the faithfulness framing, which follows
from the CAM derivation]. **If the figurine path goes the
fine-tuned-classifier route, architecting the head as GAP+linear buys us a
free, exactly-faithful heatmap at full frame rate.** That is a design
decision we should make on purpose rather than discover.

**Architectural gotcha:** every CAM except plain CAM needs a **backward
pass**. If we run the embedding/classifier through ONNX Runtime or OpenVINO
for speed, we cannot compute Grad-CAM there — ONNX/ORT are
inference-oriented and capturing a backward graph via TorchScript export is
documented as not feasible [Reported — PyTorch issue #88740; ONNX has only a
preview `Gradient` training op]. Practical consequence: keep a PyTorch copy
of the model loaded for the lock-on explanation, or restrict ourselves to
plain CAM / EigenCAM / exemplar displays [Inference].

**Newer ViT-specific methods worth knowing (2025):**

- **LeGrad** (ICCV 2025, arXiv 2404.03214): gradient w.r.t. ViT *attention
  maps*, aggregated across layers; simple to implement; validated up to
  ViT-BigG/14; already in TorchCAM [Reported].
- **Prompt-CAM** (CVPR 2025, arXiv 2501.09333): learns class-specific
  prompts on a **frozen** DINO/DINOv2/BioCLIP backbone; the true class's
  multi-head attention maps then localise the *traits* that distinguish
  visually similar categories. The paper's explicit motivation is that
  "Grad-CAM often fails to identify these traits, producing blurred, coarse
  heatmaps that highlight entire objects." Training is "almost a free lunch"
  (a VPT prediction-head modification) [Reported]. Fine-grained bird species
  ↔ fine-grained Pokémon figurines is a close analogy; this is the most
  interesting *new* option for backend 2.
- **Finer-CAM** (CVPR 2025, `Imageomics/Finer-CAM`, shipped inside
  pytorch-grad-cam): explicitly contrasts the target class against *similar*
  classes and suppresses shared features, so the heatmap shows the
  **discriminating difference** rather than the whole object; retains CAM's
  efficiency; masking its top-5% pixels drops confidence more than baselines
  [Reported]. This is the technical instantiation of the best question a kid
  asks: "why not the other one?"

**Attention maps: the debate, and our ruling.** There is no consensus that
raw attention is a faithful explanation, and the literature's framing is
exactly the trap we promised to avoid — **plausible without being
faithful**. Jain & Wallace (2019) vs Wiegreffe & Pinter (2019) never
resolved; the faithfulness-violation line of work (arXiv 2201.12114) shows
predictions are often robust to permuting the very weights the heatmap
displays; the 2025 XAI-in-CV review states flatly that "attention is not
explanation by itself — raw attention weights may not always correlate with
a model's causal reasoning" [Verified — multiple sources]. Worse for us
specifically: **ViT feature maps contain artifact tokens** — high-norm
outliers (~2% of tokens, ~10× norm) parked in low-information *background*
regions and repurposed for internal computation, present in DINO, DINOv2 and
OpenCLIP ("Vision Transformers Need Registers," ICLR 2024; fixable at test
time without retraining, arXiv 2506.08010) [Verified]. So a raw DINOv2
attention map shown to a family can literally glow on the empty table next
to the figurine, and we would have no honest caption for it. **Ruling: no
raw attention maps in the exhibit.**

The honest ViT-family display that survives scrutiny is **PCA of patch
features rendered as RGB** — the DINOv3 repo's own visualisation method
(`notebooks/pca.ipynb`; PCA of dense patch features projected to 3 dims →
RGB, with background masking) [Reported — DINOv3 repo/paper, Aug 2025]. It
makes no causal claim at all: it says "here is how the model *carves up* the
picture," which is true, checkable, and visually gorgeous. Caption it as
"the AI's colour-coded parts map," never as "where it looked."

**Saliency's own sanity problem** must stay in our design discipline:
Adebayo et al.'s randomisation tests show Guided Grad-CAM and guided
backprop produce convincing maps from *randomly-weighted* models — they
behave like edge detectors [Verified — multiple secondary sources].
Revisited and refined in **"A Fresh Look at Sanity Checks for Saliency
Maps"** (Hedström et al., NeurIPS XAIA 2023/Springer 2024, with code)
[Verified]. And a 2025 result names **class-insensitivity**: many
activation-based methods produce nearly identical maps for *different* class
labels (CASE, arXiv 2506.07327) [Reported]. Practical rule for us: **any
heatmap we ship must pass a two-minute local sanity test** — randomise the
weights, and swap the target class — and if the map barely changes, it does
not go on the wall.

**EigenCAM** is fast because it takes the first principal component of the
activations and uses **no gradients and no class score** at all — which is
why the literature's standing criticism is that it "doesn't have good enough
class discrimination" [Verified — Eigen-CAM paper + jacobgil docs +
secondary]. It is near-free and it is honest *only if captioned correctly*:
"where the picture is most structured to the model," not "why it chose
Pikachu." Given we have a better free option (plain CAM with a GAP head, or
the exemplar strip), EigenCAM is a fallback, not a centrepiece.

### Explanation-by-example

The strongest single piece of evidence in this whole note is a study of our
exact situation. **"Technical Understanding from Interactive Machine
Learning Experience: a Study Through a Public Event for Science Museum
Visitors"** (arXiv 2305.05846; *Interacting with Computers* 36(3):155, 2024)
ran a **2-day science-museum event with 61 participant groups, ages 7–49
(M=17.4, SD=9.7), 41 of whom had no AI/ML experience**. The system was an
interactive sound classifier whose centrepiece was a **feature map of 5,000
FSD50K sounds embedded by t-SNE**, onto which visitors' own recordings were
projected. Comprehension-quiz results: **84%** correct on training-data
requirements, **68%** on the embedding mechanism, **73%** on model
improvement — and **participants with no prior AI experience outperformed
the experienced group on all items** despite rating their own understanding
lower [Verified — full text]. The documented failure is the one we must
design around: some participants **"attributed meaning to the x-axis and
y-axis"** even though t-SNE coordinates carry none, and the authors
recommend visualising the *classification process* (e.g. drawing a
pseudo-boundary) rather than leaving a bare map [Verified].

On example-based explanation specifically: it is repeatedly characterised as
the XAI family that is **easy for lay users to understand** [Reported —
multiple secondary syntheses, no single decisive RCT found]. **PCNN** (arXiv
2308.13651) found that showing nearest neighbours **from the top-K probable
classes rather than only the top-1 class reduces over-reliance on the AI and
improves human decision accuracy** over top-1-only exemplar displays
[Reported — single paper]. That maps directly onto a concrete exhibit
choice: show the winner's exemplars *and* the runner-up's exemplars side by
side, not just the winner's.

Against heatmaps for lay audiences: a systematic review of **68 user
studies** of saliency maps and human performance (*Int. J. Human–Computer
Interaction*, 2024) concludes that saliency maps can help, but **null
effects and even costs are common**, and heatmap explanations drew the most
mixed participant reactions of the approaches examined [Reported — single
review, paywalled; verify the exact fractions before quoting]. A study with
**N=163** found adding feature-highlighting *on top of* nearest-neighbour
cases better calibrated users' sense of "correctness" on ambiguous
classifications (arXiv 2311.03246) [Reported] — i.e. cases first,
highlighting as a supplement, which is the ordering we should adopt.

I found **no user study of explanation displays with children
specifically**. The closest work: Teachable-Machine sessions with **10
children aged 8–13** (arXiv 2402.18688) found kids grasped input→output and
*anticipated classification errors and proposed fixes* (more training data),
but assumed machines arrive pre-trained; the paper explicitly reports **no
findings on confidence scores or explanation displays** [Verified —
fetched]. Georgia Tech's middle-schooler exhibit study (June 2024) found
kids so absorbed that "parents had to pull their kids away," but identified
**"tunnel vision"** — once a child commits to one interaction path they stay
on it, so exhibits must actively nudge toward other affordances — and noted
**none of them raised ethics unprompted** [Reported]. **DataBites** (ACM
Creativity & Cognition 2024) is an embodied, co-creative museum exhibit for
teaching supervised ML to children [Reported — ACM blocked fetch;
title/venue only]. **This is a genuine gap in the literature, and our
exhibit could contribute to it if we instrument it** (see the spike
section).

### Embedding-space visualisation, live

Mechanically it works: UMAP supports `.transform()` on unseen points, and
**Parametric UMAP** learns a neural net so new points project by a forward
pass [Verified — umap-learn docs]. The pitfalls are severe:

- **Latency**: transforming a *single* point via `umap.transform()` is
  reported to take **seconds** (one report: several seconds for a single
  13-D point against a ~1,000-point model), with numba JIT overhead on first
  call and cost scaling with training-set size (umap issues #200, #219)
  [Reported — GitHub issues, multiple users, consistent]. **Do not put
  `umap.transform` in a per-frame loop.**
- **Distortion/honesty**: **t-SNE provably exaggerates clusters** (arXiv
  2510.07746, 2025) [Reported]; the Chari & Pachter "specious embeddings"
  critique and its PLOS Comp Biol 2024 rebuttal establish that these
  projections **do not preserve high-dimensional distances** even when they
  carry real neighbourhood information [Verified — both papers exist and are
  cited against each other]; `scDEED` exists precisely to flag which points
  in a projection are untrustworthy [Reported].
- **The audience misreads it in exactly the predicted way** — see the
  61-group museum study above [Verified].

Conclusion [Inference, strongly supported]: a live dot on a UMAP/t-SNE map
is high wow, low honesty, and non-trivial latency. If we want a spatial
display, use **PCA of the reference embeddings** — one fixed 384×2 matrix, a
microsecond matmul per query, deterministic, identical transform for
reference and query, and the axes are *real* (principal directions of
variation) even if unnameable — and print the true cosine distances beside
it so the numbers, not the picture, carry the claim [Inference].

### Matching visualisations

- **cv2.drawMatches / drawMatchesKnn** is documented as "not very efficient"
  for large match counts, with OpenCV-adjacent docs recommending manual
  `cv2.line()` rendering when drawing many matches [Reported]. At the 30–60
  lines a legible exhibit should draw, either is fine; a custom renderer
  also buys us staggered/animated line-drawing and colour-by-confidence,
  which `drawMatches` cannot do [Inference].
- **XFeat** (CVPR 2024, `verlab/accelerated_features`, **Apache-2.0**): 64-D
  descriptors; README claims **"real-time sparse inference on CPU for VGA
  images (tested on laptop with an i5 CPU)"**; ~1,400 FPS batched on an RTX
  4090; "much better robustness to viewpoint and illumination changes than
  ORB and SIFT"; **ships `realtime_demo.py`, a webcam homography demo that
  switches between XFeat, ORB and SIFT** [Verified — repo README]. Secondary
  summaries of the paper put CPU throughput at **20–30 fps** and note it is
  **faster than SIFT on CPU**, with **1.8 FPS on an Orange Pi Zero 3
  (Cortex-A53)** as the constrained-device floor [Reported]. **LighterGlue**
  (XFeat-trained LightGlue variant) is ~**3× faster** than LightGlue
  [Reported]. **No official ONNX export** (community ports exist) [Verified
  — README notes it as a wanted contribution].
- That built-in webcam demo with an ORB/SIFT/XFeat switch is, almost
  accidentally, a ready-made **exhibit**: "here's the old way, here's the
  learned way, watch the lines get better." Low effort, high pedagogical
  payload [Inference].
- **Animated ranking / "distance race"**: no XAI-specific literature, but
  the visualisation grounding is solid — Heer & Robertson, *Animated
  Transitions in Statistical Data Graphics* (InfoVis 2007) shows
  appropriately-designed animated transitions **significantly improve
  graphical perception at both syntactic and semantic levels**, and names
  **staging** (phased changes) and **staggering** (small per-object delays)
  as the techniques that make them work [Verified]. Apply
  staging/staggering to both the distance race and the match-line draw-on.

### Confidence displays

Our prior finding (Teachable-Machine-style top-5 bars are the most
publicly-legible confidence display) stands unchallenged, and the trust
literature adds a sharp caveat: showing confidence **raises** user trust
when the model is confident (>80%) but **lowers** trust when it is not
(<60%), and communicating miscalibration helps users detect it but pushes
them into under-reliance (arXiv 2402.07632; arXiv 2001.02114) [Reported].
For an exhibit this is an *opportunity*, not a problem: the low-confidence
state is the most educational thing the machine can do, so **design the "I'm
not sure" screen as a first-class beat with its own copy and its own voice
line**, rather than letting it read as breakage [Inference].

---

## Display menu, ranked

Scoring: **Honesty** = does the display make a claim the computation
actually supports; **Kid-legible** = readable by a 7-year-old without
reading a paragraph; **CPU** = cost in our budget; **Wow** = stopping power
in a noisy hall. 5 = best.

### Backend 1 — Card path (contour → rectify → pHash/dHash → calibrated NN)

| # | Display | Honesty | Kid-legible | CPU cost | Wow | Notes |
|---|---|---|---|---|---|---|
| 1 | **Detected-quad overlay, live** | 5 | 5 | ~free (already computed) | 3 | It *is* the detector output. Add corner-jitter/"lock" state so kids see it hunting then settling. |
| 2 | **Rectified "as the AI sees it" thumbnail** | 5 | 5 | ~free | 4 | Literally the tensor that gets hashed. Best honesty-per-pixel display in the whole exhibit. |
| 3 | **Keypoint match lines (XFeat/LighterGlue, or ORB)** | 5 | 4 | real-time sparse on laptop i5 CPU [Reported: 20–30 fps]; render at lock-on only | **5** | The wow centrepiece. Draw staggered. Colour by inlier/outlier so the *wrong* lines are visible too — that's the honesty premium. |
| 4 | **Animated distance race, top-5** | 5 | 5 | µs (5 ints) + animation | 4 | Distances are the decision. Staged animation (Heer & Robertson). Show the margin as a plain sentence. |
| 5 | **Hash bit-grid diff (query vs winner, XOR lit up)** | 5 | 3 | free | 4 | "64 yes/no questions about the picture; it got 61 right." Very true, needs one line of copy. Untested with kids. |
| 6 | **σ-below-mean / calibration strip** | 5 | 2 | free | 2 | Keep for the poster and the report; too abstract for the wall unless rendered as a "how unusual is this good a match" gauge. |
| 7 | **ORB-vs-XFeat side-by-side toggle** | 5 | 4 | 2× match cost, lock-on only | 5 | Free from XFeat's `realtime_demo.py`. Teaches "learned features beat hand-made ones" with no hand-waving. |

**Ruling for backend 1:** 1+2 live, 4+3 at lock-on, 7 as the
operator-triggered "geek mode" for the queue's grown-ups. Don't add a
heatmap to the card path — there is no classifier to attribute over, and
faking one would be theatre.

### Backend 2 — Figurine path

| # | Display | Honesty | Kid-legible | CPU cost | Wow | Notes |
|---|---|---|---|---|---|---|
| 1 | **NN exemplar strip ("it matched THESE photos")** | **5** | **5** | µs (kNN over a few hundred refs) | 4 | Faithful *by construction* for a kNN backend: the neighbours are the decision. PCNN says include runner-up-class exemplars too, not just the winner's. |
| 2 | **Similarity bars, top-5 (Teachable-Machine style)** | 5 | 5 | free | 4 | Prior finding holds. Always show the number; script the <60% state. |
| 3 | **Grad-CAM on cosine similarity to the matched exemplar** | 4 | 4 | **~25–41 ms/call CPU** [Verified]; once at lock-on | 4 | The only saliency question the backend asks: "which pixels made this look like *that* photo." Native in pytorch-grad-cam (embedding/similarity targets); method basis = *Adapting Grad-CAM for Embedding Networks* (WACV 2020). Needs PyTorch (not ONNX) in-process. |
| 4 | **Plain CAM (only if we fine-tune a GAP+linear-head CNN)** | **5** | 4 | **0.14 ms** [Verified] | 4 | Exact decomposition of the class score, not an approximation, and effectively free. A reason to *choose* the classifier route and to constrain its head. |
| 5 | **Finer-CAM "why not the runner-up?"** | 4 | 4 | ~CAM cost | 5 | CVPR 2025; suppresses shared features, shows the *distinguishing* region. Best answer to the best kid question. Classifier route only. |
| 6 | **DINOv3-style PCA-of-patch-features RGB "parts map"** | 4 (makes no causal claim) | 3 | one PCA on patch tokens, ~free after forward | **5** | Beautiful and true-as-described. Caption discipline is everything: "the AI's parts map," never "where it looked." |
| 7 | **Prompt-CAM trait maps** | 4 | 4 | forward + prompt head | 5 | CVPR 2025, frozen DINOv2 + VPT-style head, "almost a free lunch" to train, sharper than Grad-CAM for fine-grained. Highest-upside stretch goal. Unvalidated by us. |
| 8 | **EigenCAM** | 2 *as usually captioned* | 3 | near-free | 3 | Class-agnostic by design; standing criticism is poor class discrimination. Fallback only, with honest copy. |
| 9 | **Live PCA embedding map, query dot** | 3 | 3 | µs | 5 | Only with no axis labels, thumbnail-labelled islands, and true distances printed alongside. |
| 10 | **Live UMAP/t-SNE map, query dot** | **1–2** | 3 | `transform()` reported in **seconds** per point | 5 | Rejected. Visitors invent axis meanings [Verified, museum study]; t-SNE provably exaggerates clusters; latency unfit for live. |
| 11 | **Raw ViT self-attention map** | **1** | 3 | ~free | 4 | **Rejected.** Plausible-not-faithful; artifact tokens light up empty background in DINOv2/CLIP-family models. |

---

## Prior art in public exhibits (what worked, what flopped)

**What worked**

- **Interactive-ML sound classifier with a t-SNE feature map**, science
  museum, 61 groups aged 7–49 (IWC 2024 / arXiv 2305.05846): visitors *did*
  learn mechanism — 84/68/73% on the three comprehension items — and
  **novices out-scored experienced participants** while feeling less
  confident. Hands-on internal-representation displays teach, and they teach
  the people we're aiming at [Verified].
- **Kid absorption is not the constraint.** Georgia Tech's AI-exhibit
  prototyping with middle schoolers (Jun 2024) reported parents having to
  drag children away [Reported].
- **Teachable Machine** remains the reference point for legible ML
  interaction with children, with published sessions with 8–13-year-olds
  showing they grasp input→output and *anticipate errors* —
  error-anticipation is a real learning outcome we can design for [Verified
  — fetched study]. One secondary account notes older teens watching
  **live-updating confidence percentages** started asking probability
  questions unprompted [Reported — weak single source, but consistent with
  our top-5-bars prior].
- **Touring "AI: Your Mind & The Machine"** (MOHAI/Health Museum/Museum of
  Idaho/MOSI Tampa Sept 2025–Jan 2026; Science Center of Iowa Jan 2026):
  ~two dozen kiosks, real-time style-transfer "AI painter," emotion/age
  guessers, object recognisers, plus tactile non-digital interactives
  (sliders, blocks, flip boards) [Reported]. The mix matters: the *tactile*
  pieces carry the concepts, the *live camera* pieces carry the crowd.
- **Google Arts & Culture t-SNE Map / Curator Table** (Cyril Diagne et al.,
  2018): the canonical "similarity landscape" installation,
  image-features-only with no metadata [Reported]. Beautiful, widely
  imitated — and note it is an *exploration* piece with no per-query
  decision to justify, which is exactly why it can get away with a t-SNE
  layout and we cannot.

**What flopped / what to avoid**

- **Axis literalism.** The single documented explanation failure in a museum
  setting is visitors reading meaning into t-SNE axes [Verified]. The
  authors' own remedy — visualise the *classification process*, e.g. a
  pseudo-boundary — is advice we should take, or skip the map.
- **Tunnel vision.** Kids commit to one path and don't discover the rest;
  exhibits must nudge [Reported]. Implication: our explanation panel must
  *arrive on its own*, never behind a button a child won't press.
- **Ethics invisibility.** No middle schooler raised anything problematic
  about AI unprompted [Reported]. Cheap win: one line on the panel about
  what the system *can't* do and what it does with the camera image
  (nothing, offline, not stored).
- **Heatmaps are the least-loved explanation with lay participants** across
  the user-study corpus, and saliency's behavioural benefit is inconsistent
  across 68 studies [Reported]. This is the evidentiary basis for demoting
  heatmaps to *supporting* rather than *primary*.
- I found **no documented public-exhibit deployment of Grad-CAM-family
  heatmaps to a family audience with published evaluation** [Verified by
  absence — searched museum/festival/informalscience/HCI venues]. We would
  be early. That's an opportunity and a risk: nobody has de-risked heatmap
  captioning for 7-year-olds for us.

---

## Recommended composition — the 30-second show, beat by beat

Grounding: interactive-exhibit practice says **reset to the attractor after
~30 s of no input** [Reported — interactive design guidelines]; measured
holding times for good interactives run **12–149 s**, roughly **3× the
~30 s** of passive exhibits [Reported — Sandifer, JRST 2003]. So 30 s is a
*cycle*, not a ceiling — build it to loop cleanly and to reward a second go.
Animation uses **staging and staggering** throughout [Verified — Heer &
Robertson 2007].

| Beat | Time | On screen | What's real |
|---|---|---|---|
| **0. Attract** | idle | Live camera, target frame, "hold your card or figurine here". Detector visibly hunting — quad corners flickering over the background. | Real contour detector output, per frame. |
| **1. Track** | 0–4 s | Quad locks onto the card and turns solid; **rectified crop slides into a panel labelled "what the AI actually looks at"**. Figurine path: bounding box + crop. | Real rectify. This is the tensor that gets hashed/embedded. |
| **2. Lock** | 4–6 s | Crop freezes with a shutter beat. Everything downstream now refers to this one frozen image — say so on screen. | Freeze = the honest moment to spend 40 ms of CPU. |
| **3. Race** | 6–11 s | **Top-5 distance race**: five name-plates slide from a common start to their final positions, staged; winner snaps forward. Numbers visible. Figurine path: **similarity bars** fill instead. | Real distances / real similarities. |
| **4. Evidence** | 11–18 s | Card: **match lines draw on**, staggered, ~40 lines, inliers green / rejected grey. Figurine: **exemplar strip** — winner's 3 reference photos plus the runner-up's 1, PCNN-style — and the similarity-Grad-CAM heatmap fading in over the frozen crop. | Match lines are real correspondences; exemplars are the actual kNN neighbours; CAM computed once here (~25–41 ms). |
| **5. Verdict + voice** | 18–30 s | Name, sprite, **one plain-language honesty sentence** ("the runner-up was 3× further away — I'm sure"), then the Pokédex entry speaks. **No new animation while audio plays.** Panel lingers. | Margin/σ stats, rendered as language. |
| **5b. Unsure branch** | 18–30 s | If margin is thin: "I think it's X, but Y looked almost the same — here's what confused me," with both exemplar sets side by side and (classifier route) the **Finer-CAM difference map**. Voice says so out loud. | The most educational branch. Script it, don't treat it as an error. |
| **6. Reset** | +4 s after card leaves | Panel dims to attract; last verdict stays as a ghost so the next kid in the queue sees where it's going. | — |

Design rules extracted from the evidence:

1. **Live layer = cheap and continuous; explanation layer = expensive and
   once.** Every ms-costly display (CAM, match lines, keypoint extraction)
   fires at lock-on. This is what makes 25–41 ms CPU affordable.
2. **Explanations arrive unprompted** (tunnel-vision finding). No "tap to
   see why."
3. **Cases before highlighting** (N=163 finding + the 68-study review):
   exemplars/distances first, heatmap second.
4. **Show the runner-up, always** (PCNN): it converts a magic trick into a
   comparison.
5. **Never let a picture carry a claim the numbers don't** — any map ships
   with the real distances next to it (museum axis-literalism finding).
6. **One caption per display, ≤8 words, verb-first** — and each caption must
   be literally true of the computation. Write the captions *before* the
   code; if you can't write a true one, cut the display.

---

## What a 1-day local spike must validate (falsifiable checks)

Each is a pass/fail with a number. Run on the actual target laptop, CPU
only, offline.

1. **CAM budget.** Time Grad-CAM (and plain CAM if the head is GAP+linear)
   on our chosen backbone, 224×224, 100 iterations, single-thread and
   default-thread. **Pass: ≤50 ms mean at lock-on.** Fail ⇒ drop to plain
   CAM/EigenCAM or drop the heatmap. *Prediction to falsify: 25–41 ms, per
   torch-cam's i7-10750H figures.*
2. **Match-line budget.** XFeat + LighterGlue on a rectified 640×480 card
   crop vs one DB reference: extract+match+draw. **Pass: ≤80 ms total at
   lock-on, ≥20 correct-looking inlier lines on a clean card.** Also run
   `realtime_demo.py` to sanity-check the vendored install. Fail ⇒
   ORB+BFMatcher fallback, which we know is webcam-rate.
3. **Sanity test the heatmap (the "no theatre" gate).** Compute the map (a)
   with trained weights, (b) with randomised weights, (c) targeting the
   runner-up class/exemplar instead of the winner. **Pass: (a) and (b) are
   visibly different, and (a) and (c) are visibly different.** Fail on
   either ⇒ that display is decoration and must not be captioned as
   reasoning. *This is the single most important check in the list.*
4. **Exemplar-strip latency and correctness.** kNN over the reference
   embedding set; assert the displayed thumbnails are the same items the
   decision used (not re-ranked or re-fetched by a different path). **Pass:
   <5 ms, and an assertion in code that display indices == decision
   indices.**
5. **Projection honesty.** Fit PCA and UMAP on the reference embeddings;
   time `umap.transform()` for a single query (expect **hundreds of ms to
   seconds**, first call worse — falsify or confirm) vs the PCA matmul
   (expect **<1 ms**). Then check rank agreement: **does the
   visually-nearest dot in 2-D match the true nearest neighbour?** Measure
   top-1 agreement over ~50 queries. **Pass for shipping the map: ≥90%.**
   Below that, the map contradicts the verdict on screen and must go.
6. **Artifact check on attention (to justify the refusal in writing).** Dump
   a raw last-layer attention map from the candidate ViT on 10 figurine
   photos. **Expect visible high-attention background patches** (register
   artifacts). Screenshot it for the report — it's the evidence for our
   design decision and a good slide.
7. **ONNX/PyTorch split.** Confirm whether the intended runtime can produce
   gradients. **Pass: either PyTorch stays in-process for lock-on
   explanations, or the display set contains no gradient-based method.** No
   third option.
8. **Frame-rate under load.** Run the full live layer (capture + contour +
   rectify + hash + kNN + overlay render) for 60 s. **Pass: ≥15 fps
   sustained, no frame-time spike >150 ms** (a spike reads as "broken" to a
   7-year-old).
9. **Legibility pilot (30 min, n≥3 non-CS humans, one under 12 if
   possible).** Point at each display, ask "what is the computer telling you
   here?" **Pass: the exemplar strip and the distance race are described
   correctly by ≥2 of 3 without help.** Record verbatim answers — this is
   also our contribution to a gap in the literature, since no published
   study covers explanation displays for children.
10. **Unsure-branch rehearsal.** Present a deliberately ambiguous item (holo
    card at a glare angle; two similar figurines). **Pass: the system enters
    the unsure branch and says so, rather than confidently naming the wrong
    thing.**

---

## Sources

- [grad-cam on PyPI — v1.5.5, 2025-04-07](https://pypi.org/project/grad-cam/)
- [jacobgil/pytorch-grad-cam (README: method list, ViT targets, embedding-similarity support)](https://github.com/jacobgil/pytorch-grad-cam)
- [jacobgil/pytorch-grad-cam — Releases (none published)](https://github.com/jacobgil/pytorch-grad-cam/releases)
- [frgfm/torch-cam README — CPU/GPU latency benchmark, i7-10750H, 224×224](https://github.com/frgfm/torch-cam/blob/main/README.md)
- [A Comprehensive Review of XAI in Computer Vision (PMC, 2025) — FPS table; "attention is not explanation by itself"](https://pmc.ncbi.nlm.nih.gov/articles/PMC12252469/)
- [Rethinking Attention-Model Explainability through Faithfulness Violation Test (arXiv 2201.12114)](https://arxiv.org/pdf/2201.12114)
- [Sanity Checks for Saliency Maps (Adebayo et al., NeurIPS 2018)](https://dl.acm.org/doi/10.5555/3327546.3327621) · [A Fresh Look at Sanity Checks for Saliency Maps (Hedström et al., 2024) + code](https://github.com/annahedstroem/sanity-checks-revisited)
- [CASE: Contrastive Activation for Saliency Estimation (arXiv 2506.07327) — class-insensitivity](https://arxiv.org/pdf/2506.07327)
- [Eigen-CAM: Class Activation Map using Principal Components (arXiv 2008.00299)](https://arxiv.org/abs/2008.00299)
- [Vision Transformers Need Registers (ICLR 2024, arXiv 2309.16588)](https://arxiv.org/abs/2309.16588) · [Vision Transformers Don't Need *Trained* Registers (arXiv 2506.08010, 2025)](https://arxiv.org/abs/2506.08010)
- [facebookresearch/dinov3 — PCA-of-patch-features visualisation notebook](https://github.com/facebookresearch/dinov3/blob/main/notebooks/pca.ipynb) · [DINOv3 paper (arXiv 2508.10104)](https://arxiv.org/html/2508.10104v1)
- [LeGrad (ICCV 2025, arXiv 2404.03214)](https://arxiv.org/abs/2404.03214)
- [Prompt-CAM (CVPR 2025, arXiv 2501.09333)](https://arxiv.org/abs/2501.09333v2) · [code](https://github.com/Imageomics/Prompt_CAM)
- [Finer-CAM (CVPR 2025)](https://openaccess.thecvf.com/content/CVPR2025/papers/Zhang_Finer-CAM_Spotting_the_Difference_Reveals_Finer_Details_for_Visual_Explanation_CVPR_2025_paper.pdf) · [code](https://github.com/Imageomics/Finer-CAM)
- [Adapting Grad-CAM for Embedding Networks (WACV 2020)](https://openaccess.thecvf.com/content_WACV_2020/papers/Chen_Adapting_Grad-CAM_for_Embedding_Networks_WACV_2020_paper.pdf) · [Explainable Image Similarity: Siamese + Grad-CAM (J. Imaging 2023)](https://doi.org/10.3390/jimaging9100224)
- [Technical Understanding from Interactive ML Experience: a Public Event for Science Museum Visitors (arXiv 2305.05846)](https://arxiv.org/abs/2305.05846) · [Interacting with Computers 36(3):155, 2024](https://academic.oup.com/iwc/article/36/3/155/7626066)
- [PCNN: Probable-Class Nearest-Neighbor Explanations (arXiv 2308.13651)](https://arxiv.org/pdf/2308.13651)
- [How Explainable AI Affects Human Performance: A Systematic Review of the Behavioural Consequences of Saliency Maps (IJHCI 2024)](https://www.tandfonline.com/doi/full/10.1080/10447318.2024.2381929)
- [Advancing Post Hoc Case Based Explanation with Feature Highlighting (arXiv 2311.03246)](https://arxiv.org/pdf/2311.03246)
- [Exploring AI Problem Formulation with Children via Teachable Machines (arXiv 2402.18688)](https://arxiv.org/html/2402.18688v1)
- [Middle Schoolers' Feedback Informs New Approach to AI-based Museum Exhibits (Georgia Tech, Jun 2024)](https://www.gatech.edu/news/2024/06/21/middle-schoolers-feedback-informs-new-approach-ai-based-museum-exhibits)
- [DataBites: an embodied, co-creative museum exhibit for supervised ML (ACM C&C 2024)](https://dl.acm.org/doi/10.1145/3635636.3664247)
- [AI: Your Mind & The Machine (touring exhibit)](https://aiexhibit.org/) · [MOSI Tampa, Sept 2025](https://mosi.org/mosi-opens-eye-opening-new-ai-exhibit-this-september/)
- [t-SNE Map — Cyril Diagne, Nicolas Barradeau, Simon Doury (Google Arts & Culture, 2018)](https://experiments.withgoogle.com/arts-culture/t-sne-map)
- [XFeat: Accelerated Features for Lightweight Image Matching (CVPR 2024)](https://openaccess.thecvf.com/content/CVPR2024/papers/Potje_XFeat_Accelerated_Features_for_Lightweight_Image_Matching_CVPR_2024_paper.pdf) · [verlab/accelerated_features (Apache-2.0, `realtime_demo.py`)](https://github.com/verlab/accelerated_features)
- [OpenCV drawMatches / drawMatchesKnn docs](https://docs.opencv.org/4.x/d4/d5d/group__features2d__draw.html) · [efficiency caveat](https://www.geeksforgeeks.org/python/python-opencv-drawmatchesknn-function/)
- [Heer & Robertson, Animated Transitions in Statistical Data Graphics (InfoVis 2007)](https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf)
- [UMAP: Transforming New Data](https://umap-learn.readthedocs.io/en/latest/transform.html) · [Parametric UMAP transform](https://umap-learn.readthedocs.io/en/latest/transform_landmarked_pumap.html) · [single-point transform slowness, issue #200](https://github.com/lmcinnes/umap/issues/200) · [issue #219](https://github.com/lmcinnes/umap/issues/219)
- [t-SNE Exaggerates Clusters, Provably (arXiv 2510.07746)](https://arxiv.org/pdf/2510.07746) · [2D embeddings of single-cell data do make sense (PLOS Comp Biol 2024)](https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1012403)
- [Understanding the Effects of Miscalibrated AI Confidence on User Trust (arXiv 2402.07632)](https://arxiv.org/abs/2402.07632) · [Effect of Confidence and Explanation on Accuracy and Trust Calibration (arXiv 2001.02114)](https://arxiv.org/pdf/2001.02114)
- [MobileCLIP2 (TMLR 08/2025, arXiv 2508.20691) — note: latencies measured on iPhone 12 Pro Max, **not** laptop CPU](https://arxiv.org/html/2508.20691v1)
- [Sandifer, *Technological Novelty and Open-Endedness* (JRST 40(2), 2003) — holding times](https://tigerweb.towson.edu/csandife/jrst2003.pdf) · [Guidelines for developing interactive exhibits (30 s attractor reset)](https://www.museuminsider.co.uk/wp-content/uploads/2013/06/Appendix_Guide_To_Developing_Interactives_V4.pdf)
- [meta-pytorch/captum (v0.9.0, actively maintained)](https://github.com/meta-pytorch/captum/releases)
- [Birds look like cars: adversarial analysis of intrinsically interpretable deep learning (arXiv 2503.08636)](https://arxiv.org/pdf/2503.08636)
