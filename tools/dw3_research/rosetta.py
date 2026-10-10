"""Rosetta Stone link validation, generation, and bounded queries.

The editable link file contains joins only.  Claims, catalog status, source
inventories, and implementation metadata remain owned by their existing files;
this module derives a joined view without copying those authorities.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from tools.rosetta_dispositions import build as build_dispositions
from tools.rosetta_dispositions import validate as validate_dispositions
from tools.rosetta_audit import link_population


ROOT = Path(__file__).resolve().parents[2]
LINKS = ROOT / "recovered/ddw3/rosetta-links.json"
INDEX = ROOT / "recovered/ddw3/rosetta-index.json"
CENSUS = ROOT / "recovered/ddw3/rosetta-source-census.json"
DISPOSITIONS = ROOT / "recovered/ddw3/rosetta-dispositions.json"
SOURCE_CENSUS_SCRIPT = ROOT / "tools/rosetta_source_census.mjs"
REPORT = ROOT / "docs/generated/rosetta-stone.md"
SCHEMA_VERSION = 1
RELATIONSHIPS = {
    "implements", "adapts", "wraps", "splits", "combines", "consumes_data",
    "renders", "registers_handler", "host_support",
}
REVIEW_STATUSES = {"candidate", "supported", "rejected", "stale"}
REACHABILITY = {"production", "lab_only", "test_only", "unreachable", "unresolved"}
DECOMPILATION_STATUSES = {"resolved", "empty"}
TARGET_STATUSES = {"resolved", "unresolved"}
GAP_KINDS = {
    "link", "original_evidence", "review", "static_semantics", "runtime_only",
    "implementation", "presentation", "host_only",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_links(path: Path = LINKS) -> dict[str, Any]:
    return json.loads(path.read_text())


def _required(mapping: dict[str, Any], keys: tuple[str, ...], label: str, errors: list[str]) -> None:
    for key in keys:
        if key not in mapping:
            errors.append(f"{label}: missing {key}")


def _list_of_dicts(value: Any, label: str, errors: list[str]) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        errors.append(f"{label}: expected a list")
        return []
    rows = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            errors.append(f"{label}[{index}]: expected an object")
        else:
            rows.append(item)
    return rows


def _has_text_list(value: Any) -> bool:
    return isinstance(value, list) and any(
        isinstance(item, str) and item.strip() for item in value
    )


def _resolve_source_path(source: Any, root: Path) -> Path | None:
    if not isinstance(source, str) or not source:
        return None
    if source.startswith("~/"):
        return Path.home() / source[2:]
    path = Path(source).expanduser()
    return path if path.is_absolute() else root / path


def _root_path(root: Path, path: Path) -> Path:
    return root / path.relative_to(ROOT)


def validate_links(data: dict[str, Any], root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    catalog_path = root / "docs/research/systems/catalog.json"
    ledger_path = root / "docs/research/evidence/ledger.json"
    presentation_path = root / "docs/research/presentation/master-manifest.json"
    system_ids: set[str] = set()
    claims: dict[str, dict[str, Any]] | None = None
    presentation_ids: set[str] = set()
    if catalog_path.is_file():
        system_ids = {item["system"] for item in json.loads(catalog_path.read_text()).get("systems", [])}
    if ledger_path.is_file():
        claims = {
            item["id"]: item
            for item in json.loads(ledger_path.read_text()).get("claims", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
    if presentation_path.is_file():
        presentation_ids = {item["id"] for item in json.loads(presentation_path.read_text()).get("rows", [])}
    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version: expected {SCHEMA_VERSION}")
    links = _list_of_dicts(data.get("links"), "links", errors)
    ids: set[str] = set()
    for index, link in enumerate(links):
        label = f"links[{index}]"
        _required(link, ("id", "behavior_id", "system_ids", "player_surface", "relationship_kind",
                         "mapping_review", "reachability", "original", "knowledge", "engine",
                         "web", "data", "translation", "proof", "open_work", "maintenance"), label, errors)
        link_id = link.get("id")
        if not isinstance(link_id, str) or not link_id:
            errors.append(f"{label}.id: expected non-empty string")
        elif link_id in ids:
            errors.append(f"{label}.id: duplicate {link_id}")
        else:
            ids.add(link_id)
        if link.get("relationship_kind") not in RELATIONSHIPS:
            errors.append(f"{label}.relationship_kind: invalid value")
        if link.get("mapping_review") not in REVIEW_STATUSES:
            errors.append(f"{label}.mapping_review: invalid value")
        reach = link.get("reachability")
        if not isinstance(reach, dict):
            errors.append(f"{label}.reachability: expected object")
        else:
            if reach.get("status") not in REACHABILITY:
                errors.append(f"{label}.reachability.status: invalid value")
            if not isinstance(reach.get("proof"), list):
                errors.append(f"{label}.reachability.proof: expected list")
        systems = link.get("system_ids")
        if not isinstance(systems, list) or not systems or not all(isinstance(item, str) for item in systems):
            errors.append(f"{label}.system_ids: expected a non-empty string list")
        else:
            for system_id in systems:
                if system_ids and system_id not in system_ids:
                    errors.append(f"{label}: unknown catalog system {system_id}")
        knowledge = link.get("knowledge") if isinstance(link.get("knowledge"), dict) else {}
        claim_ids = knowledge.get("claim_ids", [])
        if not isinstance(claim_ids, list) or not all(isinstance(item, str) for item in claim_ids):
            errors.append(f"{label}.knowledge.claim_ids: expected a string list")
            claim_ids = []
        for claim_id in claim_ids:
            if claims is not None and claim_id not in claims:
                errors.append(f"{label}: unknown ledger claim {claim_id}")
        for row_id in link.get("presentation_row_ids", []):
            if presentation_ids and row_id not in presentation_ids:
                errors.append(f"{label}: unknown presentation row {row_id}")
        for group in ("original", "engine", "web", "data"):
            _list_of_dicts(link.get(group), f"{label}.{group}", errors)
        original_participants = _list_of_dicts(link.get("original"), f"{label}.original", errors)
        for participant in original_participants:
            _required(participant, ("id", "binary_variant", "module", "address_space", "entry", "source",
                                    "source_locator", "source_sha256"),
                     f"{label}.original participant", errors)
            participant_id = participant.get("id")
            module = participant.get("module")
            if (
                not isinstance(participant_id, str)
                or ":" not in participant_id
                or not participant_id.split(":", 1)[0]
                or not participant_id.split(":", 1)[1]
                or not isinstance(module, str)
                or not module
            ):
                errors.append(f"{label}: original participant id must be module-qualified")
            elif participant_id.split(":", 1)[0] != module:
                errors.append(
                    f"{label}: original participant id module does not match module: {participant_id}"
                )
            source = participant.get("source")
            source_path = _resolve_source_path(source, root)
            if source_path is None or not source_path.is_file():
                errors.append(f"{label}: original source missing: {source}")
            digest = participant.get("source_sha256")
            if not isinstance(digest, str) or len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
                errors.append(f"{label}: original source_sha256 must be a lowercase SHA-256")
            elif source_path is not None and source_path.is_file():
                if digest != sha256(source_path):
                    errors.append(f"{label}: stale original source digest: {source}")
            # Optional content/resolution markers (absent = legacy row,
            # treated as resolved). Values are checked on every row so a
            # misspelled marker on a candidate cannot silently promote later.
            decompilation = participant.get("decompilation_status", "resolved")
            if decompilation not in DECOMPILATION_STATUSES:
                errors.append(
                    f"{label}.original participant decompilation_status must be "
                    f"'resolved' or 'empty': {decompilation}"
                )
            target = participant.get("target_status", "resolved")
            if target not in TARGET_STATUSES:
                errors.append(
                    f"{label}.original participant target_status must be "
                    f"'resolved' or 'unresolved': {target}"
                )
        for group in ("knowledge", "translation", "proof", "open_work", "maintenance"):
            if not isinstance(link.get(group), dict):
                errors.append(f"{label}.{group}: expected object")
        proof = link.get("proof") if isinstance(link.get("proof"), dict) else {}
        if link.get("mapping_review") == "supported":
            relationship = link.get("relationship_kind")
            if relationship != "host_support" and not original_participants:
                errors.append(f"{label}: supported original correspondence requires original participants")
            if not _has_text_list(proof.get("mapping_justification")):
                errors.append(f"{label}: supported mapping requires mapping justification")
            if relationship != "host_support" and not (
                _has_text_list(proof.get("original_evidence")) or claim_ids
            ):
                errors.append(f"{label}: supported original correspondence requires evidence or claims")
            for claim_id in claim_ids:
                if claims is not None and claims.get(claim_id, {}).get("status") == "contradicted":
                    errors.append(f"{label}: supported mapping cites contradicted claim: {claim_id}")
            for participant in original_participants:
                cited = participant.get("id")
                if participant.get("decompilation_status") == "empty":
                    errors.append(f"{label}: supported mapping cites empty decompilation: {cited}")
                if participant.get("target_status") == "unresolved":
                    errors.append(f"{label}: supported mapping cites unresolved target: {cited}")
        proof_tests = proof.get("implementation_tests", [])
        if "implementation_tests" in proof and not isinstance(proof_tests, list):
            errors.append(f"{label}.proof.implementation_tests: expected a list")
        else:
            for case_index, case in enumerate(proof_tests):
                case_label = f"{label}.proof.implementation_tests[{case_index}]"
                if isinstance(case, str):
                    # Legacy filename entry: records presence only and claims
                    # no attribution to this behavior.
                    continue
                if not isinstance(case, dict):
                    errors.append(f"{case_label}: expected a test path or case record")
                    continue
                claimed = case.get("behavior_id")
                if not isinstance(claimed, str) or not claimed:
                    errors.append(f"{case_label}: case record requires behavior_id")
                elif claimed != link.get("behavior_id"):
                    errors.append(
                        f"{case_label}: implementation case misattributed: declares "
                        f"behavior {claimed} on link behavior {link.get('behavior_id')}"
                    )
                test_path = case.get("test_path")
                resolved = _resolve_source_path(test_path, root)
                if resolved is None:
                    errors.append(f"{case_label}: case record requires test_path")
                elif not resolved.is_file():
                    errors.append(f"{case_label}: implementation case test missing: {test_path}")
                else:
                    recorded = case.get("test_sha256")
                    if recorded is not None:
                        if (
                            not isinstance(recorded, str)
                            or len(recorded) != 64
                            or any(ch not in "0123456789abcdef" for ch in recorded)
                        ):
                            errors.append(f"{case_label}: case test_sha256 must be a lowercase SHA-256")
                        elif recorded != sha256(resolved):
                            errors.append(f"{case_label}: stale implementation case digest: {test_path}")
        gaps = link.get("open_work", {}).get("gaps", []) if isinstance(link.get("open_work"), dict) else []
        for gap in _list_of_dicts(gaps, f"{label}.open_work.gaps", errors):
            if gap.get("kind") not in GAP_KINDS:
                errors.append(f"{label}.open_work.gaps: invalid kind")
            _required(gap, ("kind", "evidence_needed"), f"{label}.open_work.gap", errors)
        maintenance = link.get("maintenance", {})
        if isinstance(maintenance, dict):
            for source, digest in (maintenance.get("source_digests") or {}).items():
                source_path = root / source if not str(source).startswith("/") else Path(source)
                if not source_path.exists():
                    errors.append(f"{label}: digest source missing: {source}")
                elif digest != sha256(source_path):
                    errors.append(f"{label}: stale source digest: {source}")
    return errors


def _source_digest(path_text: str) -> str | None:
    path = Path(path_text).expanduser()
    if not path.is_absolute():
        path = ROOT / path
    return sha256(path) if path.exists() else None


# The exact tree the census script enumerates (rosetta_source_census.mjs:
# `engine`, `web`, `tools/engine-convert` walked for `.ts`/`.js` minus the
# generated `web/vendor/engine.js` bundle, plus `web/**/*.html`
# entrypoints). A content digest over this set detects a changed, added, or
# removed source without respawning node, so `rosetta check` stays fast and
# needs no toolchain beyond the standard library. Census-script edits stay
# covered by the separate `source_census_script` digest; a
# compiler-only output change under identical sources is not detected.
CENSUS_SOURCE_DIRS = ("engine", "web", "tools/engine-convert")
CENSUS_CODE_SUFFIXES = (".ts", ".js")
CENSUS_ENTRYPOINT_SUFFIX = ".html"
CENSUS_SOURCE_EXCLUDE = "web/vendor/engine.js"


def census_source_sketch(root: Path = ROOT) -> str:
    """Content digest of the sources the stored census was enumerated from."""
    digest = hashlib.sha256()
    for directory in CENSUS_SOURCE_DIRS:
        base = root / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if relative == CENSUS_SOURCE_EXCLUDE:
                continue
            if path.suffix in CENSUS_CODE_SUFFIXES or (
                directory == "web" and path.suffix == CENSUS_ENTRYPOINT_SUFFIX
            ):
                digest.update(relative.encode())
                digest.update(b"\0")
                digest.update(path.read_bytes())
                digest.update(b"\0")
    return digest.hexdigest()


def generate_source_census(root: Path = ROOT) -> dict[str, Any]:
    script_path = _root_path(root, SOURCE_CENSUS_SCRIPT)
    result = subprocess.run(
        ["node", str(script_path)], cwd=root, text=True,
        capture_output=True, check=False,
    )
    if result.returncode:
        raise ValueError(f"source census failed ({result.returncode}): {result.stderr.strip()}")
    try:
        census = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError(f"source census emitted invalid JSON: {error}") from None
    if census.get("schema_version") != 2 or not isinstance(census.get("files"), list):
        raise ValueError("source census has an unsupported schema")
    return census


def build_index(root: Path = ROOT, links_path: Path = LINKS, census: dict[str, Any] | None = None) -> dict[str, Any]:
    links = load_links(links_path)
    errors = validate_links(links, root)
    if errors:
        raise ValueError("\n".join(errors))
    ledger_path = root / "docs/research/evidence/ledger.json"
    catalog_path = root / "docs/research/systems/catalog.json"
    ledger = json.loads(ledger_path.read_text())
    catalog = json.loads(catalog_path.read_text())
    claims = {item["id"]: item for item in ledger.get("claims", [])}
    systems = {item["system"]: item for item in catalog.get("systems", [])}
    census = census or generate_source_census(root)
    dispositions = build_dispositions(root)
    disposition_errors = validate_dispositions(dispositions)
    if disposition_errors:
        raise ValueError("\n".join(disposition_errors))
    rows = []
    for link in links["links"]:
        row = json.loads(json.dumps(link))
        row["claim_statuses"] = {
            claim_id: claims.get(claim_id, {}).get("status", "missing")
            for claim_id in link.get("knowledge", {}).get("claim_ids", [])
        }
        row["system_statuses"] = {
            system_id: systems.get(system_id, {}).get("status", "missing")
            for system_id in link.get("system_ids", [])
        }
        rows.append(row)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_from": str(links_path.relative_to(root)),
        "source_digests": {
            "links": sha256(links_path),
            "ledger": sha256(ledger_path),
            "catalog": sha256(catalog_path),
            "source_census_script": sha256(_root_path(root, SOURCE_CENSUS_SCRIPT)),
            "dispositions": sha256(_root_path(root, DISPOSITIONS)) if _root_path(root, DISPOSITIONS).exists() else None,
            "source_tree": census_source_sketch(root),
        },
        "summary": {
            "links": len(rows),
            "systems": sorted({system for row in rows for system in row.get("system_ids", [])}),
            "mapping_review": {status: sum(row.get("mapping_review") == status for row in rows) for status in sorted(REVIEW_STATUSES)},
            "reachability": {status: sum(row.get("reachability", {}).get("status") == status for row in rows) for status in sorted(REACHABILITY)},
            "source_population": dispositions["summary"],
        },
        "source_census": {
            "path": str(_root_path(root, CENSUS).relative_to(root)),
            "summary": census["summary"],
            "generated_by": census["generated_by"],
        },
        "dispositions": dispositions,
        "links": rows,
    }


def write_index(
    root: Path = ROOT,
    links_path: Path = LINKS,
    output: Path = INDEX,
    census: dict[str, Any] | None = None,
) -> dict[str, Any]:
    # Reject invalid links before publishing any of the generated population.
    # Previously a failed build wrote a new census/dispositions beside an old
    # index/report, leaving a mixed snapshot on disk.
    errors = validate_links(load_links(links_path), root)
    if errors:
        raise ValueError("\n".join(errors))
    census = census or generate_source_census(root)
    census_path = _root_path(root, CENSUS)
    dispositions_path = _root_path(root, DISPOSITIONS)
    report_path = _root_path(root, REPORT)
    census_path.parent.mkdir(parents=True, exist_ok=True)
    dispositions_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    census_path.write_text(json.dumps(census, indent=2) + "\n")
    dispositions = build_dispositions(root)
    dispositions_path.write_text(json.dumps(dispositions, indent=2) + "\n")
    data = build_index(root, links_path, census)
    data["source_digests"]["source_census"] = sha256(census_path)
    output.write_text(json.dumps(data, indent=2) + "\n")
    report_path.write_text(render_report(data) + "\n")
    return data


def render_report(index: dict[str, Any]) -> str:
    summary = index["summary"]
    census = index["source_census"]["summary"]
    dispositions_summary = index["dispositions"]["summary"]
    total_symbols = dispositions_summary["behavior_symbols"]
    production_symbols = dispositions_summary.get("production_behavior_symbols", total_symbols)
    excluded_symbols = dispositions_summary.get("symbols_excluded", 0)
    population = link_population(index.get("links", []))
    return "\n".join((
        "---",
        "reach: Reading the current engine/web/original-code Rosetta Stone coverage.",
        "status: generated",
        "---",
        "",
        "# Rosetta Stone coverage",
        "",
        f"Links: {summary['links']}. Mapping review: " + ", ".join(
            f"{status}={count}" for status, count in summary["mapping_review"].items()),
        f"Record scope: system inventories={population['system_inventory_rows']}; "
        f"behavior mappings={population['behavior_rows']}; "
        f"rows without original participants={population['rows_without_original']}.",
        "Feature completion: not measured. Inventory attribution and supported mappings do not establish complete feature translations.",
        f"Production source census: {census['production_reachable']} reachable modules of "
        f"{census['files']} scanned; lab-only={census['lab_only']}, test-only={census['test_only']}, "
        f"unresolved={census['unresolved']}.",
        f"Unresolved imports: static={census['unresolved_static_imports']}, "
        f"dynamic={census['unresolved_dynamic_imports']}.",
        f"Production dispositions: modules attributed={index['dispositions']['summary']['modules_attributed']}, "
        f"unresolved={index['dispositions']['summary']['modules_unresolved']}; "
        f"behavior symbols={total_symbols} (production={production_symbols}; excluded={excluded_symbols}); "
        f"data paths={len(index['dispositions']['summary']['data_paths'])}.",
        f"Presentation manifest rows linked={index['dispositions']['summary']['presentation_rows_linked']} "
        f"of {index['dispositions']['summary']['presentation_manifest_rows']}.",
        "",
        "This generated report preserves separate mapping-review, original-claim, and runtime-reachability states.",
        "Use `./dw3-research rosetta bundle <behavior-id>` for the bounded source-backed record.",
        "Use `./dw3-research rosetta audit --limit 10` for live reconciliation leads, even when this report is stale.",
    ))


def load_index(path: Path = INDEX) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"Rosetta index missing: {path}; run `dw3-research rosetta build`")
    return json.loads(path.read_text())


def index_staleness(index: dict[str, Any], root: Path = ROOT) -> list[str]:
    sources = {
        "links": root / "recovered/ddw3/rosetta-links.json",
        "ledger": root / "docs/research/evidence/ledger.json",
        "catalog": root / "docs/research/systems/catalog.json",
        "source_census": _root_path(root, CENSUS),
        "source_census_script": _root_path(root, SOURCE_CENSUS_SCRIPT),
        "dispositions": _root_path(root, DISPOSITIONS),
    }
    stale = []
    for name, path in sources.items():
        expected = index.get("source_digests", {}).get(name)
        if not path.is_file() or expected != sha256(path):
            stale.append(name)
    return stale


def validate_generated_freshness(root: Path = ROOT) -> list[str]:
    """Reject a stale generated index/report even when the editable links validate.

    The query path already refuses a stale index; ``rosetta check`` must hold
    the same gate, otherwise a changed ledger, catalog, census, disposition,
    or hand-edited report keeps serving outdated bundles while check passes.
    """
    index_path = _root_path(root, INDEX)
    report_path = _root_path(root, REPORT)
    if not index_path.is_file():
        return [f"missing generated rosetta index: {index_path.relative_to(root)}"]
    try:
        index = json.loads(index_path.read_text())
    except json.JSONDecodeError as error:
        return [f"generated rosetta index is not valid JSON: {error}"]
    stale = index_staleness(index, root)
    if stale:
        return [f"stale generated rosetta index/report: {name}" for name in stale]
    recorded = index.get("source_digests", {}).get("source_tree")
    # A missing sketch means the index predates this check; it still
    # validates/renders (backward compatible) until the next build records one.
    if recorded is not None and recorded != census_source_sketch(root):
        return ["stale stored source census: engine/web sources changed since "
                "`rosetta build`; run `dw3-research rosetta build`"]
    if not report_path.is_file():
        return [f"missing generated rosetta report: {report_path.relative_to(root)}"]
    try:
        expected = render_report(index) + "\n"
    except KeyError as error:
        return [f"generated rosetta index cannot render its report: missing {error}"]
    if report_path.read_text() != expected:
        return ["stale generated rosetta report"]
    return []


def _address_value(value: str | None) -> str | None:
    if not isinstance(value, str) or not value.lower().startswith("0x"):
        return None
    try:
        return f"0x{int(value, 16):08x}"
    except ValueError:
        return None


def _path_symbol(value: str | None) -> tuple[str, str] | None:
    if not isinstance(value, str) or ":" not in value:
        return None
    path, symbol = value.rsplit(":", 1)
    if not path or not symbol:
        return None
    return path, symbol


def _invalid_participant_query(mode: str, value: str | None) -> dict[str, Any]:
    return {
        "query_diagnostic": {
            "kind": "invalid_participant_query",
            "mode": mode,
            "value": value,
            "message": f"{mode} participant queries require path:symbol, for example {mode}/path/file.ts:symbol",
        }
    }


def query_index(
    mode: str,
    value: str | None = None,
    limit: int = 10,
    index_path: Path = INDEX,
    root: Path = ROOT,
) -> list[dict[str, Any]]:
    index = load_index(index_path)
    stale = index_staleness(index, root)
    if stale:
        raise ValueError("Rosetta index is stale for " + ", ".join(stale) + "; run `dw3-research rosetta build`")
    recorded = index.get("source_digests", {}).get("source_tree")
    # Same sketch `rosetta build` records and `rosetta check` enforces: an
    # index whose file digests are all fresh can still describe a census
    # enumerated from older engine/web sources. A missing sketch means the
    # index predates the sketch; it keeps querying (backward compatible)
    # until the next build records one.
    if recorded is not None and recorded != census_source_sketch(root):
        raise ValueError("stale stored source census: engine/web sources changed since "
                         "`rosetta build`; run `dw3-research rosetta build`")
    rows = index.get("links", [])
    if mode == "summary":
        return [index.get("summary", {})]
    if mode == "gaps":
        system = value if value else None
        gap_kind = None
        if "::" in (value or ""):
            system, gap_kind = value.split("::", 1)
        filtered = []
        for row in rows:
            if system and system not in row.get("system_ids", []):
                continue
            gaps = row.get("open_work", {}).get("gaps", [])
            if gap_kind:
                gaps = [gap for gap in gaps if gap.get("kind") == gap_kind]
            if gaps:
                row = json.loads(json.dumps(row))
                row["open_work"]["gaps"] = gaps
                filtered.append(row)
        rows = filtered
    elif mode == "system":
        rows = [row for row in rows if value in row.get("system_ids", [])]
    elif mode == "symbol":
        rows = [row for row in rows if any(value in json.dumps(group) for group in (row.get("engine", []), row.get("web", [])))]
    elif mode == "original":
        exact = [row for row in rows if any(item.get("id") == value for item in row.get("original", []))]
        if exact:
            rows = exact
        else:
            address = _address_value(value)
            matches = [
                (row, item)
                for row in rows
                for item in row.get("original", [])
                if _address_value(item.get("entry")) == address
            ] if address else []
            identities = {item.get("id") for _, item in matches}
            if len(identities) == 1 and matches:
                rows = []
                for original_row, item in matches:
                    row = json.loads(json.dumps(original_row))
                    row["query_diagnostic"] = {
                        "kind": "bare_address",
                        "message": "use the module-qualified original participant id",
                        "matched_original_id": item.get("id"),
                    }
                    rows.append(row)
            elif identities:
                match_limit = max(0, limit)
                rows = [{
                    "query_diagnostic": {
                        "kind": "ambiguous_bare_address",
                        "message": "address is reused; query with a module-qualified original participant id",
                        "address": address,
                        "matches": [
                            {
                                "link_id": row.get("id"),
                                "original_id": item.get("id"),
                                "module": item.get("module"),
                            }
                            for row, item in matches[:match_limit]
                        ],
                    }
                }]
            else:
                rows = [{
                    "query_diagnostic": {
                        "kind": "no_bare_address_match",
                        "message": "no module-qualified original participant matched the address",
                        "address": address,
                    }
                }] if address else []
    elif mode in {"engine", "web"}:
        participant = _path_symbol(value)
        if participant is None:
            rows = [_invalid_participant_query(mode, value)]
        else:
            rows = [
                row for row in rows
                if any(
                item.get("file") == participant[0] and item.get("symbol") == participant[1]
                for item in row.get(mode, [])
                )
            ]
    elif mode == "claim":
        rows = [row for row in rows if value in row.get("knowledge", {}).get("claim_ids", [])]
    elif mode == "surface":
        rows = [row for row in rows if value in row.get("presentation_row_ids", [])]
    elif mode == "bundle":
        rows = [row for row in rows if row.get("behavior_id") == value]
    # A diagnostic is the result for invalid or ambiguous input, so keep that
    # one bounded row even if the caller supplied a zero result limit.
    diagnostic_kind = rows[0].get("query_diagnostic", {}).get("kind") if rows else None
    if diagnostic_kind and diagnostic_kind != "bare_address":
        return rows[:1]
    return rows[:max(0, limit)]
