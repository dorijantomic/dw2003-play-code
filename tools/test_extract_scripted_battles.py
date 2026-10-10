"""Tests for extract_scripted_battles — the s200 keystone must reproduce exactly."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_scripted_battles as E
import wstag_events as W


def test_setflag_decode_s200_oncomplete():
    """s200 event 0x32 on_complete (file 0xf8) sets 0x400d=1 and 0x7401=1."""
    data = W.overlay_bytes("200")
    calls = E.decode_setflags(data, 0xF8)
    assert calls == [{"id": 0x400D, "val": 1}, {"id": 0x7401, "val": 1}], calls


def test_setflag_decode_ignores_direct_store():
    """s200 event 0x34 on_complete (file 0x144) writes 0x8004b370 directly, not via
    the flag API, so it must yield NO set_flag calls."""
    data = W.overlay_bytes("200")
    assert E.decode_setflags(data, 0x144) == []


def test_s200_battle_candidate_matches_hand_authored():
    """The auto-extracted candidate reproduces SCRIPTED_BATTLES['s200'] (minus the
    native-bound screenId and synthetic wonFlag)."""
    W._SCREEN_TABLE = W._load_screen_table()
    r = E.extract_stage("200")
    assert r is not None
    cands = r["battle_candidates"]
    assert len(cands) == 1, [c["preFlagKey"] for c in cands]
    c = cands[0]
    assert c["actor"] == 57            # Genji
    assert c["armFlag"] == 0x400D
    assert c["preFlagKey"] == "0112000b"   # esdmg200 entry 11 (the challenge)
    assert c["postFlagKey"] == "0112000c"  # esdmg200 entry 12 (closing -> handoff)
    assert c["handoff_to"] == "s220"
    assert c["trigger"] == "npc"
    assert 200 in c["screenId_pool"]   # the scripted screen IS in the random pool
    # s200 pool has 3 distinct enemies -> the NAME heuristic must DECLINE (no enemy hint).
    # screenId is no longer None here: the bank-0x74 launcher resolves it (see
    # test_bank74_launcher_reproduces_the_live_verified_s200_screen).
    assert c["screenId_ambiguous"] is True
    assert c["enemyHint"] is None


def test_player_triggered_battle_detected_with_enemy_hint():
    """A player-monologue-triggered battle (no NPC speaker) is still detected when it
    arms a 0x4xxx flag, and the uniform-pool heuristic hints the enemy. s415 = Bulbmon."""
    W._SCREEN_TABLE = W._load_screen_table()
    r = E.extract_stage("415")
    assert r is not None
    player_cands = [c for c in r["battle_candidates"] if c["trigger"] == "player"]
    assert player_cands, "expected a player-triggered candidate in s415"
    c = player_cands[0]
    assert c["actor"] is None
    assert c["enemyHint"] == "Bulbmon"      # s415 pool is uniformly Bulbmon
    # screenId is still never asserted from the HEURISTIC; it is read from the bank-0x74
    # launcher the ride's hook fires. Independently corroborated: the arm flag 0x4018 and
    # the Bulbmon boss on screen 323 are both in the s415 crevice-ride decode.
    assert (c["armFlag"], c["launchFlag"], c["screenId"]) == (0x4018, 0x7400, 323)
    assert c["screenIdResolution"] == "bank74-launcher:0x7400 slot 0"


def test_resolve_screen_by_name_picks_unique_pool_match():
    """A boss named in dialogue ("MasterTyranno", -mon truncated) resolves to the one
    pool screen whose lead enemy matches. s405 pool [50,51,52,2,310]; only screen 2 is
    MasterTyrannomon."""
    W._SCREEN_TABLE = W._load_screen_table()
    assert E._resolve_screen_by_name([50, 51, 52, 2, 310], ["MasterTyranno"]) == 2


def test_resolve_screen_by_name_declines_on_no_or_multi_match():
    """No pool lead matches -> None (never guess). Genji's challenger name is not an
    enemy in the pool, so s200-style stays unresolved."""
    W._SCREEN_TABLE = W._load_screen_table()
    assert E._resolve_screen_by_name([50, 51, 52, 2, 310], ["Genji"]) is None
    assert E._resolve_screen_by_name([50, 51, 52, 2, 310], []) is None


def test_s405_mastertyranno_pairs_and_resolves():
    """The reported bug: s405 plays PRE (event 60 "challenger") then jumps to POST
    (event 61) with no fight. Events 60/61 end in END (no HANDOFF), so the old pairing
    left them as two unpaired PRE-only stubs. They must pair into ONE battle (actor 90,
    pre entry 0 -> post entry 1) and resolve screenId 2 (MasterTyrannomon) by name."""
    W._SCREEN_TABLE = W._load_screen_table()
    r = E.extract_stage("405")
    assert r is not None
    cands = r["battle_candidates"]
    assert len(cands) == 1, [(c["preFlagKey"], c["postFlagKey"]) for c in cands]
    c = cands[0]
    assert c["actor"] == 90
    assert c["preFlagKey"] == "01350000"    # esdmg400 entry 0 (challenge)
    assert c["postFlagKey"] == "01350001"   # esdmg400 entry 1 (reward)
    assert c["armFlag"] == 0x400F           # PRE on_complete sets 16399
    assert c["screenId"] == 2               # MasterTyrannomon, resolved by name


def test_native_overlay_has_no_candidate():
    """s465 ("Tranquil Swamp") is a NATIVE overlay with no bytecode event table, so it
    yields no candidate. (It is NOT the gondola — that's s415; the original note
    mis-mapped it. s465 is here only as a native-overlay no-candidate check.)"""
    assert E.extract_stage("465") is None


# ---------------------------------------------------------------------------
# bank-0x74 launcher (ARENA-C011): set_flag(0x74NN) starts the CURRENT stage's
# rate-0 scripted encounter record NN. This is what actually invokes the fight,
# so it also RESOLVES screenId, which the pool/name heuristics could only guess.
# ---------------------------------------------------------------------------

def test_scripted_block_is_the_rate0_block():
    """The scripted block is descriptor +0x18 = the 4th zone of the stage's selector
    group, and it carries rate_level 0 (never selectable by the roaming driver).
    s233 = the Amaterasu arena ladder (ARENA-C012)."""
    assert E._scripted_block("233") == [258, 259, 260, 261, 262, 0, 0, 0]
    assert E._scripted_block("232") == [253, 254, 255, 256, 257, 0, 0, 0]


def test_bank74_launcher_reproduces_the_live_verified_s200_screen():
    """The keystone. s200's PRE on_complete fires set_flag(0x7401) -> slot 1 of
    [188, 200, 272] -> screen 200 = Kuwagamon, which is the hand-authored,
    live-verified SCRIPTED_BATTLES['s200'].screenId. The decode agrees with the one
    battle that was confirmed against the running game."""
    W._SCREEN_TABLE = W._load_screen_table()
    c = E.extract_stage("200")["battle_candidates"][0]
    assert c["launchFlag"] == 0x7401
    assert c["launchSlot"] == 1
    assert c["screenId"] == 200
    assert c["screenIdResolution"] == "bank74-launcher:0x7401 slot 1"


def test_arena_finale_is_a_candidate_despite_a_non_0x4xxx_arm_flag():
    """ARENA-C010/C011: the Kurt finale on s927 arms 0x100c, not a 0x4xxx flag, so the
    old arm-flag rule produced NO candidate and the fight was never wired — the player
    got the challenge and the victory line with nothing in between. The bank-0x74
    launcher is the battle signal: 0x7400 -> slot 0 -> screen 262."""
    W._SCREEN_TABLE = W._load_screen_table()
    r = E.extract_stage("927")
    cands = r["battle_candidates"]
    assert len(cands) == 1, [(c["preFlagKey"], c["postFlagKey"]) for c in cands]
    c = cands[0]
    assert c["actor"] == 104               # Kurt
    assert c["armFlag"] == 0x100C
    assert c["launchFlag"] == 0x7400
    assert c["screenId"] == 262
    assert c["preFlagKey"] == "01580004"   # the pre-fight exchange
    assert c["postFlagKey"] == "01580005"  # "I did it! I beat Kurt!"


def test_no_hook_in_the_catalog_fires_two_launchers():
    """The linear hook decoder does not follow branches, so two launcher writes in one
    hook could be the arms of a conditional and _launcher declines rather than guess.
    This pins that the guard is not silently swallowing shipped battles: over the whole
    extracted catalog, no event hook writes bank 0x74 twice."""
    import json
    cat = json.loads(Path("web/assets/data/scripted_battles.json").read_text())
    multi = [(st, ev["flag_key"])
             for st, entry in cat.items() for ev in entry["events"]
             if len([c for c in ev.get("on_complete_setflags", [])
                     if c["id"] and (c["id"] >> 8) & 0xFE == 0x74]) > 1]
    assert multi == [], multi


def test_two_battles_on_one_stage_get_the_slot_each_one_launches():
    """s310/s311 each host TWO challengers whose scripted block holds TWO screens. The
    launcher slot separates them: the second challenger fires 0x7400 (slot 0) and the
    first fires 0x7401 (slot 1). A pool-order or name guess cannot tell them apart."""
    W._SCREEN_TABLE = W._load_screen_table()
    for stage, by_actor in (("310", {109: 191, 108: 10}), ("311", {212: 198, 258: 32})):
        got = {c["actor"]: c["screenId"] for c in E.extract_stage(stage)["battle_candidates"]}
        assert got == by_actor, (stage, got)


if __name__ == "__main__":
    for name, fn in sorted(list(globals().items())):
        if name.startswith("test_") and callable(fn):
            fn()
    print("ok")
