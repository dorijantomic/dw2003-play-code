"""Tests for gen_scenes.py. Run: python3 tools/test_gen_scenes.py"""

import json
import struct
import unittest

import gen_scenes


class TestAliasScreenResolution(unittest.TestCase):
    def test_final_world_uses_alt_stage_for_shared_screen(self):
        screens = {
            "624": {"stage": 201, "alt": {"stage": 920}},
            "512": {"stage": 200},
        }
        self.assertEqual(gen_scenes.stage_for_screen(screens, 624), 201)
        self.assertEqual(
            gen_scenes.stage_for_screen(screens, 624, alias_world=True), 920
        )
        self.assertEqual(
            gen_scenes.stage_for_screen(screens, 512, alias_world=True), 200
        )
from gen_scenes import (apply_warp_wiring, apply_wiring, apply_npc_spawns,
                        purge_ext_npcs, _sprite_for_npc_id, _sprite_cache)


class TestApplyNpcSpawnsFlaglist(unittest.TestCase):
    """spawn_flags (§WS4.9) pass through; flag-distinct variants sharing
    (slot,n,x,y) get unique ids and the first keeps the bare id."""

    def setUp(self):
        self._orig = gen_scenes._sprite_for_npc_id
        gen_scenes._sprite_for_npc_id = lambda nid: "p046"

    def tearDown(self):
        gen_scenes._sprite_for_npc_id = self._orig

    def test_variants_get_unique_ids_and_flags(self):
        npcs = [
            {"id": 46, "slot": 5, "x": 564, "y": 558, "n": 5, "talk": [],
             "spawn_flags": [{"id": 0x6004, "expected": 1}]},
            {"id": 46, "slot": 5, "x": 564, "y": 558, "n": 5, "talk": [],
             "spawn_flags": [{"id": 0x600c, "expected": 1}]},
        ]
        out = apply_npc_spawns({"npcs": []}, npcs, {"p046"})
        reals = [n for n in out["npcs"] if str(n["id"]).startswith("real_")]
        self.assertEqual([n["id"] for n in reals],
                         ["real_5_5_564_558", "real_5_5_564_558#1"])
        self.assertEqual(reals[0]["spawn_flags"], [{"id": 0x6004, "expected": 1}])
        self.assertEqual(reals[1]["spawn_flags"], [{"id": 0x600c, "expected": 1}])

    def test_empty_flaglist_omitted(self):
        npcs = [{"id": 46, "slot": 5, "x": 1, "y": 2, "n": 1, "talk": [],
                 "spawn_flags": []}]
        out = apply_npc_spawns({"npcs": []}, npcs, {"p046"})
        real = next(n for n in out["npcs"] if str(n["id"]).startswith("real_"))
        self.assertNotIn("spawn_flags", real)


class TestApplyNpcSpawnsDialogue(unittest.TestCase):
    """NPC dialogue = estalk00[ptrB triple id], gated by the triple's `gate`
    flag-list, advancing via `on_close` (talk handler F0x80090afc, §WS5).
    The old ptrA-`talk` path is dropped (ptrA = spawn_flags, not dialogue)."""

    def setUp(self):
        self._orig = gen_scenes._sprite_for_npc_id
        gen_scenes._sprite_for_npc_id = lambda nid: "p046"

    def tearDown(self):
        gen_scenes._sprite_for_npc_id = self._orig

    def test_dialogue_states_from_ptrb_id_gated(self):
        # id 1158 is a real estalk00 entry ("Tamer Service ... call out your partner")
        npcs = [{"id": 32, "slot": 4, "x": 384, "y": 255, "n": 1, "talk": [],
                 "ptrb_dialogues": [
                     {"id": 1158,
                      "gate": [{"id": 0x1A00, "expected": 1}],
                      "on_close": [{"id": 0x9004, "expected": 1}]}]}]
        out = apply_npc_spawns({"npcs": []}, npcs, {"p046"})
        real = next(n for n in out["npcs"] if str(n["id"]).startswith("real_"))
        self.assertEqual(real["dialogue"], {"file": "estalk00", "index": 1158})
        self.assertEqual(real["dialogue_states"], [
            {"gate": [{"id": 0x1A00, "expected": 1}],
             "dialogue": {"file": "estalk00", "index": 1158},
             "on_close": [{"id": 0x9004, "expected": 1}]}])

    def test_placeholder_id_is_silent_not_garbage(self):
        # id 5 is an "a" placeholder dropped from estalk00.json -> no dialogue
        npcs = [{"id": 32, "slot": 4, "x": 1, "y": 2, "n": 1, "talk": [],
                 "ptrb_dialogues": [{"id": 5, "gate": [], "on_close": []}]}]
        out = apply_npc_spawns({"npcs": []}, npcs, {"p046"})
        real = next(n for n in out["npcs"] if str(n["id"]).startswith("real_"))
        self.assertNotIn("dialogue", real)
        self.assertNotIn("dialogue_states", real)

    def test_ptra_talk_no_longer_becomes_dialogue(self):
        # a leftover `talk` entry (the ptrA misread) must NOT produce dialogue
        npcs = [{"id": 32, "slot": 4, "x": 1, "y": 2, "n": 1,
                 "talk": [{"file": "estalk00", "index": 103}], "ptrb_dialogues": []}]
        out = apply_npc_spawns({"npcs": []}, npcs, {"p046"})
        real = next(n for n in out["npcs"] if str(n["id"]).startswith("real_"))
        self.assertNotIn("dialogue", real)


class TestSpriteForNpcId(unittest.TestCase):
    # npc 112/63/113/198 have handle 0 (no sprite) in the live FIELDSTG table
    # (savestate slot-5 RAM, s210 clerk scene). They are invisible marker entities
    # in the real game. The old p{id} fallback fabricated a wrong, VISIBLE Digimon
    # (npc 112 -> p112hand, a dark/red mech) — proven against the savestate. A
    # table-miss must resolve to None so the NPC is skipped (stays invisible).
    def test_table_miss_returns_none_not_fabricated_sprite(self):
        _sprite_cache.clear()
        self.assertIsNone(_sprite_for_npc_id(112),
                          "table-miss npc must be None, not a fabricated p{id} sprite")
        _sprite_cache.clear()


def stage_data(doors=(), warps=()):
    return {"doors": list(doors), "warps": list(warps)}


def warp(stage, x, y, d="down", param=0):
    return {"screen": 0, "stage": stage, "spawnX": x, "spawnY": y,
            "dir": d, "param": param}


class TestPurgeExtNpcs(unittest.TestCase):
    def test_removes_ext_npcs_keeps_hand_ones(self):
        scene = {"npcs": [{"id": "masato", "x": 1, "y": 2},
                          {"id": "ext_divermon", "x": 3, "y": 4}],
                 "exits": [], "zones": []}
        out = purge_ext_npcs(scene)
        self.assertEqual([n["id"] for n in out["npcs"]], ["masato"])


class TestApplyWarpWiring(unittest.TestCase):
    # s1 has a door to s2 at (100, 200) (= s2's return-warp spawn);
    # walking through lands at (500, 50) in s2.
    DATA = {
        1: stage_data(doors=[{"idx": 0, "x": 104, "y1": 180, "y2": 230}],
                      warps=[warp(2, 500, 50, "right", 100)]),
        2: stage_data(warps=[warp(1, 100, 200, "left")]),
        3: stage_data(warps=[warp(1, 70, 80, "up")]),  # one-way into s1
    }

    def test_reciprocal_warp_becomes_exit(self):
        scene = {"npcs": [], "exits": [], "zones": []}
        out = apply_warp_wiring(scene, 1, self.DATA, {"s1", "s2"})
        self.assertEqual(len(out["exits"]), 1)
        ex = out["exits"][0]
        self.assertEqual(ex["to"], "s2")
        self.assertEqual((ex["spawnX"], ex["spawnY"]), (500, 50))
        self.assertEqual(ex["dir"], "right")
        # located at s2's return-warp spawn, snapped to the door trigger
        self.assertEqual((ex["x"], ex["y"], ex["w"], ex["h"]),
                         (104 - 12, 180, 24, 50))
        self.assertIn("warp", ex)

    def test_no_trigger_nearby_gives_rect_around_return_spawn(self):
        data = {1: stage_data(warps=[warp(2, 500, 50)]),
                2: stage_data(warps=[warp(1, 100, 200)])}
        out = apply_warp_wiring({"exits": []}, 1, data, {"s1", "s2"})
        ex = out["exits"][0]
        self.assertEqual((ex["x"], ex["y"], ex["w"], ex["h"]),
                         (100 - 16, 200 - 16, 32, 32))

    def test_dest_not_in_manifest_skipped(self):
        scene = {"npcs": [], "exits": [], "zones": []}
        out = apply_warp_wiring(scene, 1, self.DATA, {"s1"})
        self.assertEqual(out["exits"], [])

    def test_one_way_warp_without_source_door_skipped(self):
        # s3 -> s1 is one-way and s3 has no door trigger to pin it to: the
        # exit cannot be placed without guessing, so it is left out.
        scene = {"npcs": [], "exits": [], "zones": []}
        out = apply_warp_wiring(scene, 3, self.DATA, {"s1", "s3"})
        self.assertEqual(out["exits"], [])

    def test_one_way_warp_pinned_by_param_becomes_exit(self):
        # s3 -> s1 one-way, but s3 has a door whose idx matches param-100.
        data = {
            1: stage_data(warps=[]),
            3: stage_data(doors=[{"idx": 2, "x": 312, "y1": 100, "y2": 160}],
                          warps=[warp(1, 88, 460, "up", 102)]),
        }
        out = apply_warp_wiring({"exits": []}, 3, data, {"s1", "s3"})
        self.assertEqual(len(out["exits"]), 1)
        ex = out["exits"][0]
        self.assertEqual(ex["to"], "s1")
        self.assertTrue(ex["oneway"])
        self.assertEqual((ex["spawnX"], ex["spawnY"]), (88, 460))
        self.assertEqual((ex["x"], ex["y"], ex["w"], ex["h"]),
                         (312 - 12, 100, 24, 60))

    def test_one_way_warp_pinned_by_sole_remaining_door(self):
        # param=0 but exactly one door is unclaimed -> bind to it.
        data = {
            1: stage_data(warps=[]),
            3: stage_data(doors=[{"idx": 0, "x": 200, "y1": 50, "y2": 90}],
                          warps=[warp(1, 10, 20, "left")]),
        }
        out = apply_warp_wiring({"exits": []}, 3, data, {"s1", "s3"})
        self.assertEqual(len(out["exits"]), 1)
        self.assertEqual(out["exits"][0]["x"], 200 - 12)

    def test_one_way_warp_ambiguous_doors_skipped(self):
        # param=0 with two unclaimed doors -> guessing, so skip.
        data = {
            1: stage_data(warps=[]),
            3: stage_data(doors=[{"idx": 0, "x": 200, "y1": 50, "y2": 90},
                                 {"idx": 1, "x": 400, "y1": 50, "y2": 90}],
                          warps=[warp(1, 10, 20, "left")]),
        }
        out = apply_warp_wiring({"exits": []}, 3, data, {"s1", "s3"})
        self.assertEqual(out["exits"], [])

    def test_rerun_replaces_warp_exits_keeps_hand_exits(self):
        hand = {"x": 0, "y": 0, "w": 9, "h": 9, "to": "s9",
                "spawnX": 1, "spawnY": 1, "dir": "left"}
        scene = {"npcs": [], "exits": [hand], "zones": []}
        once = apply_warp_wiring(scene, 1, self.DATA, {"s1", "s2"})
        twice = apply_warp_wiring(once, 1, self.DATA, {"s1", "s2"})
        self.assertEqual(once, twice)
        self.assertIn(hand, twice["exits"])
        self.assertEqual(len(twice["exits"]), 2)

    def test_two_exits_cannot_share_one_trigger(self):
        # Both return spawns are nearest to trigger idx1; the closer exit
        # gets it, the other must fall back to its second-nearest trigger.
        data = {
            1: stage_data(
                doors=[{"idx": 0, "x": 510, "y1": 375, "y2": 423},
                       {"idx": 1, "x": 609, "y1": 327, "y2": 375}],
                warps=[warp(2, 50, 60), warp(3, 70, 80)]),
            2: stage_data(warps=[warp(1, 600, 350)]),   # 9px from idx1
            3: stage_data(warps=[warp(1, 560, 360)]),   # 49px from idx1
        }
        out = apply_warp_wiring({"exits": []}, 1, data,
                                {"s1", "s2", "s3"})
        rects = {e["to"]: e["x"] for e in out["exits"]}
        self.assertEqual(rects["s2"], 609 - 12)
        self.assertEqual(rects["s3"], 510 - 12)

    def test_multi_door_pairs_matched_in_axis_order_and_flagged(self):
        # Two doors between s1 and s2; spawns sorted along x on both sides.
        data = {
            1: stage_data(warps=[warp(2, 600, 450), warp(2, 200, 356)]),
            2: stage_data(warps=[warp(1, 810, 156), warp(1, 568, 140)]),
        }
        out = apply_warp_wiring({"exits": []}, 1, data, {"s1", "s2"})
        self.assertEqual(len(out["exits"]), 2)
        by_x = sorted(out["exits"], key=lambda e: e["x"])
        # west door in s1 (568) -> west arrival in s2 (200)
        self.assertEqual(by_x[0]["spawnX"], 200)
        self.assertEqual(by_x[1]["spawnX"], 600)
        self.assertTrue(all(e["approx"] for e in out["exits"]))

    def test_gated_warp_carries_gate_onto_exit(self):
        # A flag-gated warp (cond_a != 0xffff) tags its exit with a `gate`.
        w = warp(2, 500, 50, "right", 100)
        w.update(gate_a=0x7007, arg_a=0, gate_b=0xffff, arg_b=0)
        data = {1: stage_data(doors=[{"idx": 0, "x": 104, "y1": 180, "y2": 230}],
                              warps=[w]),
                2: stage_data(warps=[warp(1, 100, 200, "left")])}
        out = apply_warp_wiring({"exits": []}, 1, data, {"s1", "s2"})
        self.assertEqual(out["exits"][0]["gate"], {"flag": 0x7007, "eq": 0})

    def test_ungated_warp_has_no_gate_key(self):
        out = apply_warp_wiring({"exits": []}, 1, self.DATA, {"s1", "s2"})
        self.assertNotIn("gate", out["exits"][0])


class TestGridWarpExits(unittest.TestCase):
    SCREENS = {"527": {"stage": 255}}
    STEPS = {"steps": [
        {"cond_a": 0xffff, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
         "op": 1, "params": [527, 224, 334, 5, 102, 0, 0]},  # idx0 warp -> s255
        {"cond_a": 0xffff, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
         "op": 8, "params": [0, 0, 0, 0, 0, 0, 0]},           # idx1 non-warp
    ]}
    # 4x3 grid, cell 32; cell (2,1) carries trigger byte 0xA0 (step idx0).
    GRID = {"cell": 32, "w": 4, "h": 3,
            "grid": [0, 0, 0, 0, 0, 0, 0xA0, 0, 0, 0, 0, 0]}

    def test_exit_placed_at_trigger_cell(self):
        exits, covered = gen_scenes.grid_warp_exits(
            200, self.GRID, self.STEPS, self.SCREENS, {"s200", "s255"})
        self.assertEqual(len(exits), 1)
        ex = exits[0]
        self.assertEqual((ex["x"], ex["y"], ex["w"], ex["h"]), (64, 32, 32, 32))
        # params[3] = 5 = char+0x60's "up-right", the same word the trigger byte's
        # own group carries (0xA0 >> 5 = 5). It used to assert "up" -- a step out
        # of true, and contradicted by this very fixture's grid byte.
        self.assertEqual((ex["to"], ex["spawnX"], ex["spawnY"], ex["dir"]),
                         ("s255", 224, 334, "up-right"))
        self.assertTrue(ex["grid"])
        self.assertIn((255, 224, 334, 102), covered)

    def test_covered_warp_not_reproximity_placed(self):
        # apply_warp_wiring must skip the grid-covered warp (no duplicate exit).
        data = {200: {"doors": [], "warps": [
                    {"screen": 527, "stage": 255, "spawnX": 224, "spawnY": 334,
                     "dir": "up", "param": 102}]},
                255: {"warps": [{"screen": 0, "stage": 200, "spawnX": 9, "spawnY": 9,
                                 "dir": "down", "param": 0}]}}
        out = apply_warp_wiring({"exits": []}, 200, data, {"s200", "s255"},
                                grid=self.GRID, steps=self.STEPS,
                                screens=self.SCREENS)
        s255 = [e for e in out["exits"] if e["to"] == "s255"]
        self.assertEqual(len(s255), 1)
        self.assertTrue(s255[0]["grid"])

    def test_dive_controller_uses_same_authoritative_grid_geometry(self):
        screens = {"736": {"stage": 825, "alt": {"stage": 960}}}
        steps = {"steps": [{
            "cond_a": 0xffff, "arg_a": 0,
            "cond_b": 0xffff, "arg_b": 0,
            "op": 10, "params": [736, 576, 216, 1, 0, 5, 1],
        }]}
        exits, _covered = gen_scenes.grid_warp_exits(
            943, self.GRID, steps, screens, {"s943", "s960"})
        self.assertEqual(len(exits), 1)
        self.assertEqual(exits[0]["to"], "s960")
        self.assertEqual(exits[0]["stepOp"], 10)
        self.assertEqual(exits[0]["transition"], "dive")
        self.assertTrue(exits[0]["grid"])

    def test_noncardinal_dive_direction_keeps_native_value_but_spawns_safely(self):
        screens = {"744": {"stage": 865, "alt": {"stage": 968}}}
        steps = {"steps": [{
            "cond_a": 0xffff, "arg_a": 0,
            "cond_b": 0xffff, "arg_b": 0,
            "op": 9, "params": [744, 576, 208, 0, 0, 5, 1],
        }]}
        exits, _covered = gen_scenes.grid_warp_exits(
            943, self.GRID, steps, screens, {"s943", "s968"})
        self.assertEqual(exits[0]["dir"], "down")
        self.assertEqual(exits[0]["nativeDir"], 0)


class TestMergeGatedWarps(unittest.TestCase):
    SCREENS = {"514": {"stage": 205}, "527": {"stage": 255}}

    def _steps(self):
        # op=1 story-steps: one gated (screen 514/s205) + one unconditional
        # (screen 527/s255) that duplicates a sig-warp already present.
        return {"200": {"steps": [
            {"cond_a": 0x7007, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
             "op": 1, "params": [514, 776, 224, 1, 0, 0, 0]},
            {"cond_a": 0xffff, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
             "op": 1, "params": [527, 224, 334, 5, 102, 0, 0]},
            {"cond_a": 0xffff, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
             "op": 8, "params": [100, 0, 0, 0, 0, 0, 0]},  # non-warp op ignored
        ]}}

    def test_appends_gated_warp_and_dedupes_unconditional(self):
        # sig-warp for s255 already extracted (the ffff0000-prefixed one).
        data = {200: {"warps": [{"screen": 527, "stage": 255, "spawnX": 224,
                                 "spawnY": 334, "dir": "up", "param": 102}]}}
        gen_scenes.merge_gated_warps(data, self.SCREENS, steps=self._steps())
        warps = data[200]["warps"]
        self.assertEqual(len(warps), 2)  # s255 not duplicated; s205 added
        bridge = next(w for w in warps if w["screen"] == 514)
        # The record's params[3] = 1 is char+0x60's "down-left", not "down".
        self.assertEqual((bridge["stage"], bridge["spawnX"], bridge["spawnY"],
                          bridge["dir"], bridge["param"]), (205, 776, 224, "down-left", 0))
        self.assertEqual(bridge["gate_a"], 0x7007)

    def test_unknown_screen_skipped(self):
        data = {200: {"warps": []}}
        steps = {"200": {"steps": [
            {"cond_a": 0xffff, "arg_a": 0, "cond_b": 0xffff, "arg_b": 0,
             "op": 1, "params": [9999, 0, 0, 1, 0, 0, 0]}]}}
        gen_scenes.merge_gated_warps(data, self.SCREENS, steps=steps)
        self.assertEqual(data[200]["warps"], [])


class TestTailStepProgram(unittest.TestCase):
    """Event-less stages (no wstag_events, so absent from story_steps.json) still
    carry their 24-byte step program at the overlay tail. tail_step_program
    reconstructs it so grid_warp_exits can place their exits, instead of the
    proximity fallback piling overlapping exits onto adjacent door segments.
    Uses the real s255 (Lamb Chop) overlay -> requires ~/ddw3 asm."""

    def setUp(self):
        self.screens = gen_scenes.load_screens()
        if gen_scenes.overlay_bytes("255") is None:
            self.skipTest("~/ddw3 wstag255.s not present")

    def test_lambchop_program_is_the_two_warps_in_order(self):
        prog = gen_scenes.tail_step_program(255, self.screens)
        self.assertIsNotNone(prog)
        ops = [(s["op"], s["params"][:5]) for s in prog["steps"] if s["op"] != 0]
        # idx0 -> s200 (screen 512), idx1 -> s235 (screen 522); order matches the grid
        self.assertEqual(ops, [(1, [512, 274, 544, 1, 0]),
                               (1, [522, 104, 346, 5, 100])])

    def test_grid_places_the_two_exits_apart_not_overlapping(self):
        grid = json.loads(gen_scenes.STORY_GRIDS.read_text())["stages"]["255"]
        steps = gen_scenes.tail_step_program(255, self.screens)
        exits, _cov = gen_scenes.grid_warp_exits(255, grid, steps, self.screens,
                                                 {"s255", "s200", "s235"})
        by_to = {e["to"]: e for e in exits}
        self.assertEqual(set(by_to), {"s200", "s235"})
        self.assertTrue(all(e["grid"] for e in exits))
        # the two grid trigger cells are far apart: their rects must not overlap
        a, b = by_to["s200"], by_to["s235"]
        overlap = (a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and
                   a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"])
        self.assertFalse(overlap, f"exits overlap: {a} vs {b}")

    def test_rejects_stage_with_no_sig_warps(self):
        # s260 (Cargo Tower) has no sig-warps: no false program is invented.
        if gen_scenes.overlay_bytes("260") is None:
            self.skipTest("~/ddw3 wstag260.s not present")
        self.assertIsNone(gen_scenes.tail_step_program(260, self.screens))

    def test_dive_only_program_is_recovered(self):
        if gen_scenes.overlay_bytes("951") is None:
            self.skipTest("~/ddw3 wstag951.s not present")
        prog = gen_scenes.tail_step_program(951, self.screens)
        self.assertIsNotNone(prog)
        transitions = [s for s in prog["steps"] if s["op"] in (1, 9, 10)]
        self.assertEqual([(s["op"], s["params"][:5]) for s in transitions], [
            (10, [736, 576, 216, 1, 0]),
        ])


class TestMergeCompiledWarps(unittest.TestCase):
    """Pure-data compiled overlays (s260 Cargo Tower) hide their warp destination in
    the bytecode; merge_compiled_warps recovers it only when a reciprocal warp
    corroborates the link, so coincidental byte matches are rejected."""

    def test_reciprocal_corroborated_warp_recovered(self):
        # s1 has no warps; its overlay bytes (mocked) contain a ->s2 payload, and s2
        # warps back to s1, so the link is real.
        screens = {"600": {"stage": 2}}
        data = {1: {"warps": []},
                2: {"warps": [{"screen": 0, "stage": 1, "spawnX": 5, "spawnY": 6,
                               "dir": "down", "param": 0}]}}
        payload = struct.pack("<5H", 600, 700, 200, 1, 0)
        orig = gen_scenes.overlay_bytes
        gen_scenes.overlay_bytes = lambda s: (b"\x00\x00" + payload) if s == "1" else None
        try:
            gen_scenes.merge_compiled_warps(data, screens)
        finally:
            gen_scenes.overlay_bytes = orig
        # The inline payload's facing word is 1 = char+0x60's "down-left".
        self.assertEqual(data[1]["warps"], [
            {"screen": 600, "stage": 2, "spawnX": 700, "spawnY": 200,
             "dir": "down-left", "param": 0}])

    def test_uncorroborated_payload_rejected(self):
        # same payload but s2 does NOT warp back to s1 -> not accepted (no fabrication).
        screens = {"600": {"stage": 2}}
        data = {1: {"warps": []}, 2: {"warps": []}}
        payload = struct.pack("<5H", 600, 700, 200, 1, 0)
        orig = gen_scenes.overlay_bytes
        gen_scenes.overlay_bytes = lambda s: payload if s == "1" else None
        try:
            gen_scenes.merge_compiled_warps(data, screens)
        finally:
            gen_scenes.overlay_bytes = orig
        self.assertEqual(data[1]["warps"], [])

    def test_real_s260_recovers_only_s275(self):
        screens = gen_scenes.load_screens()
        if gen_scenes.overlay_bytes("260") is None:
            self.skipTest("~/ddw3 wstag260.s not present")
        # minimal data: s260 empty, s275 warps back to s260 (the real reciprocal)
        data = {260: {"warps": []},
                275: {"warps": [{"screen": 528, "stage": 260, "spawnX": 232,
                                 "spawnY": 418, "dir": "up", "param": 101}]}}
        gen_scenes.merge_compiled_warps(data, screens)
        dests = {(w["stage"], w["spawnX"], w["spawnY"]) for w in data[260]["warps"]}
        self.assertEqual(dests, {(275, 766, 165)})


class TestMergeMazeExits(unittest.TestCase):
    """The desert self-warp stages' overlay warp records are stale self-warp
    placeholders; merge_maze_exits swaps in the runtime-captured real neighbour
    warps and builds a synthetic step program keyed to the grid wedges so
    grid_warp_exits places them (wedge code = (dir<<5)|step)."""

    def _run(self, spec):
        import tempfile, os
        screens = {"599": {"stage": 630}, "601": {"stage": 640}}
        # grid: up wedge (0xa0 = dir5 step0), right wedge (0xe1 = dir7 step1)
        grids = {"635": {"cell": 32, "w": 2, "h": 1, "grid": [0xa0, 0xe1]}}
        data = {635: {"warps": [{"screen": 600, "stage": 635, "spawnX": 832,
                                 "spawnY": 240, "dir": "up", "param": 0}]}}
        orig = gen_scenes.MAZE_EXITS
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"stages": spec}, f)
            path = f.name
        gen_scenes.MAZE_EXITS = __import__("pathlib").Path(path)
        try:
            steps = gen_scenes.merge_maze_exits(data, grids, screens)
        finally:
            gen_scenes.MAZE_EXITS = orig
            os.unlink(path)
        return data, steps

    def test_replaces_placeholder_warps_and_builds_step_program(self):
        spec = {"635": [
            {"dir": "up", "to": "s630", "screen": 599, "spawnX": 256, "spawnY": 632},
            {"dir": "right", "to": "s640", "screen": 601, "spawnX": 288, "spawnY": 256},
        ]}
        data, steps = self._run(spec)
        # placeholder self-warp is gone; real neighbour warps are in
        self.assertEqual([(w["stage"], w["dir"]) for w in data[635]["warps"]],
                         [(630, "up"), (640, "right")])
        # step program indexes by grid step: step0 = up->s630(599), step1 = right->s640(601).
        # The facing travels as the NAME the maze enum gives it -- a maze exit
        # record is not a char+0x60 word, and grid_warp_exits keeps a name as it is
        # instead of reading it through DIR8 (which would call 5 "up-right").
        prog = steps["635"]["steps"]
        self.assertEqual(prog[0]["op"], 1)
        self.assertEqual(prog[0]["params"][:4], [599, 256, 632, "up"])
        self.assertEqual(prog[1]["params"][:4], [601, 288, 256, "right"])

    def test_missing_grid_stage_skipped(self):
        # a stage with exits but no grid gets no step program (and is left untouched)
        spec = {"999": [{"dir": "up", "to": "s630", "screen": 599,
                         "spawnX": 1, "spawnY": 2}]}
        data, steps = self._run(spec)
        self.assertNotIn("999", steps)


class TestApplyWiring(unittest.TestCase):
    DOORS = [{"idx": 0, "x": 303, "y1": 495, "y2": 544},
             {"idx": 5, "x": 1073, "y1": 463, "y2": 512}]
    WIRING = {"5": {"to": "s202", "spawnX": 80, "spawnY": 280, "dir": "right"}}

    def test_wired_door_becomes_exit_with_door_tag(self):
        scene = {"npcs": [], "exits": [], "zones": []}
        out = apply_wiring(scene, self.DOORS, self.WIRING)
        ex = next(e for e in out["exits"] if e.get("door") == 5)
        self.assertEqual(ex["to"], "s202")
        self.assertEqual((ex["x"], ex["y"], ex["w"], ex["h"]),
                         (1073 - 12, 463, 24, 512 - 463))

    def test_reapply_replaces_not_duplicates(self):
        scene = {"npcs": [], "exits": [], "zones": []}
        once = apply_wiring(scene, self.DOORS, self.WIRING)
        twice = apply_wiring(once, self.DOORS, self.WIRING)
        self.assertEqual(once, twice)


if __name__ == "__main__":
    unittest.main()


class TestExtractCastList(unittest.TestCase):
    """The descriptor +0x4C cast list is decoded with the full nid range, so a
    high-nid actor the run-scan drops (nid cap 200) is still reachable when the
    stage's talk events name it."""

    def test_high_nid_cast_record_is_decoded(self):
        import wstag_extract as W
        data = bytearray(0x400)
        cast = 0x100
        rec = 0x200
        struct.pack_into("<I", data, cast, W._OVERLAY_BASE + rec)
        struct.pack_into("<I", data, cast + 4, 0)  # terminator
        # {ptrA, ptrB, slot<<16|id, y<<16|x, n}
        struct.pack_into("<IIIII", data, rec, 0, 0, (5 << 16) | 213,
                         (232 << 16) | 336, 3)
        recs = W.extract_cast(bytes(data), W._OVERLAY_BASE + cast)
        self.assertEqual(len(recs), 1)
        self.assertEqual(recs[0]["id"], 213)
        self.assertEqual((recs[0]["slot"], recs[0]["x"], recs[0]["y"], recs[0]["n"]),
                         (5, 336, 232, 3))

    def test_player_form_ids_are_not_filtered_by_the_decoder(self):
        # The decoder returns whatever the cast holds; the caller's need_ids is
        # what excludes the 0x146/0x147 player-form markers.
        import wstag_extract as W
        data = bytearray(0x400)
        cast = 0x100
        struct.pack_into("<I", data, cast, W._OVERLAY_BASE + 0x200)
        struct.pack_into("<I", data, cast + 4, 0)
        struct.pack_into("<IIIII", data, 0x200, 0, 0, (1 << 16) | 0x147,
                         (0x40 << 16) | 0x40, 0)
        recs = W.extract_cast(bytes(data), W._OVERLAY_BASE + cast)
        self.assertEqual([r["id"] for r in recs], [0x147])
