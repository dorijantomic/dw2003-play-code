from __future__ import annotations

import argparse
import bisect
import collections
import hashlib
import json
import mmap
import os
import re
import sqlite3
import struct
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from .index import build_index, build_ledger_index, index_staleness, refresh_index, reindex_paths, stable_id
from .metadata import atomic_json, index_lock, metadata_lock
from .workflow import (
    PRIMARY_AUTHORITY,
    summary_literal_warnings,
    QUANTIFIER,
    apply_packets,
    clear_journal,
    create_epoch,
    current_snapshot,
    packet_paths,
    validate_packets,
    write_journal,
)
from .rosetta import INDEX as ROSETTA_INDEX, LINKS as ROSETTA_LINKS, DISPOSITIONS as ROSETTA_DISPOSITIONS, build_dispositions, query_index as query_rosetta_index, validate_links as validate_rosetta_links, validate_dispositions, validate_generated_freshness as validate_rosetta_freshness, write_index as write_rosetta_index


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB = ROOT / ".dw3-research/index.sqlite3"
LEDGER = ROOT / "docs/research/evidence/ledger.json"
SYSTEMS_DIR = ROOT / "docs/research/systems"
DOCS_DIR = ROOT / "docs/research"
SYSTEM_CATALOG = SYSTEMS_DIR / "catalog.json"
REVIEWS_DIR = ROOT / "docs/research/evidence/reviews"
STATUSES = {"unresearched", "candidate", "partially_verified", "verified", "contradicted"}
FRONTIER_STATUSES = {"open", "assigned", "needs_evidence", "blocked", "resolved"}
ACTIONABLE_FRONTIER_STATUSES = {"open", "needs_evidence"}
TYPES = {
    "u8": "<B", "s8": "<b", "u16": "<H", "s16": "<h",
    "u32": "<I", "s32": "<i", "f32": "<f",
}


def integer(value: str) -> int:
    return int(value, 0)


def connection(args: argparse.Namespace) -> sqlite3.Connection:
    if not args.db.exists():
        raise SystemExit(f"index missing: {args.db}; run `dw3-research index`")
    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    return conn


_STALENESS_CACHE: dict[str, list[str]] = {}


def self_written_sources() -> list[Path]:
    """Indexed sources this CLI rewrites itself (record-finding / promote-finding).

    The review files belong here too and were missing until 2026-08-17:
    `record_local_review.py` writes one and links it, so recording a review left the
    index stale on a file the CLI itself had just produced, and the next command
    demanded a full rebuild. Verified by recording a review and immediately running
    `review-bundle` with no manual reindex in between.
    """
    return [
        LEDGER,
        SYSTEM_CATALOG,
        *sorted(SYSTEMS_DIR.glob("*.manifest.json")),
        *sorted(REVIEWS_DIR.glob("*.review.json")),
    ]


def index_stale_reasons(db: Path) -> list[str]:
    """Memoized per process: a single CLI run sees one filesystem snapshot.

    Sources the CLI itself rewrites are repaired in place rather than reported: a
    `record-finding` necessarily edits the ledger and a manifest, and demanding a
    full rebuild between consecutive recordings would be pure friction. Every other
    stale source is still reported, so the cache can never be trusted while it
    disagrees with a source the CLI does not own.
    """
    key = str(db)
    if key in _STALENESS_CACHE:
        return _STALENESS_CACHE[key]
    reasons = index_staleness(ROOT, db)
    # The repair the docstring promises was MISSING until 2026-08-17: this function
    # only ever reported. The cost was real and paid on every recording session --
    # `record-finding` rewrites the ledger and a manifest, so the very next command
    # refused to run until a full `dw3-research index`, which is exactly the friction
    # the docstring says does not exist. Recording four reviews and two claims in one
    # session needed eight manual reindexes.
    if reasons and db.exists():
        owned = [path for path in self_written_sources() if path.exists()]
        # Only touch the index when a source WE own is implicated; a stale
        # hand-edited source must still be reported, never quietly re-stamped.
        implicated = [path for path in owned if any(str(path) in r for r in reasons)]
        if implicated:
            try:
                reindex_paths(ROOT, db, implicated)
            except sqlite3.Error:
                # Read paths hold a shared lock, so the write can lose a race with a
                # concurrent writer. Reporting staleness is the safe degradation --
                # never swallow it.
                pass
            else:
                reasons = index_staleness(ROOT, db)
    _STALENESS_CACHE[key] = reasons
    return reasons


def require_fresh_index(db: Path, purpose: str) -> None:
    """Refuse to answer a durable-knowledge question from a stale cache.

    The index is a derived cache keyed by source content: evidence IDs hash the
    source path plus the exact indexed text. A stale cache therefore still
    resolves IDs whose underlying lines have changed or vanished, which would
    let a validation step pass on records that are actually broken.
    """
    reasons = index_stale_reasons(db)
    if not reasons:
        return
    detail = "; ".join(reasons)
    raise SystemExit(f"{purpose} requires a current index ({detail}); run `dw3-research index`")


def relative(path: str) -> str:
    try:
        return str(Path(path).relative_to(ROOT))
    except ValueError:
        return path.replace(str(Path.home()), "~", 1)


def emit(args: argparse.Namespace, rows: list[dict]) -> None:
    if getattr(args, "json", False):
        print(json.dumps(rows, indent=2))
        return
    if not rows:
        print("no results")
        return
    for row in rows:
        print(" | ".join(f"{key}={value}" for key, value in row.items() if value not in (None, "")))


def cmd_index(args: argparse.Namespace) -> None:
    resolved = args.db.expanduser().resolve()
    cache_root = (ROOT / ".dw3-research").resolve()
    if not (resolved.is_relative_to(cache_root) or resolved.is_relative_to(Path("/tmp"))):
        raise SystemExit("refusing index write outside .dw3-research/ or /tmp")
    with metadata_lock(ROOT), index_lock(ROOT, shared=False):
        if args.changed:
            if args.ledger_only:
                raise SystemExit("--changed and --ledger-only are mutually exclusive")
            try:
                counts = refresh_index(ROOT, args.db)
            except (sqlite3.Error, ValueError) as error:
                raise SystemExit(f"incremental index refresh unavailable: {error}; run `dw3-research index`") from None
        else:
            counts = build_ledger_index(ROOT, args.db) if args.ledger_only else build_index(ROOT, args.db)
    print("indexed " + " ".join(f"{key}={value}" for key, value in counts.items()) + f" db={args.db}")


def cmd_search(args: argparse.Namespace) -> None:
    conn = connection(args)
    like = f"%{args.query}%"
    use_fts = len(args.query) >= 3
    fts = '"' + args.query.replace('"', '""') + '"'
    params: list[object] = [fts] if use_fts else [like, like, like]
    kind_sql = ""
    if args.kind:
        kind_sql = " AND (r.kind=? OR s.kind=?)"
        params.extend([args.kind, args.kind])
    params.append(args.limit)
    if use_fts:
        query = f"""
          SELECT r.kind,r.key,r.text,r.start_line,r.end_line,r.address,r.evidence_id,
                 s.path,s.authority,s.non_ground_truth
          FROM records_fts x JOIN records r ON r.id=x.rowid
          JOIN sources s ON s.id=r.source_id
          WHERE records_fts MATCH ?{kind_sql}
          ORDER BY s.authority,r.id LIMIT ?
        """
    else:
        query = f"""
      SELECT r.kind,r.key,r.text,r.start_line,r.end_line,r.address,r.evidence_id,
             s.path,s.authority,s.non_ground_truth
      FROM records r JOIN sources s ON s.id=r.source_id
      WHERE (r.key LIKE ? OR r.text LIKE ? OR s.path LIKE ?){kind_sql}
      ORDER BY s.authority,r.id LIMIT ?
        """
    rows = []
    for item in conn.execute(query, params):
        locator = f"L{item['start_line']}" if item["start_line"] else item["key"]
        text = " ".join(item["text"].split())[: args.chars]
        rows.append({"evidence": item["evidence_id"], "authority": item["authority"],
                     "kind": item["kind"], "source": relative(item["path"]),
                     "locator": locator, "text": text,
                     "non_ground_truth": bool(item["non_ground_truth"]) or None})
    # Functions are searched separately so source snippets remain bounded.
    if len(rows) < args.limit:
        remaining = args.limit - len(rows)
        if use_fts:
            fquery = """
              SELECT f.*,s.path,s.authority,s.non_ground_truth FROM functions_fts x
              JOIN functions f ON f.id=x.rowid JOIN sources s ON s.id=f.source_id
              WHERE functions_fts MATCH ? ORDER BY s.authority,f.id LIMIT ?"""
            fparams: list[object] = [fts, remaining]
        else:
            fquery = """
          SELECT f.*,s.path,s.authority,s.non_ground_truth FROM functions f
          JOIN sources s ON s.id=f.source_id
          WHERE f.name LIKE ? OR s.path LIKE ?
          ORDER BY s.authority,f.id LIMIT ?"""
            fparams = [like, like, remaining]
        for item in conn.execute(fquery, fparams):
            rows.append({"evidence": item["evidence_id"], "authority": item["authority"],
                         "kind": "function", "source": relative(item["path"]),
                         "locator": f"L{item['start_line']}-L{item['end_line']} @0x{item['address']:08x}",
                         "text": " ".join(item["body"].split())[: args.chars],
                         "non_ground_truth": bool(item["non_ground_truth"]) or None})
    for item in conn.execute("""
          SELECT sy.name,sy.address,sy.line,sy.evidence_id,s.path,s.authority
          FROM symbols sy JOIN sources s ON s.id=sy.source_id
          WHERE sy.name LIKE ? OR printf('0x%08x',sy.address) LIKE ? OR s.path LIKE ?
          ORDER BY s.authority,sy.id LIMIT ?""", (like, like, like, args.limit)):
        rows.append({"evidence": item["evidence_id"], "authority": item["authority"],
                     "kind": "assembly_label", "source": relative(item["path"]),
                     "locator": f"L{item['line']}" + (f" @0x{item['address']:08x}" if item["address"] is not None else ""),
                     "text": item["name"]})
    for item in conn.execute("""
          SELECT r.kind,r.value,r.line,r.evidence_id,f.name,s.path,s.authority
          FROM refs r JOIN functions f ON f.id=r.function_id JOIN sources s ON s.id=f.source_id
          WHERE r.value LIKE ? ORDER BY s.authority,r.id LIMIT ?""", (like, args.limit)):
        rows.append({"evidence": item["evidence_id"], "authority": item["authority"],
                     "kind": item["kind"], "source": relative(item["path"]),
                     "locator": f"{item['name']} L{item['line']}", "text": item["value"]})
    for item in conn.execute("""
      SELECT path,kind,authority,non_ground_truth,size,sha1,associated_path FROM sources
      WHERE path LIKE ? OR kind LIKE ? ORDER BY authority,path LIMIT ?
    """, (like, like, args.limit)):
        rows.append({"evidence": "SRC-" + item["sha1"][:12], "authority": item["authority"],
                     "kind": item["kind"], "source": relative(item["path"]),
                     "locator": f"size=0x{item['size']:x}",
                     "text": ("screenshot=" + relative(item["associated_path"])) if item["associated_path"] else "",
                     "non_ground_truth": bool(item["non_ground_truth"]) or None})
    rows.sort(key=lambda item: (item["authority"], item["kind"], item["source"], item["locator"]))
    emit(args, rows[:args.limit])


def find_function(conn: sqlite3.Connection, identifier: str) -> sqlite3.Row:
    address = None
    try:
        address = int(identifier.removeprefix("F"), 0)
    except ValueError:
        pass
    row = conn.execute("""
      SELECT f.*,s.path,s.authority FROM functions f JOIN sources s ON s.id=f.source_id
      WHERE lower(f.name)=lower(?) OR f.address=? ORDER BY s.authority LIMIT 1
    """, (identifier, address)).fetchone()
    if row is None:
        raise SystemExit(f"function not found: {identifier}")
    return row


def relation_rows(conn: sqlite3.Connection, row: sqlite3.Row, relation: str) -> list[dict]:
    if relation == "callees":
        found = conn.execute("SELECT value,line,evidence_id FROM refs WHERE function_id=? AND kind='callee' ORDER BY line", (row["id"],))
        return [{"function": item["value"], "line": item["line"], "evidence": item["evidence_id"]} for item in found]
    found = conn.execute("""
      SELECT f.name,r.line,r.evidence_id,s.path FROM refs r
      JOIN functions f ON f.id=r.function_id JOIN sources s ON s.id=f.source_id
      WHERE r.kind='callee' AND r.target_address=? ORDER BY s.authority,f.name
    """, (row["address"],))
    rows = [{"function": item["name"], "line": item["line"], "source": relative(item["path"]),
             "evidence": item["evidence_id"]} for item in found]
    overlay = Path(row["path"]).parent.name.removesuffix("_c")
    assembly = conn.execute("""
      SELECT r.start_line,r.evidence_id,s.path FROM records r JOIN sources s ON s.id=r.source_id
      WHERE r.kind='assembly_call' AND r.address=? AND s.path LIKE ? ORDER BY r.start_line
    """, (row["address"], f"%/{overlay}.s"))
    rows.extend({"function": "assembly call", "line": item["start_line"],
                 "source": relative(item["path"]), "evidence": item["evidence_id"]}
                for item in assembly)
    return rows


def cmd_function(args: argparse.Namespace) -> None:
    conn = connection(args)
    try:
        row = find_function(conn, args.identifier)
    except SystemExit:
        cmd_assembly_function(args, conn)
        return
    refs = conn.execute("SELECT kind,value,line,evidence_id FROM refs WHERE function_id=? ORDER BY line,kind", (row["id"],)).fetchall()
    overlay = Path(row["path"]).parent.name.removesuffix("_c")
    asm = conn.execute("""
      SELECT sy.name,sy.line,sy.evidence_id,s.path FROM symbols sy JOIN sources s ON s.id=sy.source_id
      WHERE sy.address=? AND s.kind='original_assembly' AND s.path LIKE ? ORDER BY sy.line LIMIT 5
    """, (row["address"], f"%/{overlay}.s")).fetchall()
    lines = row["body"].splitlines()
    snippet = lines if args.expand else lines[:args.lines]
    bundle = {
        "function": row["name"], "address": f"0x{row['address']:08x}",
        "source": relative(row["path"]), "lines": f"{row['start_line']}-{row['end_line']}",
        "authority": row["authority"], "evidence": row["evidence_id"],
        "callers": relation_rows(conn, row, "callers"),
        "callees": relation_rows(conn, row, "callees"),
        "references": [dict(item) for item in refs[:args.limit]],
        "assembly": [{"source": relative(item["path"]), "line": item["line"],
                      "label": item["name"], "evidence": item["evidence_id"]} for item in asm],
        "snippet": "\n".join(snippet) + ("\n…" if len(snippet) < len(lines) else ""),
    }
    print(json.dumps(bundle, indent=2))


def cmd_assembly_function(args: argparse.Namespace, conn: sqlite3.Connection) -> None:
    try:
        address = int(args.identifier.removeprefix("F"), 0)
    except ValueError:
        address = None
    source_filter = f"%{args.source}%" if args.source else "%"
    matches = conn.execute("""
      SELECT sy.*,s.path,s.authority FROM symbols sy JOIN sources s ON s.id=sy.source_id
      WHERE (lower(sy.name)=lower(?) OR sy.address=?) AND s.kind='original_assembly'
        AND s.path LIKE ?
      ORDER BY s.authority, length(s.path), s.path
    """, (args.identifier, address, source_filter)).fetchall()
    if not matches:
        raise SystemExit(f"function not found: {args.identifier}")
    row = matches[0]
    # Overlays share load bases (0x80082cb0 is used by cardgame, fieldstg and
    # more), so one address resolves in several .s files. Picking the first
    # silently has produced wrong-overlay claims; surface the rivals instead.
    rivals = [relative(item["path"]) for item in matches
              if item["path"] != row["path"]]
    path = Path(row["path"])
    all_lines = path.read_text(errors="replace").splitlines()
    start = row["line"] - 1
    finish = min(len(all_lines), start + (2000 if args.expand else args.lines))
    for index in range(start, finish - 1):
        if "jr $ra" in all_lines[index]:
            finish = min(finish, index + 2)
            break
    snippet = "\n".join(f"{number + 1}: {all_lines[number]}" for number in range(start, finish))
    calls = conn.execute("""
      SELECT r.text,r.start_line,r.evidence_id,s.path FROM records r JOIN sources s ON s.id=r.source_id
      WHERE r.kind='assembly_call' AND r.address=? AND s.path LIKE ?
      ORDER BY s.path,r.start_line LIMIT ?
    """, (row["address"], source_filter, args.limit)).fetchall()
    bundle = {"function": args.identifier, "address": f"0x{row['address']:08x}",
              "source": relative(row["path"]), "line": row["line"],
              "authority": row["authority"], "evidence": row["evidence_id"],
              "callers": [{"source": relative(item["path"]), "line": item["start_line"],
                           "instruction": item["text"], "evidence": item["evidence_id"]} for item in calls],
              "snippet": snippet}
    if rivals:
        bundle["ambiguous_overlays"] = sorted(set(rivals))
        bundle["ambiguity_warning"] = (
            "this address also resolves in the listed overlays; re-run with "
            "--source <overlay> and word-match the text before anchoring a claim"
        )
    print(json.dumps(bundle, indent=2))


def cmd_relation(args: argparse.Namespace) -> None:
    conn = connection(args)
    row = find_function(conn, args.identifier)
    emit(args, relation_rows(conn, row, args.command)[:args.limit])


def cmd_references(args: argparse.Namespace) -> None:
    conn = connection(args)
    row = find_function(conn, args.identifier)
    rows = [dict(item) for item in conn.execute(
        "SELECT kind,value,line,evidence_id AS evidence FROM refs WHERE function_id=? ORDER BY line,kind LIMIT ?",
        (row["id"], args.limit))]
    emit(args, rows)


# Corpus filters for `code-search`. Each maps to the indexed source paths whose
# assembly lines are searchable as text, with the authority the hits carry.
CODE_CORPORA: dict[str, tuple[str, str, int]] = {
    "original": ("original assembly ~/ddw3/asm/dw2003", "%/ddw3/asm/dw2003/%", 2),
    "decomp": ("decompiled asm closure exe-decomp/**/_asm", "%/exe-decomp/%", 3),
}
CODE_KINDS = ("assembly_label", "assembly_call")


def cmd_code_search(args: argparse.Namespace) -> None:
    """Full-text search of indexed assembly lines, with the scanned denominator.

    `search` matches label NAMES and `jal` targets only, so a null result from it
    is not evidence of absence for anything else -- instruction text, a `.word`
    pointer-table entry, or a register-constructed call are all invisible to it.
    Those lines are nonetheless indexed: every non-blank assembly line except
    `.include`/`.section`/`.global`/comment boilerplate carries a label, and the
    label's evidence row stores the whole line in `exact`. This command queries
    that column and reports how many lines it scanned, so "0 of N" is a citable
    negative rather than an unbounded one.

    Requires a current index: a stale cache could otherwise miss a line that
    exists on disk and manufacture exactly the false negative this exists to
    prevent. Hits are authority 2 (original assembly), the same authority a
    manual read of the file would carry.
    """
    require_fresh_index(args.db, "code-search")
    conn = connection(args)
    label, path_like, authority = CODE_CORPORA[args.corpus]
    kinds = ",".join("?" * len(CODE_KINDS))
    where = f"kind IN ({kinds}) AND source_path LIKE ?"
    base: list[object] = [*CODE_KINDS, path_like]

    scanned = conn.execute(f"SELECT COUNT(*) FROM evidence WHERE {where}", base).fetchone()[0]
    if args.regex:
        conn.create_function("re_match", 2, lambda p, s: 1 if re.search(p, s or "") else 0)
        match_sql, needle = "re_match(?, exact)", args.pattern
    else:
        # A literal search must be literal. LIKE would otherwise read `_` and `%`
        # in the pattern as wildcards, inflating the hit count and the file list
        # that this command exists to make citable ("sltiu _v0" silently matching
        # "sltiu $v0" is a wrong answer, not a lenient one).
        escaped = args.pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        match_sql, needle = "exact LIKE ? ESCAPE '\\'", f"%{escaped}%"
    params = [*base, needle]

    total = conn.execute(
        f"SELECT COUNT(*) FROM evidence WHERE {where} AND {match_sql}", params).fetchone()[0]
    files = conn.execute(
        f"SELECT COUNT(DISTINCT source_path) FROM evidence WHERE {where} AND {match_sql}",
        params).fetchone()[0]
    hits = conn.execute(
        f"""SELECT evidence_id,source_path,locator,exact FROM evidence
            WHERE {where} AND {match_sql}
            ORDER BY source_path, CAST(SUBSTR(locator,2) AS INTEGER) LIMIT ?""",
        [*params, args.limit]).fetchall()

    rows = [{"evidence": item["evidence_id"], "authority": authority,
             "source": relative(item["source_path"]), "locator": item["locator"],
             "text": " ".join(item["exact"].split())[: args.chars]} for item in hits]
    summary = {"corpus": label, "pattern": args.pattern, "lines_scanned": scanned,
               "hits": total, "files": files, "shown": len(rows)}
    if args.json:
        print(json.dumps({"summary": summary, "hits": rows}, indent=2))
        return
    print(" | ".join(f"{key}={value}" for key, value in summary.items()))
    if not total:
        # The whole point of the command: an explicit, bounded absence result.
        print(f"ABSENT: no assembly line in {label} matches; 0 of {scanned} lines scanned")
        # ... but a zero here proves the absence of a STRING, and it gets read as
        # the absence of a FACT. Both readings were wrong on 2026-08-09: searches
        # for "slt $a2, $a2, $v0" and "sh\t$v0, 0x4e0" returned 0 while both
        # instructions were present, because this corpus prints the two-operand
        # form ("slt $a2, $v0") and single-spaces its operands. So when the first
        # token of the pattern DOES occur, say so -- that is a notation mismatch,
        # not an absence, and it is the caller's cue to re-spell the query.
        head = (args.pattern.split() or [""])[0].strip()
        if not args.regex and head and head != args.pattern:
            escaped = head.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            near = conn.execute(
                f"SELECT COUNT(*) FROM evidence WHERE {where} AND exact LIKE ? ESCAPE '\\'",
                [*base, f"%{escaped}%"]).fetchone()[0]
            if near:
                print(
                    f"CAUTION: {head!r} alone occurs on {near} of those lines, so this zero "
                    f"may be a NOTATION difference, not an absence. This corpus prints MIPS "
                    f"in two-operand form and single-spaces operands. Re-spell the query, or "
                    f"search the encoded `.word`, before citing this as evidence of absence."
                )
        return
    for row in rows:
        print(" | ".join(f"{key}={value}" for key, value in row.items()))
    if total > len(rows):
        print(f"... {total - len(rows)} further hits suppressed; raise --limit")


def overlay_token(path: str) -> str | None:
    """Overlay name for a source path, so two overlays sharing a load base never merge.

    `~/ddw3/asm/dw2003/pro/cardgame.s` and `exe-decomp/cardgame_c/F0x...c` are both
    `cardgame`; `pro/fightstg.s` is `fightstg`. Returns None when the path is not
    overlay-scoped, in which case the caller must not filter on it.
    """
    parts = [part for part in str(path).replace("\\", "/").split("/") if part]
    for part in parts:
        if part.endswith("_c") and len(part) > 2:
            return part[:-2]
    if parts and parts[-1].endswith(".s"):
        return parts[-1][:-2]
    return None


# An overlay named anywhere inside a free-text `source` string. Ledger sources are
# prose, not paths -- "~/ddw3/asm/dw2003/pro/wstag740.s and wstag741.s, web/assets/
# data/fire_traps.json" names two overlays and `overlay_token` sees none of them,
# because the string does not END in one. That silent None is what made every
# `wstag` anchor apply to all 294 stage overlays (see evidence_overlay_tokens).
_OVERLAY_IN_TEXT = re.compile(r"\b([A-Za-z][A-Za-z0-9_]{2,})(?:\.s|_c|\.bin)\b")


def evidence_overlay_tokens(source: str) -> set[str] | None:
    """Every overlay an evidence `source` names, or None when it names none.

    `overlay_token` answers "which overlay is this PATH", which is right for an
    indexed source row and wrong for a ledger evidence entry, whose `source` is a
    free-text list of several files. It returned None for all of them, and None
    means "not overlay-scoped, do not filter" -- so an anchor recorded from
    wstag740 counted as prior work in every other stage overlay. All ~294 `wstag`
    overlays load at 0x800a5de0, so one address resolves inside all of them and
    `known` answered DECODED for all 294 (measured 2026-08-11 on 0x800a6118).

    A source containing a wildcard (`wstag*.s`, "all 294 ... overlays") is
    deliberately reported as unscoped: it really does span the family, so the
    caller must treat it as family-wide, not as a decode of one member.
    """
    text = str(source)
    if "*" in text:
        return None
    tokens = {match.group(1) for match in _OVERLAY_IN_TEXT.finditer(text)}
    return tokens or None


def _function_map(conn) -> dict[str, list[tuple[int, str]]]:
    """Every indexed function address, grouped by source and sorted, loaded once.

    The first version queried per target instead, which made a 96-target worklist
    time out at two minutes -- and a check too slow to run over a worklist is the
    same as no check. The whole table is a few thousand rows; load it.
    """
    grouped: dict[str, list[tuple[int, str]]] = {}
    for row in conn.execute(
        """SELECT f.name, f.address, s.path FROM functions f
           JOIN sources s ON s.id = f.source_id WHERE f.address IS NOT NULL"""):
        grouped.setdefault(row["path"], []).append((row["address"], row["name"]))
    # The index's function table is derived ENTIRELY from the decompiled C corpus
    # -- zero rows come from a `.s` file -- so assembly targets had no boundary and
    # 87 of 96 card-effect callees reported exact_start=NO. tools/build_function_
    # extents.py derives entries from the assembly itself at authority 2; union the
    # two, because each covers the other's gap (the C set holds the 7 cardgame
    # functions whose address is constructed rather than called).
    if FUNCTION_EXTENTS.exists():
        payload = json.loads(FUNCTION_EXTENTS.read_text()).get("sources", {})
        for path, item in payload.items():
            entries = grouped.setdefault(path, [])
            for function in item.get("functions", []):
                entries.append((function["address"], f"F0x{function['address']:08x}"))
    for entries in grouped.values():
        entries.sort()
    return grouped


def _known_candidates(functions: dict, address: int) -> list[tuple[str, int, int, str]]:
    """Per-overlay (name, start, end, path) blocks covering `address`.

    Grouped by overlay because one overlay contributes several sources (its .s and
    its decompiled .c), and because overlays SHARE load addresses -- pro/cardgame,
    pro/fightstg and pro/stdwtitl all cover 0x8008xxxx. Merging them offered
    fightstg's BATTLE-C002 as prior work on a cardgame function while this command
    was being built.
    """
    rows = []
    for path, entries in functions.items():
        position = bisect.bisect_right(entries, (address, chr(0x10FFFF))) - 1
        if position < 0:
            continue
        start, name = entries[position]
        end = entries[position + 1][0] if position + 1 < len(entries) else start + 0x400
        if not (start <= address < end):
            continue
        exact = (start == address)
        if not exact:
            # The target sits INSIDE an indexed function rather than at its entry,
            # which is the normal case here: the decompiled corpus indexes only the
            # functions it recovered, so most jal targets are not indexed starts.
            # Anchoring the window at the enclosing function's start counted claims
            # about code BEFORE the target as decodes of it -- F0x8008c044 was
            # reported DECODED on the strength of F0x8008bc6c's claims. Narrow the
            # window to [target, next known start) so only evidence at or after the
            # target can support the verdict.
            name = f"{name} (enclosing; target is not an indexed start)"
            start = address
        rows.append((name, start, end, path, exact))
    grouped: dict[str, list] = {}
    for item in rows:
        grouped.setdefault(overlay_token(item[3]) or "?", []).append(item)
    reduced = []
    for items in grouped.values():
        # Prefer a source that starts EXACTLY at the target. Widening to the union
        # of every source in the overlay would throw away the precise assembly
        # boundary the extents file exists to provide.
        precise = [item for item in items if item[4]]
        if precise:
            reduced.append(min(precise, key=lambda item: item[2] - item[1]))
        else:
            reduced.append((items[0][0], min(i[1] for i in items),
                            max(i[2] for i in items), items[0][3], False))
    return reduced


def _known_item(functions, parsed, by_evidence, documents, prose, address, *,
                overlay=None, include_all=False):
    """Structured verdict for one address. cmd_known renders it; tools join it."""
    candidates = _known_candidates(functions, address)
    if not candidates:
        candidates = [("(no indexed function)", address, address + 4, "", False)]
    # Sharing is a property of the ADDRESS, so measure it before --overlay
    # narrows the view.
    family_size = len([c for c in candidates if overlay_token(c[3])])
    if overlay:
        candidates = [c for c in candidates if overlay_token(c[3]) == overlay]
    needle = f"{address:08x}"
    mentions = [("claim", claim["id"], claim.get("status", ""))
                for claim, blob in prose if needle in blob]
    mentions += [("doc", path, "") for path, text in documents if needle in text]

    shown, skipped, ambiguous = [], [], []
    for name, start, end, path, exact in candidates:
        token = overlay_token(path)
        scoped, unscoped = [], []
        for item, source_tokens, hits in parsed:
            if not any(start <= hit < end for hit in hits):
                continue
            if not token or source_tokens is None:
                unscoped.append(item)
            elif token in source_tokens:
                scoped.append(item)
        shared = bool(token) and family_size > 1
        anchored = scoped if shared else scoped + unscoped
        family_only = unscoped if shared else []
        citing = {claim["id"]: claim for item in anchored
                  for claim in by_evidence.get(item["id"], [])}
        family_citing = {claim["id"]: claim for item in family_only
                         for claim in by_evidence.get(item["id"], [])}
        verdict = ("DECODED" if citing else "AMBIGUOUS" if family_citing
                   else "MENTIONED" if mentions else "UNKNOWN")
        if not citing and not include_all:
            (ambiguous if family_citing else skipped).append(
                (token or "?", family_citing))
            continue
        shown.append({
            "overlay": token, "function": name, "exact_start": exact,
            "start": start, "end": end, "source": path, "verdict": verdict,
            "claims": list(citing.values()), "anchors": anchored,
        })
    ambiguous_item = None
    if ambiguous:
        names = sorted({token for token, _ in ambiguous})
        shared_claims = {cid: claim for _, claims in ambiguous
                         for cid, claim in claims.items()}
        ambiguous_item = {"overlays": names, "claims": shared_claims}
    return {"rows": shown, "ambiguous": ambiguous_item,
            "mentions": mentions, "skipped": skipped}


def known_report(addresses, *, db=DEFAULT_DB, overlay=None, no_docs=False,
                 include_all=False):
    """Data form of `dw3-research known`; cmd_known prints it, tools join it.

    Pure: it does not require a fresh index, so a build tool can call it while
    the index is being regenerated. cmd_known owns the freshness check.
    """
    ledger = load_ledger()
    evidence = ledger.get("evidence", [])
    claims = ledger.get("claims", [])
    live = {"candidate", "partially_verified", "verified"}
    parsed = [
        (item, evidence_overlay_tokens(str(item.get("source", ""))),
         [int(found, 16) for found in
          re.findall(r"0x([0-9a-fA-F]{6,8})", str(item.get("locator", "")))])
        for item in evidence
    ]
    by_evidence: dict[str, list] = {}
    for claim in claims:
        if claim.get("status") in live:
            for eid in claim.get("evidence", []):
                by_evidence.setdefault(eid, []).append(claim)
    documents = []
    if DOCS_DIR.exists() and not no_docs:
        for document in sorted(DOCS_DIR.rglob("*.md")):
            try:
                documents.append((relative(str(document)),
                                  document.read_text(errors="replace").lower()))
            except OSError:
                continue
    prose = [(claim, (claim.get("statement", "") + claim.get("notes", "")).lower())
             for claim in claims]
    conn = connection(argparse.Namespace(db=db))
    try:
        functions = _function_map(conn)
    finally:
        conn.close()
    return [
        (address, _known_item(functions, parsed, by_evidence, documents, prose,
                              address, overlay=overlay, include_all=include_all))
        for address in addresses
    ]


def cmd_known(args: argparse.Namespace) -> None:
    """Answer "do we already know this?" for one or more addresses, before fresh work.

    The obvious test is wrong and cost a round on 2026-08-09: grepping the docs for
    an address reports all 96 card-effect dispatch callees as "known", because the
    model document's tables *list* every one of them. A mention is not a decode.

    The sound test is anchoring -- a function is decoded when a live ledger claim
    cites evidence whose locator address falls inside it. Two traps make the naive
    version wrong too, and both were hit while building this: overlays share load
    addresses (see _known_candidates), and the ledger holds TWO locator formats,
    `L2558 @0x8008548c` and `cardgame.s line 10200 (RAM 0x8008cbf4)`. Reading only
    the first reported a function decoded that same day as MENTIONED.

    Verdicts, per overlay:
      DECODED    a live claim cites evidence anchored inside this function, and
                 that evidence names THIS overlay
      AMBIGUOUS  anchors land in this range but none names one member of the
                 shared-load-base family the target falls in -- family-wide, so
                 it establishes nothing about the overlay you asked about
      MENTIONED  docs or claim prose name the address, nothing anchored
      UNKNOWN    neither

    A third trap, fixed 2026-08-11: an anchor whose overlay could not be read off
    its `source` counted in EVERY overlay, and all ~294 `wstag` stage overlays
    share the load base 0x800a5de0, so `known 0x800a6118` printed 294 DECODED
    rows off anchors recorded in wstag740, wstag735 and wstag330. See
    `evidence_overlay_tokens`.

    Takes many targets, because the whole point is triaging a worklist and a
    per-target process that reloads the ledger and every document is too slow to
    use in bulk -- a check nobody runs is not a check.
    """
    require_fresh_index(args.db, "known")
    addresses = []
    for raw in args.target:
        value = raw.strip()
        if value.lower().startswith("f0x"):
            value = value[1:]
        try:
            addresses.append(int(value, 16 if value.lower().startswith("0x") else 10))
        except ValueError:
            raise SystemExit(f"not an address: {raw}")

    report = known_report(addresses, db=args.db, overlay=args.overlay,
                          no_docs=args.no_docs, include_all=args.all)
    for address, item in report:
        shown = 0
        for row in item["rows"]:
            shown += 1
            token = row["overlay"]
            print(f"target=0x{address:08x} overlay={token or '?'} "
                  f"verdict={row['verdict']} function={row['function']} "
                  f"exact_start={'yes' if row['exact_start'] else 'NO'} "
                  f"anchors={len(row['anchors'])} claims={len(row['claims'])}")
            if not row["exact_start"] and row["claims"]:
                print("    WARNING: the target is not an indexed function start, so this "
                      "verdict is about the ENCLOSING function. The claims above may "
                      "describe neighbouring code; confirm before treating as decoded.")
            if args.quiet:
                continue
            print(f"  range=0x{row['start']:08x}..0x{row['end']:08x} "
                  f"source={relative(row['source'])}")
            for claim in row["claims"]:
                print(f"    claim={claim['id']} status={claim['status']}")
            for evidence in row["anchors"][:args.limit]:
                print(f"    evidence={evidence['id']} {evidence.get('locator','')} "
                      f"authority={evidence.get('authority')} :: "
                      f"{str(evidence.get('summary',''))[:80]}")
        ambiguous = item["ambiguous"]
        if ambiguous:
            names = ambiguous["overlays"]
            shared = ambiguous["claims"]
            print(f"target=0x{address:08x} overlay={len(names)}-overlay-family "
                  f"verdict=AMBIGUOUS function=- anchors=family-wide "
                  f"claims={len(shared)}")
            print(f"  NOTE: {len(names)} overlays share this load base and the anchors in "
                  f"range name none of them individually, so nothing is established "
                  f"about any single one. Overlays: {', '.join(names[:10])}"
                  f"{' ...' if len(names) > 10 else ''}")
            if not args.quiet:
                for claim in list(shared.values())[: args.limit]:
                    print(f"    family-claim={claim['id']} status={claim['status']}")
        if shown == 0 and not ambiguous:
            verdict = "MENTIONED" if item["mentions"] else "UNKNOWN"
            print(f"target=0x{address:08x} overlay=- verdict={verdict} "
                  f"function=- anchors=0 claims=0")
            if not args.quiet:
                if verdict == "MENTIONED":
                    print("  NOTE: named but never anchored. Someone wrote this address "
                          "down without establishing what it does -- treat it as "
                          "undecoded, not as prior work.")
                else:
                    print("  NOTE: nothing recorded. Genuinely new ground.")
        if item["skipped"] and not args.quiet:
            print(f"  ({len(item['skipped'])} further overlay(s) cover this address with nothing "
                  f"anchored: {', '.join(sorted({t for t, _ in item['skipped']})[:10])})")
        if item["mentions"] and not args.quiet:
            print("  mentions are repository-wide, not overlay-scoped:")
            for kind, name, status in item["mentions"][:args.limit]:
                print(f"    mention[{kind}]={name} {status}")


def resolve_dump(value: str) -> Path:
    path = Path(value).expanduser()
    if path.is_file():
        return path
    matches = list((ROOT / "docs/research").glob(f"**/{value}"))
    # The historical RAM-dump corpus lives outside the repo (~/vm-spike/dumps
    # — the dead Linux rig was deleted 2026-07-13 but its indexed dumps were
    # kept), and the live Windows rig writes to /mnt/c/dw3-rig/dumps.
    # Resolve bare names against both as well.
    for extra in (Path.home() / "vm-spike/dumps", Path("/mnt/c/dw3-rig/dumps")):
        if extra.is_dir():
            matches += [p for p in extra.glob(value) if p.is_file()]
    if len(matches) != 1:
        raise SystemExit(f"dump not uniquely found: {value}")
    return matches[0]


def dump_offset(path: Path, address: int) -> int:
    size = path.stat().st_size
    if address >= 0x80000000 and size <= 0x200000:
        return address & 0x1FFFFF
    return address


def read_range(path: Path, address: int, size: int) -> bytes:
    offset = dump_offset(path, address)
    if offset < 0 or offset + size > path.stat().st_size:
        raise SystemExit(f"range outside {path}: offset=0x{offset:x} size=0x{size:x}")
    with path.open("rb") as stream:
        stream.seek(offset)
        return stream.read(size)


def cmd_memory_read(args: argparse.Namespace) -> None:
    path = resolve_dump(args.dump)
    fmt = TYPES[args.type]
    width = struct.calcsize(fmt)
    raw = read_range(path, args.address, width * args.count)
    rows = []
    for index in range(args.count):
        address = args.address + index * width
        value = struct.unpack_from(fmt, raw, index * width)[0]
        rows.append({"address": f"0x{address:08x}", "type": args.type,
                     "value": value, "hex": raw[index * width:(index + 1) * width].hex()})
    emit(args, rows)


def changed_ranges(a: bytes, b: bytes, base: int, gap: int = 0) -> list[tuple[int, int]]:
    changed = [i for i, pair in enumerate(zip(a, b)) if pair[0] != pair[1]]
    if not changed:
        return []
    ranges = []
    start = previous = changed[0]
    for value in changed[1:]:
        if value > previous + gap + 1:
            ranges.append((base + start, previous - start + 1))
            start = value
        previous = value
    ranges.append((base + start, previous - start + 1))
    return ranges


def cmd_memory_diff(args: argparse.Namespace) -> None:
    left, right = resolve_dump(args.left), resolve_dump(args.right)
    length = args.length if args.length is not None else min(left.stat().st_size, right.stat().st_size) - dump_offset(left, args.start)
    a, b = read_range(left, args.start, length), read_range(right, args.start, length)
    rows = []
    ranges = changed_ranges(a, b, args.start, args.gap)
    for address, size in ranges[:args.limit]:
        offset = address - args.start
        preview = min(size, args.preview)
        rows.append({"address": f"0x{address:08x}", "length": size,
                     "left": a[offset:offset + preview].hex(),
                     "right": b[offset:offset + preview].hex(),
                     "truncated": size > preview or None})
    emit(args, rows)
    if len(ranges) > args.limit:
        print(f"… {len(ranges) - args.limit} more changed ranges", file=sys.stderr)


def cmd_value_search(args: argparse.Namespace) -> None:
    path = resolve_dump(args.dump)
    fmt = TYPES[args.type]
    needle = struct.pack(fmt, args.value)
    rows = []
    with path.open("rb") as stream:
        overlap = b""
        absolute = 0
        while len(rows) < args.limit:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            data = overlap + chunk
            pos = 0
            while len(rows) < args.limit:
                found = data.find(needle, pos)
                if found < 0:
                    break
                file_offset = absolute - len(overlap) + found
                rows.append({"address": f"0x{0x80000000 + file_offset:08x}", "offset": f"0x{file_offset:x}"})
                pos = found + max(1, len(needle))
            overlap = data[-(len(needle) - 1):] if len(needle) > 1 else b""
            absolute += len(chunk)
    emit(args, rows)


def cmd_pointer_search(args: argparse.Namespace) -> None:
    path = resolve_dump(args.dump)
    start, end = args.target_start, args.target_end
    rows = []
    with path.open("rb") as stream:
        offset = 0
        while len(rows) < args.limit:
            raw = stream.read(4)
            if len(raw) < 4:
                break
            value = struct.unpack("<I", raw)[0]
            if start <= value < end:
                rows.append({"address": f"0x{0x80000000 + offset:08x}", "points_to": f"0x{value:08x}"})
            offset += 4
    emit(args, rows)


def parse_field(value: str) -> tuple[int, str, object]:
    try:
        off_text, kind, raw = value.split(":", 2)
        fmt = TYPES[kind]
    except (ValueError, KeyError):
        raise argparse.ArgumentTypeError("field must be OFFSET:TYPE:VALUE")
    parsed: object = float(raw) if kind == "f32" else integer(raw)
    return integer(off_text), fmt, parsed


def cmd_structure_search(args: argparse.Namespace) -> None:
    path = resolve_dump(args.dump)
    fields = args.field
    maximum = max(off + struct.calcsize(fmt) for off, fmt, _ in fields)
    rows = []
    with path.open("rb") as stream, mmap.mmap(stream.fileno(), 0, access=mmap.ACCESS_READ) as data:
        for offset in range(0, len(data) - maximum + 1, args.align):
            if all(struct.unpack_from(fmt, data, offset + off)[0] == value for off, fmt, value in fields):
                rows.append({"address": f"0x{0x80000000 + offset:08x}", "offset": f"0x{offset:x}"})
                if len(rows) >= args.limit:
                    break
    emit(args, rows)


def cmd_table(args: argparse.Namespace) -> None:
    conn = connection(args)
    like = f"%{args.query}%"
    rows = []
    for item in conn.execute("""
      SELECT r.key,r.text,r.evidence_id,s.path,s.authority FROM records r JOIN sources s ON s.id=r.source_id
      WHERE r.kind='table' AND (r.key LIKE ? OR r.text LIKE ?) ORDER BY s.authority,r.id LIMIT ?
    """, (like, like, args.limit)):
        rows.append({"evidence": item["evidence_id"], "authority": item["authority"],
                     "source": relative(item["path"]), "key": item["key"], "row": item["text"][:args.chars]})
    emit(args, rows)


LANGUAGE_TABLE = ROOT / "data/language_table.json"


def cmd_languages(args: argparse.Namespace) -> None:
    """The game's seven languages, how they are numbered, and how they are picked.

    Source is data/language_table.json, composed from stagslct's name table and
    cnty_sel's cursor table. The index is the global D0x8005cca8, which also
    namespaces every story-event text bank the field script engine loads.
    """
    if not LANGUAGE_TABLE.exists():
        raise SystemExit(
            f"{relative(LANGUAGE_TABLE)} is missing; run "
            "`.venv/bin/python3 tools/extract_language_table.py`")
    table = json.loads(LANGUAGE_TABLE.read_text())
    entries = table["entries"]
    if args.name:
        needle = args.name.casefold()
        entries = [e for e in entries if needle in e["name"].casefold()
                   or needle in (e["country_pack"] or "")]
    if args.index is not None:
        entries = [e for e in entries if e["language_index"] == args.index]
    if args.json:
        emit(args, entries)
        return
    print(f"  global {table['provenance']['language_global']}")
    for e in entries:
        print(f"  index {e['language_index']}  {e['name']}  "
              f"pack {e['country_pack']}  "
              f"(cnty_sel row {e['cursor_row']}, {e['selectable_by']})")


SCREEN_CATALOG = ROOT / "data/stagslct_catalog.json"


def cmd_screens(args: argparse.Namespace) -> None:
    """The developers' own index of every screen, shop, gym and sub-system.

    Source is data/stagslct_catalog.json, decoded from the stagslct debug
    launcher that shipped on the retail disc. Answering "what did the
    developers call this" or "what screens exist" from here is both cheaper and
    more authoritative than re-deriving a grouping out of code.
    """
    if not SCREEN_CATALOG.exists():
        raise SystemExit(
            f"{relative(SCREEN_CATALOG)} is missing; run "
            "`.venv/bin/python3 tools/extract_stagslct_ui.py`")
    catalog = json.loads(SCREEN_CATALOG.read_text())
    entries = catalog["entries"]

    if args.code:
        want = int(args.code, 0)
        entries = [e for e in entries if int(e["code"], 16) == want]
    if args.section:
        needle = args.section.casefold()
        entries = [e for e in entries
                   if e.get("section") and needle in e["section"].casefold()]
    if args.stage is not None:
        entries = [e for e in entries if e.get("stage") == args.stage]
    if args.grep:
        needle = args.grep.casefold()
        entries = [e for e in entries if any(
            needle in str(e.get(f, "")).casefold()
            for f in ("overlay", "name_jp", "section", "stage_name", "code"))]

    if args.json:
        emit(args, entries[:args.limit])
        return
    shown = entries[:args.limit]
    for e in shown:
        bits = [f"{e['code']:>7}", f"val={e['value']:<3}", f"{e['overlay']}", e["name_jp"]]
        if e.get("stage") is not None:
            bits.append(f"stage={e['stage']}")
        if e.get("stage_name"):
            bits.append(f"({e['stage_name']})")
        if e.get("section"):
            bits.append(f"[{e['section']}]")
        print("  ".join(bits))
    print(f"-- {len(shown)} of {len(entries)} matching, {len(catalog['entries'])} total")


SOUND_CATALOG = ROOT / "docs/research/audio/soundtst-categories.json"


def cmd_sounds(args: argparse.Namespace) -> None:
    """Every sound the developers' own Sound Test can play, by category.

    Source is docs/research/audio/soundtst-categories.json, decoded from the
    soundtst overlay. Sound names and packed ids come from here -- do not
    hand-parse the overlay's rows.
    """
    if not SOUND_CATALOG.exists():
        raise SystemExit(
            f"{relative(SOUND_CATALOG)} is missing; run "
            "`.venv/bin/python3 tools/extract_soundtst.py`")
    catalog = json.loads(SOUND_CATALOG.read_text())

    rows = []
    for cat in catalog["categories"]:
        if args.category is not None and cat["category"] != args.category:
            continue
        if args.bank and args.bank.casefold() not in (cat["name"] or "").casefold():
            continue
        for snd in cat["sounds"]:
            rows.append({
                "category": cat["category"], "bank": cat["name"],
                "archive_id": cat["archive_id"],
                "name": snd["name"], "id": snd["id"],
            })
    if args.id:
        want = int(args.id, 0)
        rows = [r for r in rows if int(r["id"], 16) == want]
    if args.grep:
        needle = args.grep.casefold()
        rows = [r for r in rows if needle in str(r["name"]).casefold()
                or needle in str(r["bank"]).casefold()]

    if args.json:
        emit(args, rows[:args.limit])
        return
    shown = rows[:args.limit]
    for r in shown:
        print(f"  {r['id']}  {r['name']:<12} {r['bank']} "
              f"(category {r['category']}, archive {r['archive_id']})")
    print(f"-- {len(shown)} of {len(rows)} matching, {catalog['soundCount']} total "
          f"across {catalog['categoryCount']} categories")


OVERLAY_CENSUS = ROOT / "docs/generated/overlay-census.json"
FUNCTION_EXTENTS = ROOT / "docs/generated/function-extents.json"


def overlay_doc_coverage(module: str) -> str | None:
    """The coverage sentence an overlay's own document opens with, if any.

    Quoted verbatim and never parsed into a number: the document is the
    authority on what it covers, this function only surfaces it next to a claim
    count that has been misread as coverage three times. `module` arrives as a
    census path such as `pro/stgtrain`, so only the last component is used.
    """
    name = module.rsplit("/", 1)[-1]
    doc = ROOT / "docs" / "research" / "overlays" / f"{name}.md"
    if not doc.is_file():
        return None
    try:
        head = doc.read_text(errors="replace").split("\n")[:12]
    except OSError:
        return None
    for line in head:
        if re.search(r"\bfunctions?\b", line) and re.search(r"\d", line):
            return line.replace("*", "").strip()
    return None


def cmd_overlays(args: argparse.Namespace) -> None:
    """One row per original assembly file: what we know, and where it is written.

    Answers "is this overlay decoded, and is there a doc" before any disassembly
    starts. Read the status literally: `unidentified` means nothing in the
    ledger or the semantic inventory says what the file is, and `no-code-entry`
    means no entry point has been established -- neither is evidence that the
    file holds no code, and neither makes the filename a description.

    **A claim count of 0 is NOT "undecoded".** This row counts LEDGER CLAIMS.
    Most of this project's decoded knowledge lives in the plain-language overlay
    documents, which the reporting contract forbids from printing addresses and
    which carry no claim ids at all. `stcrddek` showed `0 claims` twice while
    having been read in full twice, and `stgtrain` looked like a 50-function gap
    with all 60 functions decompiled, 53 written up and its tables shipped. So
    when a document exists, its own coverage sentence is printed beneath the row
    -- believe that sentence over this row's numbers, and see
    docs/research/infra/decode-coverage-traps.md.
    """
    if not OVERLAY_CENSUS.exists():
        raise SystemExit(
            f"{relative(str(OVERLAY_CENSUS))} is missing; run "
            "`.venv/bin/python3 tools/build_overlay_census.py`")
    census = json.loads(OVERLAY_CENSUS.read_text())
    rows = census["modules"]

    if args.undecoded:
        rows = [r for r in rows if r["status"] in ("unidentified", "mentioned-only")]
    if args.status:
        rows = [r for r in rows if r["status"] == args.status]
    if args.kind:
        rows = [r for r in rows if r["kind"] == args.kind]
    if args.grep:
        needle = args.grep.casefold()
        rows = [r for r in rows if needle in r["module"].casefold()
                or any(needle in s.casefold() for s in r.get("subsystems") or ())
                or any(needle in c.casefold() for c in r.get("claims") or ())]

    if args.json:
        emit(args, rows[: args.limit])
        return
    shown = rows[: args.limit]
    for r in shown:
        docs = r.get("docs") or []
        doc = docs[0] if docs else "no doc"
        if len(docs) > 1:
            doc += f" (+{len(docs) - 1})"
        functions = "—" if r.get("functions") is None else r["functions"]
        print(f"  {r['status']:<18} {r['module']:<28} {r['kind']:<14} "
              f"{functions:>4} fns  {len(r.get('claims') or []):>2} claims  {doc}")
        # The claim count above has read as "undecoded" three times. If the
        # overlay has a plain-language document, print what IT says about its own
        # coverage, so the two never again have to be reconciled from memory.
        sentence = overlay_doc_coverage(r["module"])
        if sentence:
            print(f"{'':<21}└─ its doc says: {sentence}")
    summary = census["summary"]
    print(f"-- {len(shown)} of {len(rows)} matching, {summary['modules']} files; "
          + ", ".join(f"{k}={v}" for k, v in summary["by_status"].items()))


def cmd_evidence(args: argparse.Namespace) -> None:
    conn = connection(args)
    if args.identifier:
        items = conn.execute("SELECT * FROM evidence WHERE evidence_id=?", (args.identifier,)).fetchall()
    else:
        items = conn.execute("SELECT * FROM evidence ORDER BY evidence_id LIMIT ?", (args.limit,)).fetchall()
    emit(args, [{**dict(item), "source_path": relative(item["source_path"]),
                 "exact": item["exact"][:args.chars]} for item in items])


def bundle_digest(bundle: dict) -> str:
    canonical = json.loads(json.dumps(bundle))
    canonical.pop("bundle_sha256", None)
    # Advisory text shown to the reviewer but deliberately outside the digest, so
    # that improving the guidance never invalidates an already accepted review.
    canonical.pop("review_guidance_unhashed", None)
    canonical.get("claim", {}).pop("current_status", None)
    raw = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()


def claim_review_bundle(claim_id: str, db: Path = DEFAULT_DB, chars: int = 2000) -> dict:
    ledger = load_ledger()
    claim = next((item for item in ledger.get("claims", []) if item["id"] == claim_id), None)
    if claim is None:
        raise SystemExit(f"claim not found: {claim_id}")
    require_fresh_index(db, f"review bundle for {claim_id}")
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    evidence = []
    for evidence_id in claim.get("evidence", []):
        row = conn.execute("SELECT * FROM evidence WHERE evidence_id=?", (evidence_id,)).fetchone()
        if row is None:
            conn.close()
            raise SystemExit(f"evidence not indexed: {evidence_id}")
        evidence.append({
            "id": row["evidence_id"],
            "kind": row["kind"],
            "authority": row["authority"],
            "source": relative(row["source_path"]),
            "locator": row["locator"],
            "summary": row["summary"],
            "exact": row["exact"][:chars],
        })
    conn.close()
    subject = {
        "id": claim["id"],
        "system": claim["system"],
        "statement": claim.get("statement", ""),
        "current_status": claim["status"],
        "notes": claim.get("notes", ""),
        "evidence_ids": claim.get("evidence", []),
    }
    # A reviewer given only the statement and a handful of quoted lines cannot
    # check a claim that was DERIVED (a census, a sweep, an enumeration): the
    # quotes are samples and the claim is about the whole population. Show how
    # the quantifier was tested, what the author excluded, and which commands
    # produced it. Added only when present, so bundles for claims recorded
    # before this existed hash exactly as before and their reviews stay valid.
    for key in ("coverage", "limitations", "derivation"):
        if claim.get(key):
            subject[key] = claim[key]
    bundle = {
        "schema_version": 1,
        "claim": subject,
        "evidence_priority": [
            "controlled runtime observations and RAM comparisons",
            "original assembly",
            "decompiled C checked against assembly",
            "extracted tables checked against source",
            "existing research",
            "browser implementation (navigation only; never proof)",
        ],
        "review_rules": [
            "Accept verification only when every material part of the statement follows from exact evidence.",
            "Reject semantic names inferred only from value shape, strings, or browser behavior.",
            "If proof is incomplete, request the smallest exact missing artifact.",
            "Do not invent behavior or use outside guides as proof.",
        ],
        # NOT part of `review_rules`: that list is inside the hashed bundle, so
        # appending to it silently invalidates every accepted review (all 40, when
        # this was tried). Guidance that must reach reviewers without re-opening
        # settled verifications belongs here, outside the digest, and in
        # .claude/skills/ddw3-verify-handoff.
        "review_guidance_unhashed": [
            "Check every scope word (every, all, only, never, none, exactly) separately "
            "from the mechanism: a statement can be right about what was read and wrong "
            "about what was not. Reject a quantifier whose `coverage` restates the claim "
            "instead of describing the test that would have found a counterexample.",
        ],
        "evidence": evidence,
    }
    bundle["bundle_sha256"] = bundle_digest(bundle)
    return bundle


def cmd_review_bundle(args: argparse.Namespace) -> None:
    print(json.dumps(claim_review_bundle(args.claim_id, args.db, args.chars), indent=2))


def accepted_review(claim_id: str, db: Path) -> tuple[Path, dict] | None:
    path = REVIEWS_DIR / f"{claim_id}.review.json"
    if not path.exists():
        return None
    review = json.loads(path.read_text())
    bundle = claim_review_bundle(claim_id, db)
    if review.get("decision") != "accept":
        return None
    if review.get("recommended_status") != "verified":
        return None
    if review.get("bundle_sha256") != bundle["bundle_sha256"]:
        return None
    return path, review


def load_system_catalog() -> dict:
    if not SYSTEM_CATALOG.exists():
        return {"systems": []}
    return json.loads(SYSTEM_CATALOG.read_text())


def resolve_system(value: str) -> dict | None:
    wanted = value.lower().replace("_", "-")
    for item in load_system_catalog().get("systems", []):
        names = [item["system"], *item.get("aliases", [])]
        if wanted in (name.lower().replace("_", "-") for name in names):
            return item
    return None


def cmd_system_status(args: argparse.Namespace) -> None:
    catalog_item = resolve_system(args.system)
    system = catalog_item["system"] if catalog_item else args.system
    path = SYSTEMS_DIR / f"{system}.manifest.json"
    if not path.exists():
        known = ", ".join(item["system"] for item in load_system_catalog().get("systems", []))
        raise SystemExit(f"system not cataloged: {args.system}; known systems: {known}")
    data = json.loads(path.read_text())
    if args.json:
        print(json.dumps(data, indent=2))
        return
    print(f"system={data['system']} status={data['status']} implementation={data.get('implementation_status','?')} updated={data.get('updated','?')}")
    # The mark alone went stale unnoticed for a month (card-battle said
    # `chrome_only` while 121 tests passed), so always print what backs it.
    impl = data.get("implementation") or {}
    if impl:
        print(
            f"impl_verified={impl.get('verified','?')} "
            f"impl_modules={len(impl.get('modules', []))} "
            f"impl_tests={len(impl.get('tests', []))}"
        )
        if impl.get("note"):
            print(f"impl_note={impl['note']}")
        for module in impl.get("modules", []):
            print(f"impl_module={module}")
        for test in impl.get("tests", []):
            print(f"impl_test={test}")
    if data.get("coverage_summary"):
        print(f"summary={data['coverage_summary']}")
    for source in data.get("canonical_docs", []):
        print(f"doc={source}")
    for claim in data.get("claims", []):
        print(f"claim={claim['id']} status={claim['status']}")
    questions = data.get("research_frontiers") or data.get("unresolved_questions", [])
    for question in questions:
        print(
            f"frontier={question['id']} status={question.get('status', 'open')} "
            f"question={question.get('question','')} need={question['evidence_needed']}"
        )


def cmd_systems(args: argparse.Namespace) -> None:
    rows = []
    catalog = load_system_catalog()
    for item in catalog.get("systems", []):
        path = SYSTEMS_DIR / f"{item['system']}.manifest.json"
        data = json.loads(path.read_text()) if path.exists() else item
        claims = data.get("claims", [])
        frontiers = data.get("research_frontiers") or data.get("unresolved_questions", [])
        rows.append({
            "system": data.get("system", item["system"]),
            "status": data.get("status", "unresearched"),
            "implementation": data.get("implementation_status", "unknown"),
            "verified": sum(item.get("status") == "verified" for item in claims),
            "claims": len(claims),
            "frontiers": sum(
                frontier.get("status", "open") in ACTIONABLE_FRONTIER_STATUSES
                for frontier in frontiers
            ),
            "frontiers_total": len(frontiers),
            "tracked": path.exists(),
            # How much of the mark is backed by code the game actually loads.
            # A mark with 0 modules and a non-missing status is a red flag; see
            # docs/research/infra/implementation-status-audit-2026-08-12.md.
            "impl_modules": len((data.get("implementation") or {}).get("modules", [])),
            "impl_tests": len((data.get("implementation") or {}).get("tests", [])),
        })
    rows.sort(key=lambda row: row["system"])
    emit(args, rows)
    if not args.json:
        print("note=system status summarizes coverage only; only verified ledger claims are original-game ground truth")
        print("note=implementation marks are checked by tools/check_implementation_status.py; "
              "run `system-status <s>` for the modules, tests and the named gap")


def cmd_frontiers(args: argparse.Namespace) -> None:
    selected = resolve_system(args.system) if args.system else None
    if args.system and selected is None:
        raise SystemExit(f"system not cataloged: {args.system}")
    rows = []
    for item in load_system_catalog().get("systems", []):
        if selected and item["system"] != selected["system"]:
            continue
        if args.status and item["status"] != args.status:
            continue
        for frontier in item.get("frontiers", []):
            frontier_status = frontier.get("status", "open")
            if args.frontier_status and frontier_status != args.frontier_status:
                continue
            if not args.all and not args.frontier_status and frontier_status not in ACTIONABLE_FRONTIER_STATUSES:
                continue
            rows.append({
                "system": item["system"],
                "status": item["status"],
                "frontier": frontier["id"],
                "frontier_status": frontier_status,
                "question": frontier["question"],
                "evidence_needed": frontier["evidence_needed"],
                "source_map": ", ".join(item.get("source_map", [])),
                # The system's canonical documents, surfaced on every frontier row.
                # They were already in the catalog but only reachable through the
                # derived manifests, which a worker never opens -- so a frontier's
                # own "already decoded" inventory was the only thing anyone read.
                # On 2026-08-10 CARD-Q002's inventory was stale against its own
                # model document (it listed sections G.9-G.12 and omitted
                # G.15/G.16/G.17, written the same day), and two research rounds
                # re-derived ~9 already-decoded card opcodes. `known` cannot catch
                # this: those sections anchor no evidence at the handler addresses,
                # so the addresses report UNKNOWN while the behaviour is written
                # down. Reading the doc's heading list is the check that works.
                "canonical_docs": ", ".join(item.get("canonical_docs", [])),
                "priority": item.get("priority", 100),
            })
    rows.sort(key=lambda row: (row["priority"], row["system"], row["frontier"]))
    emit(args, rows[:args.limit])


def evidence_anchor_errors(ledger: dict) -> list[str]:
    """Re-verify every ledger anchor against the file it cites, right now.

    `record-packets` verifies digests and `exact` quotes at integration time and
    never again, so any later edit to a cited source silently desynchronises the
    ledger. `tools/audit_evidence_digests.py` was written to close that gap and
    was then never wired to anything -- nothing in the repository called it, so
    `handoff-ok` kept meaning "the ids line up", not "the evidence still says
    what we recorded". This is that check, on the mandatory path.

    A surviving quote is not proof the claim survived: the quote can still match
    while the surrounding data changed enough to falsify the summary. So a moved
    quote is reported as an error to be looked at, not silently re-stamped.
    """
    errors: list[str] = []
    blobs: dict[str, bytes | None] = {}
    for item in ledger.get("evidence", []):
        source, digest = item.get("source"), item.get("source_sha256")
        if not source or not digest:
            continue
        path = os.path.expanduser(str(source))
        if path not in blobs:
            try:
                blobs[path] = Path(path).read_bytes()
            except OSError:
                blobs[path] = None
        blob = blobs[path]
        if blob is None:
            errors.append(f"evidence source missing: {item['id']} -> {source}")
            continue
        if hashlib.sha256(blob).hexdigest() == digest:
            continue
        quote = str(item.get("exact") or "")
        if not quote.strip():
            errors.append(
                f"evidence anchor unverifiable, source changed and it has no quote: "
                f"{item['id']} -> {source}"
            )
        elif quote in blob.decode("utf-8", errors="replace"):
            errors.append(
                f"evidence anchor stale, quote still present so re-stamp the digest "
                f"after re-reading the claim: {item['id']} -> {source}"
            )
        else:
            errors.append(
                f"evidence anchor BROKEN, source changed and the quote is gone: "
                f"{item['id']} -> {source}"
            )
    return errors


def handoff_errors(args: argparse.Namespace) -> list[str]:
    errors: list[str] = []
    catalog = load_system_catalog()
    systems = catalog.get("systems", [])
    by_system: dict[str, dict] = {}
    aliases: dict[str, str] = {}
    frontier_ids: dict[str, str] = {}
    for item in systems:
        system = item["system"]
        if system in by_system:
            errors.append(f"duplicate catalog system: {system}")
        by_system[system] = item
        if item.get("status") not in STATUSES:
            errors.append(f"invalid catalog status: {system}={item.get('status')}")
        for name in [system, *item.get("aliases", [])]:
            key = name.lower().replace("_", "-")
            if key in aliases and aliases[key] != system:
                errors.append(f"alias collision: {name} -> {aliases[key]},{system}")
            aliases[key] = system
        for document in item.get("canonical_docs", []):
            if not (ROOT / document).exists():
                errors.append(f"missing canonical doc: {system} -> {document}")
        for frontier in item.get("frontiers", []):
            frontier_id = frontier.get("id")
            if not frontier_id:
                errors.append(f"frontier missing id: {system}")
                continue
            if frontier_id in frontier_ids:
                errors.append(
                    f"duplicate frontier id: {frontier_id} -> "
                    f"{frontier_ids[frontier_id]},{system}"
                )
            frontier_ids[frontier_id] = system
            frontier_status = frontier.get("status")
            if frontier_status not in FRONTIER_STATUSES:
                errors.append(
                    f"invalid frontier status: {system}.{frontier_id}={frontier_status}"
                )
            if frontier_status == "assigned" and not frontier.get("assignee"):
                errors.append(f"assigned frontier missing assignee: {system}.{frontier_id}")
            if frontier_status == "blocked" and not frontier.get("blocked_reason"):
                errors.append(f"blocked frontier missing reason: {system}.{frontier_id}")

    ledger = load_ledger()
    errors.extend(evidence_anchor_errors(ledger))
    evidence_ids = [item["id"] for item in ledger.get("evidence", [])]
    claim_ids = [item["id"] for item in ledger.get("claims", [])]
    if len(evidence_ids) != len(set(evidence_ids)):
        errors.append("duplicate evidence id in ledger")
    if len(claim_ids) != len(set(claim_ids)):
        errors.append("duplicate claim id in ledger")
    ledger_claims = {item["id"]: item for item in ledger.get("claims", [])}
    known_evidence = set(evidence_ids)
    # Indexed evidence IDs and review bundle digests are only as good as the
    # cache they come from. Checking them against a stale index can report
    # green while the underlying records are broken, so the staleness itself is
    # a handoff error and the cache-backed checks are withheld rather than run
    # on untrusted data.
    stale = index_stale_reasons(args.db)
    for reason in stale:
        errors.append(f"stale index, run `dw3-research index`: {reason}")
    if stale:
        errors.append("skipped indexed-evidence and review-digest checks: index is stale")
    else:
        conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
        known_evidence.update(row[0] for row in conn.execute("SELECT evidence_id FROM evidence"))
        conn.close()
    for claim in ledger_claims.values():
        if claim.get("system") not in by_system:
            errors.append(f"claim uses uncataloged system: {claim['id']} -> {claim.get('system')}")
        if claim.get("status") not in STATUSES:
            errors.append(f"invalid claim status: {claim['id']}={claim.get('status')}")
        if not stale:
            for evidence in claim.get("evidence", []):
                if evidence not in known_evidence:
                    errors.append(f"unknown claim evidence: {claim['id']} -> {evidence}")
        review_path = claim.get("review")
        if review_path:
            path = ROOT / review_path
            if not path.exists():
                errors.append(f"missing claim review: {claim['id']} -> {review_path}")
            else:
                review = json.loads(path.read_text())
                accepting = (
                    review.get("decision") == "accept"
                    and review.get("recommended_status") == "verified"
                )
                # A non-accepting review is a legitimate outcome, not an inconsistency:
                # it is how a `needs_evidence` or `reject` verdict stays discoverable from
                # the ledger instead of only as a loose file. What must never happen is a
                # VERIFIED claim resting on one. Before 2026-08-17 this errored on any
                # non-accepting link, and because record_local_review.py links every
                # review it writes regardless of decision, recording a hold always broke
                # the mandatory gate -- so the hold path could not be used at all. Found
                # while holding two claims the promotion review declined.
                if not accepting:
                    if claim.get("status") == "verified":
                        errors.append(
                            f"verified claim rests on a non-accepting review: {claim['id']}"
                        )
                elif not stale:
                    bundle = claim_review_bundle(claim["id"], args.db)
                    if review.get("bundle_sha256") != bundle["bundle_sha256"]:
                        errors.append(f"stale claim review: {claim['id']}")

    for system, item in by_system.items():
        for frontier in item.get("frontiers", []):
            if frontier.get("status") != "resolved":
                continue
            resolutions = frontier.get("resolution_claims", [])
            if not resolutions:
                errors.append(
                    f"resolved frontier missing resolution claims: {system}.{frontier['id']}"
                )
            for claim_id in resolutions:
                claim = ledger_claims.get(claim_id)
                if claim is None:
                    errors.append(
                        f"resolved frontier uses unknown claim: "
                        f"{system}.{frontier['id']} -> {claim_id}"
                    )
                elif claim.get("system") != system:
                    errors.append(
                        f"resolved frontier uses cross-system claim: "
                        f"{system}.{frontier['id']} -> {claim_id}"
                    )
                elif claim.get("status") in {"unresearched", "contradicted"}:
                    errors.append(
                        f"resolved frontier uses unsupported claim: "
                        f"{system}.{frontier['id']} -> {claim_id}={claim.get('status')}"
                    )

    for system, item in by_system.items():
        path = SYSTEMS_DIR / f"{system}.manifest.json"
        if not path.exists():
            errors.append(f"missing manifest: {system}")
            continue
        manifest = json.loads(path.read_text())
        if manifest.get("system") != system:
            errors.append(f"manifest system mismatch: {path.name}")
        for key in ("aliases", "canonical_docs", "source_map", "implementation_status", "research_frontiers"):
            expected_key = "frontiers" if key == "research_frontiers" else key
            if manifest.get(key, []) != item.get(expected_key, []):
                errors.append(f"stale manifest metadata: {system}.{key}")
        for claim in manifest.get("claims", []):
            recorded = ledger_claims.get(claim["id"])
            if recorded is None:
                errors.append(f"manifest claim absent from ledger: {system} -> {claim['id']}")
            elif recorded.get("system") != system or recorded.get("status") != claim.get("status"):
                errors.append(f"manifest claim mismatch: {system} -> {claim['id']}")
        expected_claims = sorted(
            (claim["id"], claim["status"])
            for claim in ledger_claims.values()
            if claim.get("system") == system
        )
        actual_claims = sorted(
            (claim.get("id"), claim.get("status"))
            for claim in manifest.get("claims", [])
        )
        if actual_claims != expected_claims:
            errors.append(f"manifest claims not derived from ledger: {system}")
        expected_status = aggregate_claim_status([status for _, status in expected_claims])
        if item.get("status") != expected_status:
            errors.append(
                f"catalog status not derived from ledger: {system}="
                f"{item.get('status')} expected={expected_status}"
            )
        if manifest.get("status") != expected_status:
            errors.append(
                f"manifest status not derived from ledger: {system}="
                f"{manifest.get('status')} expected={expected_status}"
            )
    return errors


def cmd_handoff_check(args: argparse.Namespace) -> None:
    with metadata_lock(ROOT), index_lock(ROOT, shared=True):
        errors = handoff_errors(args)
    errors.extend(unbound_open_work_errors())
    if errors:
        for error in errors:
            print(f"error={error}")
        raise SystemExit(f"handoff check failed: {len(errors)} error(s)")
    catalog = load_system_catalog()
    ledger = load_ledger()
    print(f"handoff-ok systems={len(catalog.get('systems', []))} claims={len(ledger.get('claims', []))} evidence={len(ledger.get('evidence', []))}")


def unbound_open_work_errors() -> list[str]:
    """A doc section may not declare work open without binding it to something.

    Added 2026-08-17. A handoff had shipped a "What is genuinely open" section whose
    every item was already decoded, one of them by that same session. `frontiers`
    could not see it because it named no frontier, so nothing contradicted it and the
    next session read it as live work. The guard is baselined, so this only fires on
    NEWLY unbound sections -- see tools/check_open_work_frontiers.py.

    A checker nobody runs is how the previous two rounds of this failure survived,
    which is why it is wired into the mandatory gate rather than left standalone.
    """
    script = ROOT / "tools/check_open_work_frontiers.py"
    if not script.is_file():
        return []
    proc = subprocess.run(
        [sys.executable, str(script), "--json"],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    try:
        new = json.loads(proc.stdout).get("new", [])
    except (json.JSONDecodeError, ValueError):
        # Never fail the handoff gate because the guard itself broke; say so instead.
        return [f"open-work guard did not run: {(proc.stderr or '').strip()[:200]}"]
    return [
        f"{v['file']}:{v['line']} declares open work but names no frontier, claim, "
        f"or `no-frontier:` waiver: {v['heading']!r}"
        for v in new
    ]


def load_ledger() -> dict:
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {"schema_version": 1, "evidence": [], "claims": []}


def aggregate_claim_status(statuses: list[str]) -> str:
    """Summarize claim tracking without promoting weak evidence."""
    if not statuses or set(statuses) == {"unresearched"}:
        return "unresearched"
    if set(statuses) == {"verified"}:
        return "verified"
    if set(statuses) == {"contradicted"}:
        return "contradicted"
    if set(statuses) <= {"unresearched", "candidate"}:
        return "candidate"
    return "partially_verified"


def _build_manifests() -> None:
    # Imported lazily so the command-line module remains usable in isolated tests
    # that patch its repository constants.
    from tools import build_system_manifests

    build_system_manifests.build(SYSTEMS_DIR, SYSTEM_CATALOG, LEDGER, ROOT)


def cmd_epoch_create(args: argparse.Namespace) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", args.epoch_id):
        raise SystemExit("epoch ID must be 1-80 safe filename characters")
    with metadata_lock(ROOT), index_lock(ROOT, shared=True):
        require_fresh_index(args.db, "creating a research epoch")
        frontier_ids = list(args.frontier)
        if not frontier_ids:
            candidates = []
            for item in load_system_catalog().get("systems", []):
                for frontier in item.get("frontiers", []):
                    if frontier.get("status", "open") in ACTIONABLE_FRONTIER_STATUSES:
                        candidates.append((item.get("priority", 100), item["system"], frontier["id"]))
            frontier_ids = [row[2] for row in sorted(candidates)[: args.limit]]
        try:
            path, epoch = create_epoch(
                ROOT, args.db, LEDGER, SYSTEM_CATALOG, args.epoch_id,
                frontier_ids, args.resource,
            )
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            raise SystemExit(str(error)) from None
    print(f"epoch={epoch['epoch_id']} state=open assignments={len(epoch['assignments'])} path={relative(str(path))}")
    for item in epoch["assignments"]:
        print(
            f"slot={item['slot']} frontier={item['frontier_id']} "
            f"system={item['system']} resource={item['resource']}"
        )


def _epoch_path(epoch_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", epoch_id):
        raise SystemExit("invalid epoch ID")
    return ROOT / ".dw3-research/epochs" / epoch_id / "epoch.json"


def cmd_epoch_status(args: argparse.Namespace) -> None:
    path = _epoch_path(args.epoch_id)
    if not path.exists():
        raise SystemExit(f"epoch not found: {args.epoch_id}")
    epoch = json.loads(path.read_text())
    packets = packet_paths(path.parent)
    if args.json:
        print(json.dumps({**epoch, "packets": [item.name for item in packets]}, indent=2))
        return
    print(
        f"epoch={epoch['epoch_id']} state={epoch['state']} "
        f"assignments={len(epoch.get('assignments', []))} packets={len(packets)}"
    )
    for item in epoch.get("assignments", []):
        print(f"slot={item['slot']} frontier={item['frontier_id']} resource={item['resource']}")


def _finish_integration(
    journal_path: Path,
    epoch_path: Path,
    epoch: dict,
    ledger: dict,
    catalog: dict,
    packet_files: list[Path],
    db: Path,
) -> None:
    atomic_json(LEDGER, ledger)
    atomic_json(SYSTEM_CATALOG, catalog)
    _build_manifests()
    refresh_index(ROOT, db)
    _STALENESS_CACHE.pop(str(db), None)
    errors = handoff_errors(argparse.Namespace(db=db))
    if errors:
        for error in errors:
            print(f"error={error}")
        raise SystemExit(
            f"packet integration written but handoff failed; journal retained: {journal_path}"
        )
    epoch["state"] = "integrated"
    epoch["integrated_at"] = datetime.now(timezone.utc).isoformat()
    epoch["packets"] = [
        {"path": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in packet_files
    ]
    atomic_json(epoch_path, epoch)
    clear_journal(journal_path)


def cmd_record_packets(args: argparse.Namespace) -> None:
    epoch_path = _epoch_path(args.epoch_id)
    journal_path = ROOT / ".dw3-research/integration-journal.json"
    with metadata_lock(ROOT), index_lock(ROOT, shared=False):
        if journal_path.exists():
            journal = json.loads(journal_path.read_text())
            recovery_epoch_path = Path(journal["epoch_path"])
            recovery_epoch = json.loads(recovery_epoch_path.read_text())
            files = packet_paths(recovery_epoch_path.parent)
            _finish_integration(
                journal_path, recovery_epoch_path, recovery_epoch,
                journal["ledger"], journal["catalog"], files, args.db,
            )
            print(f"recovered epoch={recovery_epoch['epoch_id']} packets={len(files)}")
            return
        if not epoch_path.exists():
            raise SystemExit(f"epoch not found: {args.epoch_id}")
        epoch = json.loads(epoch_path.read_text())
        if epoch.get("state") != "open":
            raise SystemExit(f"epoch is not open: {args.epoch_id}={epoch.get('state')}")
        require_fresh_index(args.db, "integrating research packets")
        try:
            snapshot = current_snapshot(ROOT, args.db, LEDGER, SYSTEM_CATALOG)
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            raise SystemExit(str(error)) from None
        if snapshot != epoch.get("snapshot"):
            raise SystemExit("epoch is stale: repository, metadata, or index generation changed")
        files = packet_paths(epoch_path.parent)
        if not files:
            raise SystemExit(f"no completed .packet.json files in {epoch_path.parent}")
        packets = [json.loads(path.read_text()) for path in files]
        ledger = load_ledger()
        catalog = load_system_catalog()
        catalog["_repository_root"] = str(ROOT)
        errors = validate_packets(epoch, packets, ledger, catalog)
        for warning in summary_literal_warnings(packets):
            print(f"warning={warning}")
        if errors:
            for error in errors:
                print(f"error={error}")
            raise SystemExit(f"packet validation failed: {len(errors)} error(s)")
        ledger, catalog = apply_packets(epoch, packets, ledger, catalog)
        write_journal(journal_path, epoch_path, ledger, catalog)
        _finish_integration(
            journal_path, epoch_path, epoch, ledger, catalog, files, args.db,
        )
    print(f"integrated epoch={args.epoch_id} packets={len(files)} handoff=ok")


def completion_errors(args: argparse.Namespace) -> list[str]:
    errors = handoff_errors(args)
    catalog = load_system_catalog()
    ledger = load_ledger()
    frontiers = {
        frontier["id"]: (item["system"], frontier)
        for item in catalog.get("systems", [])
        for frontier in item.get("frontiers", [])
    }
    claim_ids = {claim["id"] for claim in ledger.get("claims", [])}
    for claim in ledger.get("claims", []):
        status = claim.get("status")
        if status in {"candidate", "partially_verified"}:
            if not claim.get("evidence"):
                errors.append(f"completion: unsupported non-final claim: {claim['id']}")
            links = claim.get("frontier_ids", [])
            if not links and not claim.get("frontier_rationale"):
                errors.append(f"completion: claim has no frontier disposition: {claim['id']}")
            for frontier_id in links:
                if frontier_id not in frontiers:
                    errors.append(f"completion: claim uses unknown frontier: {claim['id']} -> {frontier_id}")
                elif frontiers[frontier_id][0] != claim.get("system"):
                    errors.append(f"completion: claim uses cross-system frontier: {claim['id']} -> {frontier_id}")
        if status == "verified" and not (claim.get("review") or claim.get("review_exemption")):
            errors.append(f"completion: verified claim lacks review: {claim['id']}")
        if status == "contradicted":
            replacements = claim.get("superseded_by", [])
            if not replacements and not claim.get("contradiction_rationale"):
                errors.append(f"completion: contradicted claim lacks disposition: {claim['id']}")
            for replacement in replacements:
                if replacement not in claim_ids:
                    errors.append(f"completion: unknown superseding claim: {claim['id']} -> {replacement}")
    for item in catalog.get("systems", []):
        actionable = [
            frontier["id"] for frontier in item.get("frontiers", [])
            if frontier.get("status", "open") in ACTIONABLE_FRONTIER_STATUSES | {"assigned", "blocked"}
        ]
        if actionable:
            errors.append(f"completion: system has unresolved frontiers: {item['system']} -> {','.join(actionable)}")
        coverage = item.get("coverage")
        if not isinstance(coverage, dict) or not coverage.get("scope") or not coverage.get("method"):
            errors.append(f"completion: system lacks coverage obligation: {item['system']}")
        elif coverage.get("exhaustive") is not True:
            errors.append(f"completion: system coverage is not exhaustive: {item['system']}")
    return list(dict.fromkeys(errors))


def cmd_completion_check(args: argparse.Namespace) -> None:
    with metadata_lock(ROOT), index_lock(ROOT, shared=True):
        errors = completion_errors(args)
    if errors:
        for error in errors:
            print(f"error={error}")
        raise SystemExit(f"completion check failed: {len(errors)} error(s)")
    print("completion-ok")


def cmd_record_finding(args: argparse.Namespace) -> None:
    with metadata_lock(ROOT), index_lock(ROOT, shared=False):
        record_finding(args)
        if args.db.exists():
            reindex_paths(ROOT, args.db, self_written_sources())
            _STALENESS_CACHE.pop(str(args.db), None)


def record_finding(args: argparse.Namespace) -> None:
    catalog_item = resolve_system(args.system)
    if catalog_item is None:
        raise SystemExit(f"system not cataloged: {args.system}; add it to docs/research/systems/catalog.json first")
    args.system = catalog_item["system"]
    ledger = load_ledger()
    if args.status != "unresearched" and not args.evidence:
        raise SystemExit(f"status {args.status} requires at least one evidence ID")
    frontier_ids = list(getattr(args, "frontier", []) or [])
    frontier_rationale = getattr(args, "frontier_rationale", None)
    if args.status in {"candidate", "partially_verified"} and not (
        frontier_ids or frontier_rationale
    ):
        raise SystemExit(
            f"status {args.status} requires --frontier or --frontier-rationale"
        )
    catalog_frontiers = {
        frontier["id"]: item["system"]
        for item in load_system_catalog().get("systems", [])
        for frontier in item.get("frontiers", [])
    }
    for frontier_id in frontier_ids:
        if catalog_frontiers.get(frontier_id) != args.system:
            raise SystemExit(
                f"unknown or cross-system frontier: {args.system} -> {frontier_id}"
            )
    superseded_by = list(getattr(args, "superseded_by", []) or [])
    contradiction_rationale = getattr(args, "contradiction_rationale", None)
    if args.status == "contradicted" and not (superseded_by or contradiction_rationale):
        raise SystemExit(
            "contradicted status requires --superseded-by or --contradiction-rationale"
        )
    known = {item["id"] for item in ledger["evidence"]}
    if not set(args.evidence) <= known:
        # Only the indexed cache can resolve auto-generated source evidence IDs,
        # and a stale cache would accept IDs whose source text has since moved.
        require_fresh_index(args.db, "recording evidence-backed claims")
        conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
        known.update(row[0] for row in conn.execute("SELECT evidence_id FROM evidence"))
        conn.close()
    missing = sorted(set(args.evidence) - known)
    if missing:
        raise SystemExit("unknown evidence ID(s): " + ", ".join(missing))
    # The lead records through this path instead of a packet, so every rule that
    # validate_packets enforces has to hold here too or the lead is simply the
    # way around them. Same gates, same wording.
    coverage = (getattr(args, "coverage", None) or "").strip()
    if args.status not in {"unresearched", "contradicted"}:
        quantifiers = sorted({
            word.lower() for word in QUANTIFIER.findall(args.statement or "")
        })
        if quantifiers and not coverage:
            raise SystemExit(
                f"claim {args.claim_id} makes a universal statement "
                f"({', '.join(quantifiers)}) but has no --coverage. State how the "
                f"quantifier was TESTED, not what it asserts: the enumeration that was "
                f"exhausted, the denominator searched, or the independent check that "
                f"would have found a counterexample. If it was not tested, narrow the "
                f"statement to the cases actually read."
            )
    if args.status in {"partially_verified", "verified"} and args.evidence:
        conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
        try:
            rows = dict(conn.execute("SELECT evidence_id,authority FROM evidence"))
        finally:
            conn.close()
        rows.update({
            item["id"]: item.get("authority") for item in ledger["evidence"]
        })
        authorities = [
            rows.get(evidence_id) for evidence_id in args.evidence
            if isinstance(rows.get(evidence_id), int)
        ]
        if authorities and min(authorities) > PRIMARY_AUTHORITY:
            raise SystemExit(
                f"claim {args.claim_id} is {args.status} but its strongest evidence is "
                f"authority {min(authorities)} (research/browser). Those are navigation "
                f"aids, never proof of original behaviour. Cite runtime, assembly, "
                f"checked decompilation or checked extraction, or record it as candidate."
            )
    existing = next((item for item in ledger["claims"] if item["id"] == args.claim_id), None)
    review_path = None
    if args.status == "verified" and not (existing and existing.get("status") == "verified"):
        if existing is None:
            raise SystemExit("new claims must be recorded below verified, reviewed, then promoted")
        if (existing.get("statement") != args.statement or
                existing.get("evidence", []) != args.evidence or
                existing.get("notes", "") != (args.notes or "")):
            raise SystemExit("reviewed promotion must preserve the candidate statement, evidence, and notes")
        accepted = accepted_review(args.claim_id, args.db)
        if accepted is None:
            raise SystemExit(f"verified promotion requires a current accepted review: {REVIEWS_DIR / (args.claim_id + '.review.json')}")
        review_path = relative(str(accepted[0]))
    claim = {"id": args.claim_id, "system": args.system, "statement": args.statement,
             "status": args.status, "evidence": args.evidence, "notes": args.notes or ""}
    if coverage:
        claim["coverage"] = coverage
    elif existing and existing.get("coverage"):
        claim["coverage"] = existing["coverage"]
    if frontier_ids:
        claim["frontier_ids"] = frontier_ids
    elif frontier_rationale:
        claim["frontier_rationale"] = frontier_rationale
    elif existing:
        for key in ("frontier_ids", "frontier_rationale"):
            if key in existing:
                claim[key] = existing[key]
    if superseded_by:
        claim["superseded_by"] = superseded_by
    elif contradiction_rationale:
        claim["contradiction_rationale"] = contradiction_rationale
    elif existing:
        for key in ("superseded_by", "contradiction_rationale"):
            if key in existing:
                claim[key] = existing[key]
    if review_path:
        claim["review"] = review_path
    elif existing and existing.get("review"):
        claim["review"] = existing["review"]
    if existing:
        existing.update(claim)
    else:
        ledger["claims"].append(claim)
    atomic_json(LEDGER, ledger)
    _build_manifests()
    print(f"recorded claim={args.claim_id} status={args.status} ledger={relative(str(LEDGER))}")


def cmd_promote_finding(args: argparse.Namespace) -> None:
    with metadata_lock(ROOT), index_lock(ROOT, shared=False):
        promote_finding(args)
        if args.db.exists():
            reindex_paths(ROOT, args.db, self_written_sources())
            _STALENESS_CACHE.pop(str(args.db), None)


def promote_finding(args: argparse.Namespace) -> None:
    ledger = load_ledger()
    claim = next((item for item in ledger.get("claims", []) if item["id"] == args.claim_id), None)
    if claim is None:
        raise SystemExit(f"claim not found: {args.claim_id}")
    if claim.get("status") == "verified":
        print(f"claim={args.claim_id} status=verified already=True")
        return
    accepted = accepted_review(args.claim_id, args.db)
    if accepted is None:
        raise SystemExit(f"promotion requires a current accepted review: {REVIEWS_DIR / (args.claim_id + '.review.json')}")
    claim["status"] = "verified"
    claim["review"] = relative(str(accepted[0]))
    atomic_json(LEDGER, ledger)
    _build_manifests()
    print(f"promoted claim={args.claim_id} status=verified review={claim['review']}")


def cmd_rosetta(args: argparse.Namespace) -> None:
    if args.rosetta_command == "audit":
        from tools.rosetta_audit import audit
        emit(args, audit(ROOT, args.system, args.limit))
        return
    if args.rosetta_command == "check":
        data = json.loads(ROSETTA_LINKS.read_text())
        errors = validate_rosetta_links(data, ROOT)
        if ROSETTA_DISPOSITIONS.exists():
            dispositions = json.loads(ROSETTA_DISPOSITIONS.read_text())
            errors.extend(validate_dispositions(dispositions))
            if dispositions != build_dispositions(ROOT):
                errors.append("stale generated disposition file")
        else:
            errors.append("missing generated disposition file")
        errors.extend(validate_rosetta_freshness(ROOT))
        if errors:
            raise SystemExit("rosetta-invalid\n" + "\n".join(errors))
        print(f"rosetta-ok links={len(data.get('links', []))}")
        return
    if args.rosetta_command == "build":
        data = write_rosetta_index(ROOT, ROSETTA_LINKS, ROSETTA_INDEX)
        print(f"rosetta-indexed links={data['summary']['links']} output={relative(str(ROSETTA_INDEX))}")
        return
    value = getattr(args, "value", None)
    if args.rosetta_command == "gaps":
        system, kind = getattr(args, "system", None), getattr(args, "kind", None)
        value = f"{system or ''}::{kind or ''}" if system or kind else None
    rows = query_rosetta_index(args.rosetta_command, value, getattr(args, "limit", 10), ROSETTA_INDEX)
    emit(args, rows)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="dw3-research", description=__doc__)
    result.add_argument("--db", type=Path, default=DEFAULT_DB)
    sub = result.add_subparsers(dest="command", required=True)

    p = sub.add_parser("index"); p.add_argument("--ledger-only", action="store_true"); p.add_argument("--changed", action="store_true", help="incrementally refresh changed sources"); p.set_defaults(func=cmd_index)
    p = sub.add_parser("search"); p.add_argument("query"); p.add_argument("--kind"); p.add_argument("--limit", type=int, default=10); p.add_argument("--chars", type=int, default=240); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_search)
    p = sub.add_parser("function"); p.add_argument("identifier"); p.add_argument("--source", help="assembly source name/path filter for overlay-relative addresses"); p.add_argument("--lines", type=int, default=60); p.add_argument("--limit", type=int, default=30); p.add_argument("--expand", action="store_true"); p.set_defaults(func=cmd_function)
    for name in ("callers", "callees"):
        p = sub.add_parser(name); p.add_argument("identifier"); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_relation)
    p = sub.add_parser("code-search"); p.add_argument("pattern"); p.add_argument("--corpus", choices=sorted(CODE_CORPORA), default="original"); p.add_argument("--regex", action="store_true"); p.add_argument("--limit", type=int, default=20); p.add_argument("--chars", type=int, default=240); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_code_search)
    p = sub.add_parser("references"); p.add_argument("identifier"); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_references)
    p = sub.add_parser("memory-read"); p.add_argument("dump"); p.add_argument("address", type=integer); p.add_argument("--type", choices=TYPES, default="u8"); p.add_argument("--count", type=int, default=1); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_memory_read)
    p = sub.add_parser("memory-diff"); p.add_argument("left"); p.add_argument("right"); p.add_argument("--start", type=integer, default=0x80000000); p.add_argument("--length", type=integer); p.add_argument("--gap", type=int, default=0); p.add_argument("--preview", type=int, default=32); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_memory_diff)
    p = sub.add_parser("value-search"); p.add_argument("dump"); p.add_argument("value", type=integer); p.add_argument("--type", choices=TYPES, default="u32"); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_value_search)
    p = sub.add_parser("pointer-search"); p.add_argument("dump"); p.add_argument("--target-start", type=integer, default=0x80000000); p.add_argument("--target-end", type=integer, default=0x80200000); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_pointer_search)
    p = sub.add_parser("structure-search"); p.add_argument("dump"); p.add_argument("--field", type=parse_field, action="append", required=True); p.add_argument("--align", type=int, default=1); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_structure_search)
    p = sub.add_parser("table"); p.add_argument("query"); p.add_argument("--limit", type=int, default=10); p.add_argument("--chars", type=int, default=500); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_table)
    p = sub.add_parser("screens", help="developers' own screen/shop/gym index from the stagslct debug launcher"); p.add_argument("grep", nargs="?", help="substring match over label, name, section, stage name and code"); p.add_argument("--code", help="exact launch code, e.g. 0xa00"); p.add_argument("--section"); p.add_argument("--stage", type=int); p.add_argument("--limit", type=int, default=40); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_screens)
    p = sub.add_parser("sounds", help="every sound the developers' Sound Test can play, by category"); p.add_argument("grep", nargs="?", help="substring match over sound name and bank name"); p.add_argument("--id", help="exact packed id, e.g. 0xa004e03c"); p.add_argument("--category", type=int); p.add_argument("--bank", help="bank/category name substring, e.g. COMMON"); p.add_argument("--limit", type=int, default=40); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_sounds)
    p = sub.add_parser("languages", help="the game's seven languages, their index and how cnty_sel picks them"); p.add_argument("name", nargs="?", help="language or pack name substring"); p.add_argument("--index", type=int); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_languages)
    p = sub.add_parser("overlays", help="per-file census: is this overlay decoded, and where is the doc"); p.add_argument("grep", nargs="?", help="substring match over module, subsystem and claim id"); p.add_argument("--status", choices=("verified", "partially_verified", "candidate", "contradicted", "named-only", "mentioned-only", "unidentified")); p.add_argument("--kind", choices=("code", "no-code-entry", "uninventoried")); p.add_argument("--undecoded", action="store_true", help="only files with no claim and no named function"); p.add_argument("--limit", type=int, default=40); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_overlays)
    p = sub.add_parser("evidence"); p.add_argument("identifier", nargs="?"); p.add_argument("--limit", type=int, default=10); p.add_argument("--chars", type=int, default=500); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_evidence)
    p = sub.add_parser("review-bundle"); p.add_argument("claim_id"); p.add_argument("--chars", type=int, default=2000); p.set_defaults(func=cmd_review_bundle)
    p = sub.add_parser("system-status"); p.add_argument("system"); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_system_status)
    p = sub.add_parser("systems"); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_systems)
    p = sub.add_parser("frontiers"); p.add_argument("--system"); p.add_argument("--status", choices=sorted(STATUSES)); p.add_argument("--frontier-status", choices=sorted(FRONTIER_STATUSES)); p.add_argument("--all", action="store_true"); p.add_argument("--limit", type=int, default=10); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_frontiers)
    p = sub.add_parser("handoff-check"); p.set_defaults(func=cmd_handoff_check)
    p = sub.add_parser("completion-check"); p.set_defaults(func=cmd_completion_check)
    p = sub.add_parser("epoch-create"); p.add_argument("epoch_id"); p.add_argument("--frontier", action="append", default=[]); p.add_argument("--limit", type=int, default=3); p.add_argument("--resource", choices=("static", "overlay", "rig"), default="static"); p.set_defaults(func=cmd_epoch_create)
    p = sub.add_parser("epoch-status"); p.add_argument("epoch_id"); p.add_argument("--json", action="store_true"); p.set_defaults(func=cmd_epoch_status)
    p = sub.add_parser("record-packets"); p.add_argument("epoch_id"); p.set_defaults(func=cmd_record_packets)
    p = sub.add_parser("known"); p.add_argument("target", nargs="+"); p.add_argument("--limit", type=integer, default=8); p.add_argument("--overlay"); p.add_argument("--all", action="store_true"); p.add_argument("--quiet", action="store_true"); p.add_argument("--no-docs", action="store_true"); p.set_defaults(func=cmd_known)
    p = sub.add_parser("record-finding"); p.add_argument("system"); p.add_argument("claim_id"); p.add_argument("status", choices=sorted(STATUSES)); p.add_argument("statement"); p.add_argument("--evidence", action="append", default=[]); p.add_argument("--notes"); p.add_argument("--coverage"); p.add_argument("--frontier", action="append", default=[]); p.add_argument("--frontier-rationale"); p.add_argument("--superseded-by", action="append", default=[]); p.add_argument("--contradiction-rationale"); p.set_defaults(func=cmd_record_finding)
    p = sub.add_parser("promote-finding"); p.add_argument("claim_id"); p.set_defaults(func=cmd_promote_finding)
    p = sub.add_parser("rosetta", help="bounded queries over the engine/web/original crosswalk")
    rosetta = p.add_subparsers(dest="rosetta_command", required=True)
    child = rosetta.add_parser("audit", help="live bookkeeping gaps, including stale records; no parity verdict")
    child.add_argument("--system")
    child.add_argument("--limit", type=int, default=10)
    child.add_argument("--json", action="store_true")
    child.set_defaults(func=cmd_rosetta)
    for command in ("summary", "check", "build"):
        child = rosetta.add_parser(command)
        child.add_argument("--json", action="store_true")
        child.set_defaults(func=cmd_rosetta)
    for command in ("system", "symbol", "engine", "web", "original", "claim", "surface", "gaps", "bundle"):
        child = rosetta.add_parser(command)
        if command != "gaps":
            child.add_argument("value")
        else:
            child.add_argument("--system")
            child.add_argument("--kind")
        child.add_argument("--limit", type=int, default=10)
        child.add_argument("--json", action="store_true")
        child.set_defaults(func=cmd_rosetta)
    return result


def main() -> None:
    args = parser().parse_args()
    try:
        if args.command in {
            "search", "function", "callers", "callees", "code-search",
            "references", "memory-read", "memory-diff", "value-search",
            "pointer-search", "structure-search", "table", "evidence",
            "review-bundle", "system-status", "systems", "frontiers",
            "epoch-status",
        }:
            with index_lock(ROOT, shared=True):
                args.func(args)
        else:
            args.func(args)
    except TimeoutError as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
