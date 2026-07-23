#!/usr/bin/env python3
"""Extract the embedded dataset from the original Kindle Highlights dashboard HTML
into compact JSON files the PWA bundles as its seed data.

Usage:
    python3 scripts/extract_seed.py /path/to/kindle_highlights_dashboard.html
"""
import sys
import re
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "data"))


def main():
    if len(sys.argv) < 2:
        print("usage: extract_seed.py <dashboard.html>", file=sys.stderr)
        sys.exit(1)
    src = sys.argv[1]
    html = open(src, encoding="utf-8").read()
    m = re.search(r'<script[^>]*id="data"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        print("could not find embedded <script id=\"data\">", file=sys.stderr)
        sys.exit(2)
    data = json.loads(m.group(1))

    os.makedirs(OUT, exist_ok=True)

    # --- books: keep display + browse metadata, drop nothing important ---
    books = []
    for b in data.get("books", []):
        books.append({
            "id": int(b["book_id"]),
            "title": b.get("title", ""),
            "author": b.get("author", ""),
            "hlCount": b.get("highlight_count", 0),
            "wordCount": b.get("word_count", 0),
            "topWords": b.get("top_words", [])[:10],
            "topThemes": [
                {"id": int(t["theme_id"]), "count": t["count"]}
                for t in b.get("top_themes", [])
            ],
            "blurb": b.get("book_blurb") or "",
            "authorBlurb": b.get("author_blurb") or "",
        })

    themes = []
    for t in data.get("themes", []):
        themes.append({
            "id": int(t["theme_id"]),
            "name": t.get("name", ""),
            "hlCount": t.get("highlight_count", 0),
            "primaryCount": t.get("primary_count", 0),
            "topWords": [
                w["word"] if isinstance(w, dict) else w
                for w in t.get("top_words", [])[:25]
            ],
        })

    # --- highlights: the big one. keep tight. ---
    highlights = []
    for h in data.get("highlights", []):
        highlights.append({
            "id": int(h["id"]),
            "b": int(h["book_id"]),
            "loc": h.get("loc", 0),
            "t": h.get("text", ""),
            "th": [int(x) for x in h.get("themes", [])],
            "p": int(h["primary"]) if h.get("primary") is not None else None,
        })

    stats = data.get("stats", {})

    def dump(name, obj):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        return os.path.getsize(path)

    sizes = {}
    sizes["books.json"] = dump("books.json", books)
    sizes["themes.json"] = dump("themes.json", themes)
    sizes["highlights.json"] = dump("highlights.json", highlights)
    sizes["meta.json"] = dump("meta.json", {
        "stats": stats,
        "counts": {
            "books": len(books),
            "themes": len(themes),
            "highlights": len(highlights),
        },
        "maxSeedHighlightId": max((h["id"] for h in highlights), default=0),
        "maxSeedBookId": max((b["id"] for b in books), default=0),
        "seedGeneratedAt": stats.get("generated_at", ""),
    })

    total = sum(sizes.values())
    print("Wrote seed data to", OUT)
    for k, v in sizes.items():
        print(f"  {k:20s} {v/1024:8.1f} KB")
    print(f"  {'TOTAL':20s} {total/1024:8.1f} KB")
    print(f"books={len(books)} themes={len(themes)} highlights={len(highlights)}")


if __name__ == "__main__":
    main()
