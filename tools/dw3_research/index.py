from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator


FUNCTION_RE = re.compile(r"\b(F0x([0-9a-fA-F]{8}))\s*\(")
FUNCTION_DEF_RE = re.compile(
    r"^[?A-Za-z_][^;\n{}]*?\s*(F0x([0-9a-fA-F]{8}))\s*\([^;\n]*\)\s*\{",
    re.MULTILINE,
)
ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{6,8}")
HEX_RE = re.compile(r"(?<![\w])0x[0-9a-fA-F]+")
OFFSET_RE = re.compile(r"(?:->unk|\b(?:lb|lbu|lh|lhu|lw|sb|sh|sw)\s+[^,]+,\s*)(-?0x[0-9a-fA-F]+)")
ASM_LABEL_RE = re.compile(
    r"^(?:glabel\s+([^\s]+)|(\.L0x([0-9a-fA-F]{8})):|([A-Za-z_][\w.]*(?:0x[0-9a-fA-F]{8})[\w.]*)\s*:)"
)


SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sources(
 id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, kind TEXT NOT NULL,
 authority INTEGER NOT NULL, non_ground_truth INTEGER NOT NULL DEFAULT 0,
 size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL, sha1 TEXT NOT NULL,
 associated_path TEXT
);
CREATE TABLE functions(
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, address INTEGER,
 source_id INTEGER NOT NULL REFERENCES sources(id), start_line INTEGER NOT NULL,
 end_line INTEGER NOT NULL, body TEXT NOT NULL, evidence_id TEXT NOT NULL UNIQUE
);
CREATE INDEX function_name ON functions(name);
CREATE INDEX function_address ON functions(address);
CREATE TABLE symbols(
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, address INTEGER,
 source_id INTEGER NOT NULL REFERENCES sources(id), line INTEGER NOT NULL,
 evidence_id TEXT NOT NULL UNIQUE
);
CREATE INDEX symbol_name ON symbols(name);
CREATE INDEX symbol_address ON symbols(address);
CREATE TABLE refs(
 id INTEGER PRIMARY KEY, function_id INTEGER NOT NULL REFERENCES functions(id),
 kind TEXT NOT NULL, value TEXT NOT NULL, target_address INTEGER,
 line INTEGER NOT NULL, evidence_id TEXT NOT NULL
);
CREATE INDEX refs_value ON refs(value);
CREATE INDEX refs_target ON refs(target_address);
CREATE TABLE records(
 id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
 kind TEXT NOT NULL, key TEXT NOT NULL, text TEXT NOT NULL,
 start_line INTEGER, end_line INTEGER, address INTEGER, evidence_id TEXT NOT NULL UNIQUE
);
CREATE INDEX records_key ON records(key);
CREATE INDEX records_kind ON records(kind);
CREATE VIRTUAL TABLE records_fts USING fts5(key, text, path);
CREATE VIRTUAL TABLE functions_fts USING fts5(name, path);
CREATE TABLE dumps(
 source_id INTEGER PRIMARY KEY REFERENCES sources(id), base_address INTEGER NOT NULL,
 screenshot_path TEXT
);
CREATE TABLE evidence(
 evidence_id TEXT PRIMARY KEY, kind TEXT NOT NULL, source_path TEXT NOT NULL,
 locator TEXT NOT NULL, authority INTEGER NOT NULL, summary TEXT NOT NULL,
 exact TEXT NOT NULL
);
CREATE TABLE claims(
 claim_id TEXT PRIMARY KEY, system_id TEXT NOT NULL, statement TEXT NOT NULL,
 status TEXT NOT NULL, evidence_ids TEXT NOT NULL, notes TEXT NOT NULL
);
CREATE TABLE ledger_evidence(evidence_id TEXT PRIMARY KEY);
"""


@dataclass(frozen=True)
class SourceSpec:
    path: Path
    kind: str
    authority: int
    non_ground_truth: bool = False


def stable_id(kind: str, path: str, locator: str, exact: str) -> str:
    raw = "\0".join((kind, path, locator, exact)).encode()
    return "EV-" + hashlib.sha1(raw).hexdigest()[:12]


def sha1_file(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discover(root: Path) -> list[SourceSpec]:
    home = Path.home()
    specs: dict[str, SourceSpec] = {}

    def add(paths: Iterable[Path], kind: str, authority: int, ngt: bool = False) -> None:
        for path in paths:
            if path.is_file():
                specs[str(path.resolve())] = SourceSpec(path.resolve(), kind, authority, ngt)

    add(root.glob("exe-decomp/**/*.c"), "decompiled_c", 3)
    add(root.glob("exe-decomp/**/_asm/*.s"), "decompiled_asm_closure", 3)
    asm_root = home / "ddw3/asm/dw2003"
    if asm_root.exists():
        add(asm_root.glob("**/*.s"), "original_assembly", 2)
    lang_root = home / "ddw3/lang_file/dw2003"
    if lang_root.exists():
        add(lang_root.glob("**/*.toml"), "original_strings", 4)
    add(root.glob("web/assets/data/**/*.json"), "extracted_table", 4)
    add(root.glob("web/assets/ui/**/*.json"), "extracted_table", 4)
    add(root.glob("web/assets/ui/**/*.png"), "extracted_asset", 4)
    add(root.glob("docs/**/*.md"), "research_document", 5)
    add(root.glob("docs/research/**/*.json"), "research_record", 5)
    add(root.glob("docs/research/**/*.bin"), "ram_dump", 1)
    add(root.glob("docs/research/**/*.png"), "runtime_screenshot", 1)
    add(root.glob("tools/**/*.py"), "research_tool", 5)
    add([root / "CLAUDE.md"], "project_guidance", 5)
    add(root.glob("web/**/*.js"), "browser_implementation", 6, True)
    add(root.glob("web/**/*.ts"), "browser_implementation", 6, True)
    memory_root = home / ".claude/projects/-home-dorij-ddw3-walker/memory"
    if memory_root.exists():
        add(memory_root.glob("*.md"), "session_research_memory", 5)
    rust_root = home / "ddw3/rust"
    if rust_root.exists():
        add(rust_root.glob("**/*.rs"), "upstream_structure", 4)
    dump_root = home / "vm-spike/dumps"
    if dump_root.exists():
        add(dump_root.glob("*.bin"), "ram_dump", 1)
    return sorted(specs.values(), key=lambda item: str(item.path))


def read_text(path: Path) -> str:
    return path.read_text(errors="replace")


def index_staleness(root: Path, db_path: Path, limit: int = 8) -> list[str]:
    """Reasons the cached index no longer describes the sources on disk.

    An empty list means every discoverable source is present in the cache with
    matching content, so cache-only lookups (evidence IDs, review bundles) are
    as trustworthy as re-reading the sources. Any non-empty result means the
    cache may still answer with evidence IDs for content that has since
    changed, moved, or been deleted.
    """
    if not db_path.exists():
        return ["index missing"]
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error as error:  # unreadable/corrupt cache is not fresh
        return [f"index unreadable: {error}"]
    try:
        try:
            meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
            indexed = {
                row[0]: (row[1], row[2], row[3])
                for row in conn.execute("SELECT path, size, mtime_ns, sha1 FROM sources")
            }
        except sqlite3.Error as error:
            return [f"index unreadable: {error}"]
    finally:
        conn.close()

    if meta.get("schema_version") != "2":
        return [f"index schema is {meta.get('schema_version', 'unknown')!r}, expected full index '2'"]
    if meta.get("root") != str(root):
        return [f"index built for a different root: {meta.get('root')!r}"]

    reasons: list[str] = []
    current = {str(spec.path): spec for spec in discover(root)}
    for path in sorted(set(current) - set(indexed)):
        reasons.append(f"source not indexed: {path}")
    for path in sorted(set(indexed) - set(current)):
        reasons.append(f"indexed source no longer discoverable: {path}")
    for path in sorted(set(indexed) & set(current)):
        size, mtime_ns, sha1 = indexed[path]
        try:
            stat = Path(path).stat()
        except OSError:
            reasons.append(f"indexed source unreadable: {path}")
            continue
        if stat.st_size == size and stat.st_mtime_ns == mtime_ns:
            continue
        # mtime alone is noisy (a checkout rewrites it), so only content counts.
        if sha1_file(Path(path)) != sha1:
            reasons.append(f"source changed since indexing: {path}")

    if len(reasons) > limit:
        hidden = len(reasons) - limit
        reasons = reasons[:limit] + [f"... and {hidden} more stale source(s)"]
    return reasons


def add_evidence(conn: sqlite3.Connection, evidence_id: str, kind: str, path: str,
                 locator: str, authority: int, summary: str, exact: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO evidence VALUES(?,?,?,?,?,?,?)",
        (evidence_id, kind, path, locator, authority, summary[:300], exact[:4000]),
    )


def line_for_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def index_c(conn: sqlite3.Connection, sid: int, spec: SourceSpec, text: str) -> None:
    matches = list(FUNCTION_DEF_RE.finditer(text))
    if not matches:
        return
    # Decompiler output is normally one function per file. The boundary logic also
    # handles concatenated outputs without needing a C parser.
    for index, match in enumerate(matches):
        start = match.start()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end].rstrip()
        start_line = line_for_offset(text, start)
        end_line = start_line + body.count("\n")
        name = match.group(1)
        address = int(match.group(2), 16)
        locator = f"L{start_line}-L{end_line} @0x{address:08x}"
        eid = stable_id("function", str(spec.path), locator, body)
        cur = conn.execute(
            "INSERT INTO functions(name,address,source_id,start_line,end_line,body,evidence_id) VALUES(?,?,?,?,?,?,?)",
            (name, address, sid, start_line, end_line, body, eid),
        )
        fid = int(cur.lastrowid)
        add_evidence(conn, eid, "decompiled_function", str(spec.path), locator,
                     spec.authority, name, body)
        seen: set[tuple[str, str, int]] = set()
        for call in FUNCTION_RE.finditer(body):
            callee = call.group(1)
            if callee == name:
                continue
            line = start_line + body.count("\n", 0, call.start())
            seen.add(("callee", callee, line))
        for address_match in ADDRESS_RE.finditer(body):
            value = address_match.group(0).lower()
            line = start_line + body.count("\n", 0, address_match.start())
            seen.add(("address", value, line))
        for off_match in OFFSET_RE.finditer(body):
            value = off_match.group(1).lower()
            line = start_line + body.count("\n", 0, off_match.start())
            seen.add(("offset", value, line))
        for kind, value, line in sorted(seen):
            target = int(value[3:], 16) if kind == "callee" else (
                int(value, 16) if kind == "address" else None)
            reid = stable_id(kind, str(spec.path), f"L{line}", value)
            conn.execute(
                "INSERT INTO refs(function_id,kind,value,target_address,line,evidence_id) VALUES(?,?,?,?,?,?)",
                (fid, kind, value, target, line, reid),
            )


def asm_base(path: Path) -> int | None:
    stem = path.stem
    if "dw2003/pro" not in str(path):
        return None
    return 0x800A5DE0 if stem.startswith(("wstag", "wfight")) else 0x80082CB0


def index_asm(conn: sqlite3.Connection, sid: int, spec: SourceSpec, text: str) -> None:
    base = asm_base(spec.path)
    for number, line in enumerate(text.splitlines(), 1):
        match = ASM_LABEL_RE.match(line)
        if match:
            name = match.group(1) or match.group(2) or match.group(4)
            address = None
            if match.group(3) and base is not None:
                raw_address = int(match.group(3), 16)
                address = raw_address if raw_address >= 0x80000000 else base + raw_address
            elif name:
                embedded = re.search(r"0x([0-9a-fA-F]{8})", name)
                if embedded:
                    address = int(embedded.group(1), 16)
            locator = f"L{number}" + (f" @0x{address:08x}" if address is not None else "")
            eid = stable_id("assembly_label", str(spec.path), locator, line)
            conn.execute(
                "INSERT OR IGNORE INTO symbols(name,address,source_id,line,evidence_id) VALUES(?,?,?,?,?)",
                (name, address, sid, number, eid),
            )
            add_evidence(conn, eid, "assembly_label", str(spec.path), locator,
                         spec.authority, name, line)
        jal = re.search(r"\bjal\s+(0x[0-9a-fA-F]{8})", line)
        if jal:
            target = int(jal.group(1), 16)
            locator = f"L{number}"
            eid = stable_id("assembly_call", str(spec.path), locator, line)
            conn.execute(
                "INSERT OR IGNORE INTO records(source_id,kind,key,text,start_line,end_line,address,evidence_id) VALUES(?,?,?,?,?,?,?,?)",
                (sid, "assembly_call", f"F0x{target:08x}", line.strip(), number, number, target, eid),
            )
            add_evidence(conn, eid, "assembly_call", str(spec.path), locator,
                         spec.authority, f"call F0x{target:08x}", line)


def index_toml(conn: sqlite3.Connection, sid: int, spec: SourceSpec, text: str) -> None:
    for number, line in enumerate(text.splitlines(), 1):
        for match in re.finditer(r'"((?:[^"\\]|\\.)*)"', line):
            value = match.group(1)
            locator = f"L{number}"
            eid = stable_id("toml_string", str(spec.path), locator, value)
            conn.execute(
                "INSERT OR IGNORE INTO records(source_id,kind,key,text,start_line,end_line,address,evidence_id) VALUES(?,?,?,?,?,?,?,?)",
                (sid, "string", value, value, number, number, None, eid),
            )
            add_evidence(conn, eid, "original_string", str(spec.path), locator,
                         spec.authority, value, line.strip())


def json_rows(value: object, key: str = "$", limit: int = 25000) -> Iterator[tuple[str, str]]:
    count = 0
    stack = [(key, value)]
    while stack and count < limit:
        path, current = stack.pop()
        if isinstance(current, dict):
            if current and all(not isinstance(v, (dict, list)) for v in current.values()):
                yield path, json.dumps(current, separators=(",", ":"), sort_keys=True)
                count += 1
            else:
                for child_key, child in reversed(list(current.items())):
                    stack.append((f"{path}.{child_key}", child))
        elif isinstance(current, list):
            for index in range(len(current) - 1, -1, -1):
                stack.append((f"{path}[{index}]", current[index]))
        else:
            yield path, json.dumps(current, separators=(",", ":"))
            count += 1


def index_json(conn: sqlite3.Connection, sid: int, spec: SourceSpec, text: str) -> None:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return
    for key, compact in json_rows(data):
        eid = stable_id("table_row", str(spec.path), key, compact)
        conn.execute(
            "INSERT OR IGNORE INTO records(source_id,kind,key,text,start_line,end_line,address,evidence_id) VALUES(?,?,?,?,?,?,?,?)",
            (sid, "table", key, compact, None, None, None, eid),
        )
        add_evidence(conn, eid, "extracted_table", str(spec.path), key,
                     spec.authority, key, compact)


def index_markdown(conn: sqlite3.Connection, sid: int, spec: SourceSpec, text: str) -> None:
    lines = text.splitlines()
    starts = [i for i, line in enumerate(lines) if line.startswith("#")]
    if not starts:
        starts = [0]
    for pos, start in enumerate(starts):
        end = starts[pos + 1] - 1 if pos + 1 < len(starts) else len(lines) - 1
        section = "\n".join(lines[start:end + 1]).strip()
        if not section:
            continue
        title = lines[start].lstrip("# ") if lines else spec.path.name
        locator = f"L{start + 1}-L{end + 1}"
        eid = stable_id("document_section", str(spec.path), locator, section)
        conn.execute(
            "INSERT OR IGNORE INTO records(source_id,kind,key,text,start_line,end_line,address,evidence_id) VALUES(?,?,?,?,?,?,?,?)",
            (sid, "research", title, section, start + 1, end + 1, None, eid),
        )
        add_evidence(conn, eid, "research_document", str(spec.path), locator,
                     spec.authority, title, section)


def import_ledger(conn: sqlite3.Connection, root: Path) -> None:
    path = root / "docs/research/evidence/ledger.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    previous = [row[0] for row in conn.execute("SELECT evidence_id FROM ledger_evidence")]
    if previous:
        conn.executemany("DELETE FROM evidence WHERE evidence_id=?", ((item,) for item in previous))
    conn.execute("DELETE FROM ledger_evidence")
    conn.execute("DELETE FROM claims")
    for item in data.get("evidence", []):
        conn.execute(
            "INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?,?)",
            (item["id"], item["kind"], item["source"], item["locator"],
             item["authority"], item.get("summary", ""), item.get("exact", "")),
        )
        conn.execute("INSERT INTO ledger_evidence VALUES(?)", (item["id"],))
    for claim in data.get("claims", []):
        conn.execute(
            "INSERT OR REPLACE INTO claims VALUES(?,?,?,?,?,?)",
            (claim["id"], claim["system"], claim["statement"], claim["status"],
             json.dumps(claim.get("evidence", [])), claim.get("notes", "")),
        )


def reset_db_files(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # A prior WAL-mode reader may leave sidecars after the main cache is
    # replaced. Opening a fresh main file against stale -wal/-shm state can
    # fail with SQLITE_IOERR, so rebuild the three-file cache as one unit.
    for path in (db_path, Path(str(db_path) + "-wal"), Path(str(db_path) + "-shm")):
        if path.exists():
            path.unlink()


def build_ledger_index(root: Path, db_path: Path) -> dict[str, int]:
    """Build a small review-only index containing durable evidence and claims."""
    reset_db_files(db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)
        import_ledger(conn, root)
        conn.execute("INSERT INTO meta VALUES('root',?)", (str(root),))
        conn.execute("INSERT INTO meta VALUES('schema_version','1-ledger-only')")
        conn.commit()
        return {
            "evidence": conn.execute("SELECT count(*) FROM evidence").fetchone()[0],
            "claims": conn.execute("SELECT count(*) FROM claims").fetchone()[0],
        }
    finally:
        conn.close()


def populate_search_rows(conn: sqlite3.Connection, source_id: int, path: str) -> None:
    """Populate bounded FTS rows for one already-parsed source."""
    conn.execute(
        """INSERT INTO records_fts(rowid,key,text,path)
           SELECT id,key,substr(text,1,2000),? FROM records
           WHERE source_id=? AND kind!='table'""",
        (path, source_id),
    )
    conn.execute(
        """INSERT INTO functions_fts(rowid,name,path)
           SELECT id,name,? FROM functions WHERE source_id=?""",
        (path, source_id),
    )


def index_source(
    conn: sqlite3.Connection,
    spec: SourceSpec,
    *,
    populate_search: bool = True,
) -> str:
    """Insert one source row and its parsed records. Returns the kind indexed."""
    stat = spec.path.stat()
    digest = sha1_file(spec.path)
    associated = None
    if spec.kind == "ram_dump":
        png = spec.path.with_suffix(".png")
        associated = str(png) if png.exists() else None
    cur = conn.execute(
        "INSERT INTO sources(path,kind,authority,non_ground_truth,size,mtime_ns,sha1,associated_path) VALUES(?,?,?,?,?,?,?,?)",
        (str(spec.path), spec.kind, spec.authority, int(spec.non_ground_truth),
         stat.st_size, stat.st_mtime_ns, digest, associated),
    )
    sid = int(cur.lastrowid)
    if spec.kind == "ram_dump":
        conn.execute("INSERT INTO dumps VALUES(?,?,?)", (sid, 0x80000000, associated))
        return spec.kind
    if spec.kind == "runtime_screenshot":
        return spec.kind
    # Avoid parsing unusually large generated tables/documents. They remain
    # discoverable as source metadata and can be explicitly expanded later.
    if stat.st_size > 32 * 1024 * 1024:
        return spec.kind
    text = read_text(spec.path)
    if spec.kind == "decompiled_c":
        index_c(conn, sid, spec, text)
    elif spec.kind in ("original_assembly", "decompiled_asm_closure"):
        index_asm(conn, sid, spec, text)
    elif spec.kind == "original_strings":
        index_toml(conn, sid, spec, text)
    elif spec.kind in ("extracted_table", "research_record"):
        index_json(conn, sid, spec, text)
    elif spec.kind in (
        "research_document", "research_tool", "project_guidance",
        "session_research_memory", "upstream_structure", "browser_implementation",
    ):
        index_markdown(conn, sid, spec, text)
    if populate_search:
        populate_search_rows(conn, sid, str(spec.path))
    return spec.kind


def delete_source(conn: sqlite3.Connection, source_id: int, path: str) -> None:
    """Remove one indexed source and every derived row belonging to it."""
    function_ids = [
        row[0] for row in conn.execute("SELECT id FROM functions WHERE source_id=?", (source_id,))
    ]
    record_ids = [
        row[0] for row in conn.execute("SELECT id FROM records WHERE source_id=?", (source_id,))
    ]
    if function_ids:
        conn.executemany("DELETE FROM functions_fts WHERE rowid=?", ((item,) for item in function_ids))
    if record_ids:
        conn.executemany("DELETE FROM records_fts WHERE rowid=?", ((item,) for item in record_ids))
    conn.execute(
        "DELETE FROM refs WHERE function_id IN (SELECT id FROM functions WHERE source_id=?)",
        (source_id,),
    )
    for table in ("functions", "symbols", "records", "dumps"):
        conn.execute(f"DELETE FROM {table} WHERE source_id=?", (source_id,))
    # Generated evidence is keyed by source path. Durable ledger evidence is
    # restored by import_ledger after all source changes are applied.
    conn.execute("DELETE FROM evidence WHERE source_path=?", (path,))
    conn.execute("DELETE FROM sources WHERE id=?", (source_id,))


def reindex_paths(root: Path, db_path: Path, paths: Iterable[Path]) -> int:
    """Re-index just `paths` in place, leaving the rest of the cache untouched.

    Used to repair the cache after the CLI itself rewrites a source it owns (the
    evidence ledger and the system manifests), so recording several findings in a
    row does not demand a full rebuild between each. Anything outside `paths` is
    left alone, so this can only ever narrow staleness, never hide it.
    """
    wanted = {str(p.resolve()) for p in paths}
    specs = [spec for spec in discover(root) if str(spec.path) in wanted]
    conn = sqlite3.connect(db_path)
    try:
        for spec in specs:
            row = conn.execute("SELECT id FROM sources WHERE path=?", (str(spec.path),)).fetchone()
            if row is not None:
                delete_source(conn, row[0], str(spec.path))
            index_source(conn, spec)
        # Evidence/claim rows are derived from the ledger, so refresh them too.
        import_ledger(conn, root)
        set_generation(conn)
        conn.commit()
    finally:
        conn.close()
    return len(specs)


def refresh_index(root: Path, db_path: Path) -> dict[str, int]:
    """Incrementally synchronize the cache with discoverable source content."""
    current = {str(spec.path): spec for spec in discover(root)}
    conn = sqlite3.connect(db_path)
    counts = {"added": 0, "changed": 0, "deleted": 0, "unchanged": 0}
    try:
        meta = dict(conn.execute("SELECT key,value FROM meta"))
        if meta.get("schema_version") != "2" or meta.get("root") != str(root):
            raise ValueError("incremental refresh requires a current schema-2 index for this root")
        indexed = {
            row[1]: (row[0], row[2], row[3], row[4])
            for row in conn.execute("SELECT id,path,size,mtime_ns,sha1 FROM sources")
        }
        for path in sorted(set(indexed) - set(current)):
            delete_source(conn, indexed[path][0], path)
            counts["deleted"] += 1
        for path, spec in sorted(current.items()):
            previous = indexed.get(path)
            if previous is None:
                index_source(conn, spec)
                counts["added"] += 1
                continue
            source_id, size, mtime_ns, digest = previous
            stat = spec.path.stat()
            unchanged = stat.st_size == size and stat.st_mtime_ns == mtime_ns
            if not unchanged:
                unchanged = sha1_file(spec.path) == digest
            if unchanged:
                counts["unchanged"] += 1
                continue
            delete_source(conn, source_id, path)
            index_source(conn, spec)
            counts["changed"] += 1
        import_ledger(conn, root)
        set_generation(conn)
        conn.commit()
    finally:
        conn.close()
    return counts


def set_generation(conn: sqlite3.Connection) -> str:
    """Store a stable digest identifying the indexed source generation."""
    digest = hashlib.sha256()
    for path, sha1 in conn.execute("SELECT path,sha1 FROM sources ORDER BY path"):
        digest.update(path.encode())
        digest.update(b"\0")
        digest.update(sha1.encode())
        digest.update(b"\n")
    generation = digest.hexdigest()
    conn.execute("INSERT OR REPLACE INTO meta VALUES('generation',?)", (generation,))
    return generation


def build_index(root: Path, db_path: Path) -> dict[str, int]:
    reset_db_files(db_path)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    counts = {"sources": 0, "functions": 0, "records": 0, "dumps": 0}
    try:
        for spec in discover(root):
            kind = index_source(conn, spec, populate_search=False)
            counts["sources"] += 1
            if kind == "ram_dump":
                counts["dumps"] += 1
        import_ledger(conn, root)
        conn.execute(
            """INSERT INTO records_fts(rowid,key,text,path)
               SELECT r.id,r.key,substr(r.text,1,2000),s.path
               FROM records r JOIN sources s ON s.id=r.source_id
               WHERE r.kind!='table'"""
        )
        conn.execute(
            """INSERT INTO functions_fts(rowid,name,path)
               SELECT f.id,f.name,s.path
               FROM functions f JOIN sources s ON s.id=f.source_id"""
        )
        counts["functions"] = conn.execute("SELECT count(*) FROM functions").fetchone()[0]
        counts["records"] = conn.execute("SELECT count(*) FROM records").fetchone()[0]
        conn.execute("INSERT INTO meta VALUES('root',?)", (str(root),))
        conn.execute("INSERT INTO meta VALUES('schema_version','2')")
        set_generation(conn)
        conn.commit()
    finally:
        conn.close()
    return counts
