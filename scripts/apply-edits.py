"""Tiny helper: apply exact literal replacements to a file, newline-agnostic.

Usage: python scripts/apply-edits.py <file> <editsJson>
The edits file is a JSON list of {"old": "...", "new": "...", "count": 1}.
Reads with universal newlines and writes back with "\n"; git's autocrlf normalises anyway.
"""
import io
import json
import sys

path, edits_path = sys.argv[1], sys.argv[2]
with io.open(path, encoding='utf-8') as handle:
    source = handle.read()
with io.open(edits_path, encoding='utf-8') as handle:
    edits = json.load(handle)

for edit in edits:
    expected = edit.get('count', 1)
    found = source.count(edit['old'])
    if found != expected:
        raise SystemExit('expected %d occurrences, found %d for: %r' % (expected, found, edit['old'][:120]))
    source = source.replace(edit['old'], edit['new'])

with io.open(path, 'w', encoding='utf-8', newline='\n') as handle:
    handle.write(source)
print('applied %d edits to %s' % (len(edits), path))
