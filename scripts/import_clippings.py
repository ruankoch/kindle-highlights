#!/usr/bin/env python3
"""Convert a Kindle 'My Clippings.txt' into rows you can paste straight into the
'Highlights' tab of your Google Sheet (tab-separated: id, book_title, author,
location, text, themes, addedAt).

Usage:
    python3 scripts/import_clippings.py "My Clippings.txt" > new_highlights.tsv

Then in Google Sheets: open the Highlights tab, click the first empty row under
the headers, and Edit → Paste (or Cmd/Ctrl+V). Open the app and hit Sync.

Notes:
 - Only "Highlight" entries are kept (bookmarks/notes are skipped).
 - Duplicate highlight texts are removed.
 - 'themes' is left blank — you can tag inside the app afterwards.
 - ids start at 3,000,000 to stay clear of the bundled seed ids.
"""
import sys
import re
import time

ID_BASE = 3_000_000


def parse(path):
    raw = open(path, encoding='utf-8-sig').read()
    entries = raw.split('==========')
    out = []
    seen = set()
    for block in entries:
        lines = [l.rstrip('\r') for l in block.strip('\n').split('\n') if l.strip() != '']
        if len(lines) < 2:
            continue
        header = lines[0].strip()
        meta = lines[1].strip()
        text = '\n'.join(lines[2:]).strip()
        if not text:
            continue
        if 'highlight' not in meta.lower():
            continue  # skip bookmarks / notes
        # "Title (Author Name)"
        m = re.match(r'^(.*?)\s*\(([^)]*)\)\s*$', header)
        if m:
            title, author = m.group(1).strip(), m.group(2).strip()
        else:
            title, author = header, ''
        loc = ''
        lm = re.search(r'Location\s+([\d\-]+)', meta) or re.search(r'page\s+([\d\-]+)', meta, re.I)
        if lm:
            loc = lm.group(1)
        key = (title.lower(), text)
        if key in seen:
            continue
        seen.add(key)
        out.append({'title': title, 'author': author, 'loc': loc, 'text': text})
    return out


def main():
    if len(sys.argv) < 2:
        print('usage: import_clippings.py "My Clippings.txt"', file=sys.stderr)
        sys.exit(1)
    rows = parse(sys.argv[1])
    now = int(time.time() * 1000)
    # header row (comment for the user; the Sheet already has headers, so paste BELOW them)
    for i, r in enumerate(rows):
        rid = ID_BASE + i
        text = r['text'].replace('\t', ' ').replace('\r', ' ')
        cols = [str(rid), r['title'], r['author'], r['loc'], text, '', str(now + i)]
        print('\t'.join(cols))
    print(f'# {len(rows)} highlights ready to paste', file=sys.stderr)


if __name__ == '__main__':
    main()
