#!/usr/bin/env python3
"""Build the per-overlay census: one row per original assembly file.

The corpus has 300-plus overlay files and, until this tool existed, no view that
answered "what is this one, and do we already know?" for a single file. Absent
that, a filename got read as a claim about content (``smdldata`` is a pure data
blob with zero functions, not a model-data *system*) and work started on an
overlay nobody had checked.

Every column here is derived from an existing authority; nothing is inferred
from the filename:

* file size and line count from the assembly file itself;
* function counts, semantic names and per-function recovery state from
  ``recovered/ddw3/function-inventory.json`` (authority 2, built from the same
  assembly);
* claims and their ledger status from ``docs/research/evidence/ledger.json``,
  joined through each evidence record's ``source`` path;
* canonical documents from ``docs/research/systems/catalog.json`` for the
  systems those claims belong to, plus any research/todo document that names the
  overlay in its text.

A module with no claims and no named functions is reported as ``unidentified``.
That is a statement about our coverage, not about the overlay's content.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASM_ROOT = Path.home() / "ddw3/asm/dw2003"
INVENTORY = ROOT / "recovered/ddw3/function-inventory.json"
LEDGER = ROOT / "docs/research/evidence/ledger.json"
CATALOG = ROOT / "docs/research/systems/catalog.json"
DOC_ROOTS = ("docs/research", "docs/todo", "docs/plans")
OUT_JSON = ROOT / "docs/generated/overlay-census.json"
OUT_MD = ROOT / "docs/generated/overlay-census.md"

# Ordered worst-to-best; a module inherits the best status among its claims.
CLAIM_RANK = ("contradicted", "unresearched", "candidate",
              "partially_verified", "verified")

STATUS_ORDER = ("verified", "partially_verified", "candidate", "contradicted",
                "named-only", "mentioned-only", "unidentified")


def module_id(path: Path) -> str:
    """``.../pro/stgtrain/f0.s`` -> ``pro/stgtrain/f0`` (the inventory's id)."""
    return path.relative_to(ASM_ROOT).with_suffix("").as_posix()


def source_to_module(source: str) -> str | None:
    """Map a ledger evidence ``source`` path onto a module id.

    Ledger sources are absolute (``/home/dorij/ddw3/asm/...``) while the
    inventory records them with ``~``; normalise both onto the module id.
    """
    text = source.replace("~", str(Path.home()), 1) if source.startswith("~") else source
    marker = "asm/dw2003/"
    if marker not in text:
        return None
    tail = text.split(marker, 1)[1]
    if not tail.endswith(".s"):
        return None
    return tail[: -len(".s")]


def code_region(data: bytes) -> str:
    """Whether the disassembler marked a code region, and whether it holds lines.

    Every overlay is emitted as `.word` regardless of content, so the word/
    instruction ratio cannot separate code from data. The `# Start of code` /
    `# End of code` pair is the only structural marker in the file. It is a weak
    signal on its own -- `soundtst` has an *empty* pair yet 8 inventoried
    functions -- so it is reported as a raw observation, never folded into a
    verdict.
    """
    if b"\n# Start of code" not in data:
        return "absent"
    body = data.split(b"\n# Start of code", 1)[1]
    if b"\n# End of code" not in body:
        return "unterminated"
    inner = body.split(b"\n# End of code", 1)[0]
    return "empty" if not inner.strip() else f"{inner.count(chr(10).encode())} lines"


def collect_assembly() -> dict[str, dict]:
    """Every ``.s`` file under exe/ and pro/, including the nested variants."""
    rows: dict[str, dict] = {}
    for group in ("exe", "pro"):
        base = ASM_ROOT / group
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.s")):
            data = path.read_bytes()
            rows[module_id(path)] = {
                "module": module_id(path),
                "group": group,
                "file": str(path),
                "bytes": len(data),
                "lines": data.count(b"\n") + (1 if data and not data.endswith(b"\n") else 0),
                "code_region": code_region(data),
            }
    return rows


def split_blocks(functions: list[dict]) -> tuple[list[dict], list[dict]]:
    """Separate real functions from addresses dispositioned as blocks.

    A `.section`+label the extents gate refused, a jump-table case body, or a
    copied code blob is an address inside a function, not a function. Counting
    one as an unread function inflates every coverage figure the census prints.
    """
    blocks = [item for item in functions if item.get("role") == "block"]
    return [item for item in functions if item.get("role") != "block"], blocks


def collect_inventory(rows: dict[str, dict]) -> None:
    if not INVENTORY.exists():
        raise SystemExit(
            f"{INVENTORY.relative_to(ROOT)} is missing; run "
            "`.venv/bin/python3 tools/build_recovered_inventory.py`")
    inventory = json.loads(INVENTORY.read_text())
    for module in inventory["modules"]:
        row = rows.get(module["id"])
        if row is None:  # inventoried module whose assembly file moved away
            continue
        functions, blocks = split_blocks(module.get("functions", []))
        named = [f for f in functions if f.get("semantic_name")]
        subsystems = Counter(
            f["semantic_subsystem"] for f in named if f.get("semantic_subsystem"))
        recovery = Counter(
            (f.get("recovery") or {}).get("semantics", "unknown") for f in functions)
        row.update({
            "inventoried": True,
            "load_base": module.get("load_base"),
            "functions": len(functions),
            "blocks": len(blocks),
            "named_functions": len(named),
            "subsystems": [s for s, _ in subsystems.most_common()],
            "semantics": dict(recovery),
        })


def collect_ledger(rows: dict[str, dict]) -> dict[str, list[str]]:
    """Attach ledger claims to modules; return module -> systems."""
    ledger = json.loads(LEDGER.read_text())
    evidence_module = {}
    for item in ledger.get("evidence", []):
        target = source_to_module(item.get("source", ""))
        if target:
            evidence_module[item["id"]] = target

    per_module: dict[str, list[dict]] = defaultdict(list)
    for claim in ledger.get("claims", []):
        targets = {evidence_module[e] for e in claim.get("evidence", [])
                   if e in evidence_module}
        for target in targets:
            per_module[target].append(claim)

    systems: dict[str, list[str]] = {}
    for module, claims in per_module.items():
        row = rows.get(module)
        if row is None:
            continue
        best = max((c.get("status", "unresearched") for c in claims),
                   key=lambda s: CLAIM_RANK.index(s) if s in CLAIM_RANK else -1)
        row["claims"] = sorted(c["id"] for c in claims)
        row["claim_status"] = best
        row["systems"] = sorted({c["system"] for c in claims if c.get("system")})
        systems[module] = row["systems"]
    return systems


def doc_tokens(rows: dict[str, dict]) -> dict[str, str]:
    """Document tokens that resolve to exactly one module.

    A bare basename is only safe for a top-level `pro/` overlay. Those carry
    cryptic 8.3 names (`stcrdshp`, `smdldata`) that cannot occur by accident,
    whereas the `exe/` compilation units are named `start`, `loading` and
    `fns` -- matching those bare attributes every English sentence containing
    "start" to an overlay. Nested modules share basenames with their parents
    (`exe/f0` vs `pro/stgtrain/f0`), so they too are excluded. Everything else
    is reachable through `<name>.s` or the full module id, and any token that
    still resolves to more than one module is dropped rather than guessed at.
    """
    token_modules: dict[str, set[str]] = defaultdict(set)
    for module in rows:
        base = module.rsplit("/", 1)[-1]
        token_modules[module].add(module)
        token_modules[f"{base}.s"].add(module)
        if module.startswith("pro/") and module.count("/") == 1 and len(base) >= 5:
            token_modules[base].add(module)
    return {t: next(iter(m)) for t, m in token_modules.items() if len(m) == 1}


def collect_docs(rows: dict[str, dict], systems: dict[str, list[str]]) -> None:
    """Canonical docs from the catalog, plus documents naming the overlay."""
    canonical: dict[str, list[str]] = {}
    if CATALOG.exists():
        for entry in json.loads(CATALOG.read_text())["systems"]:
            canonical[entry["system"]] = entry.get("canonical_docs", [])

    tokens = doc_tokens(rows)

    # A leading `-` must not count as a boundary or `technique-loading` matches
    # the `loading` unit; a trailing one must, so `smdldata-backed` still counts.
    pattern = re.compile(
        r"(?<![\w/-])(" + "|".join(
            sorted(map(re.escape, tokens), key=len, reverse=True)) + r")(?![\w.])")
    mentions: dict[str, set[str]] = defaultdict(set)
    for doc_root in DOC_ROOTS:
        base_dir = ROOT / doc_root
        if not base_dir.is_dir():
            continue
        for doc in sorted(base_dir.rglob("*.md")):
            rel = doc.relative_to(ROOT).as_posix()
            for hit in pattern.findall(doc.read_text(errors="replace")):
                mentions[tokens[hit]].add(rel)

    for module, row in rows.items():
        base = module.rsplit("/", 1)[-1]
        canon: list[str] = []
        for system in systems.get(module, ()):
            for path in canonical.get(system, ()):
                if path not in canon:
                    canon.append(path)
        row["canonical_docs"] = list(canon)

        # A document named after the overlay beats a system-wide canonical doc:
        # `soundtst-full-decode.md` answers "where is soundtst written up" and
        # the ui-chrome family doc does not. Canonical docs come next, then the
        # remaining incidental mentions.
        seen = set()
        docs: list[str] = []
        for path in sorted(mentions.get(module, ())) + canon:
            if path not in seen:
                seen.add(path)
                docs.append(path)
        docs.sort(key=lambda p: (base not in Path(p).name, p not in canon))
        row["docs"] = docs


def classify(row: dict) -> None:
    """Derive the single decoded/not-decoded verdict shown in the table."""
    if row.get("claim_status"):
        row["status"] = row["claim_status"]
    elif row.get("named_functions"):
        row["status"] = "named-only"
    elif row.get("docs"):
        row["status"] = "mentioned-only"
    else:
        row["status"] = "unidentified"
    functions = row.get("functions")
    if functions is None:
        row["kind"] = "uninventoried"
    elif functions == 0:
        # The inventory discovers overlay functions from a known code entry plus
        # same-overlay jal targets. Zero means no entry was ever established --
        # which is a gap in our coverage, not proof the file holds no code.
        row["kind"] = "no-code-entry"
    else:
        row["kind"] = "code"


def family_of(module: str) -> str:
    """Group numbered siblings: ``pro/wstag880`` -> ``pro/wstag*``.

    This is a statement about naming, not content, and it is used only to report
    coverage across a group. A file inherits nothing from its family's status.
    """
    head, _, base = module.rpartition("/")
    stem = re.sub(r"\d+$", "", base)
    if not stem or stem == base:
        return module
    return f"{head}/{stem}*" if head else f"{stem}*"


def summarise_families(rows: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        groups[family_of(row["module"])].append(row)
    families = []
    for name, members in groups.items():
        if len(members) < 2:
            continue
        families.append({
            "family": name,
            "members": len(members),
            "with_claims": sum(1 for m in members if m.get("claims")),
            "with_docs": sum(1 for m in members if m.get("docs")),
            "unidentified": sum(1 for m in members if m["status"] == "unidentified"),
            "bytes": sum(m["bytes"] for m in members),
        })
    return sorted(families, key=lambda f: -f["members"])


def summarise(rows: list[dict]) -> dict:
    return {
        "modules": len(rows),
        "by_status": dict(Counter(r["status"] for r in rows).most_common()),
        "by_kind": dict(Counter(r["kind"] for r in rows).most_common()),
        "functions": sum(r.get("functions") or 0 for r in rows),
        "named_functions": sum(r.get("named_functions") or 0 for r in rows),
        "with_claims": sum(1 for r in rows if r.get("claims")),
        "with_docs": sum(1 for r in rows if r.get("docs")),
        "uninventoried": sum(1 for r in rows if not r.get("inventoried")),
    }


def render_markdown(rows: list[dict], summary: dict, families: list[dict]) -> str:
    order = {s: i for i, s in enumerate(STATUS_ORDER)}
    ordered = sorted(rows, key=lambda r: (order.get(r["status"], 99), r["module"]))

    out = ["# Overlay census — one row per original assembly file", ""]
    out.append(
        f"{summary['modules']} assembly files  "
        f"{summary['with_claims']} with ledger claims  "
        f"{summary['with_docs']} named in a document  "
        f"{summary['named_functions']}/{summary['functions']} functions carry a "
        "semantic name")
    out.append("")
    out.append(f"{summary['uninventoried']} of those files are absent from"
               " `recovered/ddw3/function-inventory.json` altogether, so their"
               " function counts read `—` rather than zero.")
    out.append("")
    out.append("Status is derived, never guessed. `verified`/`partially_verified`/"
               "`candidate`/`contradicted` is the best ledger status among the claims"
               " whose evidence cites this file. `named-only` means functions have"
               " inferred names but no claim cites the file. `mentioned-only` means a"
               " document names the file and nothing more. `unidentified` means"
               " **nothing here says what this file is** — which is not the same as"
               " the file being empty or unimportant.")
    out.append("")
    out.append("`kind=no-code-entry` means the inventory found zero functions,"
               " because no code entry point has been established for the file. Read"
               " that as *we have not looked*, not as *this file is data*. `code"
               " region` is the raw `# Start of code` marker state, reported as"
               " observed.")
    out.append("")
    out.append("Regenerate with `.venv/bin/python3 tools/build_overlay_census.py`.")
    out.append("")
    out.append("| status | module | kind | code region | bytes | fns | named |"
               " subsystems | claims | doc |")
    out.append("| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |")
    for row in ordered:
        docs = row.get("docs") or []
        doc = docs[0] if docs else "—"
        if len(docs) > 1:
            doc += f" (+{len(docs) - 1})"
        claims = row.get("claims") or []
        claim_cell = ", ".join(claims[:3]) + (f" (+{len(claims) - 3})" if len(claims) > 3 else "")
        subsystems = ", ".join((row.get("subsystems") or [])[:2]) or "—"
        out.append(
            f"| {row['status']} | `{row['module']}` | {row['kind']} |"
            f" {row['code_region']} | {row['bytes']} |"
            f" {row.get('functions', '—')} | {row.get('named_functions', '—')} |"
            f" {subsystems} | {claim_cell or '—'} | {doc} |")
    out.append("")

    grouped = {f["family"] for f in families}
    singles = [r for r in ordered if family_of(r["module"]) not in grouped]
    out.append(f"## Named system overlays — {len(singles)} files")
    out.append("")
    out.append("Everything that is not one of the numbered stage/segment siblings."
               " This is the short list to pick work from.")
    out.append("")
    for row in singles:
        docs = row.get("docs") or []
        out.append(f"- `{row['module']}` — **{row['status']}**, {row['kind']},"
                   f" {row.get('functions', '?')} fns"
                   f" ({row.get('named_functions', 0)} named)"
                   f" — {docs[0] if docs else 'no doc'}")
    out.append("")

    out.append("## Families of numbered siblings")
    out.append("")
    out.append("Grouped by name only, to show where a whole group is uncovered."
               " A file inherits nothing from its family: a decoded *format* does"
               " not make each member's contents established.")
    out.append("")
    out.append("| family | files | with claims | with docs | unidentified | bytes |")
    out.append("| --- | ---: | ---: | ---: | ---: | ---: |")
    for fam in families:
        out.append(f"| `{fam['family']}` | {fam['members']} | {fam['with_claims']} |"
                   f" {fam['with_docs']} | {fam['unidentified']} | {fam['bytes']} |")
    out.append("")

    unidentified = [r for r in ordered if r["status"] == "unidentified"]
    out.append(f"## Unidentified — {len(unidentified)} files, largest first")
    out.append("")
    out.append("No claim, no named function and no document mentions these."
               " Check one here before assuming its filename describes it.")
    out.append("")
    for row in sorted(unidentified, key=lambda r: -r["bytes"]):
        out.append(f"- `{row['module']}` — {row['kind']}, {row['bytes']} bytes,"
                   f" {row.get('functions', '?')} functions")
    out.append("")

    no_entry = [r for r in ordered if r["kind"] == "no-code-entry"]
    out.append(f"## No code entry established — {len(no_entry)} files")
    out.append("")
    out.append("The inventory found no functions in these because it has no entry"
               " point to start from. Some are genuinely data; establishing which is"
               " the open question. Do not treat the filename as the answer —"
               " `smdldata` sounds like a model-data *system* and is a 385 KiB blob"
               " with no established entry and no claim against it.")
    out.append("")
    for row in sorted(no_entry, key=lambda r: -r["bytes"]):
        out.append(f"- `{row['module']}` — {row['bytes']} bytes, code region"
                   f" {row['code_region']}, {row['status']}")
    out.append("")
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="fail if the committed census is out of date")
    args = parser.parse_args()

    rows = collect_assembly()
    if not rows:
        raise SystemExit(f"no assembly files under {ASM_ROOT}")
    collect_inventory(rows)
    systems = collect_ledger(rows)
    collect_docs(rows, systems)
    for row in rows.values():
        classify(row)

    ordered = sorted(rows.values(), key=lambda r: r["module"])
    summary = summarise(ordered)
    families = summarise_families(ordered)
    payload = {
        "schema_version": 1,
        "authority": 2,
        "scope": "every .s file under ~/ddw3/asm/dw2003/{exe,pro}",
        "sources": {
            "inventory": "recovered/ddw3/function-inventory.json",
            "ledger": "docs/research/evidence/ledger.json",
            "catalog": "docs/research/systems/catalog.json",
        },
        "summary": summary,
        "families": families,
        "modules": ordered,
    }
    text_json = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    text_md = render_markdown(ordered, summary, families)

    if args.check:
        stale = [p.relative_to(ROOT).as_posix()
                 for p, want in ((OUT_JSON, text_json), (OUT_MD, text_md))
                 if not p.exists() or p.read_text() != want]
        if stale:
            raise SystemExit("overlay census is stale: " + ", ".join(stale))
        print(f"overlay census up to date ({summary['modules']} modules)")
        return

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(text_json)
    OUT_MD.write_text(text_md)
    print(f"wrote {OUT_MD.relative_to(ROOT)} and {OUT_JSON.relative_to(ROOT)}")
    print(f"  {summary['modules']} modules: " + ", ".join(
        f"{k}={v}" for k, v in summary["by_status"].items()))


if __name__ == "__main__":
    main()
