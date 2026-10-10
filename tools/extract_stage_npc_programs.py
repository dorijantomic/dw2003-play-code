#!/usr/bin/env python3
"""Recover all NPC programs for the browser without writing shared raster assets.

Union the descriptor's +0x4C cast with the established structural NPC scanner
(dynamic event actors can live outside the initial cast). Keep all ptrB states
and the exact spawn-gate identity, and use descriptor +0x44 for text binding.
"""
import argparse
import json
from pathlib import Path
from wstag_extract import overlay_bytes, extract_cast, extract_npcs, valid_triple_array
from gen_scenes import apply_npc_spawns

def extract():
    manifest = json.loads(Path('web/assets/manifest.json').read_text())
    sprites = {n['id'] for n in manifest.get('npcs', []) + manifest.get('characters', [])}
    stages = {}; missing_cast = []; rejected = []
    for desc in json.loads(Path('docs/generated/stage-descriptors.json').read_text()):
        number = desc['stage'][5:];stage = 's' + number
        data = overlay_bytes(number)
        records = []
        for candidate in extract_npcs(data):
            if candidate.get("ptrB") and not valid_triple_array(data, candidate["ptrB"]):
                rejected.append({"stage":stage,"slot":candidate["slot"],"npc_id":candidate["id"],"ptrB":candidate["ptrB"],"reason":"Structural candidate does not point to a valid terminated NPC dialogue program"})
            else: records.append(candidate)
        pointer = desc['fields'].get('4C', '')
        if isinstance(pointer, str) and pointer.startswith('0x'):
            records += extract_cast(data, int(pointer, 16))
        else: missing_cast.append(stage)
        unique = {}
        for npc in records:
            # ptrA is normalized to decoded conditions, so cast and scan agree.
            key = (npc['slot'], npc['id'], npc['x'], npc['y'], npc['n'],
                   json.dumps(npc.get('spawn_flags', []), sort_keys=True), npc.get('ptrB'))
            unique.setdefault(key, npc)
        stages[stage] = apply_npc_spawns({'npcs': []}, list(unique.values()), sprites, stage=int(number))['npcs']
    return {'source': 'Original descriptor +0x4C cast plus established structural NPC scanner; +0x44 text bank; ptrB ordered triples.',
            'nonconstantCastStages': missing_cast, 'rejectedStructuralCandidates': rejected, 'stages': stages}

def main():
    ap = argparse.ArgumentParser();ap.add_argument('--check', action='store_true');args = ap.parse_args()
    result = extract();body = json.dumps(result, separators=(',', ':'), ensure_ascii=True) + '\n'
    output = Path('web/stage-npc-programs.json')
    if args.check:
        if output.read_text() != body: raise SystemExit('stage NPC programs stale')
    else: output.write_text(body)
    print(f"NPC programs: {len(result['stages'])} stages, {sum(len(v) for v in result['stages'].values())} actors; {len(result['nonconstantCastStages'])} nonconstant casts")

if __name__ == '__main__': main()
