"""Load the recovered inventory, curated semantics and m2c bodies."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
INVENTORY_PATH = REPO_ROOT / "recovered/ddw3/function-inventory.json"
SEMANTICS_PATH = REPO_ROOT / "recovered/ddw3/semantics.json"

# Entry evidence that establishes a callable function independently of any
# decompiler output. `decompiled_c` is deliberately absent: an m2c file proves
# only that m2c was pointed at the address.
STRONG_ENTRY_EVIDENCE = frozenset({
    "original_label",
    "direct_call_target",
    "factory_callback",
    "extracted_called_function_pointer",
    "overlay_code_entry",
})


@dataclass
class Function:
    id: str
    module: str
    address: int
    source: str
    source_line: int | None
    end_address: int | None
    boundary_status: str
    entry_evidence: tuple[str, ...]
    decompiled_sources: tuple[str, ...]
    direct_calls: list[dict]
    indirect_calls: list[dict]
    curated_name: str | None
    curated_subsystem: str | None
    curated_family: str | None
    recovery: dict

    body_path: Path | None = None
    body_text: str | None = None
    features: object | None = None

    @property
    def has_body(self) -> bool:
        return self.body_text is not None

    @property
    def address_hex(self) -> str:
        return f"0x{self.address:08x}"

    @property
    def strong_entry_evidence(self) -> bool:
        return bool(set(self.entry_evidence) & STRONG_ENTRY_EVIDENCE)


@dataclass
class Corpus:
    functions: dict[str, Function]
    modules: dict[str, dict]
    global_function_pointers: dict
    overlay_function_pointers: dict
    rejected_entries: list[dict]
    curated: dict
    curated_families: dict
    curated_globals: dict
    summary: dict
    callers: dict[str, set[str]] = field(default_factory=dict)

    def by_module(self, module: str) -> list[Function]:
        return [fn for fn in self.functions.values() if fn.module == module]

    def curated_ids(self) -> set[str]:
        """Function ids carrying a curated meaning, directly or via a family."""
        ids = set(self.curated)
        for family in self.curated_families.values():
            ids.update(family.get("members", {}))
        return ids & set(self.functions)


def _pick_body(paths: tuple[str, ...]) -> tuple[Path | None, str | None]:
    """Return the largest readable body; m2c writes one file per attempt."""
    best: tuple[int, Path, str] | None = None
    for relative in paths:
        path = REPO_ROOT / relative
        if not path.is_file():
            continue
        try:
            text = path.read_text(errors="replace")
        except OSError:
            continue
        size = len(text)
        if best is None or size > best[0]:
            best = (size, path, text)
    if best is None:
        return None, None
    return best[1], best[2]


def load_corpus(
    inventory_path: Path = INVENTORY_PATH,
    semantics_path: Path = SEMANTICS_PATH,
    *,
    strip_curated: bool = False,
    keep_curated: set[str] | None = None,
) -> Corpus:
    """Load the corpus.

    `strip_curated` builds the holdout view: curated names, subsystems and
    families are withheld so no inference rule can read them, directly or as a
    feature. `keep_curated` narrows that to a training subset, withholding
    every id outside it. Both also strip the `curated_semantics` entry-evidence
    marker, which would otherwise leak membership of the curated set even when
    the name itself is hidden. This is the leakage guard for validation.
    """
    inventory = json.loads(inventory_path.read_text())
    semantics = json.loads(semantics_path.read_text()) if semantics_path.is_file() else {}
    curated = semantics.get("functions", {})
    curated_families = semantics.get("families", {})
    curated_globals = semantics.get("globals", {})

    def visible(function_id: str) -> bool:
        if strip_curated:
            return False
        return keep_curated is None or function_id in keep_curated

    if keep_curated is not None or strip_curated:
        curated = {fid: value for fid, value in curated.items() if visible(fid)}
        curated_families = {
            name: {
                **family,
                "members": {
                    fid: member for fid, member in family.get("members", {}).items()
                    if visible(fid)
                },
            }
            for name, family in curated_families.items()
        }
        curated_families = {
            name: family for name, family in curated_families.items() if family["members"]
        }

    functions: dict[str, Function] = {}
    modules: dict[str, dict] = {}
    for module in inventory["modules"]:
        modules[module["id"]] = {
            "id": module["id"],
            "source": module["source"],
            "source_sha256": module["source_sha256"],
            "load_base": module["load_base"],
            "function_count": module["function_count"],
        }
        for raw in module["functions"]:
            end = raw.get("provisional_end_address")
            body_path, body_text = _pick_body(tuple(raw["decompiled_sources"]))
            shown = visible(raw["id"])
            evidence = tuple(
                item for item in (raw.get("entry_evidence") or [])
                if shown or item != "curated_semantics"
            )
            functions[raw["id"]] = Function(
                id=raw["id"],
                module=module["id"],
                address=int(raw["address"], 16),
                source=module["source"],
                source_line=raw.get("source_line"),
                end_address=int(end, 16) if end else None,
                boundary_status=raw["boundary_status"],
                entry_evidence=evidence,
                decompiled_sources=tuple(raw["decompiled_sources"]),
                direct_calls=raw.get("direct_calls") or [],
                indirect_calls=raw.get("indirect_calls") or [],
                curated_name=raw.get("semantic_name") if shown else None,
                curated_subsystem=raw.get("semantic_subsystem") if shown else None,
                curated_family=raw.get("semantic_family") if shown else None,
                recovery=raw.get("recovery") or {},
                body_path=body_path,
                body_text=body_text,
            )

    callers: dict[str, set[str]] = {fid: set() for fid in functions}
    for fn in functions.values():
        for call in fn.direct_calls:
            target = call.get("target_id")
            if target in callers:
                callers[target].add(fn.id)
        for call in fn.indirect_calls:
            target = call.get("target_id")
            if target in callers:
                callers[target].add(fn.id)

    return Corpus(
        functions=functions,
        modules=modules,
        global_function_pointers=inventory.get("global_function_pointers", {}),
        overlay_function_pointers=inventory.get("overlay_function_pointers", {}),
        rejected_entries=inventory.get("rejected_entries", []),
        curated=curated,
        curated_families=curated_families,
        curated_globals={} if strip_curated else curated_globals,
        summary=inventory.get("summary", {}),
        callers=callers,
    )
