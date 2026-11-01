#!/usr/bin/env bash
# Download a module's public PDB from the Microsoft symbol server.
#   fetch_pdb.sh <path-to-pe> <out-dir>
# Writes <out-dir>/<pdbname> and prints its path.
set -euo pipefail

PE="${1:?usage: fetch_pdb.sh <pe> <out-dir>}"
OUT="${2:?usage: fetch_pdb.sh <pe> <out-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

eval "$(python3 -I "$HERE/pe_pdbid.py" "$PE")"   # sets PDB, GUID, AGE, SYMPATH

mkdir -p "$OUT"
URL="https://msdl.microsoft.com/download/symbols/$SYMPATH"
echo "fetching $URL" >&2
curl -fSL -A "Microsoft-Symbol-Server/10.0" -o "$OUT/$PDB" "$URL"
echo "$OUT/$PDB"
