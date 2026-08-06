#!/usr/bin/env bash
# Download one TCGdex set's card JSON + low-res images with parallel curl.
# Usage: bash scripts/download_card_set.sh [set_id]      (default: base1)
#
# curl (parallel, --retry, resume-missing second pass) replaced an all-in-one
# urllib downloader that stalled for minutes at a time on a flaky link /
# slow asset CDN (2026-07-29). Images are low.webp: ~6x smaller than low.png,
# identical for hashing purposes (hashes are computed at 32x32).
set -euo pipefail
cd "$(dirname "$0")/.."
SET="${1:-base1}"
mkdir -p data/cards/meta data/cards/images

echo "set $SET: fetching set list..."
curl -sS -m 30 --retry 3 "https://api.tcgdex.net/v2/en/sets/$SET" -o data/cards/set.json

# tr -d '\r': Windows Python prints CRLF; a trailing CR makes curl reject the URL
python - <<'EOF' | tr -d '\r' > data/cards/ids.txt
import json
for c in json.load(open('data/cards/set.json', encoding='utf-8'))['cards']:
    print(c['id'])
EOF
echo "$(wc -l < data/cards/ids.txt) cards; fetching card JSON (parallel)..."
xargs -P 6 -I{} curl -sS -m 30 --retry 3 -o "data/cards/meta/{}.json" \
    "https://api.tcgdex.net/v2/en/cards/{}" < data/cards/ids.txt

python - <<'EOF' | tr -d '\r' > data/cards/urls.txt
import json, glob
for p in sorted(glob.glob('data/cards/meta/*.json')):
    d = json.load(open(p, encoding='utf-8'))
    if d.get('image'):
        print(d['id'], d['image'] + '/low.webp')
EOF
echo "fetching $(wc -l < data/cards/urls.txt) images (parallel)..."
xargs -P 6 -n 2 bash -c 'curl -sS -m 60 --retry 3 -o "data/cards/images/$0.webp" "$1"' \
    < data/cards/urls.txt || true

echo "second pass for missing/empty files..."
while read -r cid url; do
    f="data/cards/images/$cid.webp"
    if [ ! -s "$f" ]; then
        echo "  retrying $cid"
        curl -sS -m 90 --retry 3 -o "$f" "$url" || true
    fi
done < data/cards/urls.txt

echo "done: $(ls data/cards/images | wc -l) images cached"
