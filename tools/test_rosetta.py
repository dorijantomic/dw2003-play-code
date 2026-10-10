from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from tools.dw3_research.rosetta import query_index, render_report, validate_generated_freshness, validate_links, write_index
from tools.rosetta_dispositions import build as build_dispositions, validate_population


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def census(rows: list[dict]) -> dict:
    return {
        "schema_version": 2,
        "generated_by": "fixture",
        "files": rows,
        "summary": {
            "files": len(rows),
            "production_reachable": sum(row["reachability"] == "production" for row in rows),
            "lab_only": sum(row["reachability"] == "lab_only" for row in rows),
            "test_only": sum(row["reachability"] == "test_only" for row in rows),
            "unresolved": sum(row["reachability"] == "unresolved" for row in rows),
            "unresolved_static_imports": 0,
            "unresolved_dynamic_imports": 0,
        },
    }


@contextmanager
def validation_fixture(claims: list[dict] | None = None) -> Iterator[Path]:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        files = {
            "docs/research/systems/catalog.json": json.dumps({"systems": [{
                "system": "battle",
                "implementation": {"modules": ["engine/formulas.ts"]},
            }]}),
            "docs/research/evidence/ledger.json": json.dumps({"claims": claims if claims is not None else [
                {"id": "GOOD", "status": "partially_verified"},
                {"id": "BAD", "status": "contradicted"},
            ]}),
            "docs/research/presentation/master-manifest.json": json.dumps({
                "status": "incomplete", "rows": [{"id": "PRESENTATION-ROW"}], "source_sets": [],
            }),
            "original/source.s": "fixture source\n",
            "tools/rosetta_source_census.mjs": Path("tools/rosetta_source_census.mjs").read_text(),
        }
        for relative, content in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        yield root


def supported_link(
    root: Path,
    *,
    link_id: str = "EDGE-MAGIC",
    behavior_id: str = "battle.damage.magical",
    relationship: str = "implements",
    original: bool = True,
    claims: list[str] | None = None,
) -> dict:
    source = root / "original/source.s"
    original_rows = [{
        "id": "pro/fightstg:F0x8009fab4",
        "binary_variant": "fixture",
        "module": "pro/fightstg",
        "address_space": "psx-ram",
        "entry": "0x8009fab4",
        "source": "original/source.s",
        "source_locator": "source.s:1",
        "source_sha256": digest(source),
    }] if original else []
    return {
        "id": link_id,
        "behavior_id": behavior_id,
        "system_ids": ["battle"],
        "presentation_row_ids": ["PRESENTATION-ROW"],
        "player_surface": "fixture behavior",
        "relationship_kind": relationship,
        "mapping_review": "supported",
        "reachability": {"status": "production", "proof": ["fixture"]},
        "original": original_rows,
        "knowledge": {"canonical_docs": [], "claim_ids": claims or [], "relationship_scope": "fixture"},
        "engine": [{"file": "engine/formulas.ts", "symbol": "magicalBase"}],
        "web": [{"file": "web/battle.js", "symbol": "magicalHit"}],
        "data": [],
        "translation": {},
        "proof": {
            "mapping_justification": ["fixture justification"],
            "original_evidence": ["fixture evidence"] if original else [],
            "implementation_tests": ["tests/fixture.test.ts"],
        },
        "open_work": {"gaps": []},
        "maintenance": {"source_digests": {}},
    }


def candidate_link(root: Path, link_id: str, behavior_id: str, gap_kind: str = "implementation") -> dict:
    row = supported_link(root, link_id=link_id, behavior_id=behavior_id, original=False)
    row["mapping_review"] = "candidate"
    row["proof"] = {"implementation_tests": ["tests/fixture.test.ts"]}
    row["open_work"] = {"gaps": [{"kind": gap_kind, "evidence_needed": "fixture gap"}]}
    return row


def census_rows() -> list[dict]:
    return [
        {"path": "engine/formulas.ts", "kind": "ts", "reachability": "production", "functions": ["magicalBase"], "registrations": [], "data_paths": []},
        {"path": "web/battle.js", "kind": "js", "reachability": "production", "functions": ["magicalHit"], "registrations": [], "data_paths": ["assets/data/example.json"]},
        {"path": "web/lab.js", "kind": "js", "reachability": "lab_only", "functions": ["openLab"], "registrations": [], "data_paths": []},
    ]


def write_index_fixture(root: Path) -> tuple[Path, dict]:
    links = {"schema_version": 1, "links": [
        supported_link(root, claims=["GOOD"]),
        candidate_link(root, "EDGE-PHYSICAL", "battle.damage.physical"),
        candidate_link(root, "EDGE-INTEGRATED", "system.battle.integrated"),
    ]}
    links_path = root / "recovered/ddw3/rosetta-links.json"
    links_path.parent.mkdir(parents=True, exist_ok=True)
    links_path.write_text(json.dumps(links))
    output = root / "recovered/ddw3/rosetta-index.json"
    data = write_index(root, links_path, output, census(census_rows()))
    return output, data


def write_query_fixture(root: Path) -> Path:
    source_files = {
        "links": ("recovered/ddw3/rosetta-links.json", "{}"),
        "ledger": ("docs/research/evidence/ledger.json", "{}"),
        "catalog": ("docs/research/systems/catalog.json", "{}"),
        "source_census": ("recovered/ddw3/rosetta-source-census.json", "{}"),
        "source_census_script": ("tools/rosetta_source_census.mjs", "// fixture"),
        "dispositions": ("recovered/ddw3/rosetta-dispositions.json", "{}"),
    }
    for relative, content in source_files.values():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    rows = [
        {"id": "EDGE-MAGIC", "behavior_id": "battle.damage.magical", "original": [{"id": "pro/fightstg:F0x8009fab4", "module": "pro/fightstg", "entry": "0x8009fab4"}], "engine": [{"file": "engine/formulas.ts", "symbol": "magicalBase"}], "web": [{"file": "web/battle.js", "symbol": "magicalHit"}]},
        {"id": "EDGE-OTHER", "behavior_id": "battle.damage.other", "original": [{"id": "other/module:F0x8009fab4", "module": "other/module", "entry": "0x8009fab4"}], "engine": [{"file": "engine/other.ts", "symbol": "other"}], "web": [{"file": "web/other.js", "symbol": "other"}]},
        {"id": "EDGE-REUSED-A", "behavior_id": "battle.damage.reused-a", "original": [{"id": "pro/reused:F0x8009fab5", "module": "pro/reused", "entry": "0x8009fab5"}], "engine": [], "web": []},
        {"id": "EDGE-REUSED-B", "behavior_id": "battle.damage.reused-b", "original": [{"id": "pro/reused:F0x8009fab5", "module": "pro/reused", "entry": "0x8009fab5"}], "engine": [], "web": []},
        {"id": "EDGE-UNIQUE", "behavior_id": "battle.damage.unique", "original": [{"id": "unique/module:F0x8009fab6", "module": "unique/module", "entry": "0x8009fab6"}], "engine": [], "web": []},
    ]
    index = {"source_digests": {key: digest(root / relative) for key, (relative, _) in source_files.items()}, "links": rows}
    index_path = root / "index.json"
    index_path.write_text(json.dumps(index))
    return index_path


class RosettaTests(unittest.TestCase):
    def test_repository_pilot_is_valid(self) -> None:
        data = json.loads(Path("recovered/ddw3/rosetta-links.json").read_text())
        self.assertEqual(validate_links(data, Path.cwd()), [])

    def test_supported_requires_original_evidence_without_promoting_claims(self) -> None:
        with validation_fixture() as root:
            self.assertEqual(validate_links({"schema_version": 1, "links": [supported_link(root, claims=["GOOD"])]}, root), [])
            errors = validate_links({"schema_version": 1, "links": [supported_link(root, original=False, claims=["GOOD"])]}, root)
            self.assertTrue(any("requires original participants" in error for error in errors))
            errors = validate_links({"schema_version": 1, "links": [supported_link(root, claims=["BAD"])]}, root)
            self.assertTrue(any("contradicted claim" in error for error in errors))

    def test_host_support_may_be_original_free(self) -> None:
        with validation_fixture() as root:
            link = supported_link(root, relationship="host_support", original=False)
            self.assertEqual(validate_links({"schema_version": 1, "links": [link]}, root), [])

    def test_claim_ids_reject_bad_types_and_empty_ledger_unknowns(self) -> None:
        with validation_fixture(claims=[]) as root:
            malformed = supported_link(root)
            malformed["knowledge"]["claim_ids"] = {"GOOD": True}
            errors = validate_links({"schema_version": 1, "links": [malformed]}, root)
            self.assertTrue(any("expected a string list" in error for error in errors))
            errors = validate_links({"schema_version": 1, "links": [supported_link(root, claims=["MISSING"])]}, root)
            self.assertTrue(any("unknown ledger claim MISSING" in error for error in errors))

    def test_original_id_module_source_and_digest_are_checked(self) -> None:
        with validation_fixture() as root:
            link = supported_link(root); link["original"][0]["id"] = "other/module:F0x8009fab4"
            self.assertTrue(any("does not match module" in error for error in validate_links({"schema_version": 1, "links": [link]}, root)))
            link = supported_link(root); link["original"][0]["id"] = ":F0x8009fab4"; link["original"][0]["module"] = ""
            self.assertTrue(any("module-qualified" in error for error in validate_links({"schema_version": 1, "links": [link]}, root)))
            link = supported_link(root); link["original"][0]["source"] = "original/missing.s"
            self.assertTrue(any("original source missing" in error for error in validate_links({"schema_version": 1, "links": [link]}, root)))
            link = supported_link(root); link["original"][0]["source_sha256"] = "0" * 64
            self.assertTrue(any("stale original source digest" in error for error in validate_links({"schema_version": 1, "links": [link]}, root)))

    def test_duplicate_ids_are_rejected(self) -> None:
        with validation_fixture() as root:
            row = supported_link(root, claims=["GOOD"])
            self.assertTrue(any("duplicate EDGE-MAGIC" in error for error in validate_links({"schema_version": 1, "links": [row, row]}, root)))

    def test_index_resolves_claim_and_system_status(self) -> None:
        with validation_fixture() as root:
            _, index = write_index_fixture(root)
            row = next(row for row in index["links"] if row["id"] == "EDGE-MAGIC")
            self.assertEqual(row["system_statuses"]["battle"], "missing")
            self.assertEqual(row["claim_statuses"], {"GOOD": "partially_verified"})
            self.assertGreater(index["source_census"]["summary"]["production_reachable"], 0)

    def test_changed_digest_is_rejected(self) -> None:
        with validation_fixture() as root:
            link = supported_link(root); link["maintenance"]["source_digests"] = {"original/source.s": "0" * 64}
            self.assertTrue(any("stale source digest" in error for error in validate_links({"schema_version": 1, "links": [link]}, root)))

    def test_check_rejects_stale_generated_index_and_report(self) -> None:
        with validation_fixture() as root:
            write_index_fixture(root)
            self.assertEqual(validate_generated_freshness(root), [])
            links_path = root / "recovered/ddw3/rosetta-links.json"
            links_path.write_text(links_path.read_text() + " ")
            stale = validate_generated_freshness(root)
            self.assertTrue(any("stale generated rosetta index/report: links" in error for error in stale))
            write_index_fixture(root)
            self.assertEqual(validate_generated_freshness(root), [])
            (root / "docs/generated/rosetta-stone.md").write_text("stale report\n")
            self.assertEqual(validate_generated_freshness(root), ["stale generated rosetta report"])
        with tempfile.TemporaryDirectory() as directory:
            missing = validate_generated_freshness(Path(directory))
            self.assertTrue(any("missing generated rosetta index" in error for error in missing))

    def test_check_rejects_stale_stored_source_census(self) -> None:
        # Node-free: the sketch is pure-python hashing, so this fixture adds
        # no subprocess cost. All writes stay under the temp fixture root.
        with validation_fixture() as root:
            output, _ = write_index_fixture(root)
            self.assertIn("source_tree", json.loads(output.read_text())["source_digests"])
            self.assertEqual(validate_generated_freshness(root), [])
            engine = root / "engine"; engine.mkdir()
            (engine / "formulas.ts").write_text("export const magicalBase = 1;\n")
            stale = validate_generated_freshness(root)
            self.assertTrue(any("stale stored source census" in error for error in stale))
            (engine / "formulas.ts").write_text("export const magicalBase = 2;\n")
            self.assertTrue(any("stale stored source census" in error for error in validate_generated_freshness(root)))
            write_index_fixture(root)
            self.assertEqual(validate_generated_freshness(root), [])
        with validation_fixture() as root:
            # Indexes recorded before the sketch still validate/render.
            output, _ = write_index_fixture(root)
            index = json.loads(output.read_text())
            del index["source_digests"]["source_tree"]
            output.write_text(json.dumps(index))
            self.assertEqual(validate_generated_freshness(root), [])

    def test_query_refuses_source_tree_drift(self) -> None:
        # Node-free and fixture-isolated like the check-path sketch test. The
        # gate sits before query dispatch, so it covers every mode; bundle and
        # summary are both asserted. All writes stay under the temp root.
        with validation_fixture() as root:
            index_path, _ = write_index_fixture(root)
            rows = query_index("bundle", "system.battle.integrated", index_path=index_path, root=root)
            self.assertEqual([row["id"] for row in rows], ["EDGE-INTEGRATED"])
            self.assertIn("links", query_index("summary", index_path=index_path, root=root)[0])
            engine = root / "engine"; engine.mkdir()
            (engine / "formulas.ts").write_text("export const magicalBase = 1;\n")
            for mode, value in (("bundle", "system.battle.integrated"), ("summary", None)):
                with self.assertRaises(ValueError) as raised:
                    query_index(mode, value, index_path=index_path, root=root)
                self.assertIn("stale stored source census", str(raised.exception))
            write_index_fixture(root)
            rows = query_index("bundle", "system.battle.integrated", index_path=index_path, root=root)
            self.assertEqual([row["id"] for row in rows], ["EDGE-INTEGRATED"])
        with validation_fixture() as root:
            # Indexes recorded before the sketch still query (backward compat).
            index_path, _ = write_index_fixture(root)
            index = json.loads(index_path.read_text())
            del index["source_digests"]["source_tree"]
            index_path.write_text(json.dumps(index))
            engine = root / "engine"; engine.mkdir()
            (engine / "formulas.ts").write_text("export const magicalBase = 1;\n")
            rows = query_index("bundle", "system.battle.integrated", index_path=index_path, root=root)
            self.assertEqual([row["id"] for row in rows], ["EDGE-INTEGRATED"])

    def test_gap_query_filters_system_and_kind(self) -> None:
        with validation_fixture() as root:
            index_path, _ = write_index_fixture(root)
            rows = query_index("gaps", "battle::implementation", index_path=index_path, root=root)
            self.assertEqual({row["behavior_id"] for row in rows}, {"battle.damage.physical", "system.battle.integrated"})
            self.assertTrue(all([gap["kind"] for gap in row["open_work"]["gaps"]] == ["implementation"] for row in rows))

    def test_bare_address_groups_by_original_identity_and_bounds_ambiguity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); index_path = write_query_fixture(root)
            reused = query_index("original", "0x8009fab5", index_path=index_path, root=root)
            self.assertEqual({row["id"] for row in reused}, {"EDGE-REUSED-A", "EDGE-REUSED-B"})
            self.assertTrue(all(row["query_diagnostic"]["kind"] == "bare_address" for row in reused))
            diagnostic = query_index("original", "0x8009fab4", limit=1, index_path=index_path, root=root)[0]["query_diagnostic"]
            self.assertEqual(diagnostic["kind"], "ambiguous_bare_address")
            self.assertEqual(len(diagnostic["matches"]), 1)
            self.assertEqual(diagnostic["matches"][0]["original_id"], "pro/fightstg:F0x8009fab4")

    def test_exact_engine_web_queries_and_bad_syntax_are_useful(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); index_path = write_query_fixture(root)
            original = query_index("original", "pro/fightstg:F0x8009fab4", index_path=index_path, root=root)
            engine = query_index("engine", "engine/formulas.ts:magicalBase", index_path=index_path, root=root)
            web = query_index("web", "web/battle.js:magicalHit", index_path=index_path, root=root)
            self.assertEqual({row["id"] for row in original}, {"EDGE-MAGIC"})
            self.assertEqual({row["id"] for row in engine}, {"EDGE-MAGIC"})
            self.assertEqual({row["id"] for row in web}, {"EDGE-MAGIC"})
            for mode, value in (("engine", "engine/formulas.ts"), ("web", "web/battle.js:")):
                diagnostic = query_index(mode, value, index_path=index_path, root=root)[0]["query_diagnostic"]
                self.assertEqual(diagnostic["kind"], "invalid_participant_query")
                self.assertIn("path:symbol", diagnostic["message"])

    def test_symbol_query_remains_broad_discovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); index_path = write_query_fixture(root)
            rows = query_index("symbol", "magicalBase", index_path=index_path, root=root)
            self.assertEqual({row["id"] for row in rows}, {"EDGE-MAGIC"})

    def test_census_tracks_reexports_test_only_and_orphans(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); web = root / "web"; web.mkdir()
            (web / "index.html").write_text('<script type="module" src="main.js"></script>')
            (web / "lab.html").write_text('<script type="module" src="lab.js"></script>')
            (web / "main.js").write_text('import { dep as alias } from "./dep.js"; export { dep } from "./dep.js"; import "./wrapper.js"; import(choice); const data = "assets/data/example.json";')
            (web / "dep.js").write_text("export const dep = 1;")
            (web / "wrapper.js").write_text("export function wrapper() { return dep(); }")
            (web / "lab.js").write_text("export const lab = 1;")
            (web / "unit.test.js").write_text("export const testOnly = 1;")
            (web / "orphan.js").write_text("export const orphan = 1;")
            result = subprocess.run(["node", str(Path("tools/rosetta_source_census.mjs").resolve()), "--root", str(root)], text=True, capture_output=True, check=True)
            discovered = json.loads(result.stdout); rows = {row["path"]: row for row in discovered["files"]}
            self.assertEqual(rows["web/main.js"]["reachability"], "production")
            self.assertEqual(rows["web/dep.js"]["reachability"], "production")
            self.assertEqual(rows["web/lab.js"]["reachability"], "lab_only")
            self.assertEqual(rows["web/unit.test.js"]["reachability"], "test_only")
            self.assertEqual(rows["web/orphan.js"]["reachability"], "unresolved")
            self.assertEqual(discovered["summary"]["unresolved_dynamic_imports"], 1)
            self.assertEqual(rows["web/main.js"]["reexports"][0]["names"], ["dep"])
            static_dep = next(item for item in rows["web/main.js"]["imports"] if item["kind"] == "static")
            self.assertEqual(static_dep["names"], ["dep"])
            self.assertIn("assets/data/example.json", rows["web/main.js"]["data_paths"])

    def test_census_rejects_extension_and_directory_fragments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); web = root / "web"; web.mkdir()
            (web / "index.html").write_text('<script type="module" src="main.js"></script>')
            (web / "main.js").write_text(
                'const mapId = "demo";\n'
                'const download = mapId + ".json";\n'
                'const prefix = "web/assets/data/";\n'
                'const bareToml = ".toml";\n'
                'const real = "assets/data/real.json";\n'
                'const realToml = "config/settings.toml";\n'
                'const sprite = "assets/sprites/hero.png";\n'
            )
            script = Path(__file__).resolve().parent / "rosetta_source_census.mjs"
            result = subprocess.run(["node", str(script), "--root", str(root)], text=True, capture_output=True, check=True)
            discovered = json.loads(result.stdout); rows = {row["path"]: row for row in discovered["files"]}
            data_paths = rows["web/main.js"]["data_paths"]
            for fragment in (".json", ".toml", "web/assets/data/"):
                self.assertNotIn(fragment, data_paths)
            for real in ("assets/data/real.json", "config/settings.toml", "assets/sprites/hero.png"):
                self.assertIn(real, data_paths)

    def test_disposition_population_rejects_omitted_census_member(self) -> None:
        with validation_fixture() as root:
            write_index_fixture(root)
            data = build_dispositions(root); data["modules"] = data["modules"][1:]
            self.assertTrue(any("missing census module disposition" in error for error in validate_population(census(census_rows()), data)))

    def test_production_symbol_numerators_exclude_nonproduction(self) -> None:
        with validation_fixture() as root:
            _, index = write_index_fixture(root)
            summary = index["dispositions"]["summary"]
            # Fixture: 2 production modules (1 symbol each) + 1 lab_only module (1 symbol).
            self.assertEqual(summary["behavior_symbols"], 3)
            self.assertEqual(summary["production_behavior_symbols"], 2)
            self.assertEqual(summary["symbols_excluded"], 1)
            self.assertEqual(
                summary["production_behavior_symbols"] + summary["symbols_excluded"],
                summary["behavior_symbols"],
            )
            self.assertEqual(
                summary["production_symbols_attributed"] + summary["production_symbols_unresolved"],
                summary["production_behavior_symbols"],
            )
            report = render_report(index)
            self.assertIn(
                f"behavior symbols=3 (production={summary['production_behavior_symbols']}; "
                f"excluded={summary['symbols_excluded']})",
                report,
            )

    def test_candidate_test_proof_does_not_promote_mapping(self) -> None:
        with validation_fixture() as root:
            index_path, _ = write_index_fixture(root)
            row = query_index("bundle", "system.battle.integrated", index_path=index_path, root=root)[0]
            self.assertTrue(row["proof"]["implementation_tests"])
            self.assertEqual(row["mapping_review"], "candidate")
            self.assertEqual(row["knowledge"]["claim_ids"], [])

    def test_implementation_case_misattribution_is_rejected(self) -> None:
        with validation_fixture() as root:
            helper = root / "tests/helper.test.ts"
            helper.parent.mkdir(parents=True, exist_ok=True)
            helper.write_text("passing helper\n")
            helper_digest = digest(helper)

            def case_for(behavior_id: str, **overrides: object) -> dict:
                record: dict = {
                    "test_path": "tests/helper.test.ts",
                    "behavior_id": behavior_id,
                    "case": "helper passes",
                    "command": "node --test tests/helper.test.ts",
                    "exit_code": 0,
                    "test_sha256": helper_digest,
                }
                record.update(overrides)
                return record

            def link_with_tests(link_id: str, behavior_id: str, tests: list) -> dict:
                row = candidate_link(root, link_id, behavior_id)
                row["proof"]["implementation_tests"] = tests
                return row

            valid = link_with_tests("EDGE-HELPER", "battle.damage.helper", [case_for("battle.damage.helper")])
            self.assertEqual(validate_links({"schema_version": 1, "links": [valid]}, root), [])
            self.assertEqual(valid["mapping_review"], "candidate")
            self.assertEqual(valid["knowledge"]["claim_ids"], [])

            misattributed = link_with_tests("EDGE-HELPER", "battle.damage.helper", [case_for("battle.damage.physical")])
            self.assertTrue(any(
                "misattributed" in error
                for error in validate_links({"schema_version": 1, "links": [misattributed]}, root)
            ))

            missing = link_with_tests("EDGE-HELPER", "battle.damage.helper", [case_for("battle.damage.helper", test_path="tests/gone.test.ts")])
            self.assertTrue(any(
                "test missing" in error
                for error in validate_links({"schema_version": 1, "links": [missing]}, root)
            ))

            stale = link_with_tests("EDGE-HELPER", "battle.damage.helper", [case_for("battle.damage.helper", test_sha256="0" * 64)])
            self.assertTrue(any(
                "stale implementation case digest" in error
                for error in validate_links({"schema_version": 1, "links": [stale]}, root)
            ))

            legacy = candidate_link(root, "EDGE-LEGACY", "battle.damage.legacy")
            self.assertEqual(validate_links({"schema_version": 1, "links": [legacy]}, root), [])

    def test_supported_rejects_empty_decompilation_and_unresolved_target(self) -> None:
        with validation_fixture() as root:
            def marked(**markers: object) -> dict:
                row = supported_link(root, claims=["GOOD"])
                row["original"][0].update(markers)
                return row

            resolved = marked(decompilation_status="resolved", target_status="resolved")
            self.assertEqual(validate_links({"schema_version": 1, "links": [resolved]}, root), [])

            empty = marked(decompilation_status="empty")
            self.assertTrue(any(
                "empty decompilation" in error
                for error in validate_links({"schema_version": 1, "links": [empty]}, root)
            ))

            unresolved = marked(target_status="unresolved")
            self.assertTrue(any(
                "unresolved target" in error
                for error in validate_links({"schema_version": 1, "links": [unresolved]}, root)
            ))

            legacy = supported_link(root, claims=["GOOD"])
            self.assertEqual(validate_links({"schema_version": 1, "links": [legacy]}, root), [])

            candidate = candidate_link(root, "EDGE-WORK", "battle.damage.work")
            candidate["original"] = supported_link(root)["original"]
            candidate["original"][0]["decompilation_status"] = "empty"
            candidate["original"][0]["target_status"] = "unresolved"
            self.assertEqual(validate_links({"schema_version": 1, "links": [candidate]}, root), [])

            bad_decompilation = marked(decompilation_status="EMPTY")
            self.assertTrue(any(
                "decompilation_status" in error
                for error in validate_links({"schema_version": 1, "links": [bad_decompilation]}, root)
            ))
            bad_target = marked(target_status="pending")
            self.assertTrue(any(
                "target_status" in error
                for error in validate_links({"schema_version": 1, "links": [bad_target]}, root)
            ))

    def test_regeneration_is_deterministic(self) -> None:
        with validation_fixture() as root:
            output, _ = write_index_fixture(root)
            links_path = root / "recovered/ddw3/rosetta-links.json"; fixture_census = census(census_rows())
            first = write_index(root, links_path, output, fixture_census)
            first_index = output.read_bytes(); first_report = (root / "docs/generated/rosetta-stone.md").read_bytes()
            second = write_index(root, links_path, output, fixture_census)
            self.assertEqual(first, second)
            self.assertEqual(first_index, output.read_bytes())
            self.assertEqual(first_report, (root / "docs/generated/rosetta-stone.md").read_bytes())


if __name__ == "__main__":
    unittest.main()
