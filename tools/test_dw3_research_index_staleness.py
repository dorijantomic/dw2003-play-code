"""Tests for the dw3-research index freshness gate.

Run: python3 tools/test_dw3_research_index_staleness.py

The index is a derived cache. Evidence IDs hash source path + exact text, so a
stale cache still resolves IDs for content that has changed or vanished — which
used to let `handoff-check` report green over broken records.
"""

import argparse
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from dw3_research import cli, index
from dw3_research.index import SCHEMA, SourceSpec, index_staleness, sha1_file


# The default must track the CURRENT full-index schema. It said "1" while
# index.py had moved to "2", so `index_stale_reasons` short-circuited on the
# schema check and returned ["index schema is '1', expected full index '2'"]
# before reaching any of the staleness behaviour these tests exist to cover --
# seven of them asserted against that one string instead. A test that fails for
# a reason unrelated to its subject is worse than no test: this suite guards the
# gate that stops `handoff-check` reporting green over a stale cache.
# Callers that deliberately want a non-current schema pass it explicitly.
def write_db(db_path: Path, sources, root: Path, schema_version: str = "2") -> None:
    index.reset_db_files(db_path)
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA)
    for path in sources:
        stat = path.stat()
        conn.execute(
            "INSERT INTO sources(path,kind,authority,non_ground_truth,size,mtime_ns,sha1,associated_path)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (str(path), "research_document", 5, 0, stat.st_size, stat.st_mtime_ns,
             sha1_file(path), None),
        )
    conn.execute("INSERT INTO meta VALUES('root',?)", (str(root),))
    conn.execute("INSERT INTO meta VALUES('schema_version',?)", (schema_version,))
    conn.commit()
    conn.close()


class TestIndexStaleness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.db = self.root / "index.sqlite3"
        self.docs = [self.root / "a.md", self.root / "b.md"]
        for n, path in enumerate(self.docs):
            path.write_text(f"doc {n}\n")
        self._real_discover = index.discover
        index.discover = lambda root: [
            SourceSpec(path, "research_document", 5) for path in sorted(self.files())
        ]
        self._files = list(self.docs)
        write_db(self.db, self.docs, self.root)

    def tearDown(self):
        index.discover = self._real_discover
        self.tmp.cleanup()

    def files(self):
        return [path for path in self._files if path.is_file()]

    def test_fresh_index_reports_nothing(self):
        self.assertEqual(index_staleness(self.root, self.db), [])

    def test_missing_index_is_stale(self):
        self.assertEqual(index_staleness(self.root, self.root / "absent.sqlite3"),
                         ["index missing"])

    def test_ledger_only_index_is_not_a_full_index(self):
        write_db(self.db, [], self.root, schema_version="1-ledger-only")
        reasons = index_staleness(self.root, self.db)
        self.assertEqual(len(reasons), 1)
        self.assertIn("1-ledger-only", reasons[0])

    def test_index_built_for_another_root_is_stale(self):
        write_db(self.db, self.docs, self.root / "elsewhere")
        reasons = index_staleness(self.root, self.db)
        self.assertEqual(len(reasons), 1)
        self.assertIn("different root", reasons[0])

    def test_changed_content_is_stale(self):
        self.docs[0].write_text("doc 0 rewritten with different length\n")
        reasons = index_staleness(self.root, self.db)
        self.assertEqual(reasons, [f"source changed since indexing: {self.docs[0]}"])

    def test_same_content_with_new_mtime_is_not_stale(self):
        # A checkout rewrites mtimes without changing bytes; only content counts.
        text = self.docs[0].read_text()
        self.docs[0].write_text(text)
        os.utime(self.docs[0], ns=(0, 0))
        self.assertEqual(index_staleness(self.root, self.db), [])

    def test_new_source_is_stale(self):
        new = self.root / "c.md"
        new.write_text("new\n")
        self._files.append(new)
        self.assertEqual(index_staleness(self.root, self.db),
                         [f"source not indexed: {new}"])

    def test_deleted_source_is_stale(self):
        self.docs[1].unlink()
        self.assertEqual(index_staleness(self.root, self.db),
                         [f"indexed source no longer discoverable: {self.docs[1]}"])

    def test_reason_list_is_capped(self):
        for n in range(12):
            path = self.root / f"extra{n}.md"
            path.write_text("x\n")
            self._files.append(path)
        reasons = index_staleness(self.root, self.db, limit=3)
        self.assertEqual(len(reasons), 4)
        self.assertIn("and 9 more", reasons[-1])


class TestHandoffRefusesStaleCache(unittest.TestCase):
    """handoff-check must fail, not silently skip, when the cache is untrusted."""

    def setUp(self):
        cli._STALENESS_CACHE.clear()

    def tearDown(self):
        cli._STALENESS_CACHE.clear()

    def test_missing_index_fails_handoff_and_withholds_cache_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            args = argparse.Namespace(db=Path(tmp) / "absent.sqlite3")
            errors = cli.handoff_errors(args)
        self.assertTrue(any("stale index" in error for error in errors), errors)
        self.assertIn("skipped indexed-evidence and review-digest checks: index is stale", errors)
        # Withheld, not silently passed as if every ID resolved.
        self.assertFalse(any("unknown claim evidence" in error for error in errors), errors)

    def test_self_written_ledger_edit_is_repaired_not_reported(self):
        # record-finding rewrites the ledger and a manifest; a second recording must not
        # demand a full rebuild in between. Any OTHER stale source must still be reported.
        db = cli.DEFAULT_DB
        if index_staleness(cli.ROOT, db):
            self.skipTest("working index is already stale; run `dw3-research index`")
        ledger = cli.LEDGER
        original = ledger.read_bytes()
        try:
            ledger.write_bytes(original.replace(b'"schema_version"', b'"schema_version" ', 1))
            cli._STALENESS_CACHE.clear()
            self.assertEqual(cli.index_stale_reasons(db), [])   # repaired in place
        finally:
            ledger.write_bytes(original)
            cli._STALENESS_CACHE.clear()
            index.reindex_paths(cli.ROOT, db, [ledger])

    def test_require_fresh_index_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit) as caught:
                cli.require_fresh_index(Path(tmp) / "absent.sqlite3", "unit test")
        self.assertIn("run `dw3-research index`", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
