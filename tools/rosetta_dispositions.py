#!/usr/bin/env python3
"""Generate the independent source/presentation disposition register.

The source census owns enumeration.  The catalog and presentation manifest
remain the owners of system and presentation meaning; this file only records
whether each independently enumerated row has a Rosetta disposition.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CENSUS = ROOT / "recovered/ddw3/rosetta-source-census.json"
CATALOG = ROOT / "docs/research/systems/catalog.json"
PRESENTATION = ROOT / "docs/research/presentation/master-manifest.json"
OUTPUT = ROOT / "recovered/ddw3/rosetta-dispositions.json"

SCHEMA_VERSION = 1
MODULE_DISPOSITIONS = {"attributed", "unresolved", "excluded"}
SYMBOL_DISPOSITIONS = {"attributed", "unresolved", "excluded"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def catalog_memberships(catalog: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    memberships: dict[str, list[dict[str, Any]]] = {}
    for system in catalog.get("systems", []):
        implementation = system.get("implementation", {})
        for module in implementation.get("modules", []):
            memberships.setdefault(module, []).append({
                "system": system["system"],
                "implementation_status": system.get("implementation_status"),
            })
    return memberships


def original_scope(catalog: dict[str, Any], systems: list[str]) -> list[str]:
    paths: set[str] = set()
    by_id = {row["system"]: row for row in catalog.get("systems", [])}
    for system_id in systems:
        paths.update(by_id.get(system_id, {}).get("source_map", []))
    return sorted(paths)


def disposition_for_module(row: dict[str, Any], memberships: list[dict[str, Any]]) -> tuple[str, str]:
    reachability = row.get("reachability")
    if reachability == "production":
        if memberships:
            return "attributed", "matched to one or more live catalog implementation module records"
        return "unresolved", "production source is absent from the live catalog implementation module lists"
    return "excluded", f"not an ordinary production module ({reachability})"


def build(root: Path = ROOT) -> dict[str, Any]:
    census = load(root / CENSUS.relative_to(ROOT))
    catalog = load(root / CATALOG.relative_to(ROOT))
    presentation = load(root / PRESENTATION.relative_to(ROOT))
    memberships = catalog_memberships(catalog)
    modules: list[dict[str, Any]] = []
    for row in census.get("files", []):
        path = row["path"]
        systems = sorted(item["system"] for item in memberships.get(path, []))
        module_disposition, reason = disposition_for_module(row, memberships.get(path, []))
        symbols: list[dict[str, Any]] = []
        for name in row.get("functions", []):
            symbols.append({
                "kind": "function",
                "name": name,
                "disposition": module_disposition,
                "reason": reason,
            })
        for registration in row.get("registrations", []):
            symbol = f"{registration.get('callee')}@L{registration.get('line')}"
            symbols.append({
                "kind": registration.get("kind", "registration"),
                "name": symbol,
                "line": registration.get("line"),
                "disposition": module_disposition,
                "reason": reason,
            })
        modules.append({
            "path": path,
            "kind": row.get("kind"),
            "reachability": row.get("reachability"),
            "system_ids": systems,
            "disposition": module_disposition,
            "reason": reason,
            "original_scope": original_scope(catalog, systems),
            "data_paths": sorted(row.get("data_paths", [])),
            "symbols": sorted(symbols, key=lambda item: (item["kind"], item["name"])),
        })

    linked_rows = {
        row_id
        for link in load(root / "recovered/ddw3/rosetta-links.json").get("links", [])
        for row_id in link.get("presentation_row_ids", [])
    }
    presentation_rows = [
        {
            "id": source_set["id"],
            "units": source_set.get("units", source_set.get("picture_draws", source_set.get("models", 0))),
            "status": source_set.get("status"),
            "registered": True,
        }
        for source_set in presentation.get("source_sets", [])
    ]
    all_row_ids = {row.get("id") for row in presentation.get("rows", [])}
    presentation_rows.append({
        "id": "manifest-rows",
        "units": len(all_row_ids),
        "status": presentation.get("status"),
        "registered": True,
        "linked_by_rosetta": len(all_row_ids & linked_rows),
        "unlinked_row_ids": sorted(all_row_ids - linked_rows),
    })

    production = [row for row in modules if row["reachability"] == "production"]
    behavior_symbols = [symbol for row in modules for symbol in row["symbols"]]
    production_symbols = [
        symbol
        for row in modules
        if row["reachability"] == "production"
        for symbol in row["symbols"]
    ]
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "tools/rosetta_dispositions.py",
        "source_digests": {
            "source_census": sha256(root / CENSUS.relative_to(ROOT)),
            "catalog": sha256(root / CATALOG.relative_to(ROOT)),
            "presentation": sha256(root / PRESENTATION.relative_to(ROOT)),
        },
        "summary": {
            "modules": len(modules),
            "production_modules": len(production),
            "modules_attributed": sum(row["disposition"] == "attributed" for row in modules),
            "modules_unresolved": sum(row["disposition"] == "unresolved" for row in modules),
            "modules_excluded": sum(row["disposition"] == "excluded" for row in modules),
            "behavior_symbols": len(behavior_symbols),
            "symbols_attributed": sum(row["disposition"] == "attributed" for row in behavior_symbols),
            "symbols_unresolved": sum(row["disposition"] == "unresolved" for row in behavior_symbols),
            "symbols_excluded": sum(row["disposition"] == "excluded" for row in behavior_symbols),
            "production_behavior_symbols": len(production_symbols),
            "production_symbols_attributed": sum(row["disposition"] == "attributed" for row in production_symbols),
            "production_symbols_unresolved": sum(row["disposition"] == "unresolved" for row in production_symbols),
            "presentation_source_sets": len(presentation_rows) - 1,
            "presentation_manifest_rows": len(all_row_ids),
            "presentation_rows_linked": len(all_row_ids & linked_rows),
            "data_paths": sorted({path for row in modules for path in row["data_paths"]}),
        },
        "modules": modules,
        "presentation": presentation_rows,
    }


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version: expected {SCHEMA_VERSION}")
    modules = data.get("modules")
    if not isinstance(modules, list):
        return ["modules: expected a list"]
    paths: set[str] = set()
    for index, row in enumerate(modules):
        label = f"modules[{index}]"
        path = row.get("path")
        if not isinstance(path, str) or not path:
            errors.append(f"{label}.path: expected a non-empty string")
        elif path in paths:
            errors.append(f"{label}.path: duplicate {path}")
        else:
            paths.add(path)
        if row.get("disposition") not in MODULE_DISPOSITIONS:
            errors.append(f"{label}.disposition: invalid")
        if not isinstance(row.get("reason"), str) or not row["reason"]:
            errors.append(f"{label}.reason: required")
        for symbol_index, symbol in enumerate(row.get("symbols", [])):
            if symbol.get("disposition") not in SYMBOL_DISPOSITIONS:
                errors.append(f"{label}.symbols[{symbol_index}].disposition: invalid")
    return errors


def validate_population(census: dict[str, Any], data: dict[str, Any]) -> list[str]:
    expected = {row.get("path") for row in census.get("files", [])}
    actual = {row.get("path") for row in data.get("modules", [])}
    errors: list[str] = []
    for path in sorted(expected - actual):
        errors.append(f"missing census module disposition: {path}")
    for path in sorted(actual - expected):
        errors.append(f"disposition has unenumerated module: {path}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = build(args.root)
    errors = validate(data)
    if errors:
        raise SystemExit("rosetta-dispositions-invalid\n" + "\n".join(errors))
    if args.check:
        if not args.output.exists():
            raise SystemExit(f"missing generated disposition file: {args.output}")
        existing = load(args.output)
        errors.extend(validate_population(load(args.root / CENSUS.relative_to(ROOT)), existing))
        if existing != data:
            raise SystemExit(f"stale generated disposition file: {args.output}")
        print(f"rosetta-dispositions-ok modules={len(data['modules'])}")
    else:
        args.output.write_text(json.dumps(data, indent=2) + "\n")
        print(f"rosetta-dispositions-written modules={len(data['modules'])} output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
