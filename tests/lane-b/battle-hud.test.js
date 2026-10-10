// Lane B oracle: engine/dw3/ui/native/battle-hud.ts must match the original
// pro/fightstg in-battle HP plate — the plate pictures, the party status markers,
// the HP bar fill quad, the two HP number widgets, the two name elements, the
// slash between the numbers and the DV/Blast gauge.
//
// The original FIGHTSTG_F0x800934f0 runs through engine/native and its build arm
// FIGHTSTG_F0x80093a74 runs in mode 0; the pack resolver, the text-widget
// constructor, the draw-context methods, the text-bank service, the roster-slot
// accessor, the enemy-id resolver and the gouraud-quad service are stubbed on both
// sides so the ordered calls, the fill quad and the widget fields can be compared.
//
// Colours are quoted as the original stores them: the PS1 is little-endian and a
// vertex colour runs R, G, B from the lowest address up. The extracted overlay in
// web/assets/native/screens/pro_fightstg.bin is word-swapped for the interpreter,
// so the reference copy in this test loads the swapped bytes on purpose and the
// port reads the documented constants.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    BATTLE_HUD_ACTIVE_SLOT, BATTLE_HUD_BANK_ENEMY_NAME, BATTLE_HUD_BANK_SEPARATOR,
    BATTLE_HUD_DRAW, BATTLE_HUD_DV_FILL_CEL_FILLING,
    BATTLE_HUD_DV_FILL_CEL_FULL, BATTLE_HUD_DV_FRAME_CEL_INNER, BATTLE_HUD_DV_FRAME_CEL_OUTER,
    BATTLE_HUD_DV_FRAME_X, BATTLE_HUD_DV_FRAME_Y, BATTLE_HUD_DV_FULL, BATTLE_HUD_DV_GAUGE_TABLE,
    BATTLE_HUD_DV_QUAD, BATTLE_HUD_DV_QUAD_HALFWORDS, BATTLE_HUD_DV_X, BATTLE_HUD_DV_Y,
    BATTLE_HUD_ENEMY_ID_OFFSET, BATTLE_HUD_ENEMY_ID_STRIDE, BATTLE_HUD_ENEMY_ID_TABLE,
    BATTLE_HUD_ENEMY_NAME_ID, BATTLE_HUD_GRADIENT_HEALTHY,
    BATTLE_HUD_GRADIENT_LOW, BATTLE_HUD_GRADIENT_WORDS, BATTLE_HUD_HP_EDGE_OFFSET,
    BATTLE_HUD_HP_MOVING_OFFSET, BATTLE_HUD_HP_QUAD_ENEMY,
    BATTLE_HUD_HP_QUAD_ENEMY_HALFWORDS, BATTLE_HUD_HP_QUAD_PLAYER,
    BATTLE_HUD_HP_QUAD_PLAYER_HALFWORDS, BATTLE_HUD_LAYER, BATTLE_HUD_NAME_ENEMY,
    BATTLE_HUD_NAME_GATE_ENEMY, BATTLE_HUD_NAME_GATE_PLAYER, BATTLE_HUD_NAME_PLAYER,
    BATTLE_HUD_NUMBER_MAX,
    BATTLE_HUD_NUMBER_SHOWN, BATTLE_HUD_PACK, BATTLE_HUD_PLATE_POSITIONS, BATTLE_HUD_PIP_X,
    BATTLE_HUD_PIP_Y, BATTLE_HUD_POLY_G4,
    BATTLE_HUD_POLY_G4_SEMI, BATTLE_HUD_POLY_WORDS, BATTLE_HUD_RECORDS,
    BATTLE_HUD_ROSTER, BATTLE_HUD_ROSTER_STRIDE, BATTLE_HUD_SEPARATOR,
    BATTLE_HUD_SEPARATOR_INDEX, BATTLE_HUD_SEPARATOR_KIND, BATTLE_HUD_SET_STRING,
    BATTLE_HUD_SIDE_MODE, BATTLE_HUD_SLOT_NAME_ENEMY, BATTLE_HUD_SLOT_NAME_PLAYER,
    BATTLE_HUD_SLOT_SEPARATOR, BATTLE_HUD_STRING_BASE, BATTLE_HUD_VERTEX_COLOUR_OFFSETS,
    battleHudBarVertexRgb,
    battleHudBarVertexWords, battleHudBuildNames, battleHudBuildSeparator,
    battleHudDrawPlateFrames, battleHudDrawPartyPips,
    battleHudDvFillCel, battleHudDvGauge, battleHudDvLeftEdge, battleHudDvPhase,
    battleHudDvQuadHalwords, battleHudDvShowsBacking, battleHudGradientRgb,
    battleHudGradientWord, battleHudHpBar, battleHudHpBarFill, battleHudHpBarLength,
    battleHudHpBarRamp, battleHudHpGradient, battleHudHpNumberRows,
} from "../../engine/dw3/ui/native/battle-hud.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// Resource 0x1cf, the enemy stat table the plate's name line is read out of, as the
// build extracts it (tools/build_translated_screen_data.py -> battlecmd/enemy_stats.json).
// The three-species check below runs the original against the disc's own records, so the
// name line on the plate is the one the record carries rather than a number the test
// invented.
const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data");
const enemyStatTable = JSON.parse(readFileSync(join(dataDir, "battlecmd/enemy_stats.json"), "utf8"));
/** Three records with three different ids and three different name lines. */
const PLATE_SPECIES = [0, 7, 191].map((i) => {
    const row = enemyStatTable.records[i];
    return { index: i, id: row.id, nameId: row.nameId, raw: Buffer.from(row.raw, "hex") };
});

const HUD = 0x80150000;      // the object at $sp[0xe8] whose +0x60 is the eased HP
const ARGSLOT = 0x80151000;  // the widget block at $s2
const WIDGET_BASE = 0x80180000;
const PACK_PTR = 0x80191000;
const SLOT_BASE = 0x0fdd1000;
/** Where [0x800a37fc] is told to point: the enemy stat record whose +0x06 is the name. */
const ENEMY_STATS = 0x80140000;
/** .L0x8009b8a8 `addiu $v1, 0x46`: the stat table's own record stride. */
const ENEMY_STATS_STRIDE = 0x46;
/** Where [0x80044f4c] is told to point: the text-bank service. */
const TEXT_STUB = 0x0fdd0014;
/** Where [0x800a37fc] is told to point: the enemy-id resolver. */
const ENEMY_STATS_STUB = 0x0fdd001c;
/** The base the text-bank service returns, so the two sides can compare it. */
const BANK_BASE = 0x801e0000;
/** The word at 0x8005cca8: the language base every bank id is added to. */
const LANGUAGE = 2;

const HUD_BUILD = 0x80093a74;         // FIGHTSTG_F0x80093a74, the HUD's own tick
const NAME_FN = 0x80093364;           // FIGHTSTG_F0x80093364, the name-widget builder
const CREATE_FN = 0x8001ae38;         // the text-element constructor
const QUAD_FN = 0x8009e950;           // F0x8009e950 -> F0x8009e77c, the gouraud-quad service
const PACK_PTR_CELL = 0x80044f5c;
const PHASE_PTR = 0x8004df98;
const GAUGE_PTR = 0x8004b44c;
const GAUGE_TABLE = 0x80042b1c;
const QUAD_PTR_CELL = 0x800a4460 + 0xf0; // [0x800a4550], the quad service slot
const TEXT_PTR_CELL = 0x80044f4c;     // [0x80044f4c], the text-bank service pointer
const ENEMY_STATS_CELL = 0x800a37fc;  // [0x800a37fc], the enemy-id resolver pointer

const PACK_STUB = 0x0fdd0004;
const QUAD_STUB = 0x0fdd0008;
const PHASE_STUB = 0x0fdd000c;
const GAUGE_STUB = 0x0fdd0010;
const SLOT_ARITY = { 0x114: 2, 0x118: 2, 0x148: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
/** [0x8004df98]()'s value: the tick the gauge's four-phase cycle reads. */
let PHASE_TICK = 0;
/** [0x8004b44c]()'s value: the roster slot the active party member lives in. */
let ROSTER_SLOT = 0;

/**
 * `[0x800a37fc](id)` — FIGHTSTG_F0x8009b8d0, which is F0x8009b864's scan
 * (`.L0x8009b888`-`.L0x8009b8b8`: `addiu $v1, 0x46`, stop at the first record whose id
 * halfword is zero) turned into a pointer, and which hands back **0** when the id is not
 * in the table because its `bltz $v1` delay slot is `move_ $v0, $zr`. That zero is what
 * makes the name builder's `beqz $s0` (`.L0x80093470`) leave an enemy's element empty.
 *
 * Both sides go through this one function, so the scan is the original's own rule and not
 * a per-case lookup table.
 */
function resolveEnemyStats(rt, id) {
    for (let i = 0; i < 512; i++) {
        const record = ENEMY_STATS + i * ENEMY_STATS_STRIDE;
        const word = (rt.mem.read16(record) << 16) >> 16;   // `lh`
        if (word === 0) return 0;
        if (word === (id | 0)) return record;
    }
    throw new Error(`enemy stat scan did not terminate for id ${id}`);
}

/**
 * A widget address keyed by (kind, x, y) rather than by allocation order, so the
 * name elements FIGHTSTG_F0x80093364 builds are the same address on both sides and
 * cannot shift the HP number elements the two compare.
 */
function widgetFor(kind, x, y) {
    return WIDGET_BASE + ((kind + x * 3 + y) % 16) * 0x100;
}

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(QUAD_STUB, (c) => {
        const quad = c.reg(6) >>> 0;
        const block = c.reg(7) >>> 0;
        LOG.push(["quad", quad,
            Array.from({ length: 8 }, (_, i) => rt.mem.read16(quad + i * 2) | 0),
            // The four words F0x8009e77c copied into its 16-byte block, in the order
            // they sit there: $sp+0xb0, +0xb4, +0xb8, +0xbc.
            Array.from({ length: 4 }, (_, i) => rt.mem.read32(block + i * 4) >>> 0)]);
        return 0;
    });
    rt.cpu.setStub(PHASE_STUB, () => { LOG.push(["phase"]); return PHASE_TICK; });
    rt.cpu.setStub(GAUGE_STUB, () => { LOG.push(["gauge"]); return ROSTER_SLOT; });
    // [0x80044f4c] takes one argument — the word at 0x8005cca8 plus the bank id — and
    // returns that family's base. Both sides compute BANK_BASE + id so the `+0x114`
    // arguments compare as addresses.
    rt.cpu.setStub(TEXT_STUB, (c) => { LOG.push(["bank", c.reg(4) | 0]); return BANK_BASE + c.reg(4); });
    rt.cpu.setStub(ENEMY_STATS_STUB, (c) => {
        LOG.push(["enemyStats", c.reg(4) | 0]);
        return resolveEnemyStats(rt, c.reg(4) | 0);
    });
    rt.cpu.setStub(CREATE_FN, (c) => {
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = widgetFor(c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0);
        for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        return widget;
    });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    // The draw-context methods F0x8001f648 installs at ctx+0x74/+0x7c/+0x84.
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ecec, (c) => { LOG.push(["palette", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => {
        LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        return 0;
    });
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(PHASE_PTR, PHASE_STUB);
    rt.mem.write32(GAUGE_PTR, GAUGE_STUB);
    rt.mem.write32(QUAD_PTR_CELL, QUAD_STUB);
    rt.mem.write32(TEXT_PTR_CELL, TEXT_STUB);
    rt.mem.write32(ENEMY_STATS_CELL, ENEMY_STATS_STUB);
    return rt;
}

/** `seed` writes the fight state the original reads; `none` skips the world's preset. */
function seedWorld(rt, seed) {
    if (!seed) return;
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(ARGSLOT + i, 0);
    rt.mem.write32(BATTLE_HUD_ACTIVE_SLOT, seed.active ?? 0);
    rt.mem.write16(BATTLE_HUD_SIDE_MODE, seed.mode ?? 0);
    for (let side = 0; side < 2; side++) {
        for (let i = 0; i < 3; i++) {
            const rec = BATTLE_HUD_RECORDS + side * 0x60 + i * 0x20;
            const m = seed.members?.[side]?.[i];
            for (let o = 0; o < 0x20; o += 4) rt.mem.write32(rec + o, 0);
            if (!m) continue;
            rt.mem.write16(rec + 0x00, m.present ?? 1);
            rt.mem.write16(rec + 0x06, m.maxHp ?? 100);
            rt.mem.write16(rec + 0x08, m.hp ?? 100);
            rt.mem.write8(rec + 0x1c, m.ailment ?? 0);
        }
    }
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(HUD + i, 0);
    rt.mem.write32(HUD + 0x60, seed.shown ?? 100);
    rt.mem.write32(HUD + 0x14 + 0x60, seed.enemyShown ?? seed.shown ?? 100);
    // The two fill quads are overlay data the routine edits in place: 0x800a3470 is
    // 175..303 and 0x800a3480 is 143..15, both six rows tall, four vertices in GPU
    // order exactly as the overlay ships them.
    for (const [base, half] of [
        [BATTLE_HUD_HP_QUAD_PLAYER, BATTLE_HUD_HP_QUAD_PLAYER_HALFWORDS],
        [BATTLE_HUD_HP_QUAD_ENEMY, BATTLE_HUD_HP_QUAD_ENEMY_HALFWORDS],
    ]) {
        half.forEach((v, i) => rt.mem.write16(base + i * 2, v));
    }
    rt.mem.write16(GAUGE_TABLE + 0x58, seed.gauge ?? 0);
    // The gauge's black trough is overlay data the routine edits in place: four
    // vertices in GPU order, (265,62) (305,62) (265,70) (305,70).
    BATTLE_HUD_DV_QUAD_HALFWORDS.forEach((v, i) => rt.mem.write16(BATTLE_HUD_DV_QUAD + i * 2, v));
    // The name builder's three inputs: the word at 0x8005cca8 (the language base the
    // bank ids are added to), the active enemy's id out of the battle descriptor, and
    // the name id inside the stat record [0x800a37fc] returns.
    rt.mem.write32(BATTLE_HUD_STRING_BASE, seed.language ?? LANGUAGE);
    rt.mem.write32(BATTLE_HUD_ACTIVE_SLOT + 4, seed.enemyActive ?? 0);
    for (let i = 0; i < 3; i++) {
        rt.mem.write32(BATTLE_HUD_ENEMY_ID_TABLE + BATTLE_HUD_ENEMY_ID_OFFSET + i * BATTLE_HUD_ENEMY_ID_STRIDE,
            (seed.enemyIds ?? [])[i] ?? 0);
    }
    // The resolver's table: 0x46-stride records, the first halfword each the id. `stats`
    // puts the disc's own records in (each carrying its real +0x06 name line); without
    // it the single synthetic record the rest of this file seeds, whose id is the one the
    // active descriptor holds so the scan finds it. `enemyStatsNull` leaves the table's
    // first record at the zero id, which is how the resolver answers "not in the table".
    const records = seed.enemyStatsNull ? [] : (seed.stats ?? [{
        id: (seed.enemyIds ?? [])[seed.enemyActive ?? 0] ?? 0,
        nameId: seed.enemyNameId ?? 0,
    }]);
    for (let i = 0; i < 3; i++) {
        const at = ENEMY_STATS + i * ENEMY_STATS_STRIDE;
        for (let o = 0; o < ENEMY_STATS_STRIDE; o += 2) rt.mem.write16(at + o, 0);
    }
    records.forEach((rec, i) => {
        const at = ENEMY_STATS + i * ENEMY_STATS_STRIDE;
        rt.mem.write16(at, rec.id | 0);
        if (rec.raw) {
            for (let o = 0; o < rec.raw.length; o += 2) {
                rt.mem.write16(at + o, (rec.raw[o] | (rec.raw[o + 1] << 8)) & 0xffff);
            }
        } else rt.mem.write16(at + BATTLE_HUD_ENEMY_NAME_ID, rec.nameId | 0);
    });
    // The roster record's own string. The name builder hands the setter the record
    // pointer with index -1, which F0x800196e4 installs as a literal, so the nickname the
    // plate shows is the first bytes of `0x8004949c + slot*0x3dc`.
    for (const [slot, name] of Object.entries(seed.rosterNames ?? {})) {
        const at = BATTLE_HUD_ROSTER + Number(slot) * BATTLE_HUD_ROSTER_STRIDE;
        const bytes = [...Buffer.from(`${name}\0`, "latin1")];
        bytes.forEach((b, o) => rt.mem.write8(at + o, b));
    }
    ROSTER_SLOT = seed.rosterSlot ?? 0;
    // `fresh` is what the plate's BUILD arm does: both name caches to -1, so the name
    // builder that follows always rebuilds both sides.
    if (seed.fresh) {
        rt.mem.write32(HUD + BATTLE_HUD_NAME_GATE_PLAYER, 0xffffffff);
        rt.mem.write32(HUD + BATTLE_HUD_NAME_GATE_ENEMY, 0xffffffff);
    }
}

function portHost(rt, seed = {}) {
    return {
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        drawSprite(pack, cel, x, y) { LOG.push(["sprite", pack | 0, cel | 0, x | 0, y | 0]); },
        drawQuad(quad, words) {
            LOG.push(["quad", quad >>> 0,
                Array.from({ length: 8 }, (_, i) => rt.mem.read16(quad + i * 2) | 0),
                words.map((w) => w >>> 0)]);
        },
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = widgetFor(kind, x, y);
            for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
            return widget;
        },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
        // [0x8004df98]() and the value the frame cel's sprite draw leaves in $v0. The
        // sprite service is stubbed at 0x8001ed6c and returns 0, so the original reads
        // entry 0 of the gauge table; the port is handed the same 0.
        tick() { return seed.tick ?? 0; },
        gaugeSlotIndex() { return seed.gaugeSlot ?? 0; },
        // The three services FIGHTSTG_F0x80093364 and the build arm reach through
        // function pointers. The original's stubs are the cells the test points at
        // TEXT_STUB, GAUGE_STUB and ENEMY_STATS_STUB, so the port returns the same
        // values and the ordered calls compare as equal.
        resourceBase(id) { LOG.push(["bank", id | 0]); return BANK_BASE + (id | 0); },
        rosterSlot() { return seed.rosterSlot ?? 0; },
        enemyStatsBlock(id) {
            LOG.push(["enemyStats", id | 0]);
            return resolveEnemyStats(rt, id | 0);
        },
    };
}

function runBoth(rt, seed) {
    seedWorld(rt, seed);
    LOG.length = 0;
    PHASE_TICK = seed.tick ?? 0;
    rt.cpu.call(BATTLE_HUD_DRAW, [HUD, ARGSLOT], 200000);
    const olog = LOG.filter(ported).slice();
    const oquals = [[BATTLE_HUD_HP_QUAD_PLAYER], [BATTLE_HUD_HP_QUAD_ENEMY]].map(([base]) =>
        Array.from({ length: 8 }, (_, i) => rt.mem.read16(base + i * 2) | 0));
    const oDv = Array.from({ length: 8 }, (_, i) => rt.mem.read16(BATTLE_HUD_DV_QUAD + i * 2) | 0);

    seedWorld(rt, seed);
    LOG.length = 0;
    const host = portHost(rt, seed);
    battleHudDrawPlateFrames(host);
    // FIGHTSTG_F0x800934f0 calls F0x80093364 between the plate pictures and the two
    // number elements (.L0x800935a4), and both name caches are equal to the active
    // slots in this preset, so the gate makes it a no-op on both sides unless the seed
    // says the plate is fresh.
    battleHudBuildNames(rt.mem, HUD, ARGSLOT, host);
    battleHudHpNumberRows(rt.mem, HUD, ARGSLOT, BATTLE_HUD_RECORDS + (seed.active ?? 0) * 0x20, host);
    const ai = seed.active ?? 0;
    battleHudHpBar(rt.mem, host, 0, seed.shown ?? 0, seed.members?.[0]?.[ai]?.maxHp ?? 0);
    battleHudHpBar(rt.mem, host, 1, seed.enemyShown ?? seed.shown ?? 0, seed.members?.[1]?.[0]?.maxHp ?? 0);
    battleHudDvGauge(rt.mem, host);
    battleHudDrawPartyPips(rt.mem, host);
    const plog = LOG.filter(ported);
    assert.deepEqual(plog, olog, "ordered calls");
    for (const [n, base] of [[0, BATTLE_HUD_HP_QUAD_PLAYER], [1, BATTLE_HUD_HP_QUAD_ENEMY]]) {
        assert.deepEqual(
            Array.from({ length: 8 }, (_, i) => rt.mem.read16(base + i * 2) | 0), oquals[n],
            `fill quad ${n}`);
    }
    assert.deepEqual(
        Array.from({ length: 8 }, (_, i) => rt.mem.read16(BATTLE_HUD_DV_QUAD + i * 2) | 0), oDv,
        "DV gauge trough quad");
    assert.equal(rt.mem.read32(HUD + BATTLE_HUD_NAME_GATE_PLAYER) | 0, seed.active ?? 0,
        "the player name cache ends on the active party slot");
    assert.equal(rt.mem.read32(HUD + BATTLE_HUD_NAME_GATE_ENEMY) | 0, seed.enemyActive ?? 0,
        "the enemy name cache ends on the active enemy slot");
    return { olog, plog, oDv };
}

/**
 * Everything the port emits is compared: the two plate pictures, both name elements and
 * their `+0x114` calls, the slash, the two number elements, all three fill quads and
 * the markers. The services the original reaches through function pointers (`bank`,
 * `enemyStats`) are logged on both sides; the per-frame draw leaves them out because the
 * HP numbers reach the same two through the number setter, while the build arm's calls
 * are compared in `runNameBuild`.
 */
function ported(entry) {
    return (entry[0] === "create") || entry[0] === "method" ||
        entry[0] === "quad" || entry[0] === "sprite";
}

/**
 * FIGHTSTG_F0x80093a74 in its BUILD arm (mode 0), against `battleHudBuildSeparator`.
 *
 * The arm does more than the names and the slash — it also builds the two HP number
 * elements, which `battleHudHpNumberRows` already covers from the draw — so the
 * comparison keeps the name and slash calls and drops the two number elements and
 * their `+0x118`/`+0x148` follow-ups.
 *
 * The two services the name builder reaches through function pointers are kept, so the
 * comparison pins the whole chain and not only the two `+0x114` calls at its end: the
 * enemy-id resolver `[0x800a37fc]` (`.L0x80093440`), then the text-bank service
 * `[0x80044f4c]` for bank `0x4e` (`.L0x80093488`) and for bank `0x7f` (`.L0x80093b00`),
 * each with the word at `0x8005cca8` added to the bank id.
 */
function namesAndSlash(entry) {
    if (entry[0] === "create") return entry[2] === 1 || (entry[2] === BATTLE_HUD_SEPARATOR_KIND && entry[3] === BATTLE_HUD_SEPARATOR.x);
    if (entry[0] === "method") return entry[2] === BATTLE_HUD_SET_STRING;
    return entry[0] === "bank" || entry[0] === "enemyStats";
}

const creates = (log) => log.filter((e) => e[0] === "create");
const textCalls = (log) => log.filter((e) => e[0] === "method" && e[2] === BATTLE_HUD_SET_STRING);
/** The one `+0x114` call the build arm made on a given element. Addresses are signed. */
const textCallOn = (log, element) =>
    textCalls(log).find((e) => (e[1] >>> 0) === (element >>> 0));
/** The NUL-terminated literal the player-side setter was pointed at. */
function literalAt(rt, address) {
    let out = "";
    for (let i = 0; i < 32 && rt.mem.read8(address + i) !== 0; i++) out += String.fromCharCode(rt.mem.read8(address + i));
    return out;
}

function runNameBuild(rt, seed) {
    seedWorld(rt, seed);
    LOG.length = 0;
    rt.mem.write32(HUD + 0x0c, 0);           // self+0xc = 0 is the build arm
    rt.cpu.call(HUD_BUILD, [HUD, ARGSLOT], 400000);
    const olog = LOG.filter(namesAndSlash).slice();
    const ogates = [BATTLE_HUD_NAME_GATE_PLAYER, BATTLE_HUD_NAME_GATE_ENEMY]
        .map((off) => rt.mem.read32(HUD + off) | 0);

    seedWorld(rt, seed);
    LOG.length = 0;
    const host = portHost(rt, seed);
    battleHudBuildSeparator(rt.mem, HUD, ARGSLOT, host);
    const plog = LOG.filter(namesAndSlash);
    assert.deepEqual(plog, olog, "name and slash calls");
    assert.deepEqual([BATTLE_HUD_NAME_GATE_PLAYER, BATTLE_HUD_NAME_GATE_ENEMY]
        .map((off) => rt.mem.read32(HUD + off) | 0), ogates, "the two name caches");
    return { olog, plog };
}

test("battleHudDrawPartyPips matches the original's marker draws", () => {
    const rt = runtime();
    const cases = [
        {
            name: "full party, no damage",
            seed: { shown: 100, active: 0, members: [
                [{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 80 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }],
            ] },
        },
        {
            name: "hurt, KO and afflicted members",
            seed: { shown: 100, active: 1, members: [
                [{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 40 }, { maxHp: 90, hp: 0 }],
                [{ maxHp: 200, hp: 200, ailment: 0x08 }],
            ] },
        },
        {
            name: "empty slots are skipped",
            seed: { shown: 100, active: 2, members: [
                [{ present: 0 }, { maxHp: 80, hp: 80 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }],
            ] },
        },
        {
            name: "ailment outranks damage",
            seed: { shown: 100, active: 0, members: [
                [{ maxHp: 100, hp: 10, ailment: 0x01 }, { maxHp: 80, hp: 0 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }],
            ] },
        },
        {
            name: "active slot on the enemy side",
            seed: { shown: 100, active: 0, members: [
                [{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 80 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }],
            ], enemyActive: 0 },
        },
        {
            name: "side mode 4+ leaves the routine on the second enemy member",
            seed: { shown: 100, active: 0, mode: 5, members: [
                [{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 80 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }, { maxHp: 200, hp: 200 }],
            ] },
        },
        {
            name: "side mode 3 still walks both enemy members",
            seed: { shown: 100, active: 0, mode: 3, members: [
                [{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 80 }, { maxHp: 90, hp: 90 }],
                [{ maxHp: 200, hp: 200 }, { maxHp: 200, hp: 200 }],
            ] },
        },
    ];
    for (const c of cases) {
        if (c.seed.enemyActive !== undefined) {
            // The enemy side's active slot is the word at 0x800a4468 + side*4; the
            // preset writes only the player one, so a second active word is added.
            rt.mem.write32(BATTLE_HUD_ACTIVE_SLOT + 4, c.seed.enemyActive);
        }
        runBoth(rt, c.seed);
        rt.mem.write32(BATTLE_HUD_ACTIVE_SLOT + 4, 0);
    }
});

test("the HP bar length and its fill quad match the original", () => {
    const rt = runtime();
    for (const seed of [
        { name: "full", shown: 100, members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]] },
        { name: "half", shown: 50, members: [[{ maxHp: 100, hp: 50 }], [{ maxHp: 200, hp: 100 }]] },
        { name: "one HP", shown: 1, members: [[{ maxHp: 100, hp: 1 }], [{ maxHp: 200, hp: 1 }]] },
        { name: "zero", shown: 0, members: [[{ maxHp: 100, hp: 0 }], [{ maxHp: 200, hp: 0 }]] },
        { name: "over max", shown: 300, members: [[{ maxHp: 100, hp: 300 }], [{ maxHp: 200, hp: 300 }]] },
        // Below a quarter the routine copies the red pair instead. These cases matter
        // for the colours: the block it hands the quad service is stack memory the
        // previous draw also used, so only a red case proves slots 2 and 3 are written
        // by this branch rather than left over from the last green one.
        { name: "low HP takes the red pair", shown: 10, members: [[{ maxHp: 100, hp: 10 }], [{ maxHp: 200, hp: 10 }]] },
        {
            name: "player low, enemy healthy",
            shown: 10, enemyShown: 200,
            members: [[{ maxHp: 100, hp: 10 }], [{ maxHp: 200, hp: 200 }]],
        },
        {
            name: "player healthy, enemy low",
            shown: 100, enemyShown: 20,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 20 }]],
        },
    ]) {
        runBoth(rt, seed);
    }
});

test("battleHudHpBarLength pins the 128ths rule", () => {
    assert.equal(battleHudHpBarLength(100, 100), 128);
    assert.equal(battleHudHpBarLength(50, 100), 64);
    assert.equal(battleHudHpBarLength(1, 100), 3, "a standing member never shows an empty bar");
    assert.equal(battleHudHpBarLength(0, 100), 0, "a fallen member shows nothing");
    assert.equal(battleHudHpBarLength(200, 0), 0);
    assert.equal(battleHudHpBarLength(300, 100), 384, "the original does not clamp");
});

test("battleHudHpGradient switches at a quarter of the maximum", () => {
    assert.equal(battleHudHpGradient(26, 100), BATTLE_HUD_GRADIENT_HEALTHY, "26 > 25");
    assert.equal(battleHudHpGradient(25, 100), BATTLE_HUD_GRADIENT_LOW, "an equal quarter is low");
    assert.equal(battleHudHpGradient(100, 100), BATTLE_HUD_GRADIENT_HEALTHY);
    assert.equal(battleHudHpGradient(0, 100), BATTLE_HUD_GRADIENT_LOW);
    assert.equal(battleHudHpGradient(1, 4), BATTLE_HUD_GRADIENT_LOW, "4 >> 2 is 1");
    assert.equal(battleHudHpGradient(2, 4), BATTLE_HUD_GRADIENT_HEALTHY);
});

test("the bar is a POLY_G4 and its four words are the vertex colours", () => {
    // F0x8009e77c .L0x8009e834/.L0x8009e838/.L0x8009e844: the word count at prim+0x3
    // and the GP0 command in the top byte of the first colour word. 0x38 is POLY_G4,
    // which carries four vertex colours and nothing else; 0x3a is the same quad
    // semi-transparent.
    assert.equal(BATTLE_HUD_POLY_WORDS, 0x08);
    assert.equal(BATTLE_HUD_POLY_G4, 0x38);
    assert.equal(BATTLE_HUD_POLY_G4_SEMI, 0x3a);
    assert.equal(BATTLE_HUD_POLY_G4_SEMI - BATTLE_HUD_POLY_G4, 0x02);
    // The four words land at prim+0x4, +0xc, +0x14, +0x1c (.L0x8009e7f0-.L0x8009e830),
    // which are the four POLY_G4 vertex-colour offsets.
    assert.deepEqual([...BATTLE_HUD_VERTEX_COLOUR_OFFSETS], [0x04, 0x0c, 0x14, 0x1c]);
});

test("the gradient words are the original's four at 0x800a3490", () => {
    assert.deepEqual(BATTLE_HUD_GRADIENT_WORDS, [0x00287100, 0x003ec800, 0x001637b3, 0x000d37ff]);
    assert.equal(battleHudGradientWord(BATTLE_HUD_GRADIENT_HEALTHY, 0), 0x00287100);
    assert.equal(battleHudGradientWord(BATTLE_HUD_GRADIENT_HEALTHY, 1), 0x003ec800);
    assert.equal(battleHudGradientWord(BATTLE_HUD_GRADIENT_LOW, 0), 0x001637b3);
    assert.equal(battleHudGradientWord(BATTLE_HUD_GRADIENT_LOW, 1), 0x000d37ff);
    // The PS1 is little-endian and a vertex colour is R, G, B from the lowest
    // address up, so the red byte is the word's LOW byte: 0x00287100 is #007128
    // and 0x003ec800 is #00c83e.
    assert.deepEqual(battleHudGradientRgb(BATTLE_HUD_GRADIENT_HEALTHY, 0), [0x00, 0x71, 0x28]);
    assert.deepEqual(battleHudGradientRgb(BATTLE_HUD_GRADIENT_HEALTHY, 1), [0x00, 0xc8, 0x3e]);
    assert.deepEqual(battleHudGradientRgb(BATTLE_HUD_GRADIENT_LOW, 0), [0xb3, 0x37, 0x16]);
    assert.deepEqual(battleHudGradientRgb(BATTLE_HUD_GRADIENT_LOW, 1), [0xff, 0x37, 0x0d]);
});

test("each bar quad gets its first colour on vertices 0 and 2 and its second on 1 and 3", () => {
    // .L0x80093740-.L0x80093780 and .L0x80093798-.L0x800937d8: word 0 is stored at
    // $sp+0xb0 and $sp+0xb8, word 1 at $sp+0xb4 and $sp+0xbc, so the block reads
    // word 0, word 1, word 0, word 1 and the ramp crosses the bar.
    assert.deepEqual(battleHudBarVertexWords(100, 100),
        [0x00287100, 0x003ec800, 0x00287100, 0x003ec800]);
    assert.deepEqual(battleHudBarVertexWords(25, 100),
        [0x001637b3, 0x000d37ff, 0x001637b3, 0x000d37ff], "an equal quarter is the red pair");
    assert.deepEqual(battleHudBarVertexRgb(100, 100), [
        [0x00, 0x71, 0x28], [0x00, 0xc8, 0x3e], [0x00, 0x71, 0x28], [0x00, 0xc8, 0x3e],
    ]);
    assert.deepEqual(battleHudBarVertexRgb(0, 100), [
        [0xb3, 0x37, 0x16], [0xff, 0x37, 0x0d], [0xb3, 0x37, 0x16], [0xff, 0x37, 0x0d],
    ]);
});

test("the ramp runs along the quad's own vertex order, so the enemy's is mirrored", () => {
    // 0x800a3470: vertices 0/2 at x 175 and 1/3 at x 303, so the player's bar goes
    // dark at its left edge and bright at its right. 0x800a3480: vertices 0/2 at 143
    // and 1/3 at 15, so the enemy's bar is bright on the left and dark on the right.
    assert.deepEqual([...BATTLE_HUD_HP_QUAD_PLAYER_HALFWORDS], [175, 37, 303, 37, 175, 43, 303, 43]);
    assert.deepEqual([...BATTLE_HUD_HP_QUAD_ENEMY_HALFWORDS], [143, 37, 15, 37, 143, 43, 15, 43]);
    assert.equal(battleHudHpBarRamp(0), 1);
    assert.equal(battleHudHpBarRamp(1), -1);
    const v = battleHudBarVertexRgb(100, 100);
    const leftOf = (ramp) => (ramp === 1 ? v[0] : v[1]);
    const rightOf = (ramp) => (ramp === 1 ? v[1] : v[0]);
    assert.deepEqual(leftOf(battleHudHpBarRamp(0)), [0x00, 0x71, 0x28]);
    assert.deepEqual(rightOf(battleHudHpBarRamp(0)), [0x00, 0xc8, 0x3e]);
    assert.deepEqual(leftOf(battleHudHpBarRamp(1)), [0x00, 0xc8, 0x3e]);
    assert.deepEqual(rightOf(battleHudHpBarRamp(1)), [0x00, 0x71, 0x28]);
});

test("the marker positions and the number widgets are the original's literals", () => {
    // .L0x800a34c0 holds 271, 282, 293, 37, 26, 15 and the loop draws them at y 0x30.
    const mem = { read16: (a) => ({ [BATTLE_HUD_PIP_X]: 271, [BATTLE_HUD_PIP_X + 2]: 282,
        [BATTLE_HUD_PIP_X + 4]: 293, [BATTLE_HUD_PIP_X + 6]: 37, [BATTLE_HUD_PIP_X + 8]: 26,
        [BATTLE_HUD_PIP_X + 10]: 15 }[a] ?? 0) };
    assert.deepEqual(BATTLE_HUD_PIP_X, 0x800a34c0);
    assert.equal(BATTLE_HUD_PIP_Y, 48);
    assert.equal(BATTLE_HUD_PACK, 0x04550000);
    assert.equal(BATTLE_HUD_LAYER, 0x1005);
    assert.deepEqual({ ...BATTLE_HUD_NUMBER_SHOWN }, { x: 267, y: 26 });
    assert.deepEqual({ ...BATTLE_HUD_NUMBER_MAX }, { x: 302, y: 26 });
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5].map((i) => mem.read16(BATTLE_HUD_PIP_X + i * 2)),
        [271, 282, 293, 37, 26, 15]);
    assert.equal(BATTLE_HUD_HP_EDGE_OFFSET, 0);
    assert.equal(BATTLE_HUD_HP_MOVING_OFFSET, 4);
});

test("battleHudHpBarFill writes the quad's moving edges", () => {
    const store = new Map();
    const mem = {
        read16: (a) => store.get(a) ?? 0,
        write16: (a, v) => store.set(a, v & 0xffff),
    };
    store.set(BATTLE_HUD_HP_QUAD_PLAYER, 175);
    store.set(BATTLE_HUD_HP_QUAD_PLAYER + 0x8, 175);
    store.set(BATTLE_HUD_HP_QUAD_ENEMY, 143);
    store.set(BATTLE_HUD_HP_QUAD_ENEMY + 0x8, 143);
    assert.equal(battleHudHpBarFill(mem, 0, 64), 239);
    assert.equal(store.get(BATTLE_HUD_HP_QUAD_PLAYER + 4), 239);
    assert.equal(store.get(BATTLE_HUD_HP_QUAD_PLAYER + 0xc), 239);
    assert.equal(battleHudHpBarFill(mem, 1, 64), 79);
    assert.equal(store.get(BATTLE_HUD_HP_QUAD_ENEMY + 4), 79);
    assert.equal(store.get(BATTLE_HUD_HP_QUAD_ENEMY + 0xc), 79);
});
test("battleHudDrawPlateFrames draws the two plate pictures first", () => {
    // .L0x80093568-.L0x8009359c: cel 0 (the enemy's plate) at (8, 15) and cel 1 (the
    // player's) at (161, 15), before the names and everything else in the routine.
    const rt = runtime();
    const seed = { shown: 100, members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]] };
    const { olog, plog } = runBoth(rt, seed);
    assert.deepEqual(olog.slice(0, 2),
        [["sprite", PACK_PTR | 0, 0, 8, 15], ["sprite", PACK_PTR | 0, 1, 161, 15]]);
    assert.deepEqual(plog.slice(0, 2), olog.slice(0, 2));
    assert.deepEqual([...BATTLE_HUD_PLATE_POSITIONS].map((p) => ({ ...p })), [
        { cel: 0, x: 8, y: 15 }, { cel: 1, x: 161, y: 15 },
    ]);
});

test("the DV gauge draws frame, trough, fill and inner frame in the original's order", () => {
    const rt = runtime();
    for (const gauge of [0, 249, 250, 500, 999, 1000, 1001]) {
        for (const tick of [0, 1, 3, 4, 7, 8, 9]) {
            const phase = (tick >> 2) & 3;
            const filling = gauge < 1000;
            const left = 265 + Math.trunc(gauge / 25);
            const { olog } = runBoth(rt, {
                name: `gauge ${gauge} tick ${tick}`, shown: 100, gauge, tick,
                members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
            });
            const label = `gauge ${gauge}, tick ${tick}`;
            // Only the gauge's own calls: the trough quad, the two frame cels and the
            // eight fill cels. The markers use 0x0c-0x0f and 0x3c-0x3f, so these
            // ranges are the gauge's alone.
            const calls = olog.filter((e) => (e[0] === "quad" && e[1] === BATTLE_HUD_DV_QUAD)
                || (e[0] === "sprite" && (e[2] === 0x1e || e[2] === 0x0b
                    || (e[2] >= 0x33 && e[2] <= 0x3a))))
                .map((e) => (e[0] === "quad" ? ["quad", ...e[2]] : ["sprite", e[2], e[3], e[4]]));
            assert.deepEqual(calls, [
                ["sprite", 0x1e, 260, 61],
                ...(filling ? [["quad", left, 62, 305, 62, left, 70, 305, 70]] : []),
                ["sprite", (filling ? 0x33 : 0x37) + phase, 265, 62],
                ["sprite", 0x0b, 260, 61],
            ], label);
        }
    }
});

test("the black trough is submitted only while the gauge is below full", () => {
    const rt = runtime();
    const quadsFor = (gauge) => runBoth(rt, {
        name: `trough ${gauge}`, shown: 100, gauge,
        members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
    }).olog.filter((e) => e[0] === "quad" && e[1] === BATTLE_HUD_DV_QUAD);
    assert.equal(quadsFor(0).length, 1, "an empty gauge still gets its trough");
    assert.equal(quadsFor(999).length, 1);
    assert.equal(quadsFor(1000).length, 0, "a full gauge draws no trough");
    assert.equal(quadsFor(1001).length, 0);
    // Below full the left column sits at 265 + trunc(gauge/25) and the right column
    // stays at the shipped 305, so the black rectangle covers the unfilled remainder.
    assert.deepEqual(quadsFor(0)[0][2], [265, 62, 305, 62, 265, 70, 305, 70]);
    assert.deepEqual(quadsFor(250)[0][2], [275, 62, 305, 62, 275, 70, 305, 70]);
    assert.deepEqual(quadsFor(999)[0][2], [304, 62, 305, 62, 304, 70, 305, 70]);
    // Its four vertex colours are the four zero words at 0x800a34b0.
    assert.deepEqual(quadsFor(500)[0][3], [0, 0, 0, 0]);
});

test("the gauge's phase is the tick shifted by two and masked to two bits", () => {
    // .L0x8009383c `sra $v1, $v0, 0x2` and .L0x80093854 `andi $s1, $v1, 0x3`.
    assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 15, 16, 17].map(battleHudDvPhase), [0, 0, 0, 0, 1, 1, 2, 3, 0, 0]);
    assert.equal(battleHudDvPhase(0), 0);
    assert.equal(battleHudDvPhase(4), 1, "the cel steps once every four frames");
    assert.equal(battleHudDvPhase(16), 0, "and wraps after sixteen");
});

test("the gauge's left edge, fill cel and trough are the original's arithmetic", () => {
    // .L0x800938a4 `ori $v0, 0x851f` over `lui $v0, 0x51eb` is the reciprocal of 25 in
    // 35-bit fixed point, and .L0x800938cc/.L0x800938d0 truncate toward zero.
    assert.equal(battleHudDvLeftEdge(0), 265);
    assert.equal(battleHudDvLeftEdge(24), 265);
    assert.equal(battleHudDvLeftEdge(25), 266);
    assert.equal(battleHudDvLeftEdge(249), 274);
    assert.equal(battleHudDvLeftEdge(250), 275);
    assert.equal(battleHudDvLeftEdge(999), 304);
    assert.equal(battleHudDvLeftEdge(1000), 305, "a full gauge reaches the trough's end");
    assert.deepEqual([0, 1, 500, 999, 1000].map((g) => battleHudDvFillCel(g, 0)), [0x33, 0x33, 0x33, 0x33, 0x37]);
    assert.deepEqual([0, 1, 2, 3].map((p) => battleHudDvFillCel(500, p)), [0x33, 0x34, 0x35, 0x36]);
    assert.deepEqual([0, 1, 2, 3].map((p) => battleHudDvFillCel(1000, p)), [0x37, 0x38, 0x39, 0x3a]);
    assert.equal(battleHudDvShowsBacking(999), true);
    assert.equal(battleHudDvShowsBacking(1000), false);
    assert.deepEqual(battleHudDvQuadHalwords(500), [285, 62, 305, 62, 285, 70, 305, 70]);
    assert.equal(BATTLE_HUD_DV_GAUGE_TABLE, 0x80042b1c);
    assert.equal(BATTLE_HUD_DV_FULL, 1000);
    assert.equal(BATTLE_HUD_DV_FRAME_CEL_OUTER, 0x1e);
    assert.equal(BATTLE_HUD_DV_FRAME_CEL_INNER, 0x0b);
    assert.equal(BATTLE_HUD_DV_FILL_CEL_FILLING, 0x33);
    assert.equal(BATTLE_HUD_DV_FILL_CEL_FULL, 0x37);
    assert.equal(BATTLE_HUD_DV_X, 265);
    assert.equal(BATTLE_HUD_DV_Y, 62);
    assert.equal(BATTLE_HUD_DV_FRAME_X, 260);
    assert.equal(BATTLE_HUD_DV_FRAME_Y, 61);
    assert.equal(BATTLE_HUD_DV_QUAD, 0x800a34a0);
});

test("the two names and the slash match the original's build arm", () => {
    // FIGHTSTG_F0x80093a74 mode 0 against battleHudBuildSeparator: both name caches
    // reset to -1, F0x80093364 builds the two kind 1 elements and installs their text,
    // then the slash element is created at (268, 26) with bank 0x7f line 0x10.
    const rt = runtime();
    for (const seed of [
        {
            name: "a fresh plate with both fighters known",
            fresh: true, active: 0, enemyActive: 0,
            rosterSlot: 0, enemyIds: [51], enemyNameId: 7,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
        },
        {
            name: "the second party member, roster slot 4",
            fresh: true, active: 1, enemyActive: 0,
            rosterSlot: 4, enemyIds: [51], enemyNameId: 7,
            members: [[{ maxHp: 100, hp: 100 }, { maxHp: 80, hp: 60 }], [{ maxHp: 200, hp: 200 }]],
        },
        {
            name: "the second enemy member, so the id comes from descriptor slot 1",
            fresh: true, active: 0, enemyActive: 1,
            rosterSlot: 6, enemyIds: [0, 188, 0], enemyNameId: 65,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
        },
        {
            name: "an enemy id that is not in the stat table",
            fresh: true, active: 0, enemyActive: 0,
            rosterSlot: 0, enemyIds: [51], enemyStatsNull: true,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
            // .L0x80093470 `beqz $s0` skips the text but not the element, so only the
            // player's name and the slash are written.
            texts: 2, nameElements: 2,
        },
        {
            name: "a party slot with no roster record yet",
            fresh: true, active: 2, enemyActive: 0,
            rosterSlot: 7, enemyIds: [51], enemyNameId: 7,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
            texts: 3, nameElements: 2,
        },
        {
            name: "another language base at 0x8005cca8",
            fresh: true, active: 0, enemyActive: 0, language: 1,
            rosterSlot: 0, enemyIds: [51], enemyNameId: 7,
            members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
            texts: 3, nameElements: 2,
        },
    ]) {
        const { plog } = runNameBuild(rt, seed);
        // The slash is the last thing the arm builds, and it is the only kind 3
        // element it creates itself; the two HP numbers that follow are the draw's.
        const separator = plog.find((e) => e[0] === "create" && e[2] === BATTLE_HUD_SEPARATOR_KIND
            && e[3] === BATTLE_HUD_SEPARATOR.x);
        assert.ok(separator, `${seed.name}: the slash element is built at (268, 26)`);
        assert.deepEqual([separator[3], separator[4]], [BATTLE_HUD_SEPARATOR.x, BATTLE_HUD_SEPARATOR.y]);
        const texts = plog.filter((e) => e[0] === "method" && e[2] === BATTLE_HUD_SET_STRING);
        assert.equal(texts.length, seed.texts ?? 3, `${seed.name}: the strings the arm writes`);
        assert.equal(creates(plog).filter((e) => e[2] === 1).length, seed.nameElements ?? 2,
            `${seed.name}: the two kind 1 name elements`);
    }
});

test("a name is rebuilt only when that side's active fighter moves", () => {
    const rt = runtime();
    const base = {
        active: 0, enemyActive: 0, rosterSlot: 0, enemyIds: [51], enemyNameId: 7,
        members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
    };
    // A plate whose caches already equal the active slots: the draw's call rebuilds
    // nothing at all, so the two names keep the text they had.
    seedWorld(rt, base);
    LOG.length = 0;
    rt.cpu.call(BATTLE_HUD_DRAW, [HUD, ARGSLOT], 200000);
    assert.equal(textCalls(LOG).length, 0, "an unchanged fighter set rewrites no text");
    assert.equal(creates(LOG).filter((e) => e[2] === 1).length, 0, "and creates no name element");

    // The build arm resets both caches, so it always writes all three strings.
    const built = runNameBuild(rt, { ...base, fresh: true });
    assert.equal(textCalls(built.plog).length, 3);
    assert.equal(creates(built.plog).filter((e) => e[2] === 1).length, 2);

    // Only the party side moved. Both elements already exist in the widget block, and
    // the enemy's cache still equals the active enemy slot, so the draw rewrites the
    // player's text and touches nothing else.
    rt.mem.write32(HUD + BATTLE_HUD_NAME_GATE_PLAYER, 0xffffffff);
    rt.mem.write32(BATTLE_HUD_ACTIVE_SLOT, 1);
    LOG.length = 0;
    rt.cpu.call(BATTLE_HUD_DRAW, [HUD, ARGSLOT], 200000);
    assert.equal(creates(LOG).filter((e) => e[2] === 1).length, 0, "no new name element");
    assert.equal(textCalls(LOG).length, 1, "only the player's name is rewritten");
    assert.equal(rt.mem.read32(HUD + BATTLE_HUD_NAME_GATE_PLAYER) | 0, 1);
    assert.equal(rt.mem.read32(HUD + BATTLE_HUD_NAME_GATE_ENEMY) | 0, 0);

    // The rewritten text is the new member's roster record, at the 988-byte stride.
    // ["method", element, 0x114, source, index]: the source is the active member's
    // roster record and the index is -1, which is how the setter installs a literal.
    const rewrite = textCalls(LOG)[0];
    assert.equal(rewrite[2], BATTLE_HUD_SET_STRING);
    assert.equal(rewrite[3] >>> 0, BATTLE_HUD_ROSTER + 0 * BATTLE_HUD_ROSTER_STRIDE);
    assert.equal(rewrite[4], -1);
});

test("the name and separator literals are the original's own", () => {
    // .L0x800933ac/.L0x800933b0 (174, 21) and .L0x80093460/.L0x80093468 (17, 21),
    // both kind 1 on layer 0x1005; .L0x80093ad8-.L0x80093ae4 (268, 26) kind 3.
    assert.deepEqual({ ...BATTLE_HUD_NAME_PLAYER }, { x: 174, y: 21 });
    assert.deepEqual({ ...BATTLE_HUD_NAME_ENEMY }, { x: 17, y: 21 });
    assert.deepEqual({ ...BATTLE_HUD_SEPARATOR }, { x: 268, y: 26 });
    assert.equal(BATTLE_HUD_SEPARATOR_KIND, 3);
    assert.equal(BATTLE_HUD_LAYER, 0x1005);
    assert.equal(BATTLE_HUD_SET_STRING, 0x114);
    // .L0x800933d4 + .L0x800933e0-.L0x800933e8: `0x80048d34 + 0x768` and a ×988 index.
    assert.equal(BATTLE_HUD_ROSTER, 0x8004949c);
    assert.equal(BATTLE_HUD_ROSTER_STRIDE, 988);
    // .L0x80093448-.L0x80093430: `0x80042b1c + 12*slot` and `+0x18` is the enemy id.
    assert.equal(BATTLE_HUD_ENEMY_ID_TABLE, 0x80042b1c);
    assert.equal(BATTLE_HUD_ENEMY_ID_OFFSET, 0x18);
    assert.equal(BATTLE_HUD_ENEMY_ID_STRIDE, 12);
    assert.equal(BATTLE_HUD_ENEMY_NAME_ID, 0x06);
    // The widget block's three name slots: player, enemy, slash.
    assert.deepEqual([BATTLE_HUD_SLOT_NAME_PLAYER, BATTLE_HUD_SLOT_NAME_ENEMY,
        BATTLE_HUD_SLOT_SEPARATOR], [0x00, 0x04, 0x08]);
    assert.deepEqual([BATTLE_HUD_NAME_GATE_PLAYER, BATTLE_HUD_NAME_GATE_ENEMY], [0x50, 0x54]);
    assert.equal(BATTLE_HUD_STRING_BASE, 0x8005cca8);
    assert.equal(BATTLE_HUD_SEPARATOR_INDEX, 0x10);
});

test("the plate's names follow three real species on both sides, through the original's resolver", () => {
    // FIGHTSTG_F0x80093a74's build arm against battleHudBuildSeparator, three times over
    // with three enemies and three party members, and every call the arm makes compared:
    // the two element creations, the resolver `[0x800a37fc]`, the two text-bank lookups
    // and the three `+0x114` calls.
    //
    // The enemy side runs on the disc's own records — resource 0x1cf as
    // battlecmd/enemy_stats.json holds them, each with its real id halfword and its real
    // name line at +0x06 — so "which line of bank 0x4e this species gets" is settled by
    // the original's own scan and not by a number the test chose.
    const rt = runtime();
    assert.equal(new Set(PLATE_SPECIES.map((s) => s.id)).size, 3, "three different enemy ids");
    assert.equal(new Set(PLATE_SPECIES.map((s) => s.nameId)).size, 3, "three different name lines");
    // The party the s212 download grants: three species, three roster slots, three names.
    const party = [[0, "Monmon"], [1, "Renamon"], [2, "Patamon"]];
    const enemyElement = widgetFor(1, BATTLE_HUD_NAME_ENEMY.x, BATTLE_HUD_NAME_ENEMY.y);
    const playerElement = widgetFor(1, BATTLE_HUD_NAME_PLAYER.x, BATTLE_HUD_NAME_PLAYER.y);
    const separatorElement = widgetFor(BATTLE_HUD_SEPARATOR_KIND, BATTLE_HUD_SEPARATOR.x, BATTLE_HUD_SEPARATOR.y);

    for (const enemy of PLATE_SPECIES) {
        for (const [slot, name] of party) {
            const seed = {
                name: `${enemy.id} against ${name} in roster slot ${slot}`,
                fresh: true, active: 0, enemyActive: 0, rosterSlot: slot,
                enemyIds: [enemy.id], stats: [enemy], rosterNames: { [slot]: name },
                members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
            };
            const { olog } = runNameBuild(rt, seed);   // asserts the port's log is equal

            // The resolver was handed the id out of the battle descriptor, not the name.
            const resolved = olog.filter((e) => e[0] === "enemyStats").map((e) => e[1]);
            assert.deepEqual(resolved, [enemy.id], `${seed.name}: the resolver's argument`);
            // The enemy's element is handed bank 0x4e and the line its own record carries.
            const enemyText = textCallOn(olog, enemyElement);
            assert.deepEqual(enemyText.slice(2), [
                BATTLE_HUD_SET_STRING,
                (BANK_BASE + LANGUAGE + BATTLE_HUD_BANK_ENEMY_NAME) | 0,
                enemy.nameId,
            ], `${seed.name}: the enemy name is bank 0x4e line ${enemy.nameId}`);
            // The player's element is handed its own roster record and -1, so what the
            // plate shows is the literal string sitting at that record.
            const playerText = textCallOn(olog, playerElement);
            assert.deepEqual(playerText.slice(2), [
                BATTLE_HUD_SET_STRING,
                (BATTLE_HUD_ROSTER + slot * BATTLE_HUD_ROSTER_STRIDE) | 0,
                -1,
            ], `${seed.name}: the player name is roster slot ${slot}'s own string`);
            assert.equal(literalAt(rt, BATTLE_HUD_ROSTER + slot * BATTLE_HUD_ROSTER_STRIDE), name,
                `${seed.name}: the string the roster record holds`);
            // And the slash between the HP numbers is the same bank 0x7f line 0x10 every
            // time, whichever species is fighting.
            assert.deepEqual(textCallOn(olog, separatorElement).slice(2), [
                BATTLE_HUD_SET_STRING,
                (BANK_BASE + LANGUAGE + BATTLE_HUD_BANK_SEPARATOR) | 0,
                BATTLE_HUD_SEPARATOR_INDEX,
            ], `${seed.name}: the separator`);
        }
    }
});

test("an enemy id outside the stat table leaves the name element empty, as the original does", () => {
    // F0x8009b8d0's `bltz` delay slot hands back 0 for an id the scan never meets, and
    // the name builder's `beqz $s0` (.L0x80093470) is above the text install and below the
    // element creation (.L0x80093450), so the element is still built and the plate shows
    // no name for it. The whole table is present here; the id simply is not in it.
    const rt = runtime();
    const seed = {
        fresh: true, active: 0, enemyActive: 0, rosterSlot: 0,
        enemyIds: [0x7fff], stats: PLATE_SPECIES, rosterNames: { 0: "Monmon" },
        members: [[{ maxHp: 100, hp: 100 }], [{ maxHp: 200, hp: 200 }]],
    };
    const { olog } = runNameBuild(rt, seed);
    const enemyElement = widgetFor(1, BATTLE_HUD_NAME_ENEMY.x, BATTLE_HUD_NAME_ENEMY.y);
    assert.ok(creates(olog).some((e) => e[3] === BATTLE_HUD_NAME_ENEMY.x), "the enemy's element is still built");
    assert.equal(textCallOn(olog, enemyElement), undefined, "but no text is installed on it");
    assert.equal(olog.filter((e) => e[0] === "bank").length, 1, "only the slash still asks for a bank");
    assert.equal(textCalls(olog).length, 2, "the player's name and the slash");
});
