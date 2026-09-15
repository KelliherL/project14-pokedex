# Contributing — team workflow

Short version: branch, PR, green CI, one review, merge. `main` must stay
demoable at all times — it is what we show the client on short notice.

## Workflow

1. Branch off `main` per change (`feature/…`, `fix/…`, `docs/…`).
2. Open a PR into `main`. Describe *what* and *why*; link the doc section or
   spike it serves if there is one.
3. CI must be green (`ruff check`, `pytest`, headless selftest — the same
   three commands you can run locally).
4. One approving review from another team member, then merge.
5. Anything that changes a seam contract (`docs/INTERFACES.md`) gets flagged
   to the whole team before merging, not after.

## Local setup

See the README quickstart. The check that matters before pushing:

```
.venv/Scripts/python scripts/selftest.py    # must print ALL PASS
.venv/Scripts/python -m pytest
.venv/Scripts/python -m ruff check .
```

(macOS/Linux: `.venv/bin/python`.)

## Environment reproducibility (and why there is no Dockerfile)

We considered Docker and decided against it for this repo:

- The app's job is **webcam in, GUI window out, audio out** — the three
  things containers handle worst on the Windows/macOS laptops the team
  actually uses (no USB webcam passthrough on Docker Desktop; `cv2.imshow`
  needs a display; the stub TTS is Windows-native speech).
- The dependency surface is four pip packages, all prebuilt wheels. A venv +
  `requirements.txt` + Python 3.11–3.13 already reproduces cleanly.
- The event target is a bare offline laptop — a container layer fights the
  deployment model.

Reproducibility is instead enforced by: pinned requirements, the **headless
selftest as the "does your machine work" gate**, and CI running the identical
checks on a clean machine every push. If a headless backend service appears
later (the FastAPI option in TECH-STACK.md), dockerizing *that* is worth
revisiting.

## Style

- Python 3.11+ (CI runs 3.13), `ruff` with `line-length = 100`
  (see `pyproject.toml`).
- Docstrings say *why* and *what the module owns*, in plain language —
  match the existing files.
- Keep modules small and behind their seams: storage only via
  `DexDataSource`, UI only via `Identification` (see `docs/INTERFACES.md`).

## Tests

- `tests/` — unit tests, run by `pytest`. New behaviour ships with a test.
- `scripts/selftest.py` — headless end-to-end check on synthetic scenes; it
  is the demo-readiness gate and runs in CI.
- Once real hardware exists: recorded webcam clips become regression
  fixtures (glare / sleeve / plush — the documented failure modes).

## Data rules

- **Never commit card images** (`data/cards/images/` is gitignored — The
  Pokémon Company IP; each machine caches its own via
  `scripts/download_card_set.sh`).
- `data/cards/hashes.json` and `data/dex.json` are small derived artifacts
  and are committed; rebuild them with the scripts if sources change.
- No frames from any camera are ever written to disk — that is an event
  privacy commitment (VISION.md), and it starts as a development habit.
- **Capture assets (video, photo sets) do not go in the repo.** Put them in
  shared storage and link them from the docs. `Images/` and `Models/` predate
  this rule and stay as they are — rewriting shared history costs everyone a
  re-clone for no functional gain — but they are why the rule exists: they add
  ~437 MB that every clone now pays for, permanently. CI runs
  `scripts/check_repo_weight.py`, which fails any commit adding a file over
  2 MB outside the allowlist. (Deliberately not Git LFS: declaring an LFS
  filter over extensions already committed as plain blobs breaks checkout for
  anyone without git-lfs installed.)
- **Derived artifacts stay out of the repo.** Extracted video frames,
  embeddings caches and experiment outputs are reproducible from their
  sources, so they belong in a scratch directory, not in git. The exceptions
  are the small committed artifacts the app needs at runtime:
  `data/cards/hashes.json`, `data/dex.json`, and `data/figurines/`
  (index ~335 KB plus exemplar thumbnails), each rebuildable with its script.
