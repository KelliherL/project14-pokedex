"""Fail if a commit adds large binaries to the repository.

Images/ and Models/ added ~437 MB of capture assets that every clone now
pays for, permanently. Rewriting that history would cost the whole team a
re-clone for no functional gain, so it stays — and this check exists so it
does not happen twice.

Capture assets belong in a shared drive with a link in the docs. Derived
artifacts (extracted frames, embedding caches) belong in a scratch directory.
The small committed artifacts the app needs at runtime are allowlisted below.

  python scripts/check_repo_weight.py            # working tree vs origin/main
  python scripts/check_repo_weight.py --all      # everything tracked
"""

import argparse
import subprocess
import sys
from pathlib import Path

MAX_FILE_BYTES = 2 * 1024 * 1024        # 2 MB
ALLOWED_PREFIXES = (
    "data/figurines/",                   # index + exemplar thumbnails, ~1.4 MB total
    "data/cards/hashes.json",
    "data/dex.json",
)
# Paths that predate the rule. Documented exemptions, not a licence to grow.
GRANDFATHERED = ("Images/", "Models/")


def tracked_files(all_files: bool) -> list[str]:
    if all_files:
        out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True)
        return out.stdout.splitlines()
    base = subprocess.run(["git", "merge-base", "HEAD", "origin/main"],
                          capture_output=True, text=True, check=False)
    ref = base.stdout.strip() or "HEAD~1"
    out = subprocess.run(["git", "diff", "--name-only", "--diff-filter=A", ref, "HEAD"],
                         capture_output=True, text=True, check=True)
    return out.stdout.splitlines()


def main() -> int:
    ap = argparse.ArgumentParser(description="Guard against large binaries")
    ap.add_argument("--all", action="store_true", help="check every tracked file")
    args = ap.parse_args()

    offenders = []
    for name in tracked_files(args.all):
        if not name or name.startswith(GRANDFATHERED) or name.startswith(ALLOWED_PREFIXES):
            continue
        path = Path(name)
        if path.is_file() and path.stat().st_size > MAX_FILE_BYTES:
            offenders.append((name, path.stat().st_size))

    if not offenders:
        print(f"repo weight OK (limit {MAX_FILE_BYTES // 1024} KB per new file)")
        return 0

    print(f"FAIL: {len(offenders)} file(s) over {MAX_FILE_BYTES // 1024} KB added to git:\n")
    for name, size in sorted(offenders, key=lambda kv: -kv[1]):
        print(f"  {size / 1048576:7.1f} MB  {name}")
    print("\nCapture assets belong in shared storage with a link in the docs;")
    print("derived artifacts belong in a scratch directory. See docs/CONTRIBUTING.md.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
