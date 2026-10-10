from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from tools.rosetta_audit import audit
from tools.rosetta_refresh_digests import main as refresh_main, refresh
from tools.test_rosetta import digest, validation_fixture, write_index_fixture
from tools.dw3_research.rosetta import validate_links, write_index


class RosettaAuditTests(unittest.TestCase):
    def test_live_audit_separates_inventory_and_survives_stale_index(self):
        with validation_fixture() as root:
            output, _ = write_index_fixture(root)
            output.write_text("not even valid JSON")
            result = audit(root, limit=1)
            self.assertEqual(result[0]["system_inventory_rows"], 1)
            self.assertEqual(result[0]["behavior_rows"], 2)
            self.assertEqual(result[0]["rows_without_original"], 2)
            self.assertEqual(len(result), 2)
            self.assertIn("not established", result[0]["feature_denominator"])
            self.assertEqual(audit(root, system="not-catalogued", limit=0)[0]["links"], 0)

    def test_evidence_leads_are_same_system_verified_and_do_not_promote(self):
        with validation_fixture(claims=[
            {"id": "EXISTING", "system": "battle", "status": "verified", "frontier_ids": ["B-Q"]},
            {"id": "OTHER-SYSTEM", "system": "shops", "status": "verified", "frontier_ids": ["B-Q"]},
            {"id": "UNREVIEWED", "system": "battle", "status": "candidate", "frontier_ids": ["B-Q"]},
            {"id": "GOOD", "status": "partially_verified"},
        ]) as root:
            write_index_fixture(root)
            path = root / "recovered/ddw3/rosetta-links.json"
            data = json.loads(path.read_text())
            row = data["links"][2]
            row["open_work"]["frontier_ids"] = ["B-Q"]
            path.write_text(json.dumps(data))
            catalog = root / "docs/research/systems/catalog.json"
            catalog.write_text(json.dumps({"systems": [{"system": "battle", "frontiers": [{"id": "B-Q", "status": "resolved"}]}]}))
            before = path.read_bytes()
            result = audit(root)
            self.assertEqual(result[0]["rows_with_verified_claim_leads"], 1)
            self.assertEqual(result[0]["rows_with_resolved_frontier_references"], 1)
            self.assertEqual(result[1]["claim_lead_sample"], ["EXISTING"])
            self.assertEqual(result[1]["mapping_review"], "candidate")
            self.assertEqual(path.read_bytes(), before)

    def test_refresh_invalidates_support_and_keeps_review_history(self):
        with validation_fixture() as root:
            _, index = write_index_fixture(root)
            data = {"schema_version": 1, "links": index["links"]}
            source = root / "original/source.s"
            for row in data["links"]:
                row["maintenance"]["source_digests"]["original/source.s"] = "0" * 64
            updated, changed, missing = refresh(data, root)
            self.assertFalse(missing)
            self.assertEqual(len(changed), 3)
            self.assertEqual(updated["links"][0]["mapping_review"], "stale")
            self.assertEqual(data["links"][0]["mapping_review"], "supported")
            self.assertEqual(updated["links"][1]["mapping_review"], "candidate")
            change = updated["links"][0]["maintenance"]["invalidations"][0]["source_changes"][0]
            self.assertEqual(change, {"source": "original/source.s", "before": "0" * 64, "after": digest(source)})
            again, changes, _ = refresh(updated, root)
            self.assertFalse(changes)
            self.assertEqual(again, updated)
            self.assertEqual(validate_links(updated, root), [])

    def test_refresh_does_not_rebind_original_evidence(self):
        with validation_fixture() as root:
            _, index = write_index_fixture(root)
            data = {"schema_version": 1, "links": index["links"]}
            before = data["links"][0]["original"][0]["source_sha256"]
            (root / "original/source.s").write_text("changed original\n")
            updated, _, _ = refresh(data, root)
            self.assertEqual(updated["links"][0]["original"][0]["source_sha256"], before)
            self.assertTrue(any("stale original source" in error for error in validate_links(updated, root)))

    def test_missing_source_aborts_refresh_without_partial_write(self):
        with validation_fixture() as root:
            write_index_fixture(root)
            path = root / "recovered/ddw3/rosetta-links.json"
            data = json.loads(path.read_text())
            data["links"][0]["maintenance"]["source_digests"] = {
                "original/source.s": "0" * 64, "missing.s": "0" * 64,
            }
            path.write_text(json.dumps(data))
            before = path.read_bytes()
            with patch("tools.rosetta_refresh_digests.ROOT", root), patch("tools.rosetta_refresh_digests.LINKS", path), patch("sys.argv", ["refresh"]), patch("builtins.print"):
                self.assertEqual(refresh_main(), 1)
            self.assertEqual(path.read_bytes(), before)

    def test_invalid_build_does_not_publish_new_population(self):
        with validation_fixture() as root:
            output, _ = write_index_fixture(root)
            outputs = [output, root / "recovered/ddw3/rosetta-source-census.json",
                       root / "recovered/ddw3/rosetta-dispositions.json", root / "docs/generated/rosetta-stone.md"]
            before = [path.read_bytes() for path in outputs]
            (root / "original/source.s").write_text("changed original\n")
            with self.assertRaisesRegex(ValueError, "stale original source"):
                write_index(root, root / "recovered/ddw3/rosetta-links.json", output)
            self.assertEqual([path.read_bytes() for path in outputs], before)


if __name__ == "__main__":
    unittest.main()
