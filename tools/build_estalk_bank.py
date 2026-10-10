#!/usr/bin/env python3
"""Build every NPC text-bank binding from decoded stage descriptor +0x44.

No text-coverage voting: the original descriptor adds the language index to
197 + 7 * bank (English index 2). See map-effects-meft.md:169 and the English
pack population in build_translated_screen_data.py. Inputs are decoded data.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data/stage_estalk_bank.json'

def bindings():
    result = {}
    for entry in json.loads((ROOT / 'docs/generated/stage-descriptors.json').read_text()):
        value = entry['fields'].get('44', '')
        match = re.fullmatch(r'\(\*\(s32 \*\)0x8005CCA8 \+ (0x[\dA-Fa-f]+)\)', value)
        if not match: raise ValueError(f"{entry['stage']}: unparsed text-bank expression {value}")
        base = int(match[1], 16)
        bank, remainder = divmod(base - 197, 7)
        if remainder or not 0 <= bank < 10: raise ValueError(f'unknown estalk base {base:#x}')
        result[entry['stage'].replace('wstag', 's', 1)] = {
            'bank': f'estalk{bank:02d}', 'descriptor_base': base,
            'source': f"docs/generated/stage-descriptors.json {entry['stage']} fields.44",
        }
    return dict(sorted(result.items()))

def main():
    ap = argparse.ArgumentParser();ap.add_argument('--check', action='store_true');args = ap.parse_args()
    body = json.dumps(bindings(), indent=2, ensure_ascii=True) + '\n'
    if args.check:
        if OUT.read_text() != body: raise SystemExit('stage NPC text-bank bindings stale')
    else: OUT.write_text(body)
    print(f'descriptor NPC text banks: {len(bindings())} stages, all 10 banks')

if __name__ == '__main__': main()
