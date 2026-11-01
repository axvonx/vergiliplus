#!/usr/bin/env python3
"""Fail the build if web/dist outgrows its budget (GitHub Pages caps a site at ~1 GB).

Each module build adds ~12 MB / ~1k files; the default budget leaves headroom for
~25 more before it trips. Raise it deliberately, not reflexively.
Usage: check_budget.py [web/dist] [--max-mb 600] [--max-files 60000]
"""
import argparse
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", nargs="?",
                    default=os.path.join(os.path.dirname(__file__), "..", "web", "dist"))
    ap.add_argument("--max-mb", type=float, default=600)
    ap.add_argument("--max-files", type=int, default=60000)
    args = ap.parse_args()
    size = files = 0
    for d, _, fs in os.walk(args.dist):
        for f in fs:
            size += os.path.getsize(os.path.join(d, f))
            files += 1
    mb = size / 1e6
    print("dist: %.1f MB in %d files (budget %.0f MB / %d files)"
          % (mb, files, args.max_mb, args.max_files))
    if mb > args.max_mb or files > args.max_files:
        sys.exit("over budget")


if __name__ == "__main__":
    main()
