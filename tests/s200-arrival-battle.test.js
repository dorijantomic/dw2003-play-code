// Why a fight is already up the moment the ordinary opening reaches s200.
//
// The 2026-10-06 end-to-end walk reported `__battle.isActive() === true` on
// arrival at s200, with the explanation "the s210->s200 leg is a walk with
// encounters live, and the counter expired on the way". That explanation is
// wrong, and a divergence hunt on 2026-10-06 settled the cause: the fight is the
// DISC's own scripted arrival battle, not a random-encounter roll.
//
//   * s200's stage-entry dispatcher auto-starts event 0x32 the moment the map is
//     entered while the master story ordinal [0x8004b370] reads 3 and flag 0x400d
//     (16397) is clear — pro/wstag200.s file 0x38-0x70:
//         lw  $v1, -0x4c90(lui 0x8005)   # [0x8004b370] = the story ordinal
//         li  $v0, 0x3 ; bne $v1, $v0, skip
//         ... get_flag(0x400d, 0) ...    # -> event 0x34 if set, else 0x32
//         jal 0x800853f8                 # start_event($a0)
//     (the gate is `web/assets/data/auto_event_gates.json` s200 entry 50/52;
//     0x6003 = the extractor's ordinal==3 virtual bank).
//   * event 0x32's on_complete — wstag200.s file 0xf8-0x130 — sets flags 0x400d=1
//     and fires the bank-0x74 scripted-battle launcher `0x7401`. Bank 0x74 is not
//     a flag array: the write starts the stage's scripted encounter block record
//     of that index (docs/research/scripting/bank74-scripted-battle-launcher.md).
//   * s200's scripted block is its fourth zone block, `[188, 200, 272]`, so record
//     1 is screen 200 = Genji's Kuwagamon. `web/assets/engine-content.json` models
//     the launcher as the OnEnterMap row `s200.sb.battle` -> StartBattle(200, 4608).
//
// The random-encounter machinery cannot produce this fight: every stage on the
// ordinary opening route registers no type-4 zone map (or ships only rate-level-0
// blocks), so the field's roll gate (`encounterRateLevel > 0`) is closed for the
// whole leg, and the step counter never drains. These tests lock both halves
// against the SHIPPED generated tables, so a future change that drops the s200
// scripted battle, or that lets the walker roll on the opening route, fails here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zoneAt, zoneRateLevel, stageZoneBlocks, scriptedScreenId } from "../engine/index.ts";

const STAGE_ENC = JSON.parse(readFileSync("web/assets/data/stage_encounters.json", "utf8"));
const ZONE_GRIDS = JSON.parse(readFileSync("web/assets/data/zone_grids.json", "utf8"));
const AUTO_GATES = JSON.parse(readFileSync("web/assets/data/auto_event_gates.json", "utf8"));
const EVENTS = JSON.parse(readFileSync("content/events/s200.json", "utf8"));
const ENGINE_CONTENT = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));

const s200Events = ENGINE_CONTENT.stages.find((s) => s.mapId === "s200");

test("s200's stage-entry chain arms the scripted battle: event 50 (OnEnterMap) then StartBattle(200)", () => {
    assert.ok(s200Events, "engine-content ships an s200 stage entry");

    // The arming events are the stage-entry dispatcher's own auto events, gated on
    // the story ordinal (0x6003 = ordinal==3) and flag 0x400d.
    const gates = AUTO_GATES.s200;
    assert.deepEqual(gates["50"], { conds: [[24579, 1], [16397, 0]] });
    assert.deepEqual(gates["52"], { conds: [[24579, 1], [16397, 1]] });
    assert.equal(24579, 0x6000 | 3, "24579 is the extractor's ordinal==3 virtual bank");

    const ev = (id) => EVENTS.find((e) => e.id === id);
    assert.equal(ev("s200.auto.50").on, "OnEnterMap");
    assert.equal(ev("s200.auto.50").arrivalChain, true);
    assert.equal(ev("s200.sb.battle").on, "OnEnterMap");

    // The battle row: run once the arming event has set 0x400d (16397) and the win
    // flag 0x1200 (4608) is still clear — exactly `bank-0x74 launcher`, i.e. the
    // disc's own scripted fight, fired from the arrival chain.
    assert.deepEqual(
        ev("s200.sb.battle").if,
        { kind: "all", children: [
            { kind: "leaf", leaf: "flag", args: [16397, 1] },
            { kind: "leaf", leaf: "flag", args: [4608, 0] },
        ] },
    );
    const script = s200Events.scripts.find((s) => s.id === "s200.sb.battle.script");
    assert.deepEqual(script.program, [
        { op: "StartBattle", args: [{ t: "INT", v: 200 }, { t: "FLAGID", v: 4608 }] },
    ]);
});

test("screen 200 is s200's scripted block record 1 — Genji's Kuwagamon", () => {
    const stage = STAGE_ENC.stages["200"];
    assert.ok(stage, "s200 ships encounter blocks");
    // The fourth block is the scripted one (rate level 0 = never rolled by the driver).
    assert.deepEqual(stage.zones[3].slots.slice(0, 3), [188, 200, 272]);
    // scriptedScreenId(stage, index, ordinal): the bank-0x74 launcher reads record
    // `index` of the scripted block directly, never through rand()&7.
    assert.equal(scriptedScreenId(stage, 1, 3), 200);
});

test("the whole ordinary opening route rolls no random encounter (field gate closed)", () => {
    // s780/s785/s790 (the intro), s225/s210/s212 (the handoff) and s200 (the field).
    const route = ["s780", "s785", "s790", "s225", "s210", "s212", "s200"];
    for (const mapId of route) {
        const key = mapId.replace(/^s/, "");
        const stage = STAGE_ENC.stages[key];
        const level = stage
            ? zoneRateLevel(stage.zones, zoneAt(ZONE_GRIDS.stages?.[key], 730, 382),
                            stageZoneBlocks(stage, 3))
            : 0;
        assert.equal(level, 0,
            `${mapId} must have no live encounter rate (the field rolls only when level > 0)`);
    }
    // s200's own table: every one of its four blocks is the level-0 sentinel.
    assert.deepEqual(STAGE_ENC.stages["200"].zones.map((z) => z.rate_level), [0, 0, 0, 0]);
    assert.deepEqual(STAGE_ENC.stages["210"].zones.map((z) => z.rate_level), [0, 0, 0, 0]);
});
