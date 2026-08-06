# Research: Live explainability visualisation, TTS, and Pokédex data source

COMPX374 Pokédex outreach project (Nerdfest, late Oct 2026). Slice: real-time explainability
visualisation, text-to-speech for kiosk, Pokédex-entry data. Researched 2026-07-29.

Evidence grades: **[Verified]** = primary source fetched and states it (URL cited).
**[Consensus]** = multiple independent practitioners agree. **[Thin]** = single or
untraceable source — verify before relying on it.

---

## 1. Live explainability visualisation

### 1.1 jacobgil/pytorch-grad-cam (the de-facto standard Grad-CAM library)

- Implements a large family of CAM methods: "GradCAM, HiResCAM, ScoreCAM, GradCAMPlusPlus,
  AblationCAM, XGradCAM, EigenCAM, EigenGradCAM, LayerCAM, FullGrad, Deep Feature
  Factorizations, KPCA-CAM, FEM, ShapleyCAM, FinerCAM, SegEigenCAM, RefineCAM". Supports CNNs
  and Vision Transformers, classification/detection/segmentation. MIT licence.
  [Verified] https://github.com/jacobgil/pytorch-grad-cam
- **No live-video / webcam support or example in the README** — examples are static images
  only. The README does emphasise "High performance: full support for batches of images in
  all methods", so per-frame use in your own webcam loop is straightforward, but you write
  the loop yourself. [Verified] (absence checked in README, same URL)
- Practical implication: you call `cam(input_tensor)` once per captured frame and alpha-blend
  the returned heatmap with `show_cam_on_image()` onto the frame — a ~15-line OpenCV loop.
  [Consensus] (standard pattern in community webcam Grad-CAM demos, e.g.
  https://github.com/topics/grad-cam)

### 1.2 frgfm/torch-cam — the repo with actual latency numbers

TorchCAM (Apache-2.0) implements CAM, Grad-CAM, Grad-CAM++, Smooth Grad-CAM++, Score-CAM,
SS-CAM, IS-CAM, XGrad-CAM, Layer-CAM, and publishes a **latency benchmark measured on a
laptop** ("Intel(R) Core(TM) i7-10750H for the CPU, and a NVIDIA GeForce RTX 2070 with
Max-Q Design", 100 iterations, 224x224 inputs). [Verified]
https://github.com/frgfm/torch-cam (table in README; docs at https://frgfm.github.io/torch-cam/)

| CAM method | Arch | GPU mean | CPU mean |
| --- | --- | --- | --- |
| CAM | resnet18 | 0.11 ms | 0.14 ms |
| GradCAM | resnet18 | 3.71 ms | 40.66 ms |
| GradCAM++ | resnet18 | 5.21 ms | 41.61 ms |
| SmoothGradCAM++ | resnet18 | 33.67 ms | 239.27 ms |
| ScoreCAM | resnet18 | 304.74 ms | **6796.89 ms** |
| XGradCAM | resnet18 | 3.78 ms | 40.63 ms |
| LayerCAM | resnet18 | 3.65 ms | 40.91 ms |
| GradCAM | mobilenet_v3_large | 8.61 ms | 26.64 ms |
| ScoreCAM | mobilenet_v3_large | 35.19 ms | 679.16 ms |
| LayerCAM | mobilenet_v3_large | 8.02 ms | 25.14 ms |

[Verified] — table quoted from README at https://github.com/frgfm/torch-cam

**Derived frame-rate estimate** (arithmetic from the verified table, not an independent
measurement): the CAM computation alone for Grad-CAM/LayerCAM is ~25–40 ms per frame on a
laptop CPU (25–40 Hz) and ~4–9 ms on a laptop GPU. Add the forward pass (~20–60 ms CPU for
resnet18/mobilenet at 224px) and preprocessing, and the realistic full pipeline is roughly
**8–15 FPS on laptop CPU, comfortably 30+ FPS on a modest laptop GPU** for
Grad-CAM/LayerCAM with a small backbone. **ScoreCAM and AblationCAM are NOT real-time**
(hundreds of forward passes; 0.3 s GPU / 6.8 s CPU per frame). SmoothGradCAM++ is marginal
(~4 FPS CPU). If you only need "where is the network looking" for a lay audience,
**EigenCAM / plain CAM are gradient-free and effectively free** (CAM: 0.14 ms), at some cost
in class-specificity. [Verified table + derived numbers]
- TorchCAM also ships a Streamlit demo app (Hugging Face Spaces) you can crib for a kiosk UI.
  [Verified] https://github.com/frgfm/torch-cam

Practitioner FPS reports for webcam Grad-CAM specifically are scarce and scattered; the
TorchCAM benchmark is the best primary data found. Web searches for "grad-cam webcam fps"
surface mostly generic webcam-test tools, not measurements. [Verified-absence of good
secondary data; treat any specific "X FPS" claim you see in blogs as [Thin]]

### 1.3 tf-explain (Keras/TF2)

- Implements 7 methods as TF2 callbacks/explainers: Activations Visualization, Vanilla
  Gradients, Gradients*Inputs, Occlusion Sensitivity, Grad-CAM, SmoothGrad, Integrated
  Gradients. MIT. Docs: https://tf-explain.readthedocs.io
  [Verified] https://github.com/sicara/tf-explain
- No archive notice, but Python support listed only up to 3.8 and the release cadence is
  old — treat as **effectively dormant**; fine for a one-off demo, risky as a dependency.
  [Thin] (inferred from README metadata; check the commit log before committing to it)
- No real-time/video support mentioned. [Verified-absence, same URL]

### 1.4 Captum (PyTorch official interpretability library)

- "A model interpretability and understanding library for PyTorch", maintained by Meta under
  the PyTorch org (now `meta-pytorch/captum`). BSD-3. Includes Integrated Gradients,
  Saliency, DeepLift, GradientShap, Occlusion, **LayerGradCam / Guided GradCAM**, and many
  neuron/layer methods. [Verified] https://github.com/pytorch/captum
- **Captum Insights (its visualisation UI) "was retired after v0.8.0 and is no longer
  supported."** So Captum gives you attribution tensors, not a display — you build the
  overlay yourself. No real-time claims in docs. [Verified] (same URL)
- Verdict for this project: heavier and more research-oriented than jacobgil/torch-cam;
  use only if you're already deep in PyTorch and want Integrated Gradients as a comparison
  view. [Consensus]

### 1.5 Browser-based saliency / TensorFlow.js

- **TensorFlow.js official demos** (webcam classification, Teachable Machine, etc.):
  https://www.tensorflow.org/js/demos — real-time classification in browser is mature
  (MobileNet webcam classification is the canonical codelab:
  https://codelabs.developers.google.com/codelabs/tensorflowjs-object-detection). [Verified]
- **CNN Explainer** (poloclub, Georgia Tech/Oregon State, IEEE TVCG 2020): "an interactive
  visualization system designed to help non-experts learn about Convolutional Neural
  Networks", runs in-browser, MIT, live at https://poloclub.github.io/cnn-explainer/.
  Not webcam-live (fixed example images), but the best public-facing explanation UI to steal
  ideas from (click a neuron, see its feature map and the convolution animation).
  [Verified] https://github.com/poloclub/cnn-explainer
- **MSI-Net saliency demo**: alexanderkroner/saliency (Neural Networks 2020) reportedly has a
  TF.js webcam saliency demo — single source, verify before citing.
  [Thin] https://github.com/alexanderkroner/saliency
- Gradient-based saliency (not just inference) **is computable in TF.js** via `tf.grads`,
  but ready-made live Grad-CAM-in-browser demos are rare; expect to write it yourself if you
  go browser-only. [Consensus — absence of canonical demo across searches]

### 1.6 Simpler audience-friendly visuals (recommended for kids)

- **Top-5 confidence bars updating live**: this is exactly Teachable Machine's output UI and
  is universally understood by the public; trivially real-time (it's just the softmax you
  already computed). [Consensus] https://teachablemachine.withgoogle.com/
- **Live feature-map grids**: Gene Kogan's "What Neural Networks See" (Experiments with
  Google) lets viewers "turn on your camera to explore what neural nets see, live, using
  your camera", visualising each layer in real time; built with openFrameworks, open source,
  aimed at the general public. Proof that layer-activation grids run live and land well at
  outreach events. [Verified] https://experiments.withgoogle.com/what-neural-nets-see
  (Kogan's ml4a openFrameworks apps: https://github.com/ml4a)
- A good kiosk pattern: heatmap overlay (Grad-CAM/EigenCAM) + top-5 bars side by side —
  one "where it looked", one "what it thinks". [Consensus among outreach demos above]

### 1.7 Feature-matching explainability: cv2.drawMatches

- OpenCV's official tutorial: `cv.drawMatches()` "stacks two images horizontally and draw
  lines from first image to second image showing best matches" (`drawMatchesKnn` for k best).
  Pairs with ORB + BFMatcher (Hamming) in the same tutorial. [Verified]
  https://docs.opencv.org/4.x/dc/dc3/tutorial_py_matcher.html
- ORB was explicitly designed as a fast real-time alternative to SIFT/SURF (Rublee et al.
  2011, "ORB: an efficient alternative to SIFT or SURF"); ORB+BFMatcher on a few hundred
  keypoints against one card template runs at webcam rates on laptop CPU. The tutorial notes
  FLANN "works faster than BFMatcher for large datasets" (relevant if matching against all
  151 reference cards per frame). [Consensus; tutorial verified at the same URL]
- Explainability value: the keypoint-line display literally shows "these dots on your card
  matched these dots on the reference card" — arguably the most honest and kid-legible
  explanation of a matching-based recogniser, and genuinely real-time. [Consensus]

### 1.8 Which are genuinely real-time? (summary verdict)

| Technique | Real-time on laptop? | Grade |
| --- | --- | --- |
| Top-5 confidence bars | Yes, free | [Consensus] |
| cv2.drawMatches (ORB) | Yes, webcam-rate CPU | [Consensus] |
| CAM / EigenCAM | Yes, sub-ms overhead | [Verified benchmark] |
| Grad-CAM / LayerCAM / XGradCAM | Yes on GPU; ~8–15 FPS CPU (derived) | [Verified benchmark + derivation] |
| Feature-map grid (live) | Yes (proven in outreach exhibits) | [Verified exhibit] |
| SmoothGrad / SmoothGradCAM++ | Marginal (~4 FPS CPU) | [Verified benchmark] |
| ScoreCAM / AblationCAM / Integrated Gradients / Occlusion | No (0.3–7 s+/frame) | [Verified benchmark / Consensus] |

---

## 2. Museum / outreach precedents

- **"What Neural Networks See"** — Gene Kogan, Experiments with Google: live webcam,
  per-layer visualisation, general-public audience, openFrameworks, open source. The
  closest existing thing to your explainability display. [Verified]
  https://experiments.withgoogle.com/what-neural-nets-see
- **Science-museum study of interactive ML**: "Technical Understanding from Interactive
  Machine Learning Experience: a Study Through a Public Event for Science Museum Visitors"
  (Interacting with Computers, 2024) — built a Teachable-Machine-style train-your-own-model
  exhibit for museum visitors and measured engagement/comprehension via logs, questionnaires,
  quizzes, interviews. Useful citation that hands-on ML exhibits measurably teach the public.
  [Verified paper exists] https://academic.oup.com/iwc/article/36/3/155/7626066
- **"Artificial Intelligence: Your Mind & The Machine"** — travelling US museum exhibition
  (shown at MOHAI Seattle) covering neural networks, ML, generative AI for lay audiences.
  [Verified] https://aiexhibit.org/ and
  https://mohai.org/exhibits/artificial-intelligence-your-mind-the-machine/
- **Teachable Machine** itself is widely used as the outreach on-ramp: webcam in, live
  class-confidence bars out, no code. Its presentation grammar (big live bars, instant
  feedback, "train it yourself") is the pattern the public already understands.
  [Consensus] https://teachablemachine.withgoogle.com/
- Presentation lessons across these: (1) mirror-style live view of the visitor/object is the
  hook; (2) one simple visual metaphor at a time (bars OR heatmap OR layers per screen);
  (3) instant response matters more than fidelity. [Consensus]

---

## 3. Text-to-speech for the kiosk

### 3.1 Web Speech API (`speechSynthesis`) — browser built-in

- `SpeechSynthesisVoice.localService` (boolean) tells you whether a voice "is supplied by a
  local speech synthesizer service (true), or a remote speech synthesizer service (false)";
  MDN notes remote voices "might have extra latency, bandwidth or cost". Baseline
  widely-available since Sept 2018. [Verified]
  https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService
- **Chrome offline behaviour**: Chrome fetches its high-quality "Google …" voices from the
  network when online; "If there is no network connection, the number of languages available
  is the same as Firefox and Safari" — i.e. it falls back to the OS-native voices
  (Microsoft voices on Windows, which are `localService: true` and work fully offline).
  Chrome also loads its voice list asynchronously (`onvoiceschanged`), unlike
  Firefox/Safari. [Consensus]
  https://webplatformcourse.com/bonus/speech-synthesis-api/ ;
  https://groups.google.com/a/chromium.org/g/chromium-discuss/c/HsYS5oVmOFc
- **Kiosk gotcha**: Chrome requires a user gesture before `speechSynthesis.speak()` will
  produce audio (autoplay policy; the no-user-activation path was deprecated/removed around
  Chrome 71). For a kiosk, the "scan" button press counts as the gesture, or launch Chrome
  with `--autoplay-policy=no-user-gesture-required`. [Consensus — widely reported;
  chromestatus entry is a JS app that could not be fetched to quote:
  https://chromestatus.com/feature/5687444770914304 — verify during build]
- Quality: OS-native offline voices (Microsoft David/Zira etc.) are robotic compared to
  neural voices — arguably *thematically perfect* for a Pokédex, which canonically sounds
  robotic. Zero install, zero cost, fully offline. [Consensus on quality; the Pokédex-voice
  observation is our own]

### 3.2 Piper TTS — local neural TTS

- Original repo rhasspy/piper: "a fast, local neural text to speech system", **MIT licence,
  archived 6 Oct 2025 (read-only); development moved to OHF-Voice/piper1-gpl**. [Verified]
  https://github.com/rhasspy/piper
- Successor OHF-Voice/piper1-gpl: "A fast and local neural text-to-speech engine that embeds
  espeak-ng for phonemization." **GPL-3.0** (name says it; COPYING file present).
  `pip install piper-tts`. Ships CLI, HTTP web server, Python API, C/C++ API, Docker. Used
  by Home Assistant and NVDA. [Verified] https://github.com/OHF-Voice/piper1-gpl
- The original Piper was described as optimised for Raspberry Pi 4, and voices come in
  quality tiers (x_low/low/medium/high, 16–22.05 kHz); on any laptop it synthesises a
  Pokédex-entry-length sentence in well under a second. [Consensus for RPi4 claim and
  tiers — stated in the archived README/samples pages, not re-fetched here; samples:
  https://rhasspy.github.io/piper-samples/ — verify tier names when picking a voice]
- Licence note for your report: the *engine* moving MIT→GPL-3.0 matters only if you
  redistribute a combined work; for an internal kiosk it's irrelevant, and the archived MIT
  engine still works. Individual voice models carry their own licences (check the voice
  card). [Verified engine licences at the two repos; voice-licence caveat Consensus]

### 3.3 Cloud TTS (OpenAI / Google / ElevenLabs)

All require internet — a hard dependency you don't want at a school-hall event. Numbers
below are from comparison aggregators, not fetched from official pricing pages — re-verify
before quoting in the client report. [Consensus across aggregators, individually Thin]

- OpenAI: `tts-1` ~$15/1M chars, `tts-1-hd` ~$30/1M, `gpt-4o-mini-tts` token-priced
  (~$0.015/min audio); ~0.5 s latency. https://texttolab.com/blog/openai-tts-pricing ;
  https://www.codesota.com/speech/openai-tts-vs-google-tts
- Google Cloud TTS: tiered (Standard ~$4/1M chars up to Studio/Chirp HD); generous free tier.
  https://www.codesota.com/speech/openai-tts-vs-google-tts
- ElevenLabs: best perceived quality/emotion, ~$50–180/1M chars depending on model, Flash
  models ~75 ms streaming latency. https://tomodahinata.com/en/blog/qwen-tts-vs-elevenlabs-openai-google-azure-tts-comparison

### 3.4 Recommendation for an offline-capable kiosk

1. **Best fit: pre-generate the audio.** The corpus is finite (e.g. 151 Gen-1 Pokémon × one
   chosen English flavor text). Batch-render WAV/MP3s once with Piper (or even a cloud voice
   while you have internet), ship them as static files. Zero runtime latency, zero runtime
   dependencies, and you can hand-fix pronunciations ("Arbok", "Onix"). [Consensus-grade
   engineering judgement]
2. Runtime fallback / dynamic text: Piper local HTTP server. [Verified capability]
3. Zero-install fallback: Web Speech API with a `localService: true` voice, gated behind the
   scan button press. [Verified API + Consensus behaviour]

---

## 4. Pokédex entry data

### 4.1 PokéAPI live API

- Docs: https://pokeapi.co/docs/v2. **Fair use policy** (quoted): "PokéAPI is free and open
  to use. It is also very popular. Because of this, we ask every developer to abide by our
  fair use policy. People not complying with the fair use policy will have their IP address
  permanently banned." Rules: "Locally cache resources whenever you request them"; "Be nice
  and friendly to your fellow PokéAPI developers"; report security issues responsibly.
  **Rate limiting was removed entirely in Nov 2018**; caching is the stated obligation.
  [Verified] https://pokeapi.co/docs/v2
- **pokemon-species endpoint** (`/api/v2/pokemon-species/{id}/`): `flavor_text_entries` is an
  array where each entry has `flavor_text` (string), `language` (NamedAPIResource) and
  `version` (NamedAPIResource). Pikachu has ~90 entries spanning games Red→Legends: Arceus
  and 7+ languages. Example English entry (FireRed): "It has small electric sacs on both its
  cheeks. If threatened, it looses electric charges from the sacs." Also useful in the same
  response: `genera` (e.g. "Mouse Pokémon"), `name`, `id`, `color`, `habitat`,
  `evolves_from_species`. [Verified] https://pokeapi.co/api/v2/pokemon-species/25/
- **Gotcha for TTS**: raw `flavor_text` strings contain embedded control characters (`\n`,
  `\f` page-break, and soft-hyphen artifacts from the game ROMs) that must be stripped/
  normalised before display or speech. [Consensus — long-standing known issue among PokéAPI
  users; confirm on your fetched JSON]
- Filter recipe: pick entries where `language.name == "en"`, then choose one `version` (or
  latest) — multiple versions repeat near-identical text.

### 4.2 Offline options (all official PokeAPI-org repos)

- **Self-host the real API**: PokeAPI/pokeapi (BSD-3-Clause code) supports Docker Compose
  ("a multi-container setup, managed by Docker Compose V2 … production-like environment"):
  `docker compose up -d` + `docker compose exec -T app python manage.py migrate`. Database
  builds from CSVs via `make build-db`. [Verified] https://github.com/PokeAPI/pokeapi
- **Static JSON dump (easiest)**: PokeAPI/api-data contains "a static copy of the JSON data
  produced by PokeAPI" (`data/api`) plus schema (`data/schema`), maintained by an automated
  updater bot based on Ditto; BSD-3-Clause. You can serve it with any static file server or
  just bundle the ~150 species files you need. [Verified] https://github.com/PokeAPI/api-data
- **Ditto**: official tool that crawls a PokéAPI instance (`ditto clone`), generates schema
  (`ditto analyze`) and rewrites base URLs (`ditto transform --base-url=...`) so the static
  clone's hyperlinks point at your own host. `pip install pokeapi-ditto`; Apache-2.0.
  [Verified] https://github.com/PokeAPI/ditto
- **Browser wrapper with caching**: PokeAPI/pokeapi-js-wrapper — "A PokeAPI wrapper intended
  for browsers. Comes fully asynchronous, zero dependencies and built-in cache", plus an
  optional Service Worker that caches all Pokémon images (`cacheImages`, `swLocation`
  options); cache management via `getCacheLength()/clearCache()/invalidateCache()`.
  MPL-2.0. First-visit-online, then effectively offline. [Verified]
  https://github.com/PokeAPI/pokeapi-js-wrapper
  (Node-side alternative with caching: pokedex-promise-v2, also under the PokeAPI org —
  [Thin], not fetched)
- **Sprites/artwork**: official artwork and game sprites live in PokeAPI/sprites and are
  referenced by the API. [Thin — repo not fetched: https://github.com/PokeAPI/sprites]

**Recommendation**: extract the needed English flavor text + genus for your supported
Pokémon from api-data into one small JSON file bundled with the app (a 151-Pokémon subset is
well under 1 MB); no network, no self-hosting overhead, complies with the "cache locally"
policy by construction. [Consensus-grade engineering judgement on verified sources]

### 4.3 Data licence caveat

PokeAPI's *code and data files* are BSD-3 licensed, but the underlying names, flavor text and
artwork are Nintendo/Creatures/GAME FREAK intellectual property — the BSD licence cannot and
does not grant rights to the Pokémon content itself. [Consensus; and see §5]

---

## 5. Nintendo / Pokémon IP note (flag for client — not legal advice)

- The Pokémon Company's legal page (https://www.pokemon.com/us/legal/) asserts that Pokémon
  character names are trademarks of Nintendo, and its fan-content terms grant TPC a broad
  royalty-free licence to any submitted fan art while stating (as fetched; wording garbled by
  extraction, verify exact sentence) that nothing constitutes "a grant to Fan Art's creator
  to use the Pokémon intellectual property … beyond a personal, noncommercial home use."
  i.e. **the page offers no documented permission pathway for educational or outreach use**.
  [Verified page exists and contains these themes; exact quote needs re-checking]
  https://www.pokemon.com/us/legal/
- No official educational/non-commercial licence program was found. PokéAPI itself operates
  publicly as "primarily an educational tool" (their words) and has done so since 2014
  without documented takedown, and non-commercial fan projects are widely tolerated in
  practice — but tolerance is not permission. [Consensus on practice; Verified quote from
  https://pokeapi.co/docs/v2]
- **Flag for client**: the activity is free, non-commercial, university-run and transient,
  which is the lowest-risk category, but TPC/Nintendo enforce actively against some fan
  projects. Recommend: (a) client sign-off recorded; (b) no Pokémon logos in university
  marketing; (c) consider the university's legal office if the exhibit is photographed for
  publicity. [Consensus-grade risk framing, not legal advice]

---

## Sources index (primary unless noted)

- https://github.com/jacobgil/pytorch-grad-cam
- https://github.com/frgfm/torch-cam / https://frgfm.github.io/torch-cam/
- https://github.com/sicara/tf-explain
- https://github.com/pytorch/captum
- https://github.com/poloclub/cnn-explainer / https://poloclub.github.io/cnn-explainer/
- https://www.tensorflow.org/js/demos
- https://github.com/alexanderkroner/saliency (thin)
- https://docs.opencv.org/4.x/dc/dc3/tutorial_py_matcher.html
- https://experiments.withgoogle.com/what-neural-nets-see
- https://academic.oup.com/iwc/article/36/3/155/7626066
- https://aiexhibit.org/ ; https://mohai.org/exhibits/artificial-intelligence-your-mind-the-machine/
- https://teachablemachine.withgoogle.com/
- https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService
- https://webplatformcourse.com/bonus/speech-synthesis-api/ (secondary)
- https://github.com/rhasspy/piper ; https://github.com/OHF-Voice/piper1-gpl
- https://rhasspy.github.io/piper-samples/
- https://texttolab.com/blog/openai-tts-pricing (secondary) ;
  https://www.codesota.com/speech/openai-tts-vs-google-tts (secondary) ;
  https://tomodahinata.com/en/blog/qwen-tts-vs-elevenlabs-openai-google-azure-tts-comparison (secondary)
- https://pokeapi.co/docs/v2 ; https://pokeapi.co/api/v2/pokemon-species/25/
- https://github.com/PokeAPI/pokeapi ; https://github.com/PokeAPI/api-data ;
  https://github.com/PokeAPI/ditto ; https://github.com/PokeAPI/pokeapi-js-wrapper
- https://www.pokemon.com/us/legal/
