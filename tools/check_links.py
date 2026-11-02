#!/usr/bin/env python3
"""Check every internal link in the built site (web/dist) resolves to a file.

Scans href/src attributes in all .html files, resolves them against the page
(relative) or the site root (absolute), and reports targets that don't exist.
Also checks that each type listing has the /ti/ sidebar index nav.js fetches, and
that each type page's pack (data-pack, /p/...json.gz) exists and every build's view in
it links to existing pages, resolved against the type page (struct.js renders it there).
Stdlib only. Exit 1 on any broken link.

Usage: check_links.py [web/dist]
"""
import gzip
import json
import os
import re
import sys
from urllib.parse import unquote, urlsplit

ATTR = re.compile(r'(?:href|src|data-pack)="([^"#?]*)')
PACK = re.compile(r'data-pack="([^"]*)"')


def slug(s):
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)  # = web/src/lib/types.mjs slug


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else
                           os.path.join(os.path.dirname(__file__), "..", "web", "dist"))
    files = set()
    for d, _, fs in os.walk(root):
        for f in fs:
            files.add(os.path.relpath(os.path.join(d, f), root))

    # On a case-insensitive disk (macOS) files differing only by case (a type page and
    # its alias, lib/panel.mjs typePages) share one entry; there, match case-insensitively.
    # CI (Linux) stays exact.
    folded = {f.lower() for f in files} if os.path.exists(os.path.join(root, "INDEX.HTML")) else None
    exists = lambda t: t in files or (folded is not None and t.lower() in folded)

    def read(rel):
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            return fh.read()

    checked, broken = 0, []
    for rel in sorted(f for f in files if f.endswith(".html")):
        base = os.path.dirname(rel)
        html = read(rel)
        urls = set(ATTR.findall(html))
        for pk in PACK.findall(html):
            pk = pk.lstrip("/")
            if pk in files:  # its views' links and used-in names, as rendered on this page
                with gzip.open(os.path.join(root, pk), "rt", encoding="utf-8") as fh:
                    p = json.load(fh)
                for v in p["v"]:
                    urls |= set(ATTR.findall(v))
                urls |= {slug(n) + ".html" for u in p["u"] for n in u}
        for url in urls:
            if not url or urlsplit(url).scheme or url.startswith("//"):
                continue  # external, mailto:, or a pure fragment
            path = unquote(url)
            target = os.path.normpath(path.lstrip("/") if path.startswith("/")
                                      else os.path.join(base, path))
            if target in ("", "."):
                target = "index.html"
            if os.path.isdir(os.path.join(root, target)):
                target = os.path.join(target, "index.html")
            checked += 1
            if not exists(target):
                broken.append((rel, url))

    # nav.js fetches /ti/<arch>/<build>/<module>.json for every listing context
    for rel in files:
        m = re.fullmatch(r"v/([^/]+)/([^/]+)/([^/]+)\.html", rel)
        if m:
            checked += 1
            ti = "ti/%s/%s/%s.json" % m.groups()
            if ti not in files:
                broken.append((rel, "/" + ti))

    for page, url in broken[:50]:
        print("BROKEN %s -> %s" % (page, url))
    print("%d links checked, %d broken" % (checked, len(broken)))
    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()
