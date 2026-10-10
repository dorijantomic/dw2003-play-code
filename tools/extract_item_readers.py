#!/usr/bin/env python3
"""Item possession call sites, using the existing native grant scanner.

Scans original pro/*.s through the resolved GET pointer, including delay slots.
This is a native-immediate census, not a proof that computed pointers or direct
save-array readers are absent. Converted table readers are enumerated separately
by report_item_routes.mjs. Output stays in docs/generated (never shared assets).
"""
import argparse
import json
import os
import struct
from pathlib import Path
from wstag_extract import overlay_bytes, extract_npcs, extract_cast
from extract_story_steps import step_program_ptr, read_step_program_at, BASE
from extract_native_item_grants import parse_insns, scan_file, GET_PTR_ADDR


def extract():
    asm_root = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003"
    files = sorted((asm_root / "pro").glob("*.s"))
    readers, unresolved, tables, reserved = [], [], [], []
    descriptors = {d['stage']:d['fields'] for d in json.loads(Path('docs/generated/stage-descriptors.json').read_text())}
    for path in files:
        source = path.read_text(errors='replace')
        lines = source.splitlines()
        rows, gaps = scan_file(parse_insns(source), pointer_addr=GET_PTR_ADDR, accepted_values=(0, 1))
        labels = {line.split(':', 1)[0]: (n, line) for n, line in enumerate(lines, 1) if line.startswith('.L0x')}
        for row in rows:
            offset = int(row['offset'], 16)
            line, exact = labels[f'.L0x{offset:08x}']
            readers.append({**row, 'item_id': row['flag_id'] & 0x1ff,
                'overlay': path.stem, 'source': str(path), 'line': line, 'exact': exact})
        if path.stem.startswith('wstag'):
            stage = path.stem.replace('wstag', 's', 1)
            data = overlay_bytes(stage[1:])
            def add_table(kind, who, conditions, **location):
                blob = b''.join(struct.pack('<HH', f['id'], f['expected']) for f in conditions) + struct.pack('<I', 65535)
                offsets = []
                if kind != 'step':
                    cursor = data.find(blob)
                    while cursor >= 0:
                        if cursor % 4 == 0: offsets.append(cursor)
                        cursor = data.find(blob, cursor + 1)
                for index, condition in enumerate(conditions):
                    fid, expected = condition['id'], condition['expected']
                    if 0x80 <= ((fid >> 8) & 0xfe) <= 0x8e:
                        positions = [int(location['offset'], 16) + index * 4] if kind == 'step' else [o + index * 4 for o in offsets]
                        anchors = []
                        for pos in positions:
                            label = f'.L0x{pos:08x}'
                            if label in labels:
                                line, exact = labels[label]
                                anchors.append({'offset': hex(pos), 'line': line, 'exact': exact})
                        if not anchors: raise ValueError(f'{stage}: no raw anchor for {kind} {fid:#x}')
                        (tables if fid & 0x1ff else reserved).append({'stage': stage, 'kind': kind, 'who': who,
                            'item_id': fid & 0x1ff, 'flag_id': fid, 'expected': expected,
                            'condition_index': index, 'source': str(path), 'anchors': anchors, **location})
            ptr = step_program_ptr(data)
            if ptr is not None:
                for index, (ca, aa, cb, ab, op, params) in enumerate(read_step_program_at(data, ptr)):
                    if op == 0: break
                    add_table('step', index, [{'id':ca,'expected':aa},{'id':cb,'expected':ab}],
                        op=op, params=params, offset=hex(ptr + index * 24))
            npcs = extract_npcs(data)
            pointer = descriptors.get(path.stem, {}).get('4C', '')
            if str(pointer).startswith('0x'): npcs += extract_cast(data, int(pointer, 16))
            unique = {}
            for npc in npcs:
                key = (npc['slot'], npc['id'], npc['x'], npc['y'], npc['n'], json.dumps(npc.get('spawn_flags', [])), npc.get('ptrB'))
                unique.setdefault(key, npc)
            for npc in unique.values():
                who = f"{npc['slot']}:{npc['id']}:{npc['x']}:{npc['y']}:{npc['n']}"
                add_table('npc_spawn', who, npc.get('spawn_flags', []), pointer=npc.get('ptrA'))
                for d, dialogue in enumerate(npc.get('ptrb_dialogues', [])):
                    add_table('dialogue', who, dialogue.get('gate', []), dialogue_index=d,
                        text_index=dialogue['id'], pointer=npc.get('ptrB'))
        for gap in gaps:
            unresolved.append({'overlay': path.stem, **gap})
    return {'scope': 'Resolved calls through original get_flag import; static scanner is linear, not a control-flow proof.',
            'corpus': {'glob': 'asm/dw2003/pro/*.s', 'files': len(files),
                       'matcher': 'existing native grant constant/pointer tracker; GET import; a1 0 or 1; delay-slot li/move'},
            'readers': readers, 'tables': tables, 'reserved_zero_reads': reserved, 'unresolved': unresolved}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    result = extract()
    output = Path('docs/generated/item-native-readers.json')
    body = json.dumps(result, indent=2, ensure_ascii=True) + '\n'
    if args.check:
        if output.read_text() != body: raise SystemExit('item native readers stale')
    else: output.write_text(body)
    print(f"native item readers: {len(result['readers'])}; unresolved calls: {len(result['unresolved'])}; files: {result['corpus']['files']}")


if __name__ == '__main__': main()
