"""Tests for tools/audit_anim_clip_coverage.py.
Run: python3 tools/test_audit_anim_clip_coverage.py
"""

import unittest

from audit_anim_clip_coverage import collect_clip_usage


class TestCollectClipUsage(unittest.TestCase):
    def test_groups_by_resolved_sprite_and_dedups_clip_ids(self):
        events_by_stage = {
            "s200": [
                {
                    "id": 50,
                    "disasm": [
                        "SETANIM 1 1 1",
                        "SETANIM 57 1 1",
                        "SETANIM 57 7 3",
                        "SETANIM 813 823 1",  # >=800 = effect/emote pseudo-actor, not a sprite
                    ],
                }
            ]
        }
        npc_sprites = {"57": "p076hanm"}
        usage = collect_clip_usage(events_by_stage, npc_sprites)
        self.assertEqual(usage["player"], {1})
        self.assertEqual(usage["p076hanm"], {1, 7})
        self.assertNotIn("actor_813", usage)  # effect ids excluded, not sprites

    def test_unresolved_npc_falls_back_to_actor_key(self):
        # actor id below the effect threshold (800) but with no npc_sprites entry.
        events_by_stage = {"s205": [{"id": 1, "disasm": ["SETANIM 300 3 0"]}]}
        usage = collect_clip_usage(events_by_stage, {})
        self.assertEqual(usage["actor_300"], {3})

    def test_actor_two_is_the_partner(self):
        events_by_stage = {"s200": [{"id": 1, "disasm": ["SETANIM 2 5 4"]}]}
        usage = collect_clip_usage(events_by_stage, {})
        self.assertEqual(usage["partner"], {5})


if __name__ == "__main__":
    unittest.main()
