#!/bin/sh
# Regenerate data/inferred/*.json from the NT 3.1-era kernel debuggers (needs r2 = radare2,
# and curl). Each debugger in data/inferred/_builds.json is fetched from its pinned
# archive.org URL, checked against its sha256, and its !process / !thread code read:
#   kdproc.py  labelled printf fields     kdseq.py  every struct read + the string it feeds
#   kdsizes.py sizeof as the debugger reads it     infer_gen.py  -> specs
# Usage: tools/legacy/re/regen.sh   (writes data/inferred/ntoskrnl-*.json)
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../../.." && pwd)
W=${TMPDIR:-/tmp}/vergiliplus-re; mkdir -p "$W/seq" "$W/sizes"
python3 - "$ROOT/data/inferred/_builds.json" > "$W/list" <<'PY'
import json, sys
for c in json.load(open(sys.argv[1])):
    print(c["key"], c["kd"], c["source"]["lib"], c["source"]["sha256"])
PY
while read -r key kd url sha; do
  f="$W/$key-$kd.EXE"
  [ -f "$f" ] || curl -sSL -o "$f" "$url"
  echo "$sha  $f" | shasum -a 256 -c - >/dev/null
  python3 "$HERE/kdproc.py" "$f" "PROCESS %08lx" > "$W/$key-$kd.json"
  python3 "$HERE/kdseq.py" "$f" "%sTHREAD %lx" > "$W/seq/$key-$kd-t.json"
  python3 "$HERE/kdsizes.py" "$f" > "$W/sizes/$key-$kd.json"
done < "$W/list"
cp "$ROOT/data/inferred/_builds.json" "$W/builds.json"
KDJSON="$W" python3 "$HERE/infer_gen.py" "$ROOT/data/inferred"
