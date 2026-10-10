"""Joins from every other semantic source in the repository onto functions.

The existing inference engine (`engine.py`) reads C bodies, families, the call
graph and address citations in research prose. That is four evidence classes out
of the dozen this repository actually holds. This module loads the rest and
expresses each one as a typed edge onto a function id, so they can enter the
same non-inflating propagation model.

Every loader here is a JOIN, not a new source of truth. Each edge carries the
file it came from and an authority number on the project's existing scale
(1 runtime comparison .. 6 browser code). Nothing here asserts original
behaviour; the output is candidate evidence for review.

MODULE QUALIFICATION IS MANDATORY
---------------------------------
An address alone never identifies a function: `cardgame` and `fieldstg` share
load base 0x80082cb0 and ~294 `wstag` overlays share 0x800a5de0. Every loader
below therefore resolves (overlay, address) pairs, and drops -- never guesses --
an address whose overlay cannot be established. The ledger join is the strong
one: an evidence row names its source FILE, so the overlay is read off the path
rather than inferred from prose context.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .corpus import REPO_ROOT

ADDRESS_RE = re.compile(r"\b0x8[0-9a-fA-F]{7}\b")

LEDGER_PATH = REPO_ROOT / "docs/research/evidence/ledger.json"
BOUNDS_PATH = REPO_ROOT / "docs/generated/bounds.json"
STRING_JOIN_PATH = REPO_ROOT / "docs/generated/string-code-join.json"
LANG_ROOT = Path.home() / "ddw3/lang_file/dw2003/eng"
ENGINE_ROOTS = (REPO_ROOT / "engine", REPO_ROOT / "web")
DOC_ROOT = REPO_ROOT / "docs/research"

# Ledger claim status -> how much weight a topic label from it may carry.
# `contradicted` is deliberately negative-signal only: it never seeds a topic.
STATUS_WEIGHT = {
    "verified": 1.0,
    "partially_verified": 0.75,
    "candidate": 0.45,
    "unresearched": 0.0,
    "contradicted": 0.0,
}


@dataclass
class Edge:
    """One joined observation about one function."""

    function_id: str
    kind: str                 # evidence class: ledger, text_bank, bound, doc, engine
    topic: str | None         # system / subsystem label, when the source carries one
    weight: float             # 0..1 prior strength of this single observation
    authority: int            # project evidence-authority scale, 1 (best) .. 6
    source: str               # repo-relative file the observation came from
    locator: str              # line, address or record id inside that file
    detail: str               # short human-readable note
    lexicon: tuple[str, ...] = ()   # game's own words attached to this edge


@dataclass
class Signals:
    edges: list[Edge] = field(default_factory=list)
    banks: dict[str, dict] = field(default_factory=dict)      # bank file -> strings/topic
    claims: dict[str, dict] = field(default_factory=dict)     # claim id -> record
    claim_functions: dict[str, set[str]] = field(default_factory=dict)
    doc_statements: list[dict] = field(default_factory=list)
    # absolute RAM address -> functions proven to touch it, hub globals removed
    global_index: dict[int, set[str]] = field(default_factory=dict)
    stats: dict[str, int] = field(default_factory=dict)

    def by_function(self) -> dict[str, list[Edge]]:
        index: dict[str, list[Edge]] = defaultdict(list)
        for edge in self.edges:
            index[edge.function_id].append(edge)
        return index


# --------------------------------------------------------------------------
# corpus address index
# --------------------------------------------------------------------------

_EXTENT_CACHE: dict[int, dict] = {}


def _address_index(corpus) -> tuple[dict[tuple[str, int], str], dict[int, list[str]]]:
    """(overlay-stem, address) -> function id, plus address -> all ids.

    Also builds, once per corpus, the per-overlay sorted extent table used to
    resolve an address that falls INSIDE a function rather than at its entry.
    Ledger evidence cites instruction addresses far more often than entries, so
    entry-only matching threw away most of the ledger.
    """
    cached = _EXTENT_CACHE.get(id(corpus))
    if cached is not None:
        return cached["by_pair"], cached["by_address"]
    by_pair: dict[tuple[str, int], str] = {}
    by_address: dict[int, list[str]] = defaultdict(list)
    extents: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    for fid, fn in corpus.functions.items():
        stem = fn.module.split("/")[-1].lower()
        by_pair[(stem, fn.address)] = fid
        by_address[fn.address].append(fid)
        if fn.end_address and fn.end_address > fn.address:
            extents[stem].append((fn.address, fn.end_address, fid))
    for rows in extents.values():
        rows.sort()
    _EXTENT_CACHE[id(corpus)] = {
        "by_pair": by_pair, "by_address": dict(by_address), "extents": dict(extents),
    }
    return by_pair, dict(by_address)


def _containing(corpus, overlay: str, address: int) -> str | None:
    """The function whose established extent contains `address`, within `overlay`."""
    _address_index(corpus)
    rows = _EXTENT_CACHE[id(corpus)]["extents"].get(overlay)
    if not rows:
        return None
    import bisect
    index = bisect.bisect_right(rows, (address, float("inf"), "")) - 1
    if index < 0:
        return None
    start, end, fid = rows[index]
    return fid if start <= address < end else None


def _overlay_from_path(path: str) -> str | None:
    """Read the overlay stem off a source path, never off prose.

    Handles the two shapes the ledger actually uses:
      /home/dorij/ddw3/asm/dw2003/pro/wstag927.s   -> wstag927
      .../exe-decomp/cardgame_c/F0x80097acc.c      -> cardgame
    """
    # Ledger authors annotate a source inline: "pro/fieldstg.s (overlay RAM base
    # 0x80082cb0)". Everything after the first space is commentary, and keeping
    # it made the path match nothing -- it cost 5+ claims their only anchor.
    cleaned = path.replace("\\", "/").split(" ")[0]
    parts = [p for p in cleaned.split("/") if p]
    if not parts:
        return None
    stem = parts[-1]
    if stem.endswith(".s"):
        return stem[:-2].lower()
    for part in reversed(parts):
        # `exe-decomp/cardgame_c/F0x....c`
        if part.endswith("_c") and len(part) > 2:
            return part[:-2].lower()
        # the per-overlay Rust data crates, `dw2003_pro_fieldstg/src/data.rs`
        if part.startswith("dw2003_pro_"):
            return part[len("dw2003_pro_"):].lower()
    # `recovered/ddw3/decomp/pro/<overlay>/F0x....c` -- the directory above the
    # function file names the overlay, with no `_c` suffix to key on.
    if stem.startswith("F0x") and len(parts) >= 2:
        parent = parts[-2].lower()
        return parent if parent not in ("pro", "exe", "decomp") else None
    return None


def _resolve(by_pair, by_address, overlay: str | None, address: int,
             corpus=None) -> str | None:
    """Resolve to one function id, or nothing. Never guesses across a shared base.

    With an overlay: exact entry first, then containment inside that overlay's
    established extents. Without one: only a corpus-unique entry address, and
    never containment -- an interior address is not unique across overlays.
    """
    if overlay is not None:
        exact = by_pair.get((overlay, address))
        if exact:
            return exact
        if corpus is not None:
            contained = _containing(corpus, overlay, address)
            if contained:
                return contained
        # The overlay named by the path does not hold this address. That means
        # the path parse was wrong, or the address is outside the extents we
        # derived -- not that the citation is unusable. A corpus-UNIQUE address
        # is still unambiguous, so fall through to it. Without this, tightening
        # the path parser cost 3 claims their only anchor while gaining 9
        # evidence rows: a net loss measured on 2026-08-12.
    ids = by_address.get(address)
    if ids and len(ids) == 1:
        return ids[0]
    return None


# --------------------------------------------------------------------------
# 1. ledger claims and evidence  (authority 1-6, carries a system label)
# --------------------------------------------------------------------------

INDEX_PATH = REPO_ROOT / ".dw3-research/index.sqlite3"


def _index_evidence(document: dict, known: dict) -> dict:
    """Claim evidence that lives in the research index, not in `ledger.json`.

    THERE ARE TWO EVIDENCE STORES. `ledger.json` carries hand-authored rows, and
    the index carries one auto-generated `EV-<hash>` row per indexed line. Claims
    cite both. Measured 2026-08-12: 64 claims reference 259 distinct ids absent
    from `ledger.json`, and ALL 259 are in the index -- real assembly labels at
    authority 2 with a file, a line and an address. 52 of those claims cite
    nothing else at all, so reading only `ledger.json` silently dropped every
    anchor they had.

    This nearly went the other way. The same measurement, stopped one step
    earlier, reads as "64 claims rest on evidence that does not exist" -- a
    fabricated integrity defect. A missing row in one store is not an absence.
    """
    wanted = {
        eid
        for claim in document.get("claims", [])
        for eid in claim.get("evidence", [])
        if eid not in known
    }
    if not wanted or not INDEX_PATH.is_file():
        return {}
    import sqlite3
    try:
        connection = sqlite3.connect(f"file:{INDEX_PATH}?mode=ro", uri=True)
    except sqlite3.Error:
        return {}
    found = {}
    try:
        for eid in wanted:
            row = connection.execute(
                "SELECT kind, source_path, locator, authority, summary, exact "
                "FROM evidence WHERE evidence_id = ?", (eid,)).fetchone()
            if row is None:
                continue
            found[eid] = {
                "id": eid, "kind": row[0], "source": row[1], "locator": row[2],
                "authority": row[3], "summary": row[4], "exact": row[5],
                "store": "research-index",
            }
    except sqlite3.Error:
        return found
    finally:
        connection.close()
    return found


def load_ledger(corpus, signals: Signals, path: Path = LEDGER_PATH) -> None:
    if not path.is_file():
        return
    document = json.loads(path.read_text())
    by_pair, by_address = _address_index(corpus)
    evidence = {row["id"]: row for row in document.get("evidence", [])}
    from_index = _index_evidence(document, evidence)
    evidence.update(from_index)
    signals.stats["ledger_evidence_rows_recovered_from_the_index"] = len(from_index)

    # evidence id -> function ids it anchors to, resolved through the FILE it cites
    evidence_functions: dict[str, set[str]] = {}
    for eid, row in evidence.items():
        overlay = _overlay_from_path(row.get("source", ""))
        blob = " ".join(str(row.get(k, "")) for k in ("locator", "exact", "summary"))
        hits: set[str] = set()
        for match in ADDRESS_RE.finditer(blob):
            fid = _resolve(by_pair, by_address, overlay, int(match.group(0), 16), corpus)
            if fid:
                hits.add(fid)
        evidence_functions[eid] = hits

    resolved_rows = sum(1 for hits in evidence_functions.values() if hits)
    signals.stats["ledger_evidence_rows"] = len(evidence)
    signals.stats["ledger_evidence_rows_resolved_to_a_function"] = resolved_rows

    for claim in document.get("claims", []):
        cid = claim["id"]
        signals.claims[cid] = claim
        status = claim.get("status", "unresearched")
        weight = STATUS_WEIGHT.get(status, 0.0)
        system = claim.get("system")
        best_authority = 6
        targets: set[str] = set()
        for eid in claim.get("evidence", []):
            targets |= evidence_functions.get(eid, set())
            row = evidence.get(eid)
            if row and isinstance(row.get("authority"), int):
                best_authority = min(best_authority, row["authority"])
        # A claim statement may cite an address no evidence row anchors. Those
        # resolve only when the address is unique corpus-wide.
        for match in ADDRESS_RE.finditer(claim.get("statement", "")):
            fid = _resolve(by_pair, by_address, None, int(match.group(0), 16))
            if fid:
                targets.add(fid)
        signals.claim_functions[cid] = targets
        if weight <= 0.0:
            continue
        for fid in targets:
            signals.edges.append(Edge(
                function_id=fid, kind="ledger", topic=system,
                weight=weight, authority=best_authority,
                source="docs/research/evidence/ledger.json",
                locator=cid,
                detail=f"{status} claim {cid} in system {system}",
            ))
    signals.stats["ledger_claims"] = len(signals.claims)
    signals.stats["ledger_claims_touching_a_function"] = sum(
        1 for t in signals.claim_functions.values() if t)


# --------------------------------------------------------------------------
# 2. text banks  (the game's own vocabulary, joined through string-code-join)
# --------------------------------------------------------------------------

_TOML_STRING = re.compile(r'^\s*"(.*)",?\s*$')


def _read_bank(name: str) -> list[str]:
    path = LANG_ROOT / f"{name}.toml"
    if not path.is_file():
        path = LANG_ROOT / name
        if not path.is_file():
            return []
    out: list[str] = []
    try:
        for line in path.read_text(errors="replace").splitlines():
            match = _TOML_STRING.match(line)
            if match:
                out.append(match.group(1))
    except OSError:
        return []
    return out


def _lexicon(strings: list[str], limit: int = 12) -> tuple[str, ...]:
    """Short, distinctive labels -- the words a UI actually shows."""
    picked: list[str] = []
    for text in strings:
        clean = text.replace("\\n", " ").strip()
        if not clean or len(clean) > 40 or clean.startswith("{"):
            continue
        if clean in picked:
            continue
        picked.append(clean)
        if len(picked) >= limit:
            break
    return tuple(picked)


def load_text_banks(corpus, signals: Signals, path: Path = STRING_JOIN_PATH) -> None:
    if not path.is_file():
        return
    document = json.loads(path.read_text())
    by_pair, by_address = _address_index(corpus)
    # `corroborated` had two independent signals agree; `consistent` had one.
    status_weight = {"corroborated": 0.8, "consistent": 0.45}

    for site in document.get("call_sites", []):
        bank = site.get("text_file")
        if not bank:
            continue
        if bank not in signals.banks:
            strings = _read_bank(bank)
            signals.banks[bank] = {
                "bank": bank,
                "string_count": len(strings),
                "lexicon": list(_lexicon(strings)),
            }
        weight = status_weight.get(site.get("status", ""), 0.0)
        if weight <= 0.0:
            continue
        token = site.get("function", "")
        if not token.startswith("F0x"):
            continue
        fid = _resolve(by_pair, by_address, site.get("overlay"), int(token[1:], 16), corpus)
        if not fid:
            continue
        # When the call site names a literal index, we know the EXACT words the
        # game puts on screen, not just which bank it drew them from. That is a
        # far tighter signal than the bank's whole vocabulary, so it replaces it.
        word = site.get("string")
        if word:
            lexicon = (word.replace("\\n", " ")[:60],)
            detail = (f"draws {bank}[{site['string_index']}] = "
                      f"{word.replace(chr(92) + 'n', ' ')[:60]!r}")
            signals.stats["text_bank_sites_with_a_resolved_word"] = (
                signals.stats.get("text_bank_sites_with_a_resolved_word", 0) + 1)
        else:
            lexicon = tuple(signals.banks[bank]["lexicon"])
            detail = (f"requests text bank {bank} "
                      f"(const {site['bank_const']}, {site['status']})")
        signals.edges.append(Edge(
            function_id=fid, kind="text_bank", topic=f"text:{bank}",
            weight=weight,
            # The C extraction is checked decompilation; the ordinal->file step
            # is an ordering hypothesis, so this never rises above authority 4.
            authority=4 if site["status"] == "corroborated" else 5,
            source="docs/generated/string-code-join.json",
            locator=f"{site['source']}:{site['line']}",
            detail=detail,
            lexicon=lexicon,
        ))
    signals.stats["text_bank_call_sites"] = len(document.get("call_sites", []))
    signals.stats["text_banks_joined"] = len(signals.banks)


# --------------------------------------------------------------------------
# 3. bounds  (caps, clamps, gates, loop counts -- mechanically extracted)
# --------------------------------------------------------------------------

def load_bounds(corpus, signals: Signals, path: Path = BOUNDS_PATH) -> None:
    if not path.is_file():
        return
    rows = json.loads(path.read_text())
    by_pair, by_address = _address_index(corpus)
    joined = 0
    cited = 0
    for row in rows:
        overlay = (row.get("overlay") or "").lower()
        # Since 2026-08-12 a row carries the exact site of each bound. Prefer it:
        # `ststatus:0x800a1234` only says which function, so the site has to be
        # found again before the bound can be quoted as evidence.
        sites = {s.get("function"): s for s in row.get("sites", [])}
        for address_text in row.get("functions", []):
            try:
                address = int(address_text, 16)
            except (TypeError, ValueError):
                continue
            fid = _resolve(by_pair, by_address, overlay, address, corpus)
            if not fid:
                continue
            joined += 1
            site = sites.get(address_text)
            if site:
                cited += 1
                locator = f"{site['path']}:{site['line']}"
                detail = f"{row['kind']} against {row['value']} -- {site['quote']}"
            else:
                locator = f"{overlay}:{address_text}"
                detail = f"{row['kind']} against {row['value']}"
            signals.edges.append(Edge(
                function_id=fid, kind="bound", topic=None,
                # A bound is a fact about the instructions, not an interpretation.
                weight=0.3, authority=2,
                source="docs/generated/bounds.json",
                locator=locator,
                detail=detail,
                lexicon=(f"{row['kind']}={row['value']}",),
            ))
    signals.stats["bounds_rows"] = len(rows)
    signals.stats["bounds_joined_to_a_function"] = joined
    signals.stats["bounds_with_an_exact_site"] = cited


# --------------------------------------------------------------------------
# 4. research documents  (prose statements, including the new plain-language set)
# --------------------------------------------------------------------------

CONTEXT_LINES = 12


def load_documents(corpus, signals: Signals, root: Path = DOC_ROOT) -> None:
    if not root.is_dir():
        return
    by_pair, by_address = _address_index(corpus)
    stems = {module.split("/")[-1].lower() for module in corpus.modules}
    ambiguous = 0
    for path in sorted(root.rglob("*.md")):
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            continue
        relative = path.relative_to(REPO_ROOT).as_posix()
        lowered = [line.lower() for line in lines]
        # The overlay docs are one file per overlay: the filename qualifies every
        # address in them, which prose context often cannot.
        file_overlay = path.stem.lower() if path.stem.lower() in stems else None
        for index, line in enumerate(lines):
            for match in ADDRESS_RE.finditer(line):
                address = int(match.group(0), 16)
                window = " ".join(lowered[max(0, index - CONTEXT_LINES): index + CONTEXT_LINES + 1])
                overlay = file_overlay
                if overlay is None:
                    named = [stem for stem in stems if len(stem) >= 4 and stem in window]
                    overlay = named[0] if len(named) == 1 else None
                fid = _resolve(by_pair, by_address, overlay, address, corpus)
                if not fid:
                    if address in by_address:
                        ambiguous += 1
                    continue
                statement = line.strip()[:300]
                signals.doc_statements.append({
                    "document": relative, "line": index + 1,
                    "address": f"0x{address:08x}", "function_id": fid,
                    "statement": statement,
                })
                signals.edges.append(Edge(
                    function_id=fid, kind="doc", topic=None,
                    # Research prose is authority 5 on the project scale.
                    weight=0.35, authority=5,
                    source=relative, locator=f"L{index + 1}",
                    detail=statement[:160],
                ))
    signals.stats["doc_statements_anchored"] = len(signals.doc_statements)
    signals.stats["doc_addresses_dropped_as_ambiguous"] = ambiguous


# --------------------------------------------------------------------------
# 5. browser implementation  (navigation aid only -- authority 6)
# --------------------------------------------------------------------------

def load_engine(corpus, signals: Signals, roots=ENGINE_ROOTS) -> None:
    by_pair, by_address = _address_index(corpus)
    stems = {module.split("/")[-1].lower() for module in corpus.modules}
    hits = 0
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix not in (".ts", ".js") or not path.is_file():
                continue
            if "vendor" in path.parts or "node_modules" in path.parts:
                continue
            try:
                lines = path.read_text(errors="replace").splitlines()
            except OSError:
                continue
            relative = path.relative_to(REPO_ROOT).as_posix()
            for index, line in enumerate(lines):
                if "0x8" not in line:
                    continue
                lowered = line.lower()
                named = [stem for stem in stems if len(stem) >= 4 and stem in lowered]
                overlay = named[0] if len(named) == 1 else None
                for match in ADDRESS_RE.finditer(line):
                    fid = _resolve(by_pair, by_address, overlay, int(match.group(0), 16), corpus)
                    if not fid:
                        continue
                    hits += 1
                    signals.edges.append(Edge(
                        function_id=fid, kind="engine", topic=None,
                        weight=0.2, authority=6,
                        source=relative, locator=f"L{index + 1}",
                        detail=f"browser code references this address: {line.strip()[:120]}",
                    ))
    signals.stats["engine_address_references"] = hits


# --------------------------------------------------------------------------
# 6. static decode records  (proven field/global/table access, authority 2)
# --------------------------------------------------------------------------

DECODE_STATIC_ROOT = REPO_ROOT / ".dw3-research/decode-static"
# A global that hundreds of functions touch is the resident state every part of
# the game reads -- the exact hub problem that made call-graph propagation score
# worse than guessing. Only reasonably specific globals may link functions.
GLOBAL_FANOUT_MAX = 20


def load_static_decode(corpus, signals: Signals, root: Path = DECODE_STATIC_ROOT) -> None:
    """Join `tools/decode_*.py` output: what each function PROVABLY touches.

    These records are the richest untapped semantic source in the repository:
    64,828 proven field accesses, 18,997 global accesses and 15,885 branch
    conditions over 3,692 functions. The globals matter most, because a global
    carries an ABSOLUTE RAM address -- a corpus-unique identity, unlike an
    overlay-relative code address. Two functions touching 0x8004b414 are related
    whatever overlay they live in, and that link is independent of the call
    graph, of module membership and of family shape.
    """
    if not root.is_dir():
        return
    by_pair, by_address = _address_index(corpus)
    records = joined = 0
    for path in sorted(root.glob("*.json")):
        records += 1
        try:
            record = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        overlay = (record.get("overlay") or "").lower()
        address = record.get("address")
        if not isinstance(address, int):
            continue
        fid = _resolve(by_pair, by_address, overlay, address, corpus)
        if not fid:
            continue
        joined += 1
        # `root` is overridable, so a record may legitimately sit outside the
        # repository (a test fixture does). Do not make that a crash.
        try:
            relative = path.relative_to(REPO_ROOT).as_posix()
        except ValueError:
            relative = path.as_posix()
        proven = record.get("proven") or {}

        shapes = tuple(record.get("shapes") or ())
        if shapes and shapes != ("unclassified",):
            signals.edges.append(Edge(
                function_id=fid, kind="static_shape", topic=None,
                weight=0.35, authority=2, source=relative, locator="shapes",
                detail="proven control shape: " + ", ".join(shapes),
                lexicon=shapes))

        # A `lui` BASE IS NOT A GLOBAL. The decoder records `address` (the base
        # the compiler materialised) and `offset` separately, and reading only
        # `address` keyed this index by base. Measured 2026-08-12 on the eight
        # surviving shared_global rows: `exe/fns:F0x8001a8b4` was recorded as
        # touching `0x8004de00` twice and in fact touches `D0x8004de04` and
        # `D0x8004de0c` once each, never `0x8004de00`; the assembly names all
        # three as distinct symbols. In the other direction `F0x8001270c` was
        # recorded as touching `0x8004df98` once and touches it five times,
        # because the rest were reached from a different base. So base-keying
        # both merged unrelated globals that shared a 64 KiB `lui` window and
        # split one global reached from two bases.
        #
        # Offsets here are signed and often negative: `0x80090000 + (-11860)`
        # is `0x8008d1ac`. That is the documented lui/addiu borrow, and it is
        # why the effective address must be computed, not assumed.
        addresses = sorted({
            entry["address"] + (entry.get("offset") or 0)
            for entry in (proven.get("globals") or [])
            if isinstance(entry.get("address"), int)
        })
        for global_address in addresses:
            signals.global_index.setdefault(global_address, set()).add(fid)
        if addresses:
            signals.edges.append(Edge(
                function_id=fid, kind="static_global", topic=None,
                weight=0.4, authority=2, source=relative, locator="proven.globals",
                detail=f"touches {len(addresses)} global(s)",
                lexicon=tuple(f"0x{a:08x}" for a in addresses[:12])))

        fields = proven.get("fields") or []
        receiver = sorted({
            (entry.get("object"), entry.get("offset"))
            for entry in fields
            if entry.get("object") in ("a0", "a1", "a2", "a3")
            and isinstance(entry.get("offset"), int)
        })
        if receiver:
            signals.edges.append(Edge(
                function_id=fid, kind="static_field", topic=None,
                weight=0.25, authority=2, source=relative, locator="proven.fields",
                detail=f"{len(receiver)} proven argument-struct slot accesses",
                lexicon=tuple(f"{obj}+0x{off:x}" for obj, off in receiver[:12])))

    # Drop the hub globals outright: they link nothing meaningfully.
    signals.global_index = {
        address: ids for address, ids in signals.global_index.items()
        if 2 <= len(ids) <= GLOBAL_FANOUT_MAX
    }
    signals.stats["static_decode_records"] = records
    signals.stats["static_decode_records_joined"] = joined
    signals.stats["linking_globals_after_hub_cut"] = len(signals.global_index)


def load_all(corpus) -> Signals:
    signals = Signals()
    load_ledger(corpus, signals)
    load_static_decode(corpus, signals)
    load_text_banks(corpus, signals)
    load_bounds(corpus, signals)
    load_documents(corpus, signals)
    load_engine(corpus, signals)
    signals.stats["edges_total"] = len(signals.edges)
    signals.stats["functions_touched"] = len({edge.function_id for edge in signals.edges})
    return signals
