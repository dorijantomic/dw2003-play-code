"""Imported PSY-Q library signature sets for `tools/match_psyq.py`.

The pinned database in `.dw3-research/psyq-signature-pilot-2026-09-12/` is
PS1Recomp's `psyq_signatures.toml`: per-function *hash* signatures with the SDK
object tree in `sources`, but only for the names that database's generator
recovered. This module reads a second, community-made set,
[`lab313ru/psx_psyq_signatures`](https://github.com/lab313ru/psx_psyq_signatures)
(Signatures for Playstation 1 PsyQ LIB/OBJ files in JSON form), which carries
per-object **byte patterns with `??` wildcards** plus the symbol labels the SDK
object still contained. It is a different signature representation, so it is
matched by byte/wildcard comparison rather than by the masked hash of
`match_psyq.py`, but it feeds the same scan and the same disposition.

Pattern semantics (from the repo's `generator/psyq_sig.py`): the `sig` string is
the little-endian byte image of a whole `.OBJ`/`.LIB` object, `??` marks a byte
the linker relocates, and `labels` are (name, byte-offset) symbols inside it. A
function signature here is the slice from one label to the next; the label name
is the SDK function name when it is not a `loc_`/`text_`/`nullsub_`/`unk_`
placeholder. Placeholder slices still identify the *library object* a body came
from, so they are kept and marked `local`.

Provenance and licence
----------------------
The source repository ships **no LICENSE file** (probed 2026-10-06), so the
signature data is redistributed by its author without an explicit licence. We
do not vendor it: the fetched tree is kept, untracked, under
`.dw3-research/psyq-imported-signatures-2026-10-06/` exactly as the pinned
PS1Recomp database is. Only names and byte patterns are read; no SDK binary or
source is included. Identifications derived from it are candidates, never
verified behaviour.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

#: Label names the source generator assigns to code it has no symbol for.
LOCAL_LABEL = re.compile(r"^(loc_|text_|nullsub|unk_|j_|sub_|LABEL|flt_)")


def is_local_name(name: str | None) -> bool:
    """True when a label is a positional placeholder, not an SDK symbol."""
    return not name or bool(LOCAL_LABEL.match(name))


def iter_signature_files(imports: Path) -> list[Path]:
    """Every JSON signature file under a fetched tree, or the file itself."""
    if imports.is_file():
        return [imports]
    files = sorted(imports.glob("*/*.json"))
    files += sorted(imports.glob("**/*.json"))
    seen: dict[Path, None] = {}
    for path in files:
        seen.setdefault(path, None)
    return list(seen)


def _pattern_bytes(sig: str) -> tuple[bytearray, bytearray]:
    words = sig.split()
    raw = bytearray(len(words))
    wild = bytearray(len(words))
    for index, word in enumerate(words):
        if word == "??":
            wild[index] = 1
        else:
            raw[index] = int(word, 16)
    return raw, wild


def load_signatures(imports: Path, *, min_size: int = 6) -> list[dict]:
    """Normalised label-slice signatures from a lab313ru-style JSON set.

    One entry per label slice, carrying the label's name, the source object's
    library (from the file name), the SDK version (from the directory name), the
    raw slice bytes and its wildcard mask, and the nearest enclosing real label.
    """
    entries: list[dict] = []
    for path in iter_signature_files(imports):
        version = path.parent.name if path.parent != imports else ""
        library = path.name.split(".")[0].lower()
        try:
            objects = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(objects, list):
            continue
        for obj in objects:
            if not isinstance(obj, dict):
                continue
            raw, wild = _pattern_bytes(obj.get("sig", ""))
            length = len(raw)
            if length == 0:
                continue
            labels = [
                (int(label["offset"]), label.get("name"))
                for label in obj.get("labels", [])
                if isinstance(label, dict) and 0 <= int(label.get("offset", -1)) < length
            ]
            if not labels:
                continue
            labels.sort()
            offsets = [offset for offset, _ in labels]
            names_at: dict[int, str | None] = {}
            for offset, name in labels:
                names_at.setdefault(offset, name)
            real_offsets = [o for o in offsets if not is_local_name(names_at.get(o))]
            ends = offsets[1:] + [length]
            for offset, end in zip(offsets, ends):
                if end - offset < min_size:
                    continue
                name = names_at.get(offset)
                enclosing = None
                for real_offset in real_offsets:
                    if real_offset <= offset:
                        enclosing = names_at.get(real_offset)
                    else:
                        break
                if not is_local_name(name):
                    enclosing = name
                entries.append({
                    "name": name,
                    "library": library,
                    "version": version,
                    "obj": obj.get("name", ""),
                    "size": end - offset,
                    "bytes": bytes(raw[offset:end]),
                    "wildcards": bytes(wild[offset:end]),
                    "local": is_local_name(name),
                    "enclosing": enclosing,
                })
    return entries


def build_pattern_index(entries: list[dict]) -> dict[int, list[dict]]:
    """Signature entries grouped by slice size, so a scan only compares equals."""
    by_size: dict[int, list[dict]] = {}
    for entry in entries:
        by_size.setdefault(entry["size"], []).append(entry)
    return by_size


def _matches(window: bytes, entry: dict) -> bool:
    raw = entry["bytes"]
    wild = entry["wildcards"]
    for index in range(len(raw)):
        if not wild[index] and window[index] != raw[index]:
            return False
    return True


def match_imported(
    buffer: bytes,
    address: int,
    ram_base: int,
    text_end: int,
    by_size: dict[int, list[dict]],
    *,
    min_size: int = 8,
) -> dict | None:
    """Best imported-signature match at one address, or None.

    A named label outranks a placeholder one; a longer slice outranks a shorter;
    ties break on the lowest (name, library, version) so the result is stable.
    When only placeholder labels match, the library attribution is still
    returned with `name=None` and `enclosing` set to the nearest real symbol.
    """
    offset = address - ram_base
    if offset < 0:
        return None
    hits: list[dict] = []
    for size, entries in by_size.items():
        if size < min_size or address + size > text_end:
            continue
        window = buffer[offset:offset + size]
        if len(window) < size:
            continue
        for entry in entries:
            if _matches(window, entry):
                hits.append(entry)
    if not hits:
        return None
    hits.sort(key=lambda e: (
        e["local"],
        -e["size"],
        e["name"] or "",
        e["library"],
        e["version"],
    ))
    best = hits[0]
    return {
        "name": None if best["local"] else best["name"],
        "local_label": best["name"],
        "library": best["library"],
        "size": best["size"],
        "hash_kind": "pattern",
        "match_mode": "imported",
        "sources": [f"{best['version']}/{best['library'].upper()}.LIB" if best["version"] else best["library"]],
        "enclosing": best["enclosing"],
        "obj": best["obj"],
        "local": best["local"],
        # Under ~24 bytes a wildcard pattern is a code shape several programs
        # share, not an identity; keep the hit but mark it shape-only.
        "weak": best["size"] < 24,
    }
