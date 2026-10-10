from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path

from tools.dw3_research.cli import (
    aggregate_claim_status,
    atomic_json,
    bundle_digest,
    changed_ranges,
    dump_offset,
    read_range,
    resolve_system,
)
from tools.dw3_research.index import SCHEMA, SourceSpec, index_c, stable_id
from tools.dw3_research.metadata import index_lock
from tools.dw3_research.workflow import apply_packets, create_epoch, validate_packets
from tools.overlay_scan import file_offset


def _record_concurrent_claim(claim_id: str) -> None:
    from tools.dw3_research import cli

    cli.cmd_record_finding(argparse.Namespace(
        system="test-system",
        claim_id=claim_id,
        status="candidate",
        statement=f"statement for {claim_id}",
        evidence=["EV-test"],
        notes=None,
        frontier=[],
        frontier_rationale="concurrency test",
        superseded_by=[],
        contradiction_rationale=None,
        db=cli.DEFAULT_DB,
    ))


class Dw3ResearchTests(unittest.TestCase):
    def test_stable_evidence_id(self) -> None:
        first = stable_id("function", "a.c", "L1", "body")
        self.assertEqual(first, stable_id("function", "a.c", "L1", "body"))
        self.assertNotEqual(first, stable_id("function", "a.c", "L2", "body"))

    def test_c_index_uses_definitions_not_calls(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.executescript(SCHEMA)
        path = Path("sample.c")
        sid = conn.execute(
            "INSERT INTO sources(path,kind,authority,size,mtime_ns,sha1) VALUES(?,?,?,?,?,?)",
            (str(path), "decompiled_c", 3, 0, 0, "0"),
        ).lastrowid
        text = "? F0x80010000(? *);\nvoid *F0x80020000(void) {\n F0x80010000(0);\n}\n"
        index_c(conn, sid, SourceSpec(path, "decompiled_c", 3), text)
        functions = conn.execute("SELECT name FROM functions").fetchall()
        refs = conn.execute("SELECT kind,value FROM refs WHERE kind='callee'").fetchall()
        self.assertEqual(functions, [("F0x80020000",)])
        self.assertEqual(refs, [("callee", "F0x80010000")])
        conn.close()

    def test_fts_indexes_function_names_without_full_body_duplication(self) -> None:
        conn = sqlite3.connect(":memory:")
        conn.executescript(SCHEMA)
        path = Path("sample.c")
        sid = conn.execute(
            "INSERT INTO sources(path,kind,authority,size,mtime_ns,sha1) VALUES(?,?,?,?,?,?)",
            (str(path), "decompiled_c", 3, 0, 0, "0"),
        ).lastrowid
        index_c(conn, sid, SourceSpec(path, "decompiled_c", 3), "void F0x80020000(void) {}\n")
        function = conn.execute("SELECT id,name FROM functions").fetchone()
        conn.execute(
            "INSERT INTO functions_fts(rowid,name,path) VALUES(?,?,?)",
            (function[0], function[1], str(path)),
        )
        self.assertEqual(
            conn.execute(
                "SELECT rowid FROM functions_fts WHERE functions_fts MATCH ?",
                ('"F0x80020000"',),
            ).fetchone()[0],
            function[0],
        )
        conn.close()

    def test_ram_seek_and_psx_address_mapping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ram.bin"
            path.write_bytes(bytes(range(32)))
            self.assertEqual(dump_offset(path, 0x80000004), 4)
            self.assertEqual(read_range(path, 0x80000004, 4), b"\x04\x05\x06\x07")

    def test_changed_ranges_are_coalesced(self) -> None:
        self.assertEqual(
            changed_ranges(b"abcdef", b"aXcYYf", 0x80000000),
            [(0x80000001, 1), (0x80000003, 2)],
        )

    def test_overlay_address_accepts_file_or_ram_form(self) -> None:
        self.assertEqual(file_offset("0x58b8", 0x80082CB0), 0x58B8)
        self.assertEqual(file_offset("0x80088568", 0x80082CB0), 0x58B8)

    def test_system_alias_resolves_to_canonical_manifest_name(self) -> None:
        self.assertEqual(resolve_system("DNA")["system"], "dna-digivolution")
        self.assertEqual(resolve_system("status_effects")["system"], "status-effects")

    def test_claim_summary_does_not_promote_candidates(self) -> None:
        self.assertEqual(aggregate_claim_status([]), "unresearched")
        self.assertEqual(aggregate_claim_status(["candidate"]), "candidate")
        self.assertEqual(aggregate_claim_status(["verified"]), "verified")
        self.assertEqual(
            aggregate_claim_status(["verified", "candidate"]),
            "partially_verified",
        )

    def test_review_digest_survives_status_promotion_only(self) -> None:
        candidate = {"claim": {"statement": "x", "current_status": "candidate"}}
        verified = {"claim": {"statement": "x", "current_status": "verified"}}
        changed = {"claim": {"statement": "y", "current_status": "candidate"}}
        self.assertEqual(bundle_digest(candidate), bundle_digest(verified))
        self.assertNotEqual(bundle_digest(candidate), bundle_digest(changed))

    def test_atomic_json_preserves_existing_indentation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "ledger.json"
            path.write_text('{\n "schema_version": 1\n}\n')
            atomic_json(path, {"schema_version": 1, "claims": []})
            self.assertTrue(path.read_text().startswith('{\n "schema_version"'))

    def test_index_writer_cannot_overlap_reader(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with index_lock(root, shared=True):
                with self.assertRaises(TimeoutError):
                    with index_lock(root, shared=False, timeout=0.05):
                        pass

    def test_epoch_packet_requires_snapshot_and_frontier_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "proof.txt"
            source.write_text("exact proof")
            snapshot = {"index_generation": "generation"}
            epoch = {
                "epoch_id": "e1",
                "snapshot": snapshot,
                "assignments": [{
                    "frontier_id": "F-1", "system": "test-system",
                    "resource": "static", "slot": 1,
                }],
            }
            catalog = {
                "_repository_root": str(root),
                "systems": [{
                    "system": "test-system",
                    "frontiers": [{"id": "F-1", "status": "open"}],
                }],
            }
            packet = {
                "schema_version": 1,
                "epoch_id": "e1",
                "snapshot": snapshot,
                "frontier_id": "F-1",
                "system": "test-system",
                "resource": "static",
                "worker": {
                    "agent_id": "agent-1", "agent_type": "ddw3-static-researcher",
                    "model": "inherit",
                },
                "model_selection": {
                    "selected_agent": "ddw3-static-researcher",
                    "tier": "standard", "reason": "bounded indexed lookup",
                },
                "commands": [{
                    "command": "./dw3-research search proof",
                    "exit_code": 0, "result": "proof",
                }],
                "limitations": [],
                "proposed_evidence": [{
                    "id": "EV-proof", "kind": "research", "source": "proof.txt",
                    "source_sha256": __import__("hashlib").sha256(source.read_bytes()).hexdigest(),
                    "locator": "L1", "authority": 5, "summary": "proof",
                    "exact": "exact proof",
                }],
                "proposed_claims": [{
                    "id": "claim-proof", "system": "test-system",
                    "statement": "proof", "status": "candidate",
                    "evidence": ["EV-proof"], "notes": "",
                    "frontier_ids": ["F-1"],
                }],
                "frontier_update": None,
            }
            self.assertEqual(validate_packets(epoch, [packet], {"evidence": [], "claims": []}, catalog), [])
            del packet["proposed_claims"][0]["frontier_ids"]
            self.assertTrue(any(
                "must reference F-1" in error
                for error in validate_packets(epoch, [packet], {"evidence": [], "claims": []}, catalog)
            ))

    def test_record_packets_integrates_one_journaled_epoch(self) -> None:
        from unittest.mock import patch
        from tools.dw3_research import cli

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            systems = root / "docs/research/systems"
            ledger = root / "docs/research/evidence/ledger.json"
            systems.mkdir(parents=True)
            ledger.parent.mkdir(parents=True)
            catalog = systems / "catalog.json"
            source = root / "proof.txt"
            source.write_text("exact proof")
            ledger.write_text(json.dumps({"schema_version": 1, "evidence": [], "claims": []}))
            catalog.write_text(json.dumps({
                "schema_version": 1,
                "updated": "2026-08-03",
                "note": "test",
                "systems": [{
                    "system": "test-system", "aliases": [], "status": "unresearched",
                    "implementation_status": "unknown", "summary": "test",
                    "canonical_docs": [], "source_map": ["proof.txt"], "priority": 1,
                    "frontiers": [{
                        "id": "F-1", "status": "open", "question": "proof?",
                        "evidence_needed": "exact proof",
                    }],
                }],
            }))
            (root / ".gitignore").write_text(".dw3-research/\n")
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            subprocess.run(["git", "add", "."], cwd=root, check=True)
            subprocess.run([
                "git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                "commit", "-qm", "initial",
            ], cwd=root, check=True)
            db = root / ".dw3-research/index.sqlite3"
            db.parent.mkdir(parents=True)
            conn = sqlite3.connect(db)
            conn.executescript(SCHEMA)
            conn.execute("INSERT INTO meta VALUES('root',?)", (str(root),))
            conn.execute("INSERT INTO meta VALUES('schema_version','2')")
            conn.execute("INSERT INTO meta VALUES('generation','test-generation')")
            conn.commit()
            conn.close()
            epoch_dir, epoch = create_epoch(
                root, db, ledger, catalog, "epoch-1", ["F-1"], "static",
            )
            packet = {
                "schema_version": 1, "epoch_id": "epoch-1",
                "frontier_id": "F-1", "system": "test-system", "slot": 1,
                "resource": "static", "snapshot": epoch["snapshot"],
                "worker": {
                    "agent_id": "agent-1", "agent_type": "ddw3-static-researcher",
                    "model": "inherit",
                },
                "model_selection": {
                    "selected_agent": "ddw3-static-researcher",
                    "tier": "standard", "reason": "bounded indexed lookup",
                },
                "proposed_evidence": [{
                    "id": "EV-proof", "kind": "research", "source": "proof.txt",
                    "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "locator": "L1", "authority": 5, "summary": "proof",
                    "exact": "exact proof",
                }],
                "proposed_claims": [{
                    "id": "claim-proof", "system": "test-system",
                    "statement": "proof", "status": "candidate",
                    "evidence": ["EV-proof"], "notes": "",
                    "frontier_ids": ["F-1"],
                }],
                "frontier_update": {"status": "needs_evidence"},
                "limitations": ["candidate only"],
                "commands": [{"command": "search", "exit_code": 0, "result": "proof"}],
            }
            atomic_json(epoch_dir / "F-1.packet.json", packet)
            with (
                patch.object(cli, "ROOT", root),
                patch.object(cli, "LEDGER", ledger),
                patch.object(cli, "SYSTEMS_DIR", systems),
                patch.object(cli, "SYSTEM_CATALOG", catalog),
                patch.object(cli, "DEFAULT_DB", db),
                patch.object(cli, "require_fresh_index"),
                patch.object(cli, "refresh_index", return_value={}),
                patch.object(cli, "handoff_errors", return_value=[]),
            ):
                cli.cmd_record_packets(argparse.Namespace(epoch_id="epoch-1", db=db))
            recorded = json.loads(ledger.read_text())
            self.assertEqual([item["id"] for item in recorded["claims"]], ["claim-proof"])
            self.assertEqual(json.loads((epoch_dir / "epoch.json").read_text())["state"], "integrated")
            self.assertFalse((root / ".dw3-research/integration-journal.json").exists())

    def _rigour_packet(self, root: Path, claim: dict, *, exact: str,
                       commands: list | None = None) -> tuple[dict, list[dict], dict, dict]:
        """One well-formed packet with a single text-source evidence anchor."""
        source = root / "proof.txt"
        source.write_text("anchor line one\nanchor line two\n")
        epoch = {"epoch_id": "e", "snapshot": {"s": 1}, "assignments": [
            {"frontier_id": "F-1", "system": "test-system", "slot": 1, "resource": "static"}]}
        packet = {
            "schema_version": 1, "epoch_id": "e", "frontier_id": "F-1",
            "system": "test-system", "slot": 1, "resource": "static",
            "snapshot": {"s": 1},
            "worker": {"agent_id": "a", "agent_type": "ddw3-static-researcher", "model": "m"},
            "model_selection": {"selected_agent": "ddw3-static-researcher",
                                "tier": "standard", "reason": "bounded"},
            "proposed_evidence": [{
                "id": "EV-1", "kind": "assembly_label", "source": str(source),
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "locator": "L1", "authority": 2, "summary": "s", "exact": exact,
            }],
            "proposed_claims": [claim], "frontier_update": None, "limitations": [],
            "commands": [{"command": "c", "exit_code": 0, "result": "r"}]
                        if commands is None else commands,
        }
        catalog = {"_repository_root": str(root), "systems": [
            {"system": "test-system", "frontiers": [{"id": "F-1", "status": "open"}]}]}
        return epoch, [packet], {"evidence": [], "claims": []}, catalog

    def _claim(self, **over: object) -> dict:
        claim = {"id": "c-1", "system": "test-system", "status": "partially_verified",
                 "evidence": ["EV-1"], "frontier_ids": ["F-1"],
                 "statement": "the byte at +0x05 is the summon cost"}
        claim.update(over)
        return claim

    def test_text_evidence_cannot_be_anchored_by_an_empty_quote(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            args = self._rigour_packet(root, self._claim(), exact="")
            errors = validate_packets(*args)
            self.assertTrue(any("empty `exact`" in error for error in errors), errors)

    def test_claim_without_a_statement_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            claim = self._claim()
            del claim["statement"]
            errors = validate_packets(*self._rigour_packet(root, claim, exact="anchor line one"))
            self.assertTrue(any("has no `statement`" in error for error in errors), errors)

    def test_universal_claim_requires_a_coverage_test(self) -> None:
        """The 2026-08-09 defect: a derived census recorded without a coverage check."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            claim = self._claim(
                statement="each dispatch block ends in at most one jal")
            errors = validate_packets(*self._rigour_packet(root, claim, exact="anchor line one"))
            self.assertTrue(any("has no `coverage`" in error for error in errors), errors)

            claim = self._claim(
                statement="each dispatch block ends in at most one jal",
                coverage="every jal in the range was matched against the walk's attributions")
            errors = validate_packets(*self._rigour_packet(root, claim, exact="anchor line one"))
            self.assertEqual(errors, [])

    def test_universal_claim_must_name_the_command_that_tested_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            claim = self._claim(
                statement="no other call exists in the region",
                coverage="checked the whole range")
            errors = validate_packets(
                *self._rigour_packet(root, claim, exact="anchor line one", commands=[]))
            self.assertTrue(any("records no commands" in error for error in errors), errors)

    def test_partially_verified_needs_more_than_browser_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            epoch, packets, ledger, catalog = self._rigour_packet(
                root, self._claim(), exact="anchor line one")
            packets[0]["proposed_evidence"][0]["authority"] = 6
            errors = validate_packets(epoch, packets, ledger, catalog)
            self.assertTrue(any("navigation aids" in error for error in errors), errors)
            packets[0]["proposed_claims"][0]["status"] = "candidate"
            self.assertEqual(validate_packets(epoch, packets, ledger, catalog), [])

    def test_integration_carries_limitations_onto_the_claim(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            epoch, packets, ledger, catalog = self._rigour_packet(
                root, self._claim(), exact="anchor line one")
            packets[0]["limitations"] = ["side register meaning not established"]
            recorded, _ = apply_packets(epoch, packets, ledger, catalog)
            claim = recorded["claims"][0]
            self.assertEqual(claim["limitations"], ["side register meaning not established"])
            self.assertEqual(claim["derivation"], ["c"])

    def test_stale_evidence_anchor_fails_handoff(self) -> None:
        """handoff-ok used to mean "ids line up", never "the evidence still says this"."""
        from tools.dw3_research.cli import evidence_anchor_errors

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "cited.s"
            source.write_text("original line\n")
            ledger = {"evidence": [{
                "id": "EV-1", "source": str(source), "exact": "original line",
                "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            }]}
            self.assertEqual(evidence_anchor_errors(ledger), [])
            source.write_text("original line\nadded later\n")
            self.assertTrue(any("stale" in e for e in evidence_anchor_errors(ledger)))
            source.write_text("the cited line is gone\n")
            self.assertTrue(any("BROKEN" in e for e in evidence_anchor_errors(ledger)))

    def test_miscited_evidence_is_flagged(self) -> None:
        """Replays the real 2026-08-09 miscitation: two evidence entries pointed one
        instruction off, claiming a mask value while quoting the zone line."""
        from tools.dw3_research.workflow import summary_literal_warnings

        wrong = {"id": "E-wrong", "source": "/x/cardgame.s",
                 "summary": "opcode 0x38 passes mask 0x81",
                 "exact": ".L0x000027d8: li $a3, 0x2    # .word 0x24070002"}
        right = dict(wrong, id="E-right",
                     exact=".L0x000027dc: li $v0, 0x81   # .word 0x24020081")
        self.assertTrue(summary_literal_warnings([{"proposed_evidence": [wrong]}]))
        self.assertEqual(summary_literal_warnings([{"proposed_evidence": [right]}]), [])

    def test_summary_context_addresses_do_not_warn(self) -> None:
        """A summary naming a function or an opcode is context, not a claim about the
        quoted line; warning on those made the check unusable at a 21% flag rate."""
        from tools.dw3_research.workflow import summary_literal_warnings

        for summary in ("F0x8008400C adds the displacement when the counter is positive",
                        "opcode 0xA9's update block opens with a conditional branch"):
            entry = {"id": "E", "source": "/x/cardgame.s", "summary": summary,
                     "exact": ".L0x0000137c: blez $v0, .L0x00001394"}
            with self.subTest(summary=summary):
                self.assertEqual(
                    summary_literal_warnings([{"proposed_evidence": [entry]}]), [])

    def test_known_separates_overlays_sharing_a_load_base(self) -> None:
        """pro/cardgame, pro/fightstg and pro/stdwtitl all cover 0x8008xxxx. The first
        draft matched on address alone and offered fightstg's claims as prior work on a
        cardgame function."""
        from tools.dw3_research.cli import overlay_token

        self.assertEqual(overlay_token("~/ddw3/asm/dw2003/pro/cardgame.s"), "cardgame")
        self.assertEqual(overlay_token("exe-decomp/cardgame_c/F0x8008ec44.c"), "cardgame")
        self.assertEqual(overlay_token("~/ddw3/asm/dw2003/pro/fightstg.s"), "fightstg")
        self.assertIsNone(overlay_token("docs/research/card/model.md"))

    def test_known_candidate_window_starts_at_the_target(self) -> None:
        """The decompiled corpus indexes only the functions it recovered, so most jal
        targets are not indexed starts. Anchoring the window at the ENCLOSING function
        counted claims about earlier code as decodes of the target."""
        from tools.dw3_research.cli import _known_candidates

        functions = {"exe-decomp/cardgame_c/a.c": [(0x8008BC6C, "F0x8008bc6c"),
                                                   (0x8008D000, "F0x8008d000")]}
        name, start, end, _, exact = _known_candidates(functions, 0x8008C044)[0]
        self.assertEqual(start, 0x8008C044)
        self.assertEqual(end, 0x8008D000)
        self.assertIn("enclosing", name)
        self.assertFalse(exact, "an inexact match must not report exact_start=yes")
        name, start, _, _, exact = _known_candidates(functions, 0x8008BC6C)[0]
        self.assertEqual(start, 0x8008BC6C)
        self.assertNotIn("enclosing", name)
        self.assertTrue(exact)

    def _extent_db(self, lines: list[tuple[int, str]]) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE evidence(source_path TEXT, locator TEXT, exact TEXT)")
        conn.executemany(
            "INSERT INTO evidence VALUES('/x/pro/demo.s', ?, ?)",
            [(f"L1 @0x{address:08x}", text) for address, text in lines])
        return conn

    def test_function_extents_accept_every_call_rendering(self) -> None:
        """cardgame prints `jal 0x8008f2ec`, fightstg prints `jal FIGHTSTG_F0x...`
        and `jal .L0x...`. Matching only the numeric form derived 45 functions from
        fightstg's 34k lines against cardgame's 247 -- the asymmetry was the bug."""
        from tools.build_function_extents import build

        conn = self._extent_db([
            (0x80080000, "jal 0x80080100"),
            (0x80080004, "jal FIGHTSTG_F0x80080200"),
            (0x80080008, "jal .L0x80080300"),
            (0x80080100, "addiu $sp, -0x20"), (0x80080104, "jr $ra"),
            (0x80080200, "addiu $sp, -0x20"), (0x80080204, "jr $ra"),
            (0x80080300, "addiu $sp, -0x20"), (0x80080304, "jr $ra"),
        ])
        functions = build(conn, "%demo.s")["/x/pro/demo.s"]["functions"]
        self.assertEqual([f["address"] for f in functions],
                         [0x80080100, 0x80080200, 0x80080300])
        self.assertTrue(all(f["has_return"] for f in functions))

    def test_function_extents_reject_branch_targets(self) -> None:
        """A jump-table target without a stack prologue is a branch inside a function.
        Admitting them would split F0x80084320 into 348 fake functions."""
        from tools.build_function_extents import build

        conn = self._extent_db([
            (0x80080000, ".L0x00000000: .word 0x80080100"),   # pointer, no prologue
            (0x80080004, ".L0x00000004: .word 0x80080200"),   # pointer, prologue
            (0x80080100, "li $v0, 0x2d"),                     # branch target
            (0x80080200, "addiu $sp, -0x20"), (0x80080204, "jr $ra"),
        ])
        addresses = [f["address"] for f in
                     build(conn, "%demo.s")["/x/pro/demo.s"]["functions"]]
        self.assertIn(0x80080200, addresses)
        self.assertNotIn(0x80080100, addresses)

    def test_function_extents_reject_non_ram_addresses(self) -> None:
        """A loose locator regex accepted 0x0009ab74 as an address and produced
        overlay ranges that derived zero functions."""
        from tools.build_function_extents import build

        conn = self._extent_db([(0x80080000, "jal 0x80080100"),
                                (0x80080100, "addiu $sp, -0x20"), (0x80080104, "jr $ra")])
        conn.execute("INSERT INTO evidence VALUES('/x/pro/demo.s','L9 @0x0009ab74','nop')")
        built = build(conn, "%demo.s")["/x/pro/demo.s"]
        self.assertGreaterEqual(built["range"][0], 0x80000000)

    def test_concurrent_record_findings_do_not_lose_updates(self) -> None:
        from unittest.mock import patch
        from tools.dw3_research import cli

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            systems = root / "docs/research/systems"
            ledger = root / "docs/research/evidence/ledger.json"
            systems.mkdir(parents=True)
            ledger.parent.mkdir(parents=True)
            catalog = systems / "catalog.json"
            catalog.write_text(json.dumps({
                "systems": [{
                    "system": "test-system",
                    "aliases": [],
                    "status": "unresearched",
                    "implementation_status": "unknown",
                    "summary": "test",
                    "canonical_docs": [],
                    "source_map": [],
                    "frontiers": [],
                }],
            }))
            ledger.write_text(json.dumps({
                "schema_version": 1,
                "evidence": [{"id": "EV-test"}],
                "claims": [],
            }))
            (systems / "test-system.manifest.json").write_text(json.dumps({
                "schema_version": 1,
                "system": "test-system",
                "status": "unresearched",
                "claims": [],
                "unresolved_questions": [],
            }))

            with (
                patch.object(cli, "ROOT", root),
                patch.object(cli, "LEDGER", ledger),
                patch.object(cli, "SYSTEMS_DIR", systems),
                patch.object(cli, "SYSTEM_CATALOG", catalog),
                patch.object(cli, "DEFAULT_DB", root / ".dw3-research/index.sqlite3"),
            ):
                context = multiprocessing.get_context("fork")
                processes = [
                    context.Process(target=_record_concurrent_claim, args=(claim_id,))
                    for claim_id in ("claim-a", "claim-b")
                ]
                for process in processes:
                    process.start()
                for process in processes:
                    process.join(10)
                    self.assertEqual(process.exitcode, 0)

            recorded = json.loads(ledger.read_text())
            self.assertEqual(
                {claim["id"] for claim in recorded["claims"]},
                {"claim-a", "claim-b"},
            )


if __name__ == "__main__":
    unittest.main()
