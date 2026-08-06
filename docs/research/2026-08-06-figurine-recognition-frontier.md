# Figurine recognition — 2026 frontier check

> Researched 2026-08-06 for **the decision: which figurine backend to build
> for ~20–50 self-photographed toys, judged on accuracy at realistic photo
> budgets, CPU speed, robustness to hand-held presentation, and the quality
> of the visible explanation.** Claims tagged [Verified] / [Reported] /
> [Inference]. Companion spikes:
> [cards](2026-08-06-card-recognition-frontier.md) ·
> [explainability](2026-08-06-live-explainability-frontier.md) ·
> synthesis in [the approach note](2026-08-06-approach-synthesis.md).

> **Verdict:** The baseline plan's Option A wins, but with a different
> backbone than planned: a **frozen DINO-family embedding (DINOv2 ViT-S/14
> or ViT-B/14, Apache-2.0; optionally DINOv3 ViT-S+/16) + cosine kNN over
> our own reference photos**, with cheap backdrop subtraction instead of
> SAM-class segmentation. Since mid-2025 the DINO line is the clear default
> for "recognize *my specific objects* from a handful of photos":
> self-supervised DINO features beat CLIP/SigLIP by huge margins on
> fine-grained visual (non-semantic) discrimination [Verified], run in
> tens-to-hundreds of milliseconds on laptop CPU [Reported], need no
> training, let you add/remove figurines by editing a photo folder, and
> natively produce the most honest live explanation available
> (matched-exemplar strips + similarity scores + attention overlays).
> Option B (fine-tuning from the 1,025-class Pokémon *artwork* checkpoint)
> is weakened by this check: that checkpoint publishes **no accuracy and no
> training-data documentation** [Verified], and artwork→physical-toy is
> exactly the rendition-style domain shift benchmarks show classifiers fail
> on [Reported]. Keep a fine-tune arm as the control, but start it from a
> plain ImageNet checkpoint (ConvNeXt-Tiny / EfficientNetV2-S — CNNs beat
> ViTs in low-data fine-tuning [Reported]) — or, cheapest of all, a
> linear/kNN head *on top of the same DINO embeddings*. What would change
> the answer: if the spike shows kNN top-1 <90% on a held-out
> lighting/angle session while the fine-tuned CNN clears it, or if
> near-identical figurine pairs (same species, different pose) need
> decision boundaries kNN can't draw.

## The landscape

**Embedding + kNN is now the default recipe for instance recognition.** The
relevant events since the 2026-07-29 plan was drafted:

- **DINOv3** (Meta, released 2025-08-13,
  [arXiv:2508.10104](https://arxiv.org/abs/2508.10104),
  [GitHub](https://github.com/facebookresearch/dinov3)) — trained on ~1.7B
  images with a 7B teacher, distilled down to ViT-S (21M), ViT-S+ (29M),
  ViT-B (86M), ViT-L (300M), ViT-H+ (840M) and ConvNeXt variants (29–198M)
  for constrained deployment [Verified]. Reported **+10.9 GAP on instance
  retrieval over DINOv2** [Reported — paper claim relayed by
  [Lightly's deep dive](https://www.lightly.ai/blog/dinov3) and others].
  Caveat: it ships under a **custom "DINOv3 License"** with a gated-access
  form and attribution requirements, not Apache-2.0
  ([license](https://ai.meta.com/resources/models-and-libraries/dinov3-license/),
  [community pushback](https://github.com/facebookresearch/dinov3/issues/31))
  [Verified]. DINOv2 remains Apache-2.0 and freely redistributable
  [Verified].
- **SigLIP 2** (Google, Feb 2025,
  [arXiv:2502.14786](https://arxiv.org/html/2502.14786v1)) — the strongest
  CLIP-family encoder; 10-shot ImageNet: B/16 72.1%, L/16 78.8%, So400m
  79.7% [Verified — first-party Table 1]. But CLIP-family embeddings encode
  *semantics* (what kind of thing), while DINO embeddings encode *visual
  structure* (which exact thing) — repeated head-to-heads favour DINO for
  fine-grained/instance work:
  [Voxel51's benchmark](https://voxel51.com/blog/finding-the-best-embedding-model-for-image-classification)
  (2025-11-04) has DINOv2-ViT-B/14 at **70% on iNaturalist-2021 vs CLIP's
  15%** and 93% vs 88% on Food-101, no fine-tuning [Reported]; the
  FungiTastic fine-grained benchmark reaches the same ordering
  [Reported — [arXiv:2408.13632](https://arxiv.org/pdf/2408.13632)].
- **Few-shot with frozen embeddings is very strong.** A 2026 study of
  frozen DINOv2-L + simple classifiers reports **96.5% (5-way 5-shot,
  miniImageNet)** and argues embedding quality has made meta-learning
  machinery unnecessary
  [Reported — [arXiv:2605.14145](https://arxiv.org/html/2605.14145)].
  Samsung's Object-conditioned Bag of Instances gets **77.1% on 18
  *personal object instances* few-shot, no backpropagation**
  [Reported — [Samsung Research, 2024](https://research.samsung.com/research-papers/Object-Conditioned-Bag-of-Instances-for-Few-Shot-Personalized-Instance-Recognition)]
  — note that's *uncontrolled* imagery; our fixed stand + ring light is a
  far easier setting.
- **Retail SKU recognition converged on the same architecture**:
  metric-learning embeddings + nearest-neighbour retrieval, chosen
  specifically because **adding a product = adding reference photos, no
  retraining** [Verified — consistent across
  [MDPI SKU study](https://www.mdpi.com/2076-3417/16/6/2810),
  [Width.ai case study (89% SKU accuracy)](https://www.width.ai/post/sku-image-classification-for-product-matching),
  Google Universal Embedding challenge].
- **Fine-tuning small models on small data**: convolutional models
  (EfficientNetV2, ConvNeXt) outperform ViTs in resource-efficient low-data
  fine-tuning
  [Reported — [backbone comparison, arXiv:2406.05612](https://arxiv.org/pdf/2406.05612);
  echoed by [2026 model-selection guides](https://labelyourdata.com/articles/image-classification-models)].
  Roboflow's working guidance: a few hundred images/class plus 2–3×
  augmentation is a sane starting budget [Reported].
- **The planned Pokémon checkpoint is a weak anchor**:
  [skshmjn/Pokemon-classifier-gen9-1025](https://huggingface.co/skshmjn/Pokemon-classifier-gen9-1025)
  is a ViT-B fine-tune with **no reported accuracy, no documented training
  data**, ~330 downloads/month [Verified — model card]. Artwork/plush-style
  rendition shift is a named failure axis in robustness benchmarks
  [Reported — [CNS-Bench, arXiv:2507.17651](https://arxiv.org/pdf/2507.17651)].
- **Prior art exists and is encouraging**:
  [Brickognize](https://www.mdpi.com/1424-8220/23/4/1898) (Sensors, 2023)
  recognized **76 LEGO brick types from photorealistic synthetic renders +
  only ~20 real photos per class** in a controlled rig — instance
  recognition of small toys with tiny real-photo budgets works
  [Verified — paper + [deployed app](https://www.brickdiscovery.com/tools/brickognize/)
  identifying parts "in under a second"]. LEGO A/S holds a patent family on
  CNN-based toy recognition
  ([US10650222](https://uspto.report/patent/grant/10,650,222) et al.)
  [Verified]. Commercial toys-to-life products (amiibo, Skylanders)
  sidestep vision entirely with NFC [Verified] — which is precisely why a
  *visible, explained* vision pipeline is a good exhibit. Museum AI
  exhibits
  ([Exploratorium "Adventures in AI"](https://www.exploratorium.edu/press-office/press-releases/exploratorium-presents-adventures-ai-hands-summer-exhibition),
  [AI: Your Mind & The Machine](https://aiexhibit.org/)) demonstrate
  appetite for hands-on ML demos but none found publishes a
  figurine-instance-recognition design with numbers
  [Verified — absence after search].

## Evidence by criterion

| Criterion | (A) Frozen DINO embedding + kNN | (A′) SigLIP2/CLIP + kNN | (B) Fine-tuned CNN/ViT classifier | (C) SAM-class segmentation pre-step |
|---|---|---|---|---|
| **Accuracy @ realistic photo budget** | DINOv2-L: 96.5% at 5 shots/class (5-way) [Reported]; 77.1% on 18 real personal instances, uncontrolled [Reported]; controlled rigs with ~20 real images/class worked in Brickognize [Verified]. With 100–300 frames/figurine from our controlled rig, ≥95% plausible [Inference] | Systematically worse than DINO on fine-grained visual identity (iNat: 15% vs 70%) [Reported]; fine for semantic search, wrong tool here [Inference] | "Few hundred images/class" is the standard floor [Reported]; CNNs > ViTs at this scale [Reported]; BYOL-style fine-tune hit 99.2% top-1 on SKU data with big data [Reported] | Background removal measurably helps fashion classification/retrieval [Reported — [arXiv:2308.09764](https://arxiv.org/html/2308.09764v2)]; with a matte controlled backdrop, most of that gain is capturable by cropping alone [Inference] |
| **CPU speed** | DINOv3 ViT-S/16 @256px: **115 ms single-thread, ~20 ms on 16 threads** [Reported — [CanViT measurements](https://arxiv.org/pdf/2603.22570)]; ViT-B ≈ 4× that, still ≪ 1 s [Inference]; kNN over ~10k reference embeddings: <5 ms [Inference] | Similar per-size; So400m heavier but still sub-second [Inference] | Fastest at inference (EffNetV2-S/ConvNeXt-T tens of ms) [Verified — well-established] | **The budget-killer**: rembg/U2-Net ~2–10 s/img CPU [Reported]; MobileSAM ~3 s on a Mac i5 [Reported — [MobileSAM repo](https://github.com/ChaoningZhang/MobileSAM)]; simple backdrop threshold/difference: ~1 ms [Inference] |
| **Robustness (hand-held, occlusion, rotation)** | CORe50 proves in-hand rotating/occluded objects are recognizable; its protocol (video sessions, held objects) is the model to copy [Verified — [CORe50](https://vlomonaco.github.io/core50/)]. Multi-frame voting over ~10 frames within the 5 s budget adds robustness for free [Inference] | Same mechanics, weaker features [Inference] | Comparable if occlusion is in training data; brittle to conditions unseen in training [Inference] | Segmentation quality itself degrades with hands in frame [Inference] |
| **Explanation quality (visible, honest)** | **Best**: nearest-neighbour exemplars are the literal decision evidence, not a post-hoc rationalization [Verified by construction]; plus similarity bars, plus DINO attention maps (near-free byproduct; use register-token checkpoints to avoid artifact blobs [Verified — [arXiv:2309.16588](https://arxiv.org/abs/2309.16588)]) | Same mechanics + could add text-prompt party tricks [Inference] | Grad-CAM only; saliency maps are known to sometimes survive sanity checks poorly (post-hoc, can mislead) [Verified — Adebayo et al. 2018]; softmax confidence poorly calibrated [Verified — Guo et al. 2017] | N/A (a mask is itself showable: "first I find the toy") |
| **"Unsure rather than wrong"** | Natural: threshold on top-1 cosine + top1–top2 margin; scores are meaningful distances [Inference, standard practice] | Same | Requires calibration work (temperature scaling / open-set head) [Verified — calibration literature] | — |
| **Set-change burden** | **Drop photos in a folder, re-embed (~seconds)** [Verified by construction] | Same | Full retrain per change (minutes–1 h on a modest laptop GPU for ~10k images [Inference]) plus re-validation | — |

**Conflict noted:** some general benchmarks (image–image similarity across
11 datasets) report SigLIP ≥ DINOv2 on *category-level* tasks [Reported].
The disagreement resolves on task type: category/semantic → CLIP-family;
instance/fine-grained visual identity → DINO-family. Figurine ID is the
second type. The spike's A-vs-A′ comparison settles it empirically for our
data anyway.

## The show-off angle (ranked for a Nerdfest audience)

1. **Nearest-neighbour exemplar strip** (kNN only) — "It matched *these
   five photos* we took of Pikachu" with the query frame beside them.
   Faithful (it *is* the mechanism), zero extra compute, instantly legible
   to children. **Rank 1.**
2. **Similarity score bars** (kNN only) — top-5 species with cosine scores,
   updating live per frame; doubles as the "unsure" display when no bar
   clears the threshold. Legible as a game ("watch Charizard's bar climb as
   you rotate it"). **Rank 2.**
3. **Attention-map overlay** (DINO forward-pass byproduct; use `-reg`
   checkpoints) — glowing heatmap on the figurine, runs at frame rate.
   Beautiful, but honest framing must be "where the model looked," not "why
   it decided." **Rank 3.**
4. **Grad-CAM** (classifier route, or on embedding similarity via
   [pytorch-grad-cam](https://github.com/jacobgil/pytorch-grad-cam), which
   explicitly supports embedding/similarity targets and ViTs [Verified]) —
   one extra backward pass, fine at button-press cadence on CPU
   [Inference]. Same caveat as 3, with weaker faithfulness guarantees.
   **Rank 4.**
5. **Live embedding-space projection** — precompute a 2D PCA/UMAP of all
   reference embeddings (each figurine a colored cluster), project the live
   frame as a moving dot that flies into a cluster. High wow-factor,
   moderate build effort; projection of one point is trivial CPU work
   [Inference]. **Rank 5 on effort, arguably rank 1 on spectacle — good
   stretch goal.**

The kNN pipeline supports displays 1, 2, 3 and 5 simultaneously and
honestly. The fine-tune route supports only 4 (+2 with calibration
caveats). Explainability being a first-class deliverable is itself a strong
argument for Option A.

## Recommendation

**Pipeline (primary):**

1. Webcam frame → **backdrop subtraction/threshold crop** (matte backdrop
   makes this ~1 ms; no SAM, no rembg at inference) → pad to square, resize
   224–336px.
2. **DINOv2 ViT-S/14-reg** embedding (upgrade to ViT-B/14-reg if accuracy
   demands and latency allows; benchmark DINOv3 ViT-S+/16 as a challenger,
   minding its license). Export to ONNX Runtime, int8-quantize if needed.
3. **Cosine kNN** (k≈5–10, majority vote) against the reference matrix
   (~50 figurines × ~200 embeddings — brute-force numpy, no index needed).
4. **Decision over a burst**: aggregate ~10 frames over ~2 s; declare
   identity only if top-1 mean similarity > τ₁ and top1–top2 margin > τ₂;
   else the Pokédex says "…I don't recognize this one yet!" (tune τ on a
   held-out unknown-objects set).
5. **Display**: exemplar strip + live similarity bars + attention overlay;
   embedding-map dot as stretch goal.

**Capture protocol** (modeled on CORe50/ALOI/Brickognize precedent —
session diversity beats raw count [Inference from CORe50's session-split
design]):

- On the **actual event camera and stand**: turntable video, ~1 rotation
  per condition; extract ~24–36 frames/rotation.
- Conditions per figurine: 2–3 elevations × 2–3 lighting settings (ring
  light full/half/ambient) → **~150–300 reference frames per figurine,
  ≈10 minutes each including handling** [Inference].
- One extra **hand-held session** per figurine (fingers partially
  occluding, wobble) — used for *testing*, optionally added to references.
- **Hold out one full session** (a lighting condition never in the
  reference set) as the eval split. Never split frames from one video
  across train/test — adjacent frames leak [Verified — standard CORe50
  protocol rationale].

**Control arm (replaces old Option B):** linear probe on the same DINO
embeddings (seconds to train, gives the classifier comparison almost free),
and one ConvNeXt-Tiny **ImageNet**-checkpoint fine-tune. Run the
Pokémon-artwork-checkpoint fine-tune only as a curiosity ablation — expect
it to underperform its ImageNet twin [Inference from rendition-shift
evidence].

## What the local spike must validate (falsifiable checks)

1. **Headline accuracy**: DINOv2-S/14 + kNN ≥ **95%** top-1 on the
   held-out-session split across ≥20 figurines (kill criterion raised from
   90%: controlled-rig precedent says 90% is too easy a bar to detect a bad
   pipeline) [Inference].
2. **Backbone ordering**: DINOv2/v3 beats SigLIP2-B and CLIP ViT-B on *our*
   data by ≥3 points, else revisit backbone choice.
3. **Confusable pairs**: measure top1–top2 margins for the most similar
   figurine pairs (same species different pose; similar silhouettes like
   Nidorino/Nidoking). If margins collapse, test ViT-B, higher resolution
   (336–518px), or a lightweight linear metric head — before abandoning
   kNN.
4. **Unknown rejection**: ≥90% of non-Pokémon objects (mug, hand, rival
   toy) and empty stand rejected as "unsure" at thresholds that still
   accept ≥95% of true figurines.
5. **Occlusion/rotation**: accuracy on the hand-held test session; check
   whether adding hand-held frames to references closes any gap.
6. **Latency**: full loop (capture→crop→embed→vote→render explanation)
   < 1 s/frame on the weakest team laptop CPU, burst decision < 5 s.
7. **Ablations that settle the plan's open questions**: (a)
   crop/backdrop-subtraction vs raw frame vs rembg-cleaned references — is
   expensive segmentation ever worth it offline? (b) reference count curve:
   accuracy at 10/25/50/100/200 refs per figurine — determines the real
   capture burden; (c) ImageNet-checkpoint fine-tune vs
   Pokémon-artwork-checkpoint fine-tune vs DINO linear probe.
8. **Add-a-figurine demo**: photograph a new figurine, add refs, verify
   recognition with zero retraining — this is both an ops requirement and a
   live exhibit moment.

## Sources

- [DINOv3 paper — arXiv:2508.10104](https://arxiv.org/abs/2508.10104) (Meta, 2025-08-13)
- [facebookresearch/dinov3 (GitHub)](https://github.com/facebookresearch/dinov3); [DINOv3 License (Meta)](https://ai.meta.com/resources/models-and-libraries/dinov3-license/); [license issue #31](https://github.com/facebookresearch/dinov3/issues/31)
- [DINOv3 technical deep dive — Lightly](https://www.lightly.ai/blog/dinov3) (2025)
- [SigLIP 2 — arXiv:2502.14786](https://arxiv.org/html/2502.14786v1) (Google, Feb 2025)
- [Finding the Best Embedding Model for Image Classification — Voxel51](https://voxel51.com/blog/finding-the-best-embedding-model-for-image-classification) (2025-11-04)
- [CanViT (CPU latency table for DINOv3 ViT-S/16) — arXiv:2603.22570](https://arxiv.org/pdf/2603.22570) (2026)
- [Rethinking the Good Enough Embedding for Easy Few-Shot Learning — arXiv:2605.14145](https://arxiv.org/html/2605.14145) (2026-05)
- [Object-Conditioned Bag of Instances for Few-Shot Personalized Instance Recognition — Samsung Research](https://research.samsung.com/research-papers/Object-Conditioned-Bag-of-Instances-for-Few-Shot-Personalized-Instance-Recognition) (2024)
- [Brickognize — Sensors 23(4):1898](https://www.mdpi.com/1424-8220/23/4/1898) (2023); [Brickognize app overview](https://www.brickdiscovery.com/tools/brickognize/)
- [CORe50 dataset & benchmark](https://vlomonaco.github.io/core50/) (Lomonaco & Maltoni, 2017)
- [FungiTastic fine-grained benchmark — arXiv:2408.13632](https://arxiv.org/pdf/2408.13632) (2024)
- [Which Backbone to Use: resource-efficient comparison — arXiv:2406.05612](https://arxiv.org/pdf/2406.05612) (2024)
- [CNS-Bench: robustness under continuous nuisance (incl. plush-toy style) shifts — arXiv:2507.17651](https://arxiv.org/pdf/2507.17651) (2025)
- [Impact of Background Removal on fashion classification — arXiv:2308.09764](https://arxiv.org/html/2308.09764v2) (2023)
- [rembg (GitHub)](https://github.com/danielgatis/rembg); [BiRefNet vs rembg vs U2Net production comparison — DEV](https://dev.to/om_prakash_3311f8a4576605/birefnet-vs-rembg-vs-u2net-which-background-removal-model-actually-works-in-production-4830) (2026)
- [MobileSAM (GitHub, CPU timing)](https://github.com/ChaoningZhang/MobileSAM) (2023); [EfficientSAM vs SAM — Medium](https://medium.com/@nandinilreddy/efficient-sam-vs-sam-920879408467)
- [pytorch-grad-cam (similarity/embedding + ViT support)](https://github.com/jacobgil/pytorch-grad-cam)
- [Vision Transformers Need Registers — arXiv:2309.16588](https://arxiv.org/abs/2309.16588) (2023/ICLR 2024)
- [Contrastive learning for SKU recognition — Applied Sciences 16(6):2810](https://www.mdpi.com/2076-3417/16/6/2810) (2026); [Width.ai SKU classification case study](https://www.width.ai/post/sku-image-classification-for-product-matching)
- [Roboflow classification model guidance](https://playground.roboflow.com/models/task/classification); [image classification models 2026 — Label Your Data](https://labelyourdata.com/articles/image-classification-models)
- [LEGO A/S toy-recognition patent US10650222](https://uspto.report/patent/grant/10,650,222) (granted 2020); [US10213692B2](https://patents.google.com/patent/US10213692B2/en)
- [skshmjn/Pokemon-classifier-gen9-1025 — Hugging Face](https://huggingface.co/skshmjn/Pokemon-classifier-gen9-1025)
- [Exploratorium: Adventures in AI](https://www.exploratorium.edu/press-office/press-releases/exploratorium-presents-adventures-ai-hands-summer-exhibition) (2024); [AI: Your Mind & The Machine traveling exhibit](https://aiexhibit.org/)
