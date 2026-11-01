#!/usr/bin/env python3
"""Check every internal link in the built site (web/dist) resolves to a file.

Scans href/src attributes in all .html files, resolves them against the page
(relative) or the site root (absolute), and reports targets that don't exist.
Also checks that each type listing has the /ti/ sidebar index nav.js fetches.
Stdlib only. Exit 1 on any broken link.

Usage: check_links.py [web/dist]
"""
import os
import re
import sys
from urllib.parse import unquote, urlsplit

ATTR = re.compile(r'(?:href|src)="([^"#?]*)')


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else
                           os.path.join(os.path.dirname(__file__), "..", "web", "dist"))
    files = set()
    for d, _, fs in os.walk(root):
        for f in fs:
            files.add(os.path.relpath(os.path.join(d, f), root))

    checked, broken = 0, []
    for rel in sorted(f for f in files if f.endswith(".html")):
        base = os.path.dirname(rel)
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            html = fh.read()
        for url in set(ATTR.findall(html)):
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
            if target not in files:
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
