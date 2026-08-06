# Card recognition — 2026 frontier check

> Researched 2026-08-06 for **the decision: does anything beat the calibrated
> pHash pipeline for the event build, judged on glare/sleeve/skew robustness,
> CPU real-time speed, scale beyond one set, and the quality of the visible
> explanation it enables.** Claims tagged [Verified] / [Reported] /
> [Inference]. Companion spikes:
> [figurines](2026-08-06-figurine-recognition-frontier.md) ·
> [explainability](2026-08-06-live-explainability-frontier.md) ·
> synthesis in [the approach note](2026-08-06-approach-synthesis.md).

> **Verdict: keep the calibrated pHash core, upgrade to a hybrid.** Nothing in
> the 2024–2026 literature beats calibrated perceptual hashing on CPU
> cost-per-frame for a curated ~102-card set — every maintained open-source
> scanner still ships a pHash variant, and the one serious 2026 academic
> system (TCG-AR, July 2026) shows that even a purpose-trained ArcFace
> embedding network only reaches 85.1% open-set top-1 across 20,360 Pokémon
> cards on real video. But single-frame pHash alone is the weakest link under
> holo glare and at 20k-card scale, and it is the *least* show-offable stage.
> The strongest exhibit pipeline is: pHash shortlist (every frame,
> 60 fps-class) → temporal voting → XFeat/ORB keypoint geometric verification
> on the top-K (the accept gate *and* the on-screen spectacle) → optional
> DINOv3/SigLIP embedding lane held in reserve for 20k-scale. This adds
> glare/sleeve robustness, gives an "unsure-rather-than-wrong" gate with a
> physical meaning (inlier count under homography), and produces the best
> honest live visual (match lines) — all comfortably inside a 5 s CPU budget.

## The landscape (what exists, with links and dates)

**Open-source scanners are still hash-based.**

- [magic_card_detector](https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/)
  (tmikonen, 2020) — the canonical prior art: CLAHE → contour/convex-hull
  segmentation → perspective transform → pHash, accepting when the best match
  sits **>4σ below** the mean distance to other cards (~300-card Alpha DB).
  Handles "cards in sleeves and cases" and "extremely tilted angle"; fails on
  occlusion and hard lighting. No accuracy table published.
  [Verified — first-party writeup]
- [hj3yoo/mtg_card_detector](https://github.com/hj3yoo/mtg_card_detector)
  (2018) — YOLO detection + pHash lookup, real-time video. [Verified — repo]
- [Moss Machine](https://kairicollections.github.io/Moss-Machines-Magic-the-Gathering-sorting/)
  (active multi-TCG sorting hardware) — **256-bit pHash (16×16), computed per
  RGB channel** specifically to cope with varied card finishes, Hamming
  distance with **progressive strict→relaxed thresholds**, ~2 s/card
  end-to-end including robotics. The most "production" open pHash design
  found; independently converges on the calibrated-threshold idea.
  [Reported — project docs]
- [1vcian/Pokemon-TCGP-Card-Scanner](https://github.com/1vcian/Pokemon-TCGP-Card-Scanner)
  (2024–25) — YOLO11-nano OBB detector (mAP50 98.5% on synthetic) +
  **24-bit RGB perceptual hash**; targets TCG Pocket *screenshots*, not
  webcam, so its accuracy doesn't transfer, but again: detector + RGB pHash.
  [Verified — repo README]
- [hugopeixoto/ptcg-detection](https://github.com/hugopeixoto/ptcg-detection)
  (Pokémon-specific) — pHash base detection **plus set-symbol template
  matching**, because "the base detection algorithm is not able to tell apart
  two similar cards from two different sets" — the clearest open statement of
  pHash's same-artwork-reprint failure mode at scale. [Verified — repo README]
- [pokemon-card-recognizer](https://pypi.org/project/pokemon-card-recognizer/)
  (PyPI, last release **2 May 2025**) — OCR-backed (easy_ocr); notable for
  its **video modes** (`PULLS_VIDEO`, `BOOSTER_PULLS_VIDEO`) doing
  statistical estimation of shown cards *across frames* — live evidence that
  multi-frame consensus is standard practice. 5–10× slower on CPU than GPU
  per its own docs. [Verified — PyPI page]
- OCR-route scanners
  ([tcg-ocr-scanner](https://github.com/starstuffharvestingstarlight/tcg-ocr-scanner),
  Tesseract) exist but OCR reads the *name*, not the *printing*, and
  Tesseract on webcam frames is fragile — not competitive for this exhibit.
  [Inference from repo approach]
- **Commercial**: [Delver Lens](https://www.delverlab.com/) (Android,
  offline) uses an undisclosed neural recognition model (a third-party
  [review](https://alternativeto.net/software/mtg-card-scanner-delver-lens/about/)
  mentions a faster "lambda" model); its own guidance is telling: "No glare,
  no shadows, good lighting, and high contrast between card and surface are
  the most important factors." Even the commercial NN wants the contrasting
  backdrop. [Reported]
- A granted US patent for an industrial
  [trading card sorter](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12200174)
  uses **pHash + dHash jointly** ("increases confidence that the closest
  match is the correct one") and matches inverted orientations explicitly —
  industrial confirmation of the multi-hash, multi-orientation design.
  [Verified — patent text]

**The one directly on-point academic system.**
[TCG-AR](https://arxiv.org/abs/2607.02090) (arXiv 2607.02090, **July 2026**,
Cioppa et al.) recognises Pokémon cards on a play mat from RGB cameras for AR
streaming. Identification is **metric-learning retrieval**: ResNet-50 →
embedding → nearest neighbour against **20,360 reference cards**, trained on
synthetic data. Results: triplet-loss 128-d head collapses on real data
(**1.7% top-1**); **ArcFace 512-d reaches 85.1% open-set top-1**, 96.4% when
restricted to a ~631-card deck pool; "stable behavior across the lighting
conditions"; greedy nearest-position matching between frames for stability;
**~10 FPS with an RTX 2080 Ti GPU** in the loop. Caveat: their crops are
small oblique board-view images — harder than our held-up-to-webcam close-up
— so treat 85.1% as a lower bound for our presentation geometry, but it
still says: at 20k cards, *pure* embedding retrieval is not near-flawless
even with training and a GPU. [Verified — paper]

**Learned local features on CPU (the real 2024–26 upgrade).**

- [XFeat](https://github.com/verlab/accelerated_features) (CVPR 2024,
  Apache-2.0): **27.1 FPS sparse / 19.2 FPS semi-dense at VGA on an
  i5-1135G7 CPU** per the [paper](https://arxiv.org/abs/2404.19174); repo
  ships a **webcam real-time demo with homography registration** comparing
  XFeat vs ORB/SIFT — almost exactly our exhibit visual. The
  [OpenCV 5 DNN benchmarks](https://github.com/opencv/opencv/wiki/OpenCV-5-DNN-Benchmarks)
  list X-Feat at **6.2 ms (i9) / 14.4 ms (i7) CPU** inference (resolution
  unstated, so treat as favourable-case). Also ships **LighterGlue**, a
  distilled LightGlue matcher for XFeat (MegaDepth AUC 0.564/0.710/0.819 vs
  SP+LightGlue 0.591/0.738/0.841). [Verified — paper + repo + OpenCV wiki]
- [LightGlue](https://github.com/cvg/LightGlue) (ICCV 2023) + SuperPoint:
  excellent, but CPU numbers are bad for per-frame use — a C++ ONNX runner
  measured **~2.1 s per pair on CPU** (SuperPoint extract alone ~73 ms)
  ([LightGlue-OnnxRunner](https://github.com/OroChippw/LightGlue-OnnxRunner));
  all the fast numbers (8–44 ms) are GPU
  ([fabio-sim's evaluations](https://github.com/fabio-sim/LightGlue-ONNX/blob/main/evaluation/EVALUATION.md)).
  Fine as a *one-shot* verifier, not per-frame.
  [Verified — multiple benchmark sources]
- [EfficientLoFTR](https://github.com/zju3dv/EfficientLoFTR) (CVPR 2024, now
  in HF Transformers): ~2.5× faster than LoFTR and can beat SP+LightGlue in
  throughput — **on GPU**. No credible CPU-webcam-rate numbers found;
  semi-dense transformers remain GPU-class.
  [Verified for GPU claims; Inference for CPU unsuitability]
- ORB/AKAZE: unchanged baselines; ORB extraction+BF-Hamming on a rectified
  640-px card vs one candidate is single-digit-ms CPU, and `cv2.drawMatches`
  is free. [Verified — standard OpenCV practice]

**Global embeddings + FAISS.**

- [DINOv3](https://arxiv.org/abs/2508.10104) (Meta, **Aug 2025**) ViT-S: 21M
  params; OpenCV 5 DNN CPU benchmark **16 ms (i9) / 34.9 ms (i7)**; a related
  benchmark shows single-thread 34.8 ms at low output resolution rising
  steeply at high res. [SigLIP(2)](https://arxiv.org/abs/2502.14786)
  (Feb 2025): **23.7–91.4 ms CPU** in the same OpenCV table. So a per-frame
  embedding at ~5–20 fps CPU is plausible for small variants.
  [Verified — OpenCV wiki; Reported for thread/resolution details]
- Index scale is a non-issue: 20,360 cards × 512-d float32 ≈ **42 MB** flat
  FAISS index, exhaustive inner-product search well under 5 ms CPU; a
  64-bit×4-orientation hash table for 20k cards is ~0.7 MB and
  sub-millisecond with vectorised popcount.
  [Inference — arithmetic, uncontroversial]
- No off-the-shelf *pretrained* embedding was found with published
  near-duplicate accuracy on printed cards under glare; TCG-AR had to
  fine-tune with ArcFace to get to 85%. [Inference from absence + TCG-AR]

**Glare, sleeves, temporal practice.** Perceptual-hash robustness literature
([2406.00918](https://arxiv.org/pdf/2406.00918),
[2212.08035](https://arxiv.org/pdf/2212.08035)) confirms hashes tolerate
global transforms (scale, compression) but degrade under *localised* changes
— which is exactly what a holo hotspot is. Practitioner mitigations found:
**cross-polarisation** (polarising film over the light + rotated polariser on
the lens kills specular reflection; standard in
[book/card scanning](https://diybookscanner.org/forum/viewtopic.php?t=3547)
and card photography guides), RGB-per-channel hashing (Moss Machine),
multi-frame consensus (pokemon-card-recognizer's video modes; TCG-AR's
frame-to-frame matching; temporal voting is textbook in video
classification). Sleeves: tmikonen reports pHash works through sleeves; matte
sleeves mostly add a global contrast shift (CLAHE handles it), and keypoint
verification is robust to it too. [Verified/Reported as cited]

## Evidence by criterion

| Approach | Glare/sleeve/skew robustness | CPU speed (per frame) | Scale 102 → 20k | Explanation quality | Grade of key numbers |
|---|---|---|---|---|---|
| Calibrated pHash+dHash (baseline) | Skew: good after rectify. Sleeve: good. **Holo glare: weakest** (localised corruption flips hash bits) | **~1–5 ms** hash+search; measured 7–26 ms whole-pipeline consistent with all prior art | 102: near-flawless with margin gate. 20k: same-art reprints collide (hugopeixoto); margin gate will abstain often | Medium: honest but abstract (bit grids, distance bars) | [Verified] behaviour, [Reported] no formal accuracy tables exist anywhere |
| + ORB verify on top-K | Glare: good (RANSAC discards hotspot region); sleeve: good | +5–15 ms per candidate | Verifier fixes reprint collisions only if art differs; set-symbol crop check needed for identical-art reprints | **High: drawMatches lines** | [Verified] OpenCV practice |
| + XFeat verify / XFeat retrieval | Best learned-feature robustness at CPU price; trained for viewpoint/illumination change | **27 FPS sparse VGA (i5 CPU)** paper; 6–14 ms OpenCV DNN bench | Per-frame match vs 20k impossible; use only as verifier on shortlist | **High: denser, steadier match lines than ORB** | [Verified] paper + OpenCV wiki |
| SuperPoint+LightGlue verify | Excellent | **~2.1 s/pair CPU** — one-shot only | Verifier only | High but not webcam-rate on CPU | [Reported] single C++ ONNX benchmark |
| EfficientLoFTR | Excellent | GPU-class; no CPU webcam-rate evidence | — | Spectacular semi-dense flow, but not live on CPU | [Verified GPU], [Inference CPU] |
| DINOv3-S / SigLIP2 + FAISS | Glare: better than pHash (global semantic feature) but **unproven off-the-shelf on cards**; TCG-AR needed ArcFace fine-tune | 16–35 ms (DINOv3-S) / 24–91 ms (SigLIP) embed + <5 ms FAISS | **The scaling lane** — but 85.1% open-set at 20k (trained!) says it is not near-flawless alone | Medium-low: NN grids and similarity scores; heatmaps are pretty but less causally honest | [Verified] speeds (OpenCV wiki), [Verified] TCG-AR accuracy |
| OCR (name text) | Poor on webcam frames; name ≠ printing | Tesseract ~100s of ms | Cannot distinguish printings | Low | [Inference from repo approaches] |

## The show-off angle (ranked)

1. **Keypoint match lines with RANSAC inlier highlighting (ORB or XFeat)** —
   the winner. Honest (each line is a real correspondence the decision
   uses), instantly legible to a child ("it found the same 47 spots"),
   renders at webcam rate on CPU (XFeat's own repo demo does exactly this).
   Colour inliers green / outliers red; the accept gate *is* the green-line
   count, so the visual and the decision are the same computation.
2. **Live Hamming distance race + margin gauge (pHash)** — a bar chart of
   best vs second-best distance per frame, with the accept/abstain threshold
   drawn on. Honest and cheap; teaches "confidence = gap", which is the
   unsure-not-wrong story. Add the 8×8/16×16 hash bit-grid of live card vs
   matched reference with XOR-diff cells flashing — abstract but genuinely
   the computation.
3. **Nearest-neighbour grid** (works for hash or embedding): top-5 candidate
   card images with distances, updating live; the moment of the crowd seeing
   the right card snap to rank 1 is strong. Honest, legible, free to render.
4. **Temporal voting strip** — last N frames' votes as coloured tiles
   filling toward consensus. Turns the stability mechanism into a visible
   "lock-on" animation.
5. **Embedding similarity heatmaps / attention maps (DINO)** — beautiful but
   partially dishonest as an explanation of *matching* (attention ≠ the
   NN-distance computation), and 1 fps-ish if done properly. Keep as a
   poster, not the live view.
6. **Semi-dense LoFTR-style flow** — the most spectacular visual in the
   field, but not CPU-live; skip.

The rectified "as the AI sees it" view we already have remains the correct
opening beat of the story: quad → rectify → (hash race) → (match lines) →
speak.

## Recommendation (exact pipeline, with fallbacks)

**Per frame (target 15–30 fps):** contour quad detect → perspective rectify
(keep) → pHash+dHash, 16×16 RGB-aware variants worth testing (Moss Machine
evidence), all 4 orientations (fixes the known 90° gap; 4× sub-ms search is
free) → Hamming search of full DB → top-K (K≈5) shortlist + best/second-best
margin → **temporal vote ring buffer** (e.g. same card top-1 in ≥6 of last
10 frames).

**On vote convergence (once, <300 ms):** keypoint geometric verification of
top-K against the live rectified crop — **ORB first** (zero new
dependencies, 5–15 ms/candidate), **XFeat as the upgrade** if ORB inlier
counts prove flaky on holo cards (27 FPS-class CPU, better features, same
drawMatches visual; LighterGlue optional). Accept iff best candidate has ≥T
RANSAC-homography inliers *and* beats runner-up by a ratio; else say "hold
it a little flatter…" — the abstain state is a scripted, friendly beat, not
a failure.

**Display:** every frame shows quad + rectified view + distance race +
voting strip; the verify step renders the green match-lines flourish; then
TTS. Budget: detect/rectify/hash ~10–30 ms/frame, verify ~50–300 ms once,
TTS ~1 s — well under 5 s.

**Scaling fallback (20k cards, post-event ambition):** add an embedding lane
— DINOv3-S or SigLIP2-B via ONNX/OpenCV DNN (~20–90 ms) + flat FAISS
(~42 MB) — as the *shortlister*, keep keypoint verification as the
*decider*, and add hugopeixoto's set-symbol crop check for identical-artwork
reprints. TCG-AR is the evidence this lane works (85.1% open-set
shortlisting is plenty when a verifier sits behind it) and its promised
open-source release is worth watching. Do not replace pHash for the
102-card event: it is faster, fully understood, and calibratable to
near-zero false accepts at that scale.

**Physical fallback for glare:** cross-polarised lighting (polarising film
on the lamp + polariser on the webcam) — cheapest robustness win available,
and exhibit-friendly.

## What a 1-day local spike must validate (falsifiable checks)

1. **Margin separation under stress**: on the 102-card set, record ≥30 s
   webcam video per condition (flat, 30° skew, sleeved, holo card with
   moving LED glare). Check: per-frame top-1 correct rate, and
   best/second-best margin distributions stay separable (no wrong accept in
   ~10k frames at calibrated thresholds). *Falsified if* glare frames
   produce confident wrong matches rather than abstentions.
2. **4-orientation hashing**: cost of 4× DB comparisons stays <2 ms; upside:
   rotated presentations recover. *Falsified if* search time becomes
   frame-limiting.
3. **Temporal voting**: 6-of-10 voting reaches stable correct ID in <2 s of
   presentation and eliminates flicker on holo cards vs single-frame.
   *Falsified if* voted accuracy ≤ single-frame accuracy under glare.
4. **ORB verify discriminates**: correct card vs top-5 impostors — measure
   RANSAC inlier counts; need a clean gap (e.g. >30 vs <10) on holo and
   sleeved cards. *Falsified if* impostor inliers overlap correct-card
   inliers.
5. **XFeat on the actual laptop**: run the repo webcam demo (PyTorch CPU);
   need ≥10 fps at VGA and visibly steadier matches than ORB on a holo card.
   *Falsified if* <5 fps or no robustness gain over ORB — then ORB stays.
6. **RGB/16×16 hash variant**: A/B against current grayscale hash on the
   glare video; adopt only if wrong-accept + abstain rates both improve.
7. **(Stretch) embedding lane micro-bench**: DINOv3-S ONNX on laptop CPU —
   ms/frame and top-1 on the 102 set with no fine-tuning; establishes
   whether the 20k lane is credible later.

## Sources

- TCG-AR: Real-Time Multi-View AR for TCG Streaming (arXiv 2607.02090, Jul 2026) — https://arxiv.org/abs/2607.02090
- XFeat paper (CVPR 2024) — https://arxiv.org/abs/2404.19174 ; repo — https://github.com/verlab/accelerated_features
- OpenCV 5 DNN Benchmarks (XFeat, DINOv3, SigLIP CPU ms) — https://github.com/opencv/opencv/wiki/OpenCV-5-DNN-Benchmarks
- LightGlue — https://github.com/cvg/LightGlue ; ONNX evals — https://github.com/fabio-sim/LightGlue-ONNX/blob/main/evaluation/EVALUATION.md ; C++ CPU timings — https://github.com/OroChippw/LightGlue-OnnxRunner
- EfficientLoFTR (CVPR 2024) — https://github.com/zju3dv/EfficientLoFTR
- DINOv3 (Aug 2025) — https://arxiv.org/abs/2508.10104 ; SigLIP 2 (Feb 2025) — https://arxiv.org/abs/2502.14786
- magic_card_detector writeup — https://tmikonen.github.io/quantitatively/2020-01-01-magic-card-detector/
- Moss Machine MTG sorter — https://kairicollections.github.io/Moss-Machines-Magic-the-Gathering-sorting/
- Pokemon-TCGP-Card-Scanner — https://github.com/1vcian/Pokemon-TCGP-Card-Scanner
- ptcg-detection (set-symbol disambiguation) — https://github.com/hugopeixoto/ptcg-detection
- pokemon-card-recognizer (video pull modes) — https://pypi.org/project/pokemon-card-recognizer/
- mtg_card_detector (YOLO+pHash) — https://github.com/hj3yoo/mtg_card_detector
- tcg-ocr-scanner — https://github.com/starstuffharvestingstarlight/tcg-ocr-scanner
- Delver Lens — https://www.delverlab.com/ ; third-party notes — https://alternativeto.net/software/mtg-card-scanner-delver-lens/about/
- Trading card sorter patent (pHash+dHash, orientation handling) — https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12200174
- Perceptual hash robustness — https://arxiv.org/pdf/2406.00918 ; Hamming distributions — https://arxiv.org/pdf/2212.08035
- Cross-polarisation for glare — https://diybookscanner.org/forum/viewtopic.php?t=3547
- TCGdex cards database — https://github.com/tcgdex/cards-database
