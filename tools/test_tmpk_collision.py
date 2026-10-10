"""Tests for tmpk_collision.py quadtree decode. Run: python3 tools/test_tmpk_collision.py"""

import base64
import struct
import unittest

from tmpk_collision import (decode_layer_pixels, find_layer, registered_layers,
                            stage_collision, walk_layer_subs, widen_doors)
from zone_registration import type0_id


def quad_u16(*entries):
    return b"".join(struct.pack("<4H", *e) for e in entries)


class TestDecodeLayerPixels(unittest.TestCase):
    def test_single_tile_quadtree_resolves_to_pixels(self):
        # 1x1 tile grid. Two leaves: 0 = all blocked, 1 = all walkable.
        # All levels point everything at child 0, except the very first 8px
        # quad (top-left of the tile) which uses walkable leaf 1.
        bins = [
            bytes([1, 1, 0]),                              # 0.bin: grid 1x1 -> l1[0]
            bytes([0, 0, 0, 0]),                           # 1.bin: 4 x 64px -> l2[0]
            quad_u16((0, 0, 0, 0)),                        # 2.bin: 4 x 32px -> l3[0]
            quad_u16((0, 0, 0, 0)),                        # 3.bin: 4 x 16px -> l4[0]
            quad_u16((1, 0, 0, 0)),                        # 4.bin: TL 8px -> leaf 1
            bytes([0] * 64) + bytes([1] * 64),             # 5.bin: leaves
        ]
        px = decode_layer_pixels(bins, 1, 1)
        self.assertEqual(len(px), 128)
        self.assertEqual(len(px[0]), 128)
        # Only the first 8x8 px of every 16px quad's TL... no: only the very
        # top-left 8px block of EVERY 16px region whose l4 entry is (1,0,0,0)
        # -- which is all of them, since l3 always points at l4[0].
        self.assertEqual(px[0][0], 1)     # inside a TL 8px block
        self.assertEqual(px[7][7], 1)
        self.assertEqual(px[0][8], 0)     # TR 8px block of the 16px quad
        self.assertEqual(px[8][0], 0)     # BL
        self.assertEqual(px[0][16], 1)    # TL of the next 16px quad
        self.assertEqual(px[120][120], 0) # BR corner blocked

    def test_child_order_is_row_major(self):
        # leaf 1 only on the BR 8px child (index 3) of the BR chain
        bins = [
            bytes([1, 1, 0]),
            bytes([0, 0, 0, 1]),                           # BR 64px -> l2[1]
            quad_u16((0, 0, 0, 0), (0, 0, 0, 1)),          # l2[1]: BR 32px -> l3[1]
            quad_u16((0, 0, 0, 0), (0, 0, 0, 1)),          # l3[1]: BR 16px -> l4[1]
            quad_u16((0, 0, 0, 0), (0, 0, 0, 1)),          # l4[1]: BR 8px -> leaf 1
            bytes([0] * 64) + bytes([1] * 64),
        ]
        px = decode_layer_pixels(bins, 1, 1)
        self.assertEqual(px[127][127], 1)  # bottom-right pixel walkable
        self.assertEqual(px[0][0], 0)
        self.assertEqual(sum(sum(r) for r in px), 64)  # exactly one 8px leaf


class TestWidenDoors(unittest.TestCase):
    def _grid(self, cols, rows):
        return {"cell": 8, "cols": cols, "rows": rows,
                "blocked": ["1" * cols for _ in range(rows)]}

    def test_clears_cells_around_door_trigger(self):
        # 16x16 cell grid (128px), one door at x=64 spanning y 64..96.
        coll = self._grid(16, 16)
        widen_doors(coll, [{"idx": 0, "x": 64, "y1": 64, "y2": 96}])
        # trigger column (cell 8) and rows 8..12 must be cleared, halo included.
        self.assertEqual(coll["blocked"][8][8], "0")   # door center
        self.assertEqual(coll["blocked"][8][6], "0")   # left approach (x=64-12)
        self.assertEqual(coll["blocked"][8][9], "0")   # right approach (x=64+12)
        # far cells stay blocked.
        self.assertEqual(coll["blocked"][0][0], "1")
        self.assertEqual(coll["blocked"][15][15], "1")

    def test_clamps_at_grid_edges(self):
        coll = self._grid(8, 8)
        # door near the top-left corner; expansion must not throw or wrap.
        widen_doors(coll, [{"idx": 0, "x": 0, "y1": 0, "y2": 8}])
        self.assertEqual(coll["blocked"][0][0], "0")

    def test_no_doors_is_noop(self):
        coll = self._grid(4, 4)
        widen_doors(coll, [])
        self.assertEqual(coll["blocked"], ["1111"] * 4)


class TestRegisteredWalkLayers(unittest.TestCase):
    """The walkable area is the stage's REGISTERED walk layers (type 0 + type 1).

    The old fixed {0,1,2} union in find_layers dropped the type-1 layer whole on
    the 8 stages that register it, so the Pharaohmon stairs (s375) and the Jungle
    Grave boardwalk (s480/s481) were blocked; and it merged the type-4 encounter
    layer into the walkable set of ~29 stages, leaving those maps wall-free.
    """

    def test_type1_stage_unions_its_registered_second_walk_layer(self):
        # s375 registers type 0 -> sub 1 and type 1 -> sub 4. Both are walk layers.
        self.assertEqual(walk_layer_subs("s375"), [1, 4])
        self.assertEqual(walk_layer_subs("s480"), [1, 3])
        # s376 registers type 0 -> sub 1, type 1 -> sub 2 (already inside {0,1,2}).
        self.assertEqual(walk_layer_subs("s376"), [1, 2])

    def test_the_eight_type1_stages_are_known(self):
        # enumerate through the registrar instead of hand rows
        import zone_registration as z
        type1 = set()
        for n in range(200, 1000):
            for _, typ, _id in z.registrations(str(n)):
                if typ == 1:
                    type1.add(n)
        self.assertEqual(type1, {261, 375, 376, 480, 481, 540, 934, 949})

    def test_encounter_and_trigger_stages_do_not_gain_a_walk_layer(self):
        # s953 registers type 4 -> sub 1 (encounter, full coverage) and type 0 ->
        # sub 2. Only sub 2 is walk.
        self.assertEqual(walk_layer_subs("s953"), [2])
        # s810 registers type 0 -> sub 1, type 4 -> sub 2.
        self.assertEqual(walk_layer_subs("s810"), [1])

    def test_registered_layers_resolve_to_the_registered_subs(self):
        layers = registered_layers("s480", 1536 // 128, 1408 // 128)
        self.assertEqual(len(layers), 2)  # type 0 sub 1 + type 1 sub 3
        self.assertEqual(layers[0], find_layer("s480", 1, 12, 11))
        self.assertEqual(layers[1], find_layer("s480", 3, 12, 11))

    def test_no_registration_returns_empty_for_fallback(self):
        # s260 registers no type-0 resource; walk_layer_subs must be empty so the
        # caller falls back rather than shipping an all-walkable grid.
        self.assertEqual(walk_layer_subs("s260"), [])


class TestTerrainSourcedFromType0Registration(unittest.TestCase):
    """The `terrain` key must come from the stage's REGISTERED type-0 TMPK sub.

    Guards the 2026-07-28 repoint: before it, `stage_collision` read a
    hardcoded sub 2 for every stage, which was the wrong layer for 266 of the
    292 registered stages. These also fail loudly if the zone_registration
    lookup ever silently degrades to "no terrain at all".
    """

    def _terrain_bins(self, coll):
        return [base64.b64decode(r) for r in coll["terrain"]]

    def test_repointed_stage_uses_its_registered_sub_not_sub_2(self):
        # s680 registers type 0 on sub 1; sub 2 also decodes as a valid
        # quadtree, so the old hardcode produced a plausible-looking but wrong
        # layer. The export must match sub 1 and differ from sub 2.
        gw, gh = 384 // 128, 256 // 128
        self.assertEqual(type0_id("680")[1], 1)
        coll = stage_collision("s680", 384, 256)
        self.assertIn("terrain", coll)
        self.assertEqual(self._terrain_bins(coll), find_layer("s680", 1, gw, gh))
        self.assertNotEqual(self._terrain_bins(coll), find_layer("s680", 2, gw, gh))

    def test_stage_registered_on_sub_2_still_uses_sub_2(self):
        # s235 genuinely registers type 0 on sub 2 -- the repoint must be a
        # no-op for it, not a blanket move off sub 2.
        gw, gh = 384 // 128, 384 // 128
        self.assertEqual(type0_id("235")[1], 2)
        coll = stage_collision("s235", 384, 384)
        self.assertEqual(self._terrain_bins(coll), find_layer("s235", 2, gw, gh))

    def test_stage_without_type0_registration_has_no_terrain_key(self):
        # s260 (and s415) never register a type-0 resource, so there is no
        # terrain layer to export -- omitted, not guessed at.
        self.assertIsNone(type0_id("260"))
        coll = stage_collision("s260", 512, 512)
        self.assertIsNotNone(coll)
        self.assertNotIn("terrain", coll)
        self.assertIsNone(type0_id("415"))


if __name__ == "__main__":
    unittest.main()
