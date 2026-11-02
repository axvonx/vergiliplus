#!/usr/bin/env python3
"""Fail the build if web/dist outgrows its budget (GitHub Pages caps a site at ~1 GB).

Each build (two modules) adds ~1 MB / ~100 files: pages for its new types plus the
views that changed (one page per type covers every build). Pages documents no file-count limit; --max-files is a
guard against runaway generation, not a hosting limit. Raise either deliberately.
Usage: check_budget.py [web/dist] [--max-mb 600] [--max-files 150000]
"""
import argparse
import os
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dist", nargs="?",
                    default=os.path.join(os.path.dirname(__file__), "..", "web", "dist"))
    ap.add_argument("--max-mb", type=float, default=600)
    ap.add_argument("--max-files", type=int, default=150000)
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
