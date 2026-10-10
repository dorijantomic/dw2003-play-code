#!/usr/bin/env python3
"""Publish the card shop's data-only text families and stage-name table.
The pre-existing checked extraction is read; executable ranges are never emitted.
Run after build_native_screens.py when its source extraction changes.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
source = root / 'web/assets/native/screens'
out = root / 'web/cardshop-data'
out.mkdir(exist_ok=True)
entries = []
for offset, role in ((0x16, 'card-names'), (0x1d, 'card-effects'), (0x32, 'shop-text')):
    for language in range(7):
        bank = offset + language
        path = source / 'banks' / f'{bank}.bin'
        if not path.exists():
            continue
        data = path.read_bytes()
        (out / f'{bank}.bin').write_bytes(data)
        entries.append({'id': bank, 'role': role, 'language': language,
                        'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)})
image = (source / 'pro_stcrdshp.bin').read_bytes()
start, end = 0x8008caf8, 0x8008cb80
# This range contains the cursor-palette words and zero-terminated stage/name
# pairs only; the following function-pointer cells are deliberately excluded.
data = image[start - 0x80082cb0:end - 0x80082cb0]
(out / 'tables.bin').write_bytes(data)
(out / 'manifest.json').write_text(json.dumps({'schema': 1, 'tableBase': start,
    'tableSize': len(data), 'tableSha256': hashlib.sha256(data).hexdigest(),
    'banks': entries}, indent=2) + '\n')
print(f'Card shop: {len(entries)} text banks and {len(data)} table bytes; no executable bytes')
