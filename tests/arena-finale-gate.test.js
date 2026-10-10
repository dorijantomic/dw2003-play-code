// The Digimon Arena World Champ finale's GATE, pinned to the extracted data.
//
// Decode: docs/research/systems/arena-finale-gate-2026-10-06.md. The finale is
// gated on the VIRTUAL flag 0x7054 (all four endgame tamer challenges taken),
// NOT on 0x100c. 0x100c is the arm flag the finale writes itself, and it selects
// the challenge row (event 1608) vs the victory row (event 1610) on the floor and
// the receptionist's post-finale line. Every value here comes from the disc
// (pro/wstag926.s 0x37c-0x3a0 and 0x61c; pro/wstag927.s 0x218-0x2c0, 0x338, 0x410,
// 0x438, 0x6ec) via the committed extractors, so a later session cannot quietly
// move the gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const launch = read("web/assets/data/talk_launch_bindings.json");
const roster = read("web/assets/data/roster_predicate_table.json");
const arrival = read("web/assets/data/scene/arrival_candidates.json");
const steps = read("web/assets/data/story_steps.json");
const s927 = read("web/assets/scenes/s927.json");
const s926 = read("web/assets/scenes/s926.json");
const casts = read("web/assets/data/stage_cast_lists.json");

const F_7054 = 28756; // 0x7054, virtual
const F_100C = 4108; // 0x100c, the finale's own arm flag
const ENDGAME_BITS = [4109, 4110, 4111, 4112]; // 0x100d, 0x100e, 0x100f, 0x1010

test("s926's receptionist (npc 32) launches event 1606 only in dialogue state 1, gated on 0x7054 == 1 and 0x100c == 0", () => {
    const sites = launch.stages.s926 ?? [];
    assert.equal(sites.length, 1, "s926 ships exactly one talk-launch site");
    const site = sites[0];
    assert.equal(site.npc, 32, "the Arena Reception");
    assert.equal(site.state, 1, "the state whose gate is 0x7054 == 1");
    assert.equal(site.event, 1606, "the scene that ends in HANDOFF 632");
    assert.deepEqual(
        site.gate,
        [{ id: F_7054, expected: 1 }, { id: F_100C, expected: 0 }],
        "gate = four challenges taken AND finale not yet armed",
    );
});

test("0x7054 is virtual: true iff the four endgame bits 0x100d..0x1010 are all set", () => {
    const rec = roster.records.find((r) => r.flag_id === F_7054);
    assert.ok(rec, "0x7054 has a bank-0x70 predicate record");
    assert.deepEqual(
        rec.semantics,
        { kind: "stored_bits_all_set", effect: "read", bank: 16, flag_ids: ENDGAME_BITS },
        "0x7054 = stored_bits_all_set over 0x100d/0x100e/0x100f/0x1010",
    );
});

test("s927's arrival gate picks event 1608 when 0x100c == 0 and event 1610 when 0x100c == 1, in that order", () => {
    const ch = arrival.stages.s927;
    assert.ok(ch, "s927 has an arrival chain");
    const cs = ch.candidates;
    assert.equal(cs[0].event, 1608, "first candidate = the Kurt challenge");
    assert.deepEqual(cs[0].paths[0], [[F_100C, 0]], "challenge runs while 0x100c is clear");
    assert.equal(cs[1].event, 1610, "second candidate = the victory line");
    assert.deepEqual(cs[1].paths[0], [[F_100C, 1]], "victory runs after the finale armed 0x100c");
});

test("event 1608's completion writes 0x100c = 1 and fires the bank-0x74 launcher (0x7400)", () => {
    const ev = steps.stages["927"].events.find((e) => e.event_id === 1608);
    assert.ok(ev, "s927 ships event 1608");
    const set = new Map(ev.sets.map(([id, v]) => [id, v]));
    assert.equal(set.get(F_100C), 1, "the challenge arms 0x100c");
    assert.equal(set.get(0x7400), 1, "and fires the scripted-battle launcher (record 0)");
});

test("s927 ships one cutscene-positioned actor (Kurt at 0,0) and no static exits — the disc's own records", () => {
    assert.equal(s927.npcs.length, 1, "one cast record");
    const kurt = s927.npcs[0];
    assert.equal(kurt.npc_id, 104);
    assert.equal(kurt.x, 0);
    assert.equal(kurt.y, 0);
    assert.equal(kurt.cutsceneOnly, true, "positioned by the scene's SETPOS, not at stage load");
    assert.deepEqual(s927.exits, [], "no static warp — the exit is the victory HANDOFF");
    // the raw extractor agrees, one level down
    assert.equal(casts.s927.length, 1);
    assert.equal(casts.s927[0].id, 104);
});

test("s926 ships the front desk: the receptionist's three states and the s923 exit", () => {
    const npc32 = s926.npcs.find((n) => n.npc_id === 32);
    assert.ok(npc32, "Arena Reception present");
    const states = npc32.dialogue_states.map((s) => s.gate);
    assert.deepEqual(states, [
        [{ id: F_7054, expected: 0 }],
        [{ id: F_7054, expected: 1 }, { id: F_100C, expected: 0 }],
        [{ id: F_7054, expected: 1 }, { id: F_100C, expected: 1 }],
    ]);
    assert.ok(s926.exits.length >= 1, "the desk has its exit");
    assert.ok(steps.stages["926"].events.some((e) => e.event_id === 1606), "s926's event table holds 1606");
});
