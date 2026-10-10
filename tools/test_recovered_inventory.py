from __future__ import annotations

import tempfile
import json
import subprocess
import sys
import unittest
from pathlib import Path

from tools.build_recovered_inventory import build_inventory, canonical_id, jalr_call_target
from tools.query_recovered_inventory import (
    command_callers,
    command_factory_families,
    command_global_pointers,
    command_overlay_service_tables,
    command_promoted_targets,
    command_slot_families,
    command_translation_coverage,
    is_trivial_empty_body,
    is_trivial_forwarder,
    normalize_decompiled_c,
)


class RecoveredInventoryTests(unittest.TestCase):
    def test_translation_join_keeps_overlay_identity_and_unjoined_entries(self):
        inventory = {"modules": [
            {"id": "pro/a", "functions": [{"address": "0x80083000"}, {"address": "0x80083010"}]},
            {"id": "pro/b", "functions": [{"address": "0x80083000"}]},
        ]}
        registry = [
            {"module": "pro/a", "address": "0x80083000"},
            {"module": "pro/a", "address": "0x80083008"},
            {"module": "pro/c", "address": "0x80083000"},
        ]
        result = command_translation_coverage(inventory, registry)
        self.assertEqual(result["exact_joins"], 1)
        self.assertEqual(result["inventory_without_registry_join"], 2)
        self.assertEqual(result["registry_without_inventory_join"], 2)
        self.assertEqual(result["modules"][1]["exact_joins"], 0)
        self.assertEqual(result["unjoined_registry"], registry[1:])

    def test_trivial_shapes_are_quarantined_from_homolog_families(self) -> None:
        """Two body shapes match each other for reasons that carry no meaning.

        An empty body is either a real stub or a false boundary on a shared
        epilogue label. A one-tail-call body forwards to a DIFFERENT target in
        every instance, and m2c drops the arguments passed through in registers
        -- createUnregisteredObject renders exactly like this despite taking
        three. Grouping either as a homolog family invents a shared
        implementation that does not exist.
        """
        empty = normalize_decompiled_c("void F0x80081234(void) { }\n")
        self.assertTrue(is_trivial_empty_body(empty))
        self.assertFalse(is_trivial_forwarder(empty))

        # Real shape of exe-decomp/c/F0x80014504.c, extern prototype included:
        # the matcher must look past the prototypes m2c emits ahead of the body.
        forwarder = normalize_decompiled_c(
            "? F0x800143dc(?);                                    /* extern */\n"
            "\n"
            "void F0x80014504(void) {\n"
            "    F0x800143dc(0);\n"
            "}\n"
        )
        self.assertTrue(is_trivial_forwarder(forwarder))
        self.assertFalse(is_trivial_empty_body(forwarder))

        returning = normalize_decompiled_c("s32 F0x80081234(s32 a) { return F0x80085678(a); }\n")
        self.assertTrue(is_trivial_forwarder(returning))

        # A body with any real work is a genuine family candidate and must pass.
        substantive = normalize_decompiled_c(
            "void F0x80081234(void *o) { o->unk0 = 1; F0x80085678(o); }\n"
        )
        self.assertFalse(is_trivial_forwarder(substantive))
        self.assertFalse(is_trivial_empty_body(substantive))

    def test_homolog_normalization_changes_only_function_labels(self) -> None:
        first = "void F0x80081234(void) { F0x80085678(0x12); }\n"
        second = "void F0x8008abcd(void) { F0x8008cdef(0x12); }\n"
        different = "void F0x8008abcd(void) { F0x8008cdef(0x13); }\n"
        self.assertEqual(normalize_decompiled_c(first), normalize_decompiled_c(second))
        self.assertNotEqual(normalize_decompiled_c(first), normalize_decompiled_c(different))

    def test_overlay_adapter_recovers_literal_jump_table_relocation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "stgtest.s"
            output = root / "stgtest.fns.s"
            inventory = root / "inventory.json"
            source.write_text(
                ".L0x00000000: .word 0x800837d0\n"
                "# Start of code\n"
                ".L0x00000b00: lui $v0, 0x8008\n"
                ".L0x00000b04: addiu $v0, 0x2cb0\n"
                ".L0x00000b08: jr $v0\n"
                ".L0x00000b0c: nop\n"
                ".L0x00000b20: jr $ra\n"
                ".L0x00000b24: nop\n"
            )
            inventory.write_text(json.dumps({
                "modules": [{
                    "id": "pro/stgtest",
                    "functions": [{"address": "0x800837b0"}],
                }],
            }))
            subprocess.run([
                sys.executable,
                str(Path(__file__).parent / "exe_decomp/overlay_to_fns.py"),
                str(source), str(output), "--inventory", str(inventory),
                "--module", "pro/stgtest",
            ], check=True, capture_output=True, text=True)
            adapted = output.read_text()
            self.assertIn("D0x80082cb0:", adapted)
            self.assertIn("lui $v0, %hi(D0x80082cb0)", adapted)
            self.assertIn("addiu $v0, %lo(D0x80082cb0)", adapted)

    def test_jalr_distinguishes_calls_from_non_linking_indirect_jumps(self) -> None:
        self.assertEqual(jalr_call_target("jalr $v0"), "v0")
        self.assertEqual(jalr_call_target("jalr $ra, $v0"), "v0")
        self.assertIsNone(jalr_call_target(".word 0x03a00009 # jalr $zr, $sp"))

    def test_resident_labels_own_calls_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                ".global F0x80010000\n"
                "F0x80010000:\n"
                ".L0x80010000: jal 0x80010020 # .word 0x0c004008\n"
                ".L0x80010004: nop # .word 0x00000000\n"
                ".global F0x80010020\n"
                "F0x80010020:\n"
                ".L0x80010020: jr $ra # .word 0x03e00008\n"
                ".L0x80010024: nop # .word 0x00000000\n"
            )
            inventory = build_inventory(root)
            module = inventory["modules"][0]
            self.assertEqual(module["function_count"], 2)
            call = module["functions"][0]["direct_calls"][0]
            self.assertEqual(call["target_id"], "exe/fns:F0x80010020")
            self.assertEqual(call["caller_attribution"], "exact_labeled_boundary")

    def test_overlay_separates_call_targets_from_pointer_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n.L0x80010000: jr $ra # .word 0x03e00008\n"
            )
            (root / "pro/wstag001.s").write_text(
                ".L0x00000000: .word 0x800a5e00\n"
                "# Start of code\n"
                ".L0x00000010: jal 0x800a5e10 # .word 0x0c029784\n"
                ".L0x00000014: jal 0x80010000 # .word 0x0c004000\n"
                ".L0x00000018: jr $ra # .word 0x03e00008\n"
                ".L0x0000001c: nop # .word 0x00000000\n"
                ".L0x00000020: jr $ra # .word 0x03e00008\n"
                ".L0x00000024: nop # .word 0x00000000\n"
                ".L0x00000030: jr $ra # .word 0x03e00008\n"
                ".L0x00000034: nop # .word 0x00000000\n"
            )
            inventory = build_inventory(root)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/wstag001")
            ids = {item["id"] for item in overlay["functions"]}
            self.assertIn(canonical_id("pro/wstag001", 0x800A5DF0), ids)
            self.assertIn(canonical_id("pro/wstag001", 0x800A5E10), ids)
            self.assertEqual(overlay["pointer_candidates"][0]["address"], "0x800a5e00")
            calls = overlay["functions"][0]["direct_calls"]
            self.assertEqual(calls[1]["resolution"], "resident")

    def test_block_gate_and_curated_blocks_mark_non_functions(self) -> None:
        """A refused label and a curated case body stay addressable, not functions.

        The extents gate refuses a `.section`+label with no call, frame or
        return; a jump-table case body passes that gate but is still not a
        function. Both are carried as `role: block` so the census stops reading
        them as unread functions.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n.L0x80010000: jr $ra\n"
                "F0x80010004:\n.L0x80010004: nop\n"
            )
            extents = root / "extents.json"
            extents.write_text(json.dumps({"sources": {
                "/home/dorij/ddw3/asm/dw2003/exe/fns.s": {"rejected": [
                    {"address": 0x80010004,
                     "reason": "declared_section_without_call_return_or_frame"}]},
            }}))
            semantics = root / "semantics.json"
            semantics.write_text(json.dumps({
                "schema_version": 1, "functions": {},
                "blocks": {"exe/fns:F0x80010000": {"reason": "case body"}},
            }))
            inventory = build_inventory(
                root, semantics_path=semantics, function_extents_path=extents,
            )
            by_address = {
                item["address"]: item
                for item in inventory["modules"][0]["functions"]
            }
            self.assertEqual(by_address["0x80010000"]["role"], "block")
            self.assertEqual(
                by_address["0x80010000"]["block"]["source"], "curated_semantics")
            self.assertEqual(by_address["0x80010004"]["role"], "block")
            self.assertEqual(
                by_address["0x80010004"]["block"]["source"], "function_extents_gate")
            self.assertEqual(inventory["summary"]["block_functions"], 2)
            self.assertEqual(inventory["summary"]["extent_block_functions"], 1)

    def test_decompiled_file_promotes_overlay_entry_without_claiming_semantics(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decomp = root / "decomp"
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (decomp / "stagslct_c").mkdir(parents=True)
            (root / "exe/fns.s").write_text("")
            (root / "pro/stagslct.s").write_text(
                ".L0x00000020: .word 0x03e00008 # jr $ra\n"
            )
            (decomp / "stagslct_c/F0x80082cd0.c").write_text("void F0x80082cd0(void) {}\n")
            inventory = build_inventory(root, decomp)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/stagslct")
            function = overlay["functions"][0]
            self.assertEqual(function["address"], "0x80082cd0")
            self.assertEqual(function["recovery"]["lift"], "decompiled_c_present")
            self.assertEqual(function["recovery"]["semantics"], "unknown")

    def test_decompiled_data_label_without_control_transfer_is_rejected(self) -> None:
        """A pointer table names data, not a function.

        The wstag overlays' record tables point into the tail of the decoded
        span; the upstream splatter decoded the record's first words as
        instructions when a pointer named them, and m2c then lifted a data
        word. The C file carries `missing "jr $ra"` -- the entry has no
        control transfer and is removed, while the real function at the code
        entry stays.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decomp = root / "decomp"
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (decomp / "wstag_test_c").mkdir(parents=True)
            (root / "exe/fns.s").write_text("")
            (root / "pro/wstag_test.s").write_text(
                "# Start of code\n"
                ".L0x00000004: jr $ra # .word 0x03e00008\n"
                ".L0x00000008: nop # .word 0x00000000\n"
                ".L0x0000000c: sll $zr, $at, 0x18 # .word 0x00010600\n"
                ".L0x00000010: .word 0x0101006a # 0x101006a\n"
                ".L0x00000020: .word 0x800a5dec # 0x800a5dec\n"
            )
            (decomp / "wstag_test_c/F0x800a5dec.c").write_text(
                'Warning: missing "jr $ra" in last block (.initial).\n\n'
                "void F0x800a5dec(void) {\n\n}\n"
            )
            inventory = build_inventory(root, decomp)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/wstag_test")
            ids = {item["id"] for item in overlay["functions"]}
            self.assertNotIn("pro/wstag_test:F0x800a5dec", ids)
            rejected = {item["id"]: item for item in inventory["rejected_entries"]}
            self.assertEqual(
                rejected["pro/wstag_test:F0x800a5dec"]["reason"],
                "no_control_transfer_in_decoded_run",
            )
            self.assertIn("pro/wstag_test:F0x800a5de4", ids)

    def test_failed_decompilation_does_not_promote_or_inflate_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            decomp = root / "decomp"
            recovered = root / "recovered"
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (decomp / "stgtrain_c").mkdir(parents=True)
            (recovered / "pro/stgtrain").mkdir(parents=True)
            (root / "exe/fns.s").write_text("")
            (root / "pro/stgtrain.s").write_text(
                ".L0x00000020: jr $ra # .word 0x03e00008\n"
                ".L0x00000030: jr $ra # .word 0x03e00008\n"
            )
            (decomp / "stgtrain_c/F0x80082cd0.c").write_text(
                "// Decompilation failure in function F0x80082cd0:\n"
            )
            (recovered / "pro/stgtrain/F0x80082ce0.c").write_text(
                "void F0x80082ce0(void) {}\n"
            )
            inventory = build_inventory(
                root, decomp_root=decomp, recovered_decomp_root=recovered,
            )
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/stgtrain")
            failed = next(item for item in overlay["functions"] if item["address"] == "0x80082cd0")
            successful = next(item for item in overlay["functions"] if item["address"] == "0x80082ce0")
            self.assertEqual(failed["decompiled_sources"], [])
            self.assertEqual(failed["recovery"]["lift"], "assembly_inventoried")
            self.assertEqual(successful["recovery"]["lift"], "decompiled_c_present")
            self.assertEqual(inventory["summary"]["decompilation_attempt_files"], 2)
            self.assertEqual(inventory["summary"]["decompiled_c_files"], 1)
            self.assertEqual(inventory["summary"]["failed_decompilation_files"], 1)

    def test_curated_semantics_promote_indirect_only_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text("")
            (root / "pro/fieldstg.s").write_text(
                ".L0x00000020: addiu $sp, -0x18 # .word 0x27bdffe8\n"
            )
            semantics = root / "semantics.json"
            semantics.write_text(
                '{"schema_version":1,"functions":{'
                '"pro/fieldstg:F0x80082cd0":{'
                '"name":"callback","subsystem":"field","signature":"void callback(void)",'
                '"recovery":{"lift":"pseudocode","structure":"partial",'
                '"semantics":"candidate","verification":"candidate",'
                '"implementation":"missing"},"evidence":[],"unknowns":[]}}}'
            )
            inventory = build_inventory(root, semantics_path=semantics)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/fieldstg")
            function = overlay["functions"][0]
            self.assertIn("curated_semantics", function["entry_evidence"])
            self.assertEqual(function["semantic_name"], "callback")

    def test_semantic_family_expands_members_without_erasing_family_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n.L0x80010000: jr $ra\n"
            )
            semantics = root / "semantics.json"
            semantics.write_text(json.dumps({
                "schema_version": 1,
                "functions": {},
                "families": {
                    "shared-test": {
                        "template": {
                            "subsystem": "test",
                            "signature": "void shared(void)",
                            "recovery": {
                                "lift": "typed_recovered_code", "structure": "complete",
                                "semantics": "strongly_inferred",
                                "verification": "partially_verified",
                                "implementation": "unknown",
                            },
                            "evidence": ["EV-test"], "unknowns": [],
                        },
                        "members": {"exe/fns:F0x80010000": "sharedTest"},
                    },
                },
            }))
            inventory = build_inventory(root, semantics_path=semantics)
            function = inventory["modules"][0]["functions"][0]
            self.assertEqual(function["semantic_name"], "sharedTest")
            self.assertEqual(function["semantic_family"], "shared-test")
            self.assertEqual(inventory["summary"]["semantic_families"], 1)

    def test_factory_callback_and_literal_arguments_propagate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80014504:\n.L0x80014504: jr $ra # .word 0x03e00008\n"
            )
            (root / "pro/wstag001.s").write_text(
                "# Start of code\n"
                ".L0x00000000: lui $a0, 0x800a # .word 0x3c04800a\n"
                ".L0x00000004: addiu $a0, 0x5e00 # .word 0x24845e00\n"
                ".L0x00000008: li $a1, 0x64 # .word 0x0\n"
                ".L0x0000000c: jal 0x80014504 # .word 0x0c005141\n"
                ".L0x00000010: li $a2, 0x14 # .word 0x0\n"
                ".L0x00000014: jr $ra # .word 0x03e00008\n"
                ".L0x00000018: nop # .word 0x00000000\n"
                ".L0x00000020: jr $ra # .word 0x03e00008\n"
                ".L0x00000024: nop # .word 0x00000000\n"
            )
            inventory = build_inventory(root)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/wstag001")
            callback = next(item for item in overlay["functions"] if item["address"] == "0x800a5e00")
            self.assertIn("factory_callback", callback["entry_evidence"])
            self.assertFalse(any(
                item["address"] == callback["address"]
                for item in overlay["pointer_candidates"]
            ))
            edge = overlay["functions"][0]["direct_calls"][0]
            self.assertEqual(edge["arguments"]["a0"]["value"], "0x800a5e00")
            self.assertEqual(edge["arguments"]["a1"]["value"], 0x64)
            self.assertEqual(edge["arguments"]["a2"]["value"], 0x14)
            families = command_factory_families(inventory, min_count=1)
            self.assertEqual(families[0]["object_size"], 0x64)
            self.assertEqual(families[0]["extra_state_size"], 0x14)
            self.assertEqual(families[0]["callbacks"], ["pro/wstag001:F0x800a5e00"])

    def test_shared_slot_indirect_call_stays_candidate_without_receiver_type(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80014288:\n.L0x80014288: jr $ra # .word 0x03e00008\n"
            )
            (root / "pro/wstag001.s").write_text(
                "# Start of code\n"
                ".L0x00000000: lw $v0, 0x2c($s0) # .word 0x8e02002c\n"
                ".L0x00000004: jalr $v0 # .word 0x0040f809\n"
                ".L0x00000008: nop # .word 0x00000000\n"
            )
            inventory = build_inventory(root)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/wstag001")
            edge = overlay["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["resolution"], "candidate_shared_object_method")
            self.assertEqual(edge["candidate_target_id"], "exe/fns:F0x80014288")
            self.assertIsNone(edge["target_id"])
            self.assertEqual(inventory["summary"]["candidate_shared_object_method_calls"], 1)
            self.assertEqual(inventory["summary"]["resolved_indirect_calls"], 0)
            families = command_slot_families(inventory, min_count=1)
            self.assertEqual(families[0]["slot_offset"], 0x2C)
            self.assertEqual(families[0]["call_count"], 1)

    def test_curated_global_function_pointer_resolves_indirect_caller(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n"
                ".L0x80010000: lui $v0, %hi(D0x8004b7bc)\n"
                ".L0x80010004: lw $v0, %lo(D0x8004b7bc)($v0)\n"
                ".L0x80010008: jalr $v0\n"
                ".L0x8001000c: nop\n"
                "F0x8001810c:\n"
                ".L0x8001810c: jr $ra\n"
                ".L0x80018110: nop\n"
            )
            semantics = root / "semantics.json"
            semantics.write_text(
                '{"schema_version":1,"functions":{},"globals":{'
                '"D0x8004b7bc":{"name":"lookupFn",'
                '"target":"exe/fns:F0x8001810c","verification":"partially_verified",'
                '"evidence":[],"unknowns":[]}}}'
            )
            inventory = build_inventory(root, semantics_path=semantics)
            caller = inventory["modules"][0]["functions"][0]
            edge = caller["indirect_calls"][0]
            self.assertEqual(edge["kind"], "global_function_pointer")
            self.assertEqual(edge["target_id"], "exe/fns:F0x8001810c")
            result = command_callers(inventory, "exe/fns:F0x8001810c")
            self.assertEqual(result["caller_count"], 1)
            self.assertEqual(result["direct_caller_count"], 0)
            self.assertEqual(result["indirect_caller_count"], 1)
            self.assertEqual(result["callers"][0]["edge_type"], "indirect")

    def test_extracted_static_initializer_resolves_global_function_pointer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n"
                ".L0x80010000: lui $v0, 0x8005\n"
                ".L0x80010004: lw $v0, 0x5c48($v0)\n"
                ".L0x80010008: jalr $v0\n"
                ".L0x8001000c: nop\n"
                "F0x8002006c:\n"
                ".L0x8002006c: jr $ra\n"
                ".L0x80020070: nop\n"
            )
            exe_data = root / "data.rs"
            exe_data.write_text(
                'pub static mut D0x80055c48 @ "0x80055c48": *const u32 = '
                'unsafe { ptr::addr_of!(F0x8002006c) };\n'
                'pub static mut D0x80056000 @ "0x80056000": [*const u32; 3] = unsafe { [\n'
                'core::ptr::null(),\n'
                'ptr::addr_of!(F0x8002006c),\n'
                'ptr::addr_of!(f5),\n'
                '] };\n'
                'pub static mut RAND_U16 @ "0x8005600c": unsafe extern "C" fn() -> u16 = rand_u16;\n'
            )
            inventory = build_inventory(root, exe_data_path=exe_data)
            edge = inventory["modules"][0]["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["target_id"], "exe/fns:F0x8002006c")
            self.assertEqual(edge["resolution"], "extracted_static_initializer")
            self.assertEqual(inventory["summary"]["resolved_global_pointer_calls"], 1)
            self.assertEqual(inventory["summary"]["extracted_static_global_function_pointers"], 4)
            self.assertEqual(
                inventory["global_function_pointers"]["D0x80055c48"]["source_line"], 1,
            )
            self.assertEqual(
                inventory["global_function_pointers"]["D0x80056004"]["array_index"], 1,
            )
            self.assertIsNone(
                inventory["global_function_pointers"]["D0x80056008"]["target"],
            )
            self.assertEqual(
                inventory["global_function_pointers"]["D0x8005600c"]["name"], "RAND_U16",
            )
            pointers = command_global_pointers(inventory)
            self.assertEqual(pointers[0]["symbol"], "D0x80055c48")
            self.assertEqual(pointers[0]["target_id"], "exe/fns:F0x8002006c")

    def test_prologue_base_in_callee_saved_register_resolves_far_call(self) -> None:
        """The base is set once, in the cross-register form, far from its use.

        Both halves matter.  The disassembler prints `addiu $s1, $v0, imm`
        whenever destination and source differ, and a callee-saved base is
        materialised in the prologue and then reused for the whole body, so a
        fixed sixteen-instruction lookback files these calls as unknown object
        slots.  The caller-saved copy of the same shape must stay unresolved:
        an intervening call could have rewritten the register.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            filler = "".join(
                f".L0x{0x80010008 + 4 * step:08x}: nop\n" for step in range(40)
            )
            far_call = 0x80010008 + 4 * 40
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n"
                ".L0x80010000: lui $v0, 0x8005\n"
                ".L0x80010004: addiu $s1, $v0, 0x5c48\n"
                + filler
                + f".L0x{far_call:08x}: lw $v0, ($s1)\n"
                f".L0x{far_call + 4:08x}: jalr $v0\n"
                f".L0x{far_call + 8:08x}: nop\n"
                "F0x8002006c:\n"
                ".L0x8002006c: jr $ra\n"
                ".L0x80020070: nop\n"
            )
            exe_data = root / "data.rs"
            exe_data.write_text(
                'pub static mut D0x80055c48 @ "0x80055c48": *const u32 = '
                'unsafe { ptr::addr_of!(F0x8002006c) };\n'
            )
            inventory = build_inventory(root, exe_data_path=exe_data)
            edge = inventory["modules"][0]["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["kind"], "global_function_pointer")
            self.assertEqual(edge["target_id"], "exe/fns:F0x8002006c")
            self.assertEqual(edge["global_symbol"], "D0x80055c48")
            self.assertEqual(
                edge["address_recovery"],
                "callee_saved_literal_base_from_function_start",
            )

            caller_saved = root / "caller-saved"
            caller_saved.mkdir()
            (caller_saved / "exe").mkdir()
            (caller_saved / "pro").mkdir()
            (caller_saved / "exe/fns.s").write_text(
                (root / "exe/fns.s").read_text().replace("$s1", "$t1")
            )
            unresolved = build_inventory(caller_saved, exe_data_path=exe_data)
            edge = unresolved["modules"][0]["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["kind"], "struct_function_slot")
            self.assertIsNone(edge["target_id"])

    def test_word_directive_rows_are_still_scannable_instructions(self) -> None:
        """Half the corpus is `.word 0x... # mnemonic`; it is code, not data.

        The parser already mined `jal` targets out of these comments, but it
        dropped the row itself, so every backward producer search ran against
        nothing in those regions -- leaving the call classified only as an
        unclassified register pointer.  Pointer CANDIDATES must not widen with
        them: a `.word`-only overlay would otherwise gain a full code range and
        turn every aligned data word inside it into a candidate.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text("")
            (root / "pro/stgtrain.s").write_text(
                "# Start of code\n"
                ".L0x00000000: .word 0x3c028008 # lui $v0, 0x8008\n"
                ".L0x00000004: .word 0x8c422d00 # lw $v0, 0x2d00($v0)\n"
                ".L0x00000008: .word 0x0040f809 # jalr $v0\n"
                ".L0x0000000c: .word 0x00000000 # nop\n"
                ".L0x00000020: .word 0x03e00008 # jr $ra\n"
                ".L0x00000024: .word 0x00000000 # nop\n"
                ".L0x00000030: .word 0x80082cd0 # 0x80082cd0\n"
            )
            data_root = root / "rust"
            data_file = data_root / "dw2003_pro_stgtrain/src/data.rs"
            data_file.parent.mkdir(parents=True)
            data_file.write_text(
                'pub static mut TABLE @ "0x80082d00": [u32; 1] = [\n'
                '0x80082cd0,\n'
                '];\n'
            )
            inventory = build_inventory(root, overlay_data_root=data_root)
            module = inventory["modules"][1]
            edge = module["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["kind"], "global_function_pointer")
            self.assertEqual(edge["global_symbol"], "D0x80082d00")
            self.assertEqual(inventory["summary"]["unclassified_indirect_calls"], 0)
            # The trailing pointer-shaped word must not become a candidate just
            # because the `.word` rows are now scannable.
            self.assertEqual(module["pointer_candidate_count"], 0)

    def test_cross_register_base_resolves_within_the_local_window(self) -> None:
        """The same pair, close to its use, is not attributed to the widening."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text(
                "F0x80010000:\n"
                ".L0x80010000: lui $v0, 0x8005\n"
                ".L0x80010004: addiu $s1, $v0, 0x5c48\n"
                ".L0x80010008: lw $v0, ($s1)\n"
                ".L0x8001000c: jalr $v0\n"
                ".L0x80010010: nop\n"
                "F0x8002006c:\n"
                ".L0x8002006c: jr $ra\n"
                ".L0x80020070: nop\n"
            )
            exe_data = root / "data.rs"
            exe_data.write_text(
                'pub static mut D0x80055c48 @ "0x80055c48": *const u32 = '
                'unsafe { ptr::addr_of!(F0x8002006c) };\n'
            )
            inventory = build_inventory(root, exe_data_path=exe_data)
            edge = inventory["modules"][0]["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["target_id"], "exe/fns:F0x8002006c")
            self.assertEqual(
                edge["address_recovery"],
                "nearest_local_literal_base_non_flow_sensitive",
            )

    def test_called_overlay_data_cell_promotes_and_resolves_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data_root = root / "rust"
            data_file = data_root / "dw2003_pro_stgtrain/src/data.rs"
            data_file.parent.mkdir(parents=True)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text("")
            (root / "pro/stgtrain.s").write_text(
                "# Start of code\n"
                ".L0x00000000: lui $v0, 0x8008\n"
                ".L0x00000004: lw $v0, 0x2d00($v0)\n"
                ".L0x00000008: jalr $v0\n"
                ".L0x0000000c: nop\n"
                ".L0x00000020: jr $ra\n"
                ".L0x00000024: nop\n"
            )
            data_file.write_text(
                'pub static mut TABLE @ "0x80082d00": [u32; 1] = [\n'
                '0x80082cd0,\n'
                '];\n'
            )
            inventory = build_inventory(root, overlay_data_root=data_root)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/stgtrain")
            target = next(item for item in overlay["functions"] if item["address"] == "0x80082cd0")
            self.assertIn("extracted_called_function_pointer", target["entry_evidence"])
            edge = overlay["functions"][0]["indirect_calls"][0]
            self.assertEqual(edge["target_id"], "pro/stgtrain:F0x80082cd0")
            self.assertEqual(edge["resolution"], "extracted_overlay_static_initializer")
            self.assertEqual(inventory["summary"]["promoted_overlay_function_pointer_targets"], 1)
            promoted = command_promoted_targets(inventory)
            self.assertEqual(promoted[0]["id"], "pro/stgtrain:F0x80082cd0")
            tables = command_overlay_service_tables(inventory)
            self.assertEqual(len(tables), 1)
            self.assertEqual(tables[0]["array_name"], "TABLE")
            self.assertEqual(tables[0]["array_declared_slot_count"], 1)
            self.assertEqual(tables[0]["slots"][0]["index"], 0)
            self.assertEqual(tables[0]["slots"][0]["call_count"], 1)


class ExtentFunctionTests(unittest.TestCase):
    def test_absolute_path_sections_are_admitted(self) -> None:
        """A `.section`+label with only a return behind it is still a function.

        `InitHeap` and the 16-byte BIOS stubs at 0x8002507c are reached through
        data tables, so the label, jal-target and decompiled-C discovery paths
        all miss them. The extents gate admits them; the inventory must union
        them or the resident library tier reads as smaller than it is.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text("")
            (root / "pro/stagslct.s").write_text("")
            extents = root / "function-extents.json"
            extents.write_text(json.dumps({"sources": {
                "/home/dorij/ddw3/asm/dw2003/exe/fns.s": {
                    "functions": [{"address": 0x8002507C}],
                },
                "~/ddw3/asm/dw2003/pro/stagslct.s": {
                    "functions": [{"address": 0x80082cd0}],
                },
                "pro/fieldstg.s (overlay base 0x80082cb0); ~/ddw3/asm/dw2003/exe/fns": {
                    "functions": [{"address": 0x80010000}],
                },
            }}))
            inventory = build_inventory(root, function_extents_path=extents)
            exe = next(item for item in inventory["modules"] if item["id"] == "exe/fns")
            self.assertEqual(exe["functions"][0]["address"], "0x8002507c")
            self.assertIn("assembly_section", exe["functions"][0]["entry_evidence"])
            self.assertEqual(inventory["summary"]["assembly_section_functions"], 1)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/stagslct")
            self.assertEqual(overlay["functions"], [])

    def test_overlay_projection_outside_the_module_extent_is_dropped(self) -> None:
        """A resident address in an overlay's jal list is not that overlay's code."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "exe").mkdir()
            (root / "pro").mkdir()
            (root / "exe/fns.s").write_text("")
            (root / "pro/stagslct.s").write_text(
                ".L0x00000000: jr $ra\n"
                ".L0x00000004: nop\n"
                ".L0x00000020: jr $ra\n"
                ".L0x00000024: nop\n"
            )
            extents = root / "function-extents.json"
            extents.write_text(json.dumps({"sources": {
                "/home/dorij/ddw3/asm/dw2003/pro/stagslct.s": {
                    "functions": [
                        {"address": 0x80082cd0},
                        {"address": 0x80010000},
                    ],
                },
            }}))
            inventory = build_inventory(root, function_extents_path=extents)
            overlay = next(item for item in inventory["modules"] if item["id"] == "pro/stagslct")
            addresses = {item["address"] for item in overlay["functions"]}
            self.assertIn("0x80082cd0", addresses)
            self.assertNotIn("0x80010000", addresses)


if __name__ == "__main__":
    unittest.main()
