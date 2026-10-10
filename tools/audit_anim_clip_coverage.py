"""Measures the SETANIM clip-id gap: how many distinct animation clip ids the original
cutscene data uses per sprite, none of which the walker currently renders distinctly (see
engine/systems/animation-controller.ts — every sprite only ever shows idle-frame-0 or its
walk cycle, regardless of SETANIM's clip argument). This turns "the clip directory is
undecoded" (docs/research/field/field-actor-anim-engine.md) into a measured checklist for
the docs/todo/2026-07-01-sprite-clip-directory-fieldstg-elf.md follow-up.

Run: python3 tools/audit_anim_clip_coverage.py
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
EVENTS_JSON = ROOT / "web/assets/events/wstag_events.json"
NPC_SPRITES_JSON = ROOT / "web/assets/npc_sprites.json"

EFFECT_ID_THRESHOLD = 800  # actor ids >= this are effect/emote pseudo-actors, not real sprites
_SETANIM_RE = re.compile(r"^SETANIM (\d+) (\d+) (\d+)$")


def _resolve_sprite_key(actor_id: int, npc_sprites: dict) -> str | None:
    if actor_id >= EFFECT_ID_THRESHOLD:
        return None
    if actor_id == 1:
        return "player"
    if actor_id == 2:
        return "partner"
    sprite = npc_sprites.get(str(actor_id))
    return sprite if sprite else f"actor_{actor_id}"


def collect_clip_usage(events_by_stage: dict, npc_sprites: dict) -> dict[str, set[int]]:
    usage: dict[str, set[int]] = {}
    for events in events_by_stage.values():
        for event in events:
            for line in event.get("disasm", []):
                m = _SETANIM_RE.match(line)
                if not m:
                    continue
                actor_id, clip_id, _facing = (int(g) for g in m.groups())
                key = _resolve_sprite_key(actor_id, npc_sprites)
                if key is None:
                    continue
                usage.setdefault(key, set()).add(clip_id)
    return usage


def main():
    events_by_stage = json.loads(EVENTS_JSON.read_text())
    npc_sprites = json.loads(NPC_SPRITES_JSON.read_text()) if NPC_SPRITES_JSON.exists() else {}
    usage = collect_clip_usage(events_by_stage, npc_sprites)

    serializable = {k: sorted(v) for k, v in sorted(usage.items())}
    print(json.dumps(serializable, indent=2))

    total_clips = sum(len(v) for v in usage.values())
    print(
        f"# {len(usage)} sprites use {total_clips} total distinct SETANIM clip ids; "
        "0 are currently rendered distinctly (walker only distinguishes idle vs. walk-cycle "
        "by movement state, not clip id — see docs/todo/2026-07-01-sprite-clip-directory-fieldstg-elf.md)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
