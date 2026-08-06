# Research: Recognising Pokémon species from figurines/plush/3D objects

**Scope:** datasets, pretrained models, CLIP zero-shot, vision-LLM route, complete prior-art Pokédex builds, and the artwork→photo domain-gap problem.
**Context:** COMPX374 Pokédex outreach kiosk (webcam + figurine/card → species ID + spoken Pokédex entry + recognition visualisation), live at Nerdfest late Oct 2026.
**Date researched:** 2026-07-29. Grading: [Verified] = primary source states it (URL cited). [Consensus] = multiple independent practitioners. [Thin] = single/untraceable source.

---

## Headline answers

1. **No public dataset of photos of physical Pokémon merchandise (figurines/plush) exists** on Kaggle, Hugging Face, or Roboflow Universe as far as multiple targeted searches could find — everything substantial is official art, game sprites, anime stills, and fan art. The only merch photos are *incidental* contamination inside web-scraped datasets. [Consensus — absence across all sources checked below]
2. **The exact project has been built at least twice**, and the best-documented builds that handle *physical toys* both use a **vision LLM (GPT-4V / Gemini), not a trained classifier**: Abe's Projects' ChatGPT Pokédex (Feb 2024) and `iraldir/pokedex` (Gemini, explicitly "toy, plush, card, figurine"). [Verified, below]
3. **The consistent practitioner finding:** artwork-trained recognition works well on screens/cards/accurate figurines and degrades on plush toys (exaggerated proportions); the standard mitigation for a kiosk is a **closed set**: photograph the actual event figurines and fine-tune / nearest-neighbour on those. [Consensus, §6]

---

## 1. Datasets

### Kaggle — the main image datasets

| Dataset | URL | Size / classes | Image type | Licence |
|---|---|---|---|---|
| Pokemon Image Dataset (vishalsubbiah) | https://www.kaggle.com/datasets/vishalsubbiah/pokemon-images-and-types | 809 images (one per species), Gen 1–7, + types CSV | Single art render per species | not confirmed |
| 7,000 Labeled Pokemon (lantian773030 / Lance Zhang) | https://www.kaggle.com/datasets/lantian773030/pokemonclassification | ~7,000 images, 150 Gen-1 classes, 25–50/class | Mixed web scrapes, hand-cropped, subject centred | not confirmed |
| Complete Pokemon Image Dataset (hlrhegemony) | https://www.kaggle.com/datasets/hlrhegemony/pokemon-image-dataset | 2,500+ images, Gen 1–8 (~898 species → ~2–3/class) | "all official art" | not confirmed |
| 1000 Pokemon Dataset (noodulz) | https://www.kaggle.com/datasets/noodulz/pokemon-dataset-1000 | 26,539 images, 1,000 classes, ~40/class, 128×128 PNG | Mixed art/sprites; "originally made for a Pokedex project in Flutter"; "data augmentation highly recommended" | not confirmed |
| 11,945 Pokemon from First Gen (unexpectedscepticism) | https://www.kaggle.com/datasets/unexpectedscepticism/11945-pokemon-from-first-gen | 11,945 JPGs, Gen 1, manually cropped, uniform aspect ratio | Mixed scrapes (built for the Poke-Pi-Dex project, §5) | not confirmed |
| Ultimate Pokémon Images & Updated Pokédex Dataset (shivanshcoding) | https://www.kaggle.com/datasets/shivanshcoding/1282-pokemon-139542-images-updated-pokedex-dataset | **139,542 images, 1,282 Pokémon, Gen I–IX** (updated Jan 2026) | not confirmed in detail | not confirmed |
| Pokemon Images, First Generation (mikoajkolman) | https://www.kaggle.com/datasets/mikoajkolman/pokemon-images-first-generation17000-files | ~17,000 files, Gen 1 | not confirmed | not confirmed |
| Dataset of 32000 Pokemon Images (divyanshusingh369) | https://www.kaggle.com/datasets/divyanshusingh369/complete-pokemon-library-32k-images-and-csv | ~32,000 images + CSV/JSON | not confirmed | not confirmed |
| Pokemon Images Dataset (kvpratama) | https://www.kaggle.com/datasets/kvpratama/pokemon-images-dataset | ~819 renders | art renders | not confirmed |

Claim grading for the table:
- vishalsubbiah = 809 images covering Gen 1–7 with primary/secondary types CSV: [Verified] — stated in Kaggle-derived search summary of the dataset page (https://www.kaggle.com/datasets/vishalsubbiah/pokemon-images-and-types). One image per species → useless alone for training, useful for UI/reference art.
- 7,000 Labeled Pokemon = "7,000 labeled and hand-cropped Pokemon images with 150 classes, each class 25–50 images with the pokemon in the center", owner Lance Zhang, images "imported from another dataset on Kaggle" then relabelled: [Verified] via dataset-page description surfaced in search (https://www.kaggle.com/datasets/lantian773030/pokemonclassification). This is the single most-used dataset in hobbyist Pokémon classifiers. [Consensus]
- hlrhegemony = "2,500+ clean labeled images, all official art, Generations 1 through 8": [Verified] via dataset-page description (https://www.kaggle.com/datasets/hlrhegemony/pokemon-image-dataset).
- noodulz = 26,539 images / 1,000 classes / ~40 per class / 128×128 PNG / ~407 MB: [Verified] via dataset-page description (https://www.kaggle.com/datasets/noodulz/pokemon-dataset-1000).
- unexpectedscepticism = 11,945 manually-cropped JPGs, published 2021-12-14: [Verified] via dataset-page description (https://www.kaggle.com/datasets/unexpectedscepticism/11945-pokemon-from-first-gen); it is the "New Dataset" linked from the Poke-Pi-Dex README (https://github.com/TryKatChup/Poke-Pi-Dex). [Verified]
- shivanshcoding = "130K+ Images of 1,000+ Pokémon (GEN I-IX)", last updated 2026-01-30: [Verified] via page title/snippet (https://www.kaggle.com/datasets/shivanshcoding/1282-pokemon-139542-images-updated-pokedex-dataset). Largest found; image-type mix unconfirmed. [Thin on composition]
- **Licence caveat (applies to ALL of these):** Kaggle licence fields could not be read directly (Kaggle pages are JS-rendered and would not fetch), and regardless of what the field says, the underlying images are Nintendo/Game Freak/Creatures IP — fine for a non-commercial university outreach demo, not redistributable as "your" dataset. Concretely: Hugging Face's most popular Pokémon dataset, `lambdalabs/pokemon-blip-captions`, **was removed by DMCA takedown** — visible in the HF datasets API listing (https://huggingface.co/api/datasets?search=pokemon). [Verified]

### Hugging Face datasets

- **keremberke/pokemon-classification** — https://huggingface.co/datasets/keremberke/pokemon-classification — Roboflow export (2022-12-20) of the **"Pokedex Dataset" by Lance Zhang** (same author as the Kaggle 7,000 set): "It includes 6991 images", 224×224 fit-with-black-edges, splits 4,869 / 1,390 / 732, licence "Public Domain", classes Abra→Zapdos incl. Alolan Sandslash. Card states 151 classes. [Verified]
- **fcakyon/pokemon-classification** — https://huggingface.co/datasets/fcakyon/pokemon-classification — same Roboflow source, same 6,991 images and identical splits; this card states **110 classes**. The 151-vs-110 discrepancy between the two cards is unresolved — check `names` list before using. [Verified both cards; discrepancy noted]
- **TheFusion21/PokemonCards** — https://huggingface.co/datasets/TheFusion21/PokemonCards — 13,139 rows; images are official TCG card **scans** hot-linked from https://images.pokemontcg.io/ ; fields id/image_url/caption/name/hp/set_name; licence cc-by-nc-4.0. Relevant to the card half of the project, not figurines. [Verified]
- **huggan/pokemon** (https://huggingface.co/datasets/huggan/pokemon, 1K–10K art images) and **huggan/few-shot-pokemon** — art images collected for GAN training. [Verified existence via API]
- **JJMack/pokemon-classification-gen1-9** — https://huggingface.co/datasets/JJMack/pokemon-classification-gen1-9 — images sourced from **Bulbapedia**, each augmented 5× (flips, rotation, colour jitter, gaussian blur, affine, perspective, grayscale); CC-BY-NC-SA-4.0. [Verified via the paired model card, §2]
- Also on Kaggle: Bulbapedia scrape https://www.kaggle.com/datasets/sevans7/pokemon-images-scraped-from-bulbapedia. [Verified existence]
- Canonical per-species reference art/sprites (for your UI and for prompt/reference images): **PokeAPI sprites** repo https://github.com/PokeAPI/sprites and PokeAPI itself (https://pokeapi.co) — used by nearly every prior-art build in §5. [Consensus]

### Do any datasets contain photos of physical merchandise?

- **No dedicated figurine/plush/toy-photo Pokémon dataset was found** on Kaggle, the HF datasets API (top ~60 results for "pokemon"), or Roboflow Universe (searches for pokemon + figure/figurine/plush/toy return generic toy-detection datasets and Pikachu-only detection sets, e.g. https://universe.roboflow.com/search?q=class:pikachu, https://universe.roboflow.com/search?q=class:toy). [Verified searches; graded Consensus-by-absence]
- Merch photos DO occur *incidentally* in web-scraped datasets: PyImageSearch's scraped 1,191-image dataset explicitly mixed "Still frames from the TV show and movies, Trading cards, Action figures, Toys and plushes, Drawings and artistic renderings from fans" (https://pyimagesearch.com/2018/04/16/keras-and-convolutional-neural-networks-cnns/). [Verified] The Lance Zhang 7,000 set is the same kind of scrape, so likely similar contamination. [Thin — composition not itemised on its page]
- **Implication:** any figurine-photo training/eval data for the kiosk will have to be **self-collected from the actual event figurines** (see §6). [Consensus]

---

## 2. Pretrained classifiers (Hugging Face)

Full listing obtained from https://huggingface.co/api/models?search=pokemon&pipeline_tag=image-classification (53 models returned; long tail is ViT-base fine-tunes of the same Roboflow/Kaggle data). The ones that matter:

- **skshmjn/Pokemon-classifier-gen9-1025** — https://huggingface.co/skshmjn/Pokemon-classifier-gen9-1025 — ViT (`google/vit-base-patch16-224-in21k` fine-tune), "trained to classify upto Gen9 (1025) Pokémon images", Apache-2.0, has a DOI; **no accuracy reported**, training data unspecified. 225 downloads. [Verified card]
- **JJMack/pokemon_gen1_9_classifier** — https://huggingface.co/JJMack/pokemon_gen1_9_classifier — ViT-base-in21k fine-tune, 1,025 classes, trained on **Bulbapedia art with 5× augmentation**; reported `eval_accuracy = 0.9221` (on a held-out split of the same augmented artwork — NOT on photos); CC-BY-NC-SA-4.0; 86.6M params. [Verified card]
- **imzynoxprince/pokemons-image-classifier-gen1-gen9** — https://huggingface.co/imzynoxprince/pokemons-image-classifier-gen1-gen9 — ViT-base, **1,027 classes** (Gen 1–9 + 2 Poketwo event variants), claims "95%+ on Pokemon classification", marketed "Perfect for Discord bots" (Poketwo spawns official artwork, so this is artwork-domain). 646 downloads. [Verified card; accuracy claim has no eval details → treat as Thin]
- **imjeffhi/pokemon_classifier** — https://huggingface.co/imjeffhi/pokemon_classifier — ViT fine-tune, most-liked (16 likes) but the card is sparse: no class count, no accuracy; details deferred to a Medium article. [Verified card is sparse]
- **keremberke/yolov8n/s/m-pokemon-classification** — e.g. https://huggingface.co/keremberke/yolov8m-pokemon-classification — YOLOv8 classification heads trained on the 6,991-image Roboflow dataset (§1); usable via `ultralyticsplus`; per-model top-1 in their model-index (not fetched here). ~650–950 downloads each. [Verified existence + training set]
- **dima806/pokemons_1000_types_image_detection** — https://huggingface.co/dima806/pokemons_1000_types_image_detection — ViT-base, ~1,000 classes; dima806 models usually ship a Kaggle notebook with per-class metrics. [Verified existence; details Thin]
- **merve/pokemon-classifier** — https://huggingface.co/merve/pokemon-classifier — ViT fine-tune on the `pokemon-classification` dataset (HF staff demo). [Verified existence]
- Demo Spaces (all Gradio): `Manimaran/pokemon-classifier` (4 likes), `unlisboa/pokemon-image-classifier`, `echometerain/whos-that-pokemon`, `abdellatif/pokemon-detector`, etc. — from https://huggingface.co/api/spaces?search=pokemon. [Verified listing]

**Assessment:** every model card inspected trains and evaluates on **artwork/sprites**; none reports accuracy on photos of physical objects. [Verified for the cards inspected; Consensus for the pattern] The 1,025-class ViTs are the right starting checkpoints if you fine-tune on your own figurine photos; used as-is on webcam frames of toys they are unproven.

---

## 3. CLIP / SigLIP zero-shot

- **No rigorous public benchmark of CLIP zero-shot Pokémon species ID was found** despite multiple targeted searches. This is a genuine gap — plan to measure it yourselves in week 1. [Verified absence across searches]
- Closest data points, all weak:
  - Jeremy K's CLIP series (Medium) uses a Pokémon image and the prompt "a pokemon", reporting cosine similarity 0.642 — i.e. CLIP easily recognises *that something is a Pokémon* (category level), but this says nothing about 1,000-way species ID. https://medium.com/@jeremy-k/unlocking-openai-clip-part-1-intro-to-zero-shot-classification-f81194f4dff7 [Thin]
  - arXiv 2405.07284 ("Zero Shot Context-Based Object Segmentation using SLIP (SAM+CLIP)") **fine-tunes CLIP on a Pokémon dataset** to get useful image-text representations for Pokémon prompts — the authors' need to fine-tune is indirect evidence that off-the-shelf CLIP was insufficient for their Pokémon task; the abstract gives no pretrained-vs-fine-tuned numbers. https://arxiv.org/abs/2405.07284 [Thin]
  - "Building CLIP from Scratch to Classify Pokemons" (Naren Dasan, Correll Lab, Oct 2024) — trains a CLIP-style model *from scratch* on Pokémon rather than testing zero-shot. https://medium.com/correll-lab/building-clip-from-scratch-to-classify-pokemons-18f7e2878bf0 [Verified existence]
  - Roboflow's CLIP tutorial documents extreme **prompt sensitivity** in zero-shot classification (46% → 97% on a flowers dataset purely from re-wording class captions) — directly relevant if you try "a photo of {name}, a pokemon" style prompts. https://blog.roboflow.com/how-to-use-openai-clip/ and https://github.com/roboflow/notebooks/blob/main/notebooks/how-to-use-openai-clip-classification.ipynb [Verified]
- **Inference (ours, not a sourced claim):** CLIP's 400M web pairs contain heavy Pokémon co-occurrence, so zero-shot will likely nail the famous ~100 (Pikachu, Charizard, Eevee…) even as toys, and confuse within evolution lines and the long tail. The practical CLIP route for the kiosk is not 1,025-way prompting but **embedding nearest-neighbour against your own reference photos of the event figurines** — zero training, works with any gallery size, and the similarity scores double as your "how the AI saw it" visualisation.

---

## 4. Vision-LLM route (GPT-4V / Claude / Gemini)

Two complete builds prove this route works on physical objects, with well-documented caveats:

- **Abe's Projects ChatGPT Pokédex (Abraham Haskin, ex-Google, Feb 2024)** — 3D-printed Pokédex, camera, Wi-Fi, GPT-4(V) + PokéAPI, voice cloned via Play HT free tier.
  - Coverage: Decrypt https://decrypt.co/217240/real-world-pokedex-id-pokemon-thanks-chatgpt, Gizmodo https://gizmodo.com/youtuber-chatgpt-homemade-pokedex-ai-pokemon-1851242086, PCWorld https://www.pcworld.com/article/2231086/this-guy-built-a-real-pokemon-pokedex-powered-by-chatgpt.html, Yanko Design https://www.yankodesign.com/2024/02/13/actual-working-pokedex-uses-chatgpt-to-identify-pokemon-and-you-can-build-one-too/, Dexerto https://www.dexerto.com/tech/youtuber-builds-worlds-first-working-pokedex-powered-by-chatgpt-2523687/ (video on the Abe's Projects YouTube channel).
  - Performance, consistent across outlets: "worked absolutely flawlessly when pointed at images, or an accurate 3D figurine or toy. It didn't however, fare too well with plushes, which can sometimes have exaggerated proportions." [Consensus]
  - Reliability: Haskin called it "flaky", noting "each prompt to ChatGPT is an independent event" — he considered querying twice for verification. "There is a gooeyness to these LLMs; they don't have that rigidity you're used to when working with computer systems." [Verified quotes via Decrypt]
  - Cost: "the Pokémon project only costs pennies when it comes to the AI implementation". [Verified via Decrypt]
- **iraldir/pokedex (Gemini)** — https://github.com/iraldir/pokedex — Raspberry Pi Zero 2 W handheld: 2" ST7789V LCD, Pi Camera, MAX98357 I2S amp, button trigger, optional PiSugar battery; **Google Gemini** for recognition, **ElevenLabs** TTS (EN/FR/IT), **PokeAPI** for sprites/entries; MIT licence. README: "Point your camera at any Pokemon (toy, plush, card, figurine) → Press the button → Watch the magic happen." Latency: Gemini takes **2–5 seconds per request** ("slow identification is normal"). Author flags it as a quickly-built "vibe coded" project. [Verified README]
- Commercial evidence the task is LLM-easy: imageidentifier.ai runs a "What Pokemon is this" identifier analysing "body type, colors, markings, and distinctive features". https://imageidentifier.ai/what-pokemon-is-this [Thin]

**Kiosk constraints (the obvious ones, all evidenced above):** hard internet dependency at a public venue, 2–5 s+ round-trip latency, per-call cost (small but nonzero), rate limits under continuous crowd use, and non-deterministic output requiring name-normalisation against the canonical species list. Mitigations seen in the wild: ask-twice/majority vote (Haskin), constrain the model to output only a name from the Pokédex list, and cache by image similarity. [Consensus]

---

## 5. Complete prior-art builds ("real working Pokédex")

Ranked by relevance to your exact spec (webcam + physical object → species + spoken entry):

1. **iraldir/pokedex** — §4. Exact feature match: toys/plush/cards/figurines, official sprite display, TTS Pokédex entry. Stack: RPi Zero 2 W, Python 3 (picamera2, pygame, PIL), Gemini, ElevenLabs, PokeAPI, systemd autostart. [Verified: https://github.com/iraldir/pokedex]
2. **Abe's Projects ChatGPT Pokédex** — §4. Exact concept match incl. anime-style voice; best documented real-world accuracy anecdotes (figurines good, plush bad). [Consensus across 5+ outlets]
3. **TryKatChup/Poke-Pi-Dex** — https://github.com/TryKatChup/Poke-Pi-Dex — University of Bologna project: RPi 4, PiCamera, LCD, speaker, joystick+buttons, recycled-cardboard case. Custom small CNN (**3 conv + 2 FC layers**) over Gen-1; trained first on Kaggle `thedagger/pokemon-generation-one`, then on the purpose-built **11,945-image** first-gen dataset (§1); "data augmentation (random flip, rotation, contrast, brightness)"; Pokémon cries + pre-generated description audio (texttospeechrobot.com). Claims recognition of "cards, plushies, figures"; README says "excellent accuracy" but gives **no numbers**; roadmap included "insert one or more white LEDs near the camera lens" → lighting was a pain point. Repo archived. [Verified README; accuracy claim Thin]
4. **PyImageSearch Pokédex (Adrian Rosebrock, 2018)** — the canonical tutorial series:
   - Keras CNN ("SmallerVGGNet"): 1,191 images / 5 classes (Bulbasaur 234, Charmander 238, Squirtle 223, Pikachu 234, Mewtwo 239) scraped via Bing Image Search API; ~98.3% train / **82% test** accuracy in the CNN post; the RPi deployment post quotes 96.84%/97.07%. https://pyimagesearch.com/2018/04/16/keras-and-convolutional-neural-networks-cnns/ [Verified]
   - Deployed on **Raspberry Pi 3 + camera + 7" touchscreen**; demonstrated live on a **3D-printed Bulbasaur and real figurines**; ~20–30 s model init on the Pi. https://pyimagesearch.com/2018/04/30/a-fun-hands-on-deep-learning-project-for-beginners-students-and-hobbyists/ [Verified]
   - Also picked up by Adafruit: https://blog.adafruit.com/2018/05/04/creating-a-real-life-pokemon-pokedex-using-python-deeplearning-a-raspberry-pi-camera-module-and-7-touch-screen-raspberry_pi-piday-raspberrypi/ [Verified]
5. **BigRig Creates dual-screen Pokédex** — RPi + ESP32; **no ML model at all** — captures image → **Google reverse image search** → takes the most frequent Pokémon name in results. "the most reliable way to determine a Pokémon is to grab the image, send it through a Google reverse image search, identify the Pokémon name that appears the most in the results, and run with that." Works on **plushes and in-game sprites**; TV-style AI voice; no public build files. https://www.xda-developers.com/someone-built-fully-functional-pokedex/ (also Hackster: https://www.hackster.io/news/gotta-catch-em-all-c081e4efb43b) [Verified via XDA]
6. **brettdavidshelley/Pokedex** — https://github.com/brettdavidshelley/Pokedex — RPi 4B; **YOLOv11n → ONNX**, ~150 Gen-1 classes, 200 epochs @640px (~12.2 h on RTX 3070); TTS via **pyttsx3**, which "produced low-quality and sometimes unintelligible speech on Raspberry Pi"; Arducam IMX708 wouldn't open through `cv2.VideoCapture()` (libcamera gap) forcing shell-capture workarounds with added latency. Honest, current (YOLOv11-era) lessons list. [Verified README]
7. **Sam Makes real-world Pokédex** — RPi 4B + cheap camera + **SSD MobileNetV3 via OpenCV**, 3D-printed shell, 27-day build; recognises *real-world objects* (not Pokémon) and reads Pokémon-themed joke descriptions via TTS; "It's not perfect, but I'd say this is pretty freaking awesome for making it in 27 days." Source on GitHub via his channel. https://pmdway.com/blogs/news/real-world-pokemon-pokedex-uses-opencv-and-a-raspberry-pi-to-identify-objects (orig. Hackster: https://www.hackster.io/news/real-world-pokemon-pokedex-uses-opencv-and-a-raspberry-pi-to-identify-objects-45a1e8b746e0) [Verified]
8. **Image Classifying Pokédex (Devpost hackathon)** — web app: **Google Cloud AutoML Vision** trained on **10,000+ images of all 151** Kanto species → **92% accuracy**; Cloud TTS for readout; HTML/JS/Tailwind/ChartJS + PokéAPI. Biggest stated challenge: gathering/importing the 10k images within hackathon time. https://devpost.com/software/image-classifying-pokedex (writeup: https://dev.to/lo_victoria2666/my-new-year-hackathon-project-image-classification-pokedex-4b54) [Verified]
9. Frameworks/minor: **bastien8060/PokePiOS** "Flexible Pokedex Framework for Raspberry Pi… uses machine learning to recognize Pokémon" (https://github.com/bastien8060/PokePiOS); **thiventura/PokedexWithImageProcessing** "Pokedex with image classification and audio description" (https://github.com/thiventura/PokedexWithImageProcessing); LOGiCFACE tutorial https://logicface.co.uk/create-your-own-working-pokedex/. [Verified existence only]

**Recurring lessons across builds** [Consensus]: (a) plush toys are the hardest input class; (b) lighting at the camera matters enough that builders retrofit LEDs; (c) on-Pi TTS (pyttsx3/espeak) sounds bad — every polished build uses cloud TTS (ElevenLabs, Play HT, Google Cloud TTS) or pre-generated audio; (d) camera/driver integration (libcamera vs OpenCV) eats surprising amounts of time; (e) LLM-based ID is the accuracy shortcut but brings latency/flakiness; classifier-based ID is instant but domain-limited.

---

## 6. The domain-gap problem (artwork-trained → photos of toys)

What practitioners actually report:

- **Shortcut learning on small scraped art datasets:** PyImageSearch's 5-class CNN keyed on colour — "Lots of red and oranges in an image will likely return 'Charmander'… lots of yellows… 'Pikachu'" — and Rosebrock's stated floor is "at least 500-1,000 images per class" for a CNN. His real-object demo worked *because* his scraped training data already contained action figures and plushes (quoted in §1). https://pyimagesearch.com/2018/04/16/keras-and-convolutional-neural-networks-cnns/ [Verified]
- **Even GPT-4V shows the gap in miniature:** flawless on screen images and accurate figurines, poor on plushes with exaggerated proportions (§4, Abe's Projects). [Consensus]
- **One builder abandoned trained models entirely** for Google reverse image search because it was more reliable on plushes (§5, BigRig Creates). [Verified]
- **Poke-Pi-Dex responded to weak generalisation by building a bigger, manually-cropped 11,945-image dataset** and adding augmentation (flip/rotation/contrast/brightness), plus planned camera LEDs — i.e. more diverse data + controlled lighting, not architecture changes. https://github.com/TryKatChup/Poke-Pi-Dex [Verified]
- **Augmentation recipe in the wild for artwork→robustness:** JJMack's 1,025-class ViT augments Bulbapedia art 5× with horizontal/vertical flips, rotation, colour jitter, gaussian blur, affine, perspective distortion, grayscale (https://huggingface.co/JJMack/pokemon_gen1_9_classifier). Note its 92.2% eval is still measured on augmented *art*, not photos. [Verified]
- No formal study of artwork→figurine-photo transfer for Pokémon specifically was found; the nearest analogue in the literature is general synthetic-to-real / cartoon-to-photo domain adaptation. [Verified absence; general DA literature not surveyed here]

**Standard mitigations (synthesised from the above + standard practice)** [Consensus for 1–3; 4–5 are our inference]:
1. **Close the set:** the kiosk only ever sees the N figurines/cards you bring. Photograph each event figurine from ~20–50 angles/backgrounds/lightings on the actual webcam, and fine-tune (or build a retrieval index) on *those*. This converts an open 1,025-class artwork-vs-photo problem into a small closed-set photo-vs-photo problem — the single highest-leverage decision available.
2. **Control capture conditions:** fixed stand/backdrop + ring light (Poke-Pi-Dex's LED lesson); consistent distance so the toy fills the frame (Lance Zhang's dataset is deliberately centred/cropped for the same reason).
3. **Heavy augmentation** when training on art or few photos: the JJMack recipe above, plus background randomisation/segmentation (cut the toy out with rembg/SAM before classifying).
4. **Hybrid architecture for the event:** local CLIP/SigLIP embedding + nearest-neighbour over your figurine reference photos as the instant, offline path; vision-LLM (Gemini/GPT-4V/Claude) as a fallback/verifier when confidence is low. Both prior-art LLM builds and both classifier builds' weaknesses point at this split.
5. **Test on plush early** — it is the consistently-reported worst case; if your event set includes plush, they need the most reference photos.

---

## Source index (primary)

- Kaggle: https://www.kaggle.com/datasets/vishalsubbiah/pokemon-images-and-types · https://www.kaggle.com/datasets/lantian773030/pokemonclassification · https://www.kaggle.com/datasets/hlrhegemony/pokemon-image-dataset · https://www.kaggle.com/datasets/noodulz/pokemon-dataset-1000 · https://www.kaggle.com/datasets/unexpectedscepticism/11945-pokemon-from-first-gen · https://www.kaggle.com/datasets/shivanshcoding/1282-pokemon-139542-images-updated-pokedex-dataset · https://www.kaggle.com/datasets/mikoajkolman/pokemon-images-first-generation17000-files
- Hugging Face: https://huggingface.co/api/models?search=pokemon&pipeline_tag=image-classification · https://huggingface.co/api/datasets?search=pokemon · https://huggingface.co/datasets/keremberke/pokemon-classification · https://huggingface.co/datasets/fcakyon/pokemon-classification · https://huggingface.co/datasets/TheFusion21/PokemonCards · https://huggingface.co/skshmjn/Pokemon-classifier-gen9-1025 · https://huggingface.co/JJMack/pokemon_gen1_9_classifier · https://huggingface.co/imzynoxprince/pokemons-image-classifier-gen1-gen9 · https://huggingface.co/imjeffhi/pokemon_classifier
- GitHub prior art: https://github.com/iraldir/pokedex · https://github.com/TryKatChup/Poke-Pi-Dex · https://github.com/brettdavidshelley/Pokedex · https://github.com/bastien8060/PokePiOS · https://github.com/thiventura/PokedexWithImageProcessing · https://github.com/PokeAPI/sprites
- PyImageSearch: https://pyimagesearch.com/2018/04/16/keras-and-convolutional-neural-networks-cnns/ · https://pyimagesearch.com/2018/04/30/a-fun-hands-on-deep-learning-project-for-beginners-students-and-hobbyists/
- Press on Abe's Projects: https://decrypt.co/217240/real-world-pokedex-id-pokemon-thanks-chatgpt · https://gizmodo.com/youtuber-chatgpt-homemade-pokedex-ai-pokemon-1851242086 · https://www.pcworld.com/article/2231086/this-guy-built-a-real-pokemon-pokedex-powered-by-chatgpt.html · https://www.yankodesign.com/2024/02/13/actual-working-pokedex-uses-chatgpt-to-identify-pokemon-and-you-can-build-one-too/
- Other builds/press: https://www.xda-developers.com/someone-built-fully-functional-pokedex/ · https://pmdway.com/blogs/news/real-world-pokemon-pokedex-uses-opencv-and-a-raspberry-pi-to-identify-objects · https://devpost.com/software/image-classifying-pokedex · https://dev.to/lo_victoria2666/my-new-year-hackathon-project-image-classification-pokedex-4b54
- CLIP: https://blog.roboflow.com/how-to-use-openai-clip/ · https://medium.com/@jeremy-k/unlocking-openai-clip-part-1-intro-to-zero-shot-classification-f81194f4dff7 · https://arxiv.org/abs/2405.07284 · https://medium.com/correll-lab/building-clip-from-scratch-to-classify-pokemons-18f7e2878bf0
