# Proposed Tech Stack — Pokédex AI Outreach Activity

> **Status: PRELIMINARY / PROPOSAL** — 2026-07-29, pre-client-meeting and
> pre-team-review. Rationale for each pick, with the alternative we'd switch
> to and why we didn't start there. Evidence behind claims:
> [research note](research/2026-07-29-pokedex-outreach-cv.md) and its
> deep-dives.

## Summary table

| Layer | Proposal | Alternative considered |
|---|---|---|
| Language | Python 3.11+ | — (ecosystem decides this one) |
| Vision core | OpenCV + ImageHash + NumPy + Pillow; XFeat (Apache-2.0) as the lock-on verify upgrade over ORB | — |
| Figurine model | Frozen DINOv2 ViT-S/14-reg + cosine kNN over self-captured reference photos (control arm: DINO linear probe, ConvNeXt-Tiny ImageNet fine-tune) — see [2026-08-06 check](research/2026-08-06-figurine-recognition-frontier.md) | DINOv3 (stronger, licence-gated); SigLIP2/CLIP kNN (demoted: semantic ≠ instance features); Ultralytics YOLO-cls (AGPL) |
| Explainability | Exemplar strips + distance race + keypoint match lines (the mechanisms themselves); one pytorch-grad-cam similarity-CAM at lock-on — see [2026-08-06 check](research/2026-08-06-live-explainability-frontier.md) | Raw ViT attention maps and live UMAP dots (refused: honesty); tf-explain (dormant), Captum (research-grade) |
| UI | Phase 1: OpenCV window (this stub). Phase 2: local web kiosk — FastAPI + WebSocket frames + small React/TS front-end | PyQt/pygame desktop app |
| TTS | Pre-generated WAVs via Piper at build time; Windows built-in voice as stub/fallback | Cloud TTS (rejected: internet dependency at event) |
| Dex data | PokeAPI static dump subset, bundled JSON | Live PokéAPI (rejected at event time: network) |
| Card DB | pokemontcg.io hi-res (bulk-cache NOW) + TCGdex keyless fallback | Scrydex commercial API (cost, key mgmt) |
| Hardware | Laptop + 1080p webcam + ring light; **stretch:** RPi 5 in a 3D-printed shell | Tablet (weaker CV story) |
| Testing | pytest + synthetic-composite selftest + recorded webcam clips as regression fixtures | — |
| Repo/CI | GitHub + Actions (lint + selftest on push) | — |

## Rationale by layer

### Python
The entire evidence base — every scanner, every classifier checkpoint, every
explainability library in the research — is Python. Team familiarity from
university coursework. No other choice reduces risk.

### Vision core: OpenCV + ImageHash, verified by keypoints
The card path needs no ML at all: contour detect → perspective rectify →
perceptual hash → nearest neighbour is the consensus architecture across
every open-source card scanner examined, and runs 7–26 ms/frame on laptop
CPU (verified numbers from the MTG scanner that abandoned YOLO for being 2×
slower and less robust). ImageHash gives pHash/dHash in two lines.
**Implication worth saying out loud: "AI-powered" for cards means classical
computer vision, not a neural net — and that's the honest, fast, reliable
choice.** The 2026-08-06 check confirmed the hash core against the frontier
(the one trained 20k-card embedding system published in 2026 reaches only
85.1% open-set top-1) and promoted two additions: temporal voting across
frames, and a **keypoint geometric verification at lock-on** — ORB first,
XFeat (CVPR 2024, Apache-2.0, real-time sparse on laptop i5 CPU) as the
upgrade — whose RANSAC inlier count is both the accept gate and the
match-lines display. The neural story lives in the figurine path and the
explainability display.

### Figurine model: DINOv2-kNN primary, spike confirms
The 2026-08-06 frontier check settled the July A-vs-B framing: instance
identity is a visual-structure problem, and DINO-family self-supervised
features beat CLIP-family by wide margins on fine-grained/instance
benchmarks (e.g. 70% vs 15% on iNaturalist, no fine-tuning). All candidates
still start from the same self-collected photo set of the actual event
figurines (no public figurine photo dataset exists — verified by absence
across Kaggle/HF/Roboflow):

- **Primary: frozen DINOv2 ViT-S/14 (registers) + cosine kNN** — no
  training, add a figurine by adding photos, similarity scores and matched
  exemplars feed the explanation panel directly, distances give the unsure
  gate. Apache-2.0. DINOv3 benchmarked as a challenger (stronger instance
  retrieval, gated custom licence).
- **Control arm: linear probe on the same embeddings + ConvNeXt-Tiny
  ImageNet fine-tune** — keeps the classifier route honest; CNNs beat ViTs
  in low-data fine-tuning. The 1,025-class Pokémon-artwork checkpoint is a
  curiosity ablation only (no published accuracy; artwork→toy rendition
  shift is a documented failure mode).

Spike (b′) in ARCHITECTURE.md benches these on a held-out *session* split
(never split one video across train/test). Lachlan's kiwifruit
transfer-learning pipeline is directly reusable for the control arm.

### Explainability
The 2026-08-06 ruling: lead with the mechanisms themselves, spend saliency
sparingly, refuse theatre. Details and evidence in
[the explainability check](research/2026-08-06-live-explainability-frontier.md).

- Cards: keypoint match lines at lock-on (inliers green — the verifier's
  own evidence; ORB via `cv2.drawMatches` or custom staggered renderer,
  XFeat upgrade) + animated top-5 distance race + the hash-distance accept
  statistics rendered as one plain sentence.
- Figurines: nearest-neighbour exemplar strip (winner **and** runner-up) +
  Teachable-Machine-style similarity bars; **one** Grad-CAM at lock-on
  targeted at cosine similarity to the matched exemplar (pytorch-grad-cam,
  ~25–41 ms CPU measured) — never per frame; requires the PyTorch model
  in-process (gradients don't cross ONNX Runtime).
- Refused on honesty grounds: raw ViT attention maps (register artifacts
  glow on background), live UMAP/t-SNE dots (visitors invent axis meanings;
  seconds per transform). Every shipped heatmap must pass the
  randomise-weights / swap-target sanity test.
- Avoid: ScoreCAM/AblationCAM/Integrated Gradients (0.3–7 s/frame — not live).

### UI: OpenCV window now, local web kiosk later
The stub uses an OpenCV window because it's zero extra dependencies and the
spikes need exactly that. For the event build we propose a **local** web UI
(FastAPI backend streaming frames + a React front-end in kiosk-mode Chrome):
richer layout for the explanation panel, captions, artwork; the team's
existing web skills apply; still fully offline (localhost). Decision after
the client meeting (staffed vs unattended changes the UI brief). Note if the
browser ever does TTS: Chrome requires a user gesture before speech — the
scan button press satisfies it, or we launch with the autoplay flag; moot if
audio is pre-generated WAVs played by the backend (the plan).

### TTS: pre-generated, robotic on purpose
The speakable corpus is finite (curated entries × curated species), so we
batch-render WAVs once (Piper — local neural TTS, runs anywhere, voices in
quality tiers) and hand-fix pronunciations ("Arbok", "Onix"). Zero runtime
latency, zero cloud. The slightly robotic voice is *canon* for a Pokédex.
Licence note: current Piper engine (OHF-Voice/piper1-gpl) is GPL-3.0 — fine
as a build-time tool generating assets; it never ships inside the app.

### Data: everything cached before event day
- Dex entries: PokeAPI's official static dump (`PokeAPI/api-data`), subset
  bundled as JSON (<1 MB), control chars stripped, kid-safe whitelist.
  PokéAPI's own fair-use policy mandates local caching — compliance by
  construction.
- Card images/JSON: pull from pokemontcg.io v2 (free key, 20k req/day,
  734×1024 hi-res) **early in the project** — the service is now "part of
  Scrydex" (commercial) and the free tier's lifespan is uncertain. TCGdex
  (keyless, 600×825, fully open-source DB, and its card JSON carries the
  National Dex number — verified live) is the fallback and is what the stub
  uses today.

### Hardware
Baseline: any modern laptop + external 1080p webcam + cheap ring light +
external speaker. Everything in the stack runs CPU-only at demo rates; a
laptop with any NVIDIA GPU makes Grad-CAM comfortably 30+ fps but is not
required. Stretch (client-dependent): Raspberry Pi 5 + camera + small screen
in a 3D-printed Pokédex shell — proven possible by two prior builds, but it
halves our compute budget, so it's a v2, not the plan of record.

### Testing
- The synthetic-composite selftest (this stub ships one): paste known card
  images into generated scenes, assert the pipeline identifies them — runs
  headless in CI, no camera needed.
- Recorded real webcam clips as regression fixtures once hardware exists
  (glare clip, sleeve clip, plush clip = the documented failure modes).
- Adversarial pre-event suite: deliberately break it (tilt, glare, partial
  occlusion, wrong objects, nothing in frame) and require graceful behaviour.

## What we are deliberately NOT proposing

- **Vision-LLM (GPT-4V/Gemini/Claude) as the primary identifier** — the two
  prior builds that used it report 2–5 s latency, internet dependency, and
  flakiness in their own words. At most a curiosity fallback if the venue
  has internet; never on the critical path.
- **Cloud anything at event time.**
- **Training on public artwork datasets and hoping it transfers to toys** —
  the documented domain gap says it won't, reliably.
- **Open-set recognition promises** — see VISION.md non-goals.
