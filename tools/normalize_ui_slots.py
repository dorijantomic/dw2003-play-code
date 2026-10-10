#!/usr/bin/env python3
"""Re-key the UI symbol map's method slots by (receiver, offset), not offset alone.

The Phase 1 harvest grouped every `->unkNN(...)` call by the offset NUMBER, so
calls on different receivers landed in one record: `stcrdshp` slot `unk8` is
named `windowFoldStart` but one of its call sites is `0x8004DC04->unk8`, the
RNG. The receiver is present in each stored quote, so the split is mechanical.

This script:
  1. reads every `docs/research/ui/symbols/<overlay>.json`,
  2. extracts the receiver from each call site's quote,
  3. regroups `method_slots` into one record per (receiver, offset),
  4. applies a canonical name where prior research or the audit settled one,
  5. marks the rest `disputed` with the competing names and the reason, so a
     reader never mistakes an unsettled slot for an established one.

It never invents a meaning: a slot whose semantics are genuinely unread keeps
the majority spelling AND a `disputed` field saying what is not known.

Usage:  python3 tools/normalize_ui_slots.py [--write]
Without --write it reports and changes nothing.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

SYMDIR = "docs/research/ui/symbols"

# Receiver globals seen in the Phase 1 quotes.
RECEIVERS = {
    "0x80042B98": "content-database",
    "0x8008CB80": "window-fold",
    "0x8004DC04": "rng",
    "0x8004DE10": "gpu",
    "0x8004B7D0": "pad",
    "0x8004B5DC": "heap",
    "0x80044B38": "resource-bank",
    "0x80048D34": "save",
    "0x800519EC": "scene",
    "0x8009B6EC": "ststatus-local-service",
}

# (receiver, offset) -> canonical name. Only rows that prior research or the
# Phase 1 audit settled. Everything else stays disputed.
CANONICAL = {
    ("0x8004DC04", "0x8"): ("rng_next", "RNG receiver; audit calls the three names synonyms"),
    ("0x8004B5DC", "0x10"): ("heap_free", "heap receiver; audit calls the three names synonyms"),
    ("0x8004B7D0", "0x408"): ("pad_button_bit", "audit: synonyms only"),
    ("0x8004DE10", "0x188"): ("frame_counter", "audit: synonyms only"),
}

# Text-element method table starts at +0x110 on a 0x174-byte object; these are
# reached through an object pointer, not a global, so they key as receiver
# "widget". docs/research/ui/shop-system-decompiled.md:63 established two.
WIDGET_CANONICAL = {
    "0x114": ("set_text", "shop-system-decompiled.md:63 established 'set text'"),
    "0x118": ("set_number", "audit: synonyms only"),
    "0x144": ("close", "shop-system-decompiled.md:63 established 'close'"),
}

# Slots whose disagreement is about MEANING, not spelling. Never auto-settled.
DISPUTED = {
    ("0x8004B7D0", "0x3f4"): "held vs pressed polarity is not shown by the call shape",
    ("0x8004B7D0", "0x3f8"): "repeat vs trigger latch not settled",
    ("0x8004B7D0", "0x3fc"): "edge vs repeat latch not settled",
    ("0x8004DE10", "0x150"): "six spellings for one call; begin-frame vs display-reset unread",
    ("0x8004DE10", "0x154"): "OT budget vs display env not settled",
    ("0x8004DE10", "0x158"): "packet alloc vs OT fetch not settled",
    ("0x8004DE10", "0x16c"): "audit flags the gpuAllocPrim/gpu_alloc_tint side as the wrong slot",
    ("0x8004DE10", "0x17c"): "OT bucket vs texture fetch not settled",
    ("0x80044B38", "0x404"): "busy vs ready polarity not settled",
    ("0x80044B38", "0x40c"): "audit: stgdglab's name is swapped relative to the others",
    ("0x80048D34", "0x270c"): "one pointer, several verbs; not read",
    ("0x80048D34", "0x2718"): "party slot vs save slot not settled",
    ("0x800519EC", "0x425c"): "spelling plus idle/busy polarity",
    ("0x800519EC", "0x4274"): "spelling plus idle/busy polarity",
}

GLOBAL_RE = re.compile(r"\(void \*\)(0x[0-9A-Fa-f]{8})\s*->\s*unk([0-9A-Fa-f]+)")
LOCAL_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\s*->\s*unk([0-9A-Fa-f]+)")


def receiver_of(quote: str, off: str) -> str:
    """Which object this call site is really on."""
    want = off.lower().lstrip("0x") or "0"
    for m in GLOBAL_RE.finditer(quote):
        if m.group(2).lower().lstrip("0") in (want, want.lstrip("0")) or m.group(2).lower() == want:
            return m.group(1).upper().replace("0X", "0x")
    # An object pointer. The text element's table starts at +0x110.
    try:
        if int(off, 16) >= 0x110:
            return "widget"
    except ValueError:
        pass
    if LOCAL_RE.search(quote):
        return "object"
    return "unknown"


def main() -> int:
    write = "--write" in sys.argv
    overlays = sorted(f for f in os.listdir(SYMDIR) if f.endswith(".json"))
    total_before = total_after = split = settled = disputed = 0

    for fname in overlays:
        path = os.path.join(SYMDIR, fname)
        doc = json.load(open(path))
        slots = doc.get("method_slots") or []
        if not slots:
            continue
        total_before += len(slots)

        regrouped = defaultdict(lambda: {"call_sites": [], "names": Counter()})
        for slot in slots:
            off = (slot.get("off") or "").lower()
            name = slot.get("proposed_name") or ""
            for cs in slot.get("call_sites") or []:
                rcv = receiver_of(cs.get("quote", ""), off)
                key = (rcv, off)
                regrouped[key]["call_sites"].append(cs)
                if name:
                    regrouped[key]["names"][name] += 1

        out = []
        for (rcv, off), data in sorted(regrouped.items(), key=lambda kv: (kv[0][0], int(kv[0][1] or "0", 16))):
            names = data["names"]
            rec = {
                "receiver": rcv,
                "receiver_role": RECEIVERS.get(rcv, "widget/object" if rcv in ("widget", "object") else "unknown"),
                "off": off,
                "call_site_count": len(data["call_sites"]),
                "call_sites": data["call_sites"],
            }
            canon = CANONICAL.get((rcv, off))
            if canon is None and rcv == "widget":
                canon = WIDGET_CANONICAL.get(off)
            why = DISPUTED.get((rcv, off))
            if canon and not why:
                rec["proposed_name"] = canon[0]
                rec["name_authority"] = canon[1]
                settled += 1
            else:
                rec["proposed_name"] = names.most_common(1)[0][0] if names else f"unk{off}"
                if len(names) > 1 or why:
                    rec["disputed"] = why or "lanes proposed different spellings; no source settles it"
                    rec["competing_names"] = sorted(names)
                    disputed += 1
            out.append(rec)

        for slot in slots:
            off = (slot.get("off") or "").lower()
            if len({r for (r, o) in regrouped if o == off}) > 1:
                split += 1

        total_after += len(out)
        doc["method_slots"] = out
        doc.setdefault("note_slots", (
            "method_slots are keyed by (receiver, offset). A slot marked "
            "`disputed` is NOT established; see docs/research/ui/symbols/audit.md."
        ))
        if write:
            with open(path, "w") as fh:
                json.dump(doc, fh, indent=1, ensure_ascii=False)
                fh.write("\n")

    print(f"overlays            : {len(overlays)}")
    print(f"slot records before : {total_before}")
    print(f"slot records after  : {total_after}")
    print(f"offsets that split across receivers: {split}")
    print(f"canonical names applied : {settled}")
    print(f"records marked disputed : {disputed}")
    print("(dry run — pass --write to apply)" if not write else "(written)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
