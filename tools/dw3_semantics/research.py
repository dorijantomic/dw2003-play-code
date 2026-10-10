"""Module-qualified joins from research documents to inventory functions.

An address alone cannot identify a function: `cardgame` and `fieldstg` share the
load base 0x80082cb0, and every WSTAG stage overlay has an entry at 0x800a5de0.
A citation is therefore attributed to a specific function only when the citing
document independently names that module, or when the address is unique across
the whole corpus. Everything else is retained as an explicitly ambiguous lead
that may not carry a name.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from .corpus import REPO_ROOT

ADDRESS_RE = re.compile(r"\b0x8[0-9a-fA-F]{7}\b")
RESEARCH_ROOT = REPO_ROOT / "docs/research"
CONTEXT_LINES = 12


def _module_tokens(corpus) -> dict[str, str]:
    """Map a distinctive lowercase token to each module id."""
    tokens: dict[str, str] = {}
    for module_id in corpus.modules:
        stem = module_id.split("/")[-1].lower()
        if len(stem) >= 4:
            tokens[stem] = module_id
    return tokens


def collect(corpus, root: Path = RESEARCH_ROOT) -> dict[str, list[dict]]:
    """Return citations per function id, module-qualified and context-checked."""
    if not root.is_dir():
        return {}
    tokens = _module_tokens(corpus)
    by_address: dict[int, list[str]] = defaultdict(list)
    for fid, fn in corpus.functions.items():
        by_address[fn.address].append(fid)

    links: dict[str, list[dict]] = defaultdict(list)
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in (".md", ".json"):
            continue
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            continue
        lowered = [line.lower() for line in lines]
        document = path.relative_to(REPO_ROOT).as_posix()
        for index, line in enumerate(lines):
            for match in ADDRESS_RE.finditer(line):
                address = int(match.group(0), 16)
                candidates = by_address.get(address)
                if not candidates:
                    continue
                window = " ".join(
                    lowered[max(0, index - CONTEXT_LINES): index + CONTEXT_LINES + 1],
                )
                named = {
                    tokens[token] for token in tokens if token in window
                }
                if len(candidates) == 1:
                    resolved, basis = candidates, "unique_address_in_corpus"
                elif named:
                    resolved = [fid for fid in candidates if fid.split(":")[0] in named]
                    basis = "module_named_in_citation_context"
                    if not resolved:
                        continue
                else:
                    # Shared load base with nothing to disambiguate it.
                    resolved, basis = candidates, "module_ambiguous"
                for fid in resolved:
                    links[fid].append({
                        "document": document,
                        "line": index + 1,
                        "address": f"0x{address:08x}",
                        "basis": basis,
                        "excerpt": line.strip()[:200],
                        "usable_for_naming": basis != "module_ambiguous",
                    })
    return {
        fid: sorted(items, key=lambda item: (item["document"], item["line"]))
        for fid, items in links.items()
    }


def naming_usable(links: dict[str, list[dict]]) -> dict[str, list[dict]]:
    """Only citations that identify one module may carry a name."""
    result = {}
    for fid, items in links.items():
        usable = [item for item in items if item["usable_for_naming"]]
        if usable:
            result[fid] = usable
    return result
