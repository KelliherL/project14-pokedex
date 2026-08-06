# Figurine data sources and generalization — adversarial check

> Researched 2026-08-06 after the technical lead formally challenged the
> closed-set plan ("there must be an existing dataset or a stronger
> generalised attempt"). This spike's brief was to **refute** three claims
> from the earlier research, not defend them. Claims tagged [Verified] /
> [Reported] / [Inference]. Companions:
> [figurine frontier check](2026-08-06-figurine-recognition-frontier.md) ·
> [approach synthesis](2026-08-06-approach-synthesis.md) (addendum reflects
> this note's outcome).

> **Verdict up top.** After an exhaustive hostile sweep (Kaggle,
> HuggingFace, Roboflow Universe, Zenodo, IEEE DataPort, GitHub, arXiv, app
> stores, LEGO/Funko/sneaker analogues, 2020–2026), **claim 1 survives**:
> no public photo dataset of physical Pokémon figurines/plush exists
> anywhere we could find — every "Pokémon image dataset" is artwork,
> sprites, anime frames, or cards. **Claim 2 survives as stated but was
> being over-applied**: artwork-trained models do fail on toys, but
> *game-model renders* are a different and much closer domain than artwork,
> and DINOv2 render→real template matching is proven technology (CNOS/ZS6D,
> BOP) — the claim cannot be used to dismiss the synthetic-render route.
> **Claim 3 survives with a dent**: no offline, laptop-CPU, ≥90%
> arbitrary-merch system exists or is credibly promised by anything found;
> cloud tools (Google Lens, Nyckel, raugen, ChatGPT-powered Pokédex builds)
> remain the only working generalized identifiers, and measured VLM
> fine-grained benchmarks (FOCI) show vision-LLMs *underperform* CLIP-style
> retrieval on exactly this task shape. The strongest refutation attempt
> overall was **Brickognize** (LEGO: synthetic renders + ~20 real
> photos/class → 91.3% AP50 uncontrolled), which suggests the team's
> per-figurine capture could plausibly be *shrunk* (not eliminated) — but
> no one anywhere has measured render→real transfer on Pokémon figurines,
> so the current plan's self-capture remains the only evidence-backed path
> to ≥90%.

## Datasets found

| Name | Size | Content type | License | Usable for |
|---|---|---|---|---|
| Kaggle/HF Pokémon image sets (kvpratama, djilax, huggan/pokemon, rajatvisitme v2, keremberke/fcakyon classification) [Verified] | 819–9,002 imgs | Official artwork / sprites, white or transparent bg — **zero toy photos** | mixed, mostly permissive | Neither reference nor training data; wrong domain |
| Roboflow Universe Pokémon sets (DeepLearningAI 1,387; Irfan Virani 8.3k/922 classes; misc detection sets) [Verified] | 100–8.3k imgs | Anime frames, artwork, cards | CC BY 4.0 | Species artwork prior only; not toy photos |
| Zenodo / IEEE DataPort "Pokémon" hits [Verified] | n/a | Stats tables, TCG metadata, point-cloud registration sets | open | Neither |
| Nyckel `pokemon-plush` pretrained classifier [Verified it exists; content Reported] | 39 labels | Curated plush images behind API — **not downloadable** | proprietary, cloud | Neither (no data access, no accuracy published) |
| Nyckel `funko-pop-figure` / `funko-pop-line` [Verified] | 31 labels | Same pattern | proprietary | Analogue evidence only |
| ToyImageClassificationDataset (CVxTz, GitHub) [Verified] | small | Generic toy photos w/ Labelme annotations | open | Marginal; no Pokémon |
| Toys4K [Verified] | 4,179 assets, 105 cats | **3D assets** of toys (incl. dragon-like creatures) | CC / royalty-free | Render-source near-miss; no Pokémon |
| Google Scanned Objects [Verified] | ~1,030 scans | Real-scanned household products incl. toys | CC-BY 4.0 | Render pipeline validation only |
| OmniObject3D [Verified] | 6,000 scans, 190 cats (toy bus/car/truck/train…) | Real-scanned objects + multi-view renders + real videos | research use | Sim-to-real methodology validation; no Pokémon |
| CO3D (Meta) [Reported] | ~19k videos, 50 cats incl. teddybear/toy* | Real turntable-style videos of toys | CC BY-NC | Proves turntable-video capture is the standard way real toy data gets made |
| ABO (Amazon Berkeley Objects) [Reported] | 147k products, 398k catalog imgs | Product listing photos + 3D models | CC BY-NC | Marketplace-route methodology precedent |
| eBay **eProduct** [Verified] | 2.5M imgs, 1.3M train listings | Real marketplace listing photos, fine-grained | research benchmark | Proves SKU-level visual search from listing photos works at scale |
| Products-10K (JD.com) [Verified] | 10k SKUs | Human-labeled product photos | research | Same |
| LEGO: B200C (Kaggle) [Verified] | 800k renders / 200 parts | **Synthetic renders** | open | Render-route precedent |
| LEGO: Gdańsk Tech (MostWiedzy) [Verified] | 52k real photos + 567k renders / 447 parts | Mixed real+synthetic | open data | The only public mixed real/render toy-part corpus found |

**Bottom line:** the direct refutation failed. Nothing containing photos of
physical Pokémon merchandise is publicly downloadable. The July/August 2026
"no dataset exists" finding held up under a wider net (Zenodo, IEEE
DataPort, GitHub, HF API dump of all `pokemon` datasets) than the original
check used.

## The synthetic-render route (evidence + coverage + IP note)

**Coverage — first-party counts pulled from The Models Resource pages
[Verified]:**

- Pokémon X/Y (3DS): **732 model entries** — effectively all Gen 1–6
  species (721) plus forms
- Pokémon Sun/Moon (3DS): 238 entries (Gen 7 + forms)
- Pokémon Sword/Shield: 169 entries; Scarlet/Violet: **470 entries**
  (Gen 8–9, growing)
- Pokémon HOME (mobile): 108 entries (high-poly, includes Megas/regionals)

Union coverage is plausibly **~900–1,000 of 1,025 species** in rigged,
textured, rip-quality form, before counting DeviantArt MMD packs, Sketchfab
rips, and 3D-print archives (Meshy alone indexes 425+ free Pokémon models)
[Verified counts; union estimate is Inference]. Coverage is *not* the
bottleneck.

**Render→real transfer evidence:**

- **Brickognize (Sensors 2023) [Verified]** — the anchor precedent.
  Photo-realistic synthetic renders of LEGO parts + few-shot fine-tuning
  with **~20 real photos per class** reached **AP50 91.33% uncontrolled /
  98.7% controlled**. Key caveat not to skip: that is *detection AP50 on
  rigid CAD-exact objects*, not instance recognition of hand-painted
  stylized sculpts.
- **CNOS (ICCV 2023 workshop) [Verified]** — segments/identifies *novel*
  objects by matching DINOv2 CLS tokens of real-image proposals against
  **42 Blender-rendered viewpoints** of a CAD model; authors explicitly
  chose DINOv2 for "its ability to effectively address the domain gap
  between real and synthetic images"; SOTA on all 7 BOP datasets (+19.8 AP
  over prior). **ZS6D** extends the same DINOv2-template trick to 6D pose.
  This is direct, measured evidence that our exact embedding model (frozen
  DINOv2) matches renders to real photos well.
- BlenderProc/domain-randomization literature [Verified]: photorealistic
  PBR renders reduce the sim-to-real gap; a 1:1 synthetic+real mix beat
  real-only in recent applied work.
- **Measured Pokémon render→real attempt: none found anywhere.** [Verified
  absence across GitHub/arXiv/web]

**The honest gap:** a figurine is a *stylized re-sculpt* (proportions,
paint, gloss, seams) of the game model, not the model itself — closer than
artwork, but not CAD-exact like LEGO. CNOS/Brickognize bound the technique
from the optimistic side; nothing bounds it from the pessimistic side. ≥90%
from renders alone is **unproven speculation**; renders + ~20 real
photos/figurine is a Brickognize-shaped bet, not a guarantee. [Inference]

**IP note [Inference, grounded in verified facts]:** every usable model is
a ripped Nintendo/Game Freak/Creatures asset. The Models Resource hosts
them as unlicensed fan rips. Internal use as training/reference data for a
non-commercial university exhibit is low-enforcement-risk but unambiguously
unlicensed; the resulting *dataset could never be published or
redistributed*, and Nintendo is famously litigious about public-facing fan
uses. The LEGO precedent doesn't transfer legally (LDraw CAD models are
community-made, not ripped). Add to the client IP sign-off list.

## The marketplace-photo route

- **Prior art exists and is strong as a genre**: eBay's eProduct benchmark
  (2.5M listing images, built *by eBay* specifically because product
  recognition is "super fine-grained" visual search) and Products-10K prove
  SKU-level recognition from listing photos is an established, working
  paradigm [Verified]. Sneaker apps (Sneakerr: 7,000+ SKUs from photo;
  GOAT's image-database verification) and Funko/toy value scanners are
  commercial embodiments — though several lean on **box/barcode**, not the
  bare figure [Verified].
- **Pokémon figurine SKUs are identifiable**: official lines (Takara Tomy
  Moncolle with MS-numbering, Jazwares, Select, Funko, Pokémon Center
  plush) are finite, catalogued SKUs with many listing photos of the same
  sculpt on eBay/Mercari/Amazon [Verified by inspection of listings].
- **ToS reality [Verified]**: eBay's ToS prohibits scraping without
  permission; official APIs are the sanctioned path but their license terms
  do not cleanly permit harvesting image sets for model training; Amazon is
  stricter. A university team quietly downloading a few hundred images for
  internal reference data is common practice and low risk, but it is not
  clean, and cannot be redistributed.
- **Quality reality [Inference]**: listing photos mix bootlegs, repaints,
  multi-figure lots, different releases of the same species, watermarks,
  and boxed shots. Curating ~20 clean photos per exact SKU the team owns is
  real work — plausibly *more* work per figurine than 10 minutes at a
  turntable, with a worse camera/domain match.
- **Prior art using marketplace photos as reference data for collectible
  recognition specifically**: Ximilar's commercial collectibles API (cards,
  comics, coins — notably *not* figures) and the sneaker apps are the
  closest; no figurine-specific published attempt found [Verified absence].

## Generalized attempts and their measured reality

| Attempt | What it is | Measured reality |
|---|---|---|
| Google Lens / raugen "AI Pokemon Identifier" [Verified] | Cloud; raugen explicitly claims figurine/plush photos work | No published accuracy; cloud-only; credit-metered |
| Mr. Volt + BigRig Creates real-life Pokédex (2026) [Reported] | RPi CM4 handheld, camera → identification; Tom's Hardware reports it uses ChatGPT (cloud) | "Real time" per Hackster write-up; no accuracy numbers; supports, not refutes, the "cloud VLM" characterization |
| Nyckel pokemon-plush / funko-pop classifiers [Verified] | Trained cloud classifiers (39 / 31 labels) — *not* vision-LLMs | No accuracy published; proves someone assembled a small private plush photo set; **slightly falsifies "only done with cloud vision-LLMs"** — it's been done with a cloud *classifier* too |
| BrickScan/BrickMonkey (16,000 minifigs), brick'em [Verified claims, Reported accuracy] | Commercial minifig identifiers | brick'em self-reports ~94% on well-lit standard minifigs; training data undisclosed (Bricklink-style catalog imagery likely) |
| PyImageSearch 5-class Pokédex (2018) [Verified] | CNN, 1,191 *web-scraped* images per 5 species — training set explicitly **included toy/plush/figure photos** | 82.9% val; correct high-confidence IDs of real plush/figures on webcam incl. a 3D-printed Bulbasaur; author documents a dominant-color shortcut. **Does not refute artwork→toy shift** (training set wasn't artwork-only), but does refute "reference photos must be self-captured on the event camera" |
| FOCI benchmark (EMNLP 2024) [Verified] | 12 LVLMs on fine-grained object classification | **LVLMs underperform the CLIP encoders they're built on** at fine-grained distinction — the strongest measured evidence that vision-LLMs are the wrong tool for this task shape |
| CLIP zero-shot on toys [Verified absence] | — | No published Pokémon-toy numbers; OpenAI's own docs note zero-shot CLIP struggles on fine-grained categories |

No app, paper, or repo anywhere demonstrates measured ≥90% recognition of
arbitrary physical Pokémon merchandise — cloud or offline.

## Verdict against the three challenged claims

1. **"No public Pokémon figurine photo dataset exists" — SURVIVES
   [Verified].** Strongest refutation attempt: Nyckel's pokemon-plush
   classifier proves a curated plush image set exists — but it is 39
   labels, API-locked, non-downloadable, accuracy-unpublished. Everything
   downloadable is artwork/sprites/cards. The original claim actually
   understated its own strength: it also holds on Zenodo, IEEE DataPort,
   and GitHub.
2. **"Artwork→physical-toy rendition shift breaks artwork-trained models" —
   SURVIVES, but its implied corollary FALLS.** The claim is consistent
   with everything found (and with the fine-grained/rendition-shift
   literature). But it was implicitly used to conclude "therefore only
   self-captured photos work." That's refuted in two ways: (a) web-scraped
   mixed sets containing merch photos worked in 2018 on 5 classes; (b)
   *renders of the very game models the sculpts are based on* are a domain
   artwork is not, and DINOv2 render→real matching is measured, published,
   SOTA technology (CNOS/ZS6D/Brickognize). [Verified components; corollary
   refutation is Inference]
3. **"Generalized any-merch recognition only exists as slow, flaky cloud
   vision-LLMs" — LARGELY SURVIVES.** Minor correction: cloud *classifiers*
   (Nyckel) and cloud *retrieval* (Lens) also exist, so "only vision-LLMs"
   is wrong on the letter. On the substance — nothing offline, nothing
   laptop-CPU, nothing measured ≥90%, and FOCI gives measured grounds to
   expect vision-LLMs to stay flaky at fine-grained ID — the claim stands.

**Direct answers:** (a) Nothing found *eliminates* per-figurine capture;
Brickognize credibly suggests it could shrink to renders + ~20 real frames
per figurine, and DINOv2-kNN reference sets likely saturate well below
150–300 frames — worth one afternoon of measurement, not a plan change on
faith. (b) **No** — nothing credibly enables ≥90% on arbitrary Pokémon
merchandise offline on CPU; no such system exists even in cloud form with
published numbers. (c) Strongest generalized architecture the evidence
supports: keep the closed-set instance kNN as tier 1, add a CNOS-style
**open-set species fallback** — ~40 Blender render templates per species
from ripped HOME/X-Y models (~900+ species coverage), same frozen DINOv2,
same cosine kNN, zero extra runtime dependencies. Honest promise for that
tier: "best-effort species guess with confidence gating" — top-1 accuracy
on arbitrary figurines is unmeasured anywhere and should be promised as an
experiment, not a number; anything ≥90% may only be promised for the
curated, self-captured set. [Inference]

## What this changes in the plan (concretely)

1. **Keep the turntable capture for the event set** — it remains the only
   evidence-backed path to the ≥90% demo bar. Budget stands.
2. **Run a 1-day frame-count ablation**: measure kNN accuracy at
   10/25/50/150 reference frames per figurine. If 25 frames ≈ 150 frames
   (likely for frozen-embedding kNN), capture drops from ~10 min to ~2 min
   per figurine. This is the cheapest real saving found.
3. **Add the render-based species fallback as a stretch tier**: rip models
   for the species in the event set + popular species, render 42 icosphere
   viewpoints in Blender (CNOS recipe), pin them in the same index with a
   lower trust weight. Ship it only behind confidence gating. Do not
   publish the render dataset (IP).
4. **Run the missing experiment nobody has run**: renders-only vs
   renders+20-real-frames vs 150-real-frames on 5 figurines. If renders+20
   lands near the full-capture number, the team owns the first measured
   Pokémon sim-to-real datapoint — publishable (methods, not the dataset).
5. **Drop any consideration of marketplace scraping** for the curated set:
   ToS-dirty, curation-heavy, worse domain match than 10 minutes of
   turntable. Revisit only if the figurine count grows past ~100 SKUs.
6. **Stop benchmarking against vision-LLMs** as the "generalized"
   alternative: FOCI gives measured grounds that CLIP/DINO-style retrieval
   beats LVLMs at fine-grained ID; the exhibit's offline constraint makes
   the comparison moot anyway.

## Sources

- Brickognize — Vidal et al., *Sensors* 2023: https://www.mdpi.com/1424-8220/23/4/1898
- CNOS (DINOv2 render-template matching, BOP SOTA): https://openaccess.thecvf.com/content/ICCV2023W/R6D/papers/Nguyen_CNOS_A_Strong_Baseline_for_CAD-Based_Novel_Object_Segmentation_ICCVW_2023_paper.pdf · https://github.com/nv-nguyen/cnos
- ZS6D (zero-shot 6D pose via DINOv2 templates): https://arxiv.org/abs/2309.11986
- FOCI — "African or European Swallow?" EMNLP 2024: https://aclanthology.org/2024.emnlp-main.154/ · https://github.com/gregor-ge/FOCI-Benchmark
- eBay eProduct benchmark: https://arxiv.org/pdf/2107.05856 · Products-10K: https://arxiv.org/pdf/2008.10545
- The Models Resource — Pokémon X/Y (732), Scarlet/Violet (470), Sun/Moon (238), Sword/Shield (169), HOME (108): https://models.spriters-resource.com/3ds/pokemonxy/ etc. (counts extracted from page HTML, 2026-08-06)
- Pokémon Model Ripping Project (VG Resource): https://archive.vg-resource.com/thread-25872.html
- Nyckel pokemon-plush classifier: https://www.nyckel.com/pretrained-classifiers/pokemon-plush/ · funko-pop: https://www.nyckel.com/pretrained-classifiers/funko-pop-figure/
- PyImageSearch Keras Pokédex (plush/figure tests): https://pyimagesearch.com/2018/04/16/keras-and-convolutional-neural-networks-cnns/ · real-time follow-up: https://pyimagesearch.com/2018/04/30/a-fun-hands-on-deep-learning-project-for-beginners-students-and-hobbyists/
- awesome-lego-machine-learning (B200C 800k renders; Gdańsk 52k real + 567k renders; RebrickNet): https://github.com/360er0/awesome-lego-machine-learning
- BrickScan/BrickMonkey (16k minifigs): https://apps.apple.com/us/app/brickscan-ai-minifig-scanner/id1602067461 · brick'em accuracy claim: https://brickem.io/blog/ai-lego-recognition-api
- Mr. Volt real-life Pokédex: https://www.hackster.io/news/this-real-life-pokedex-can-actually-identify-pokemon-in-the-wild-d770462f27b1 · https://www.tomshardware.com/raspberry-pi/this-functional-3d-printed-pokedex-uses-chat-gpt-to-identify-pokemon
- raugen AI Pokemon Identifier (cloud, figurine photos supported): https://raugen.com/ai-tools/pokemon-identifier
- Toys4K: https://rehg.org/publication/dataset2/ · OmniObject3D: https://omniobject3d.github.io/ · BlenderProc: https://sim2real.github.io/assets/papers/2020/denninger.pdf
- Ximilar collectibles recognition (cards, not figures): https://docs.ximilar.com/collectibles/recognition
- eBay scraping/ToS reality: https://scrapeops.io/websites/ebay/ · https://multilogin.com/blog/how-to-scrape-ebay-data/
- HuggingFace `pokemon` dataset sweep (API, 2026-08-06): https://huggingface.co/api/datasets?search=pokemon · Zenodo/IEEE DataPort sweeps: https://zenodo.org/records/10106105 · https://ieee-dataport.org/documents/pokemon-zero-neg
