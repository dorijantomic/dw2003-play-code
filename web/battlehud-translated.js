// Browser adapter for the translated in-battle HP plate: the party status markers,
// the HP bar fill, the two HP numbers, the two name plates and the slash between
// the numbers. The logic lives in engine/dw3/ui/native/battle-hud.ts (the ports of
// FIGHTSTG_F0x800934f0's .L0x80093950-.L0x80093a44 marker loop, FIGHTSTG_F0x80093364
// and the build arm of FIGHTSTG_F0x80093a74); this file seeds the memory the original
// reads and hands the results to web/battle.js's picture and text painters. It never
// executes original instructions. `?legacyBattleHud=1` keeps the walker's hand-drawn
// markers, bar and digits.
//
// The bar colour. The bar is one POLY_G4 — the GPU command F0x8009e77c patches in
// is 0x38 — so the two words each branch of F0x800934f0 hands it are the quad's
// VERTEX colours, and they ramp across the bar: the branch's first word on
// vertices 0 and 2, its second on 1 and 3. The PS1 is little-endian and a vertex
// colour runs R, G, B from the lowest address up, so 0x00287100 is #007128 and
// 0x003ec800 is #00c83e — green above a quarter of maximum HP, and 0xb33716 →
// 0xff370d in red at or below it. The player's quad puts vertex 0 on the left and
// the enemy's on the right, so the same pair runs in opposite directions on the
// two plates.
import { ui } from "./vendor/engine.js";
// The enemy-id resolver (engine/dw3/battle-enemy-id.ts, FIGHTSTG_F0x8009b8d0): the
// synthetic record table below is resolved through the PORT's scan, not a predicate.
import { enemyStatsBlock as engineEnemyStatsBlock } from "./vendor/engine.js";
import { packReady, drawClip, drawClipWidth } from "./screenpack.js";
import { decodeGameName } from "./nameentry-translated.js";
import { battleMsgBank, battleMsgText } from "./battlemsg-translated.js";
import { fetchBytes } from "./resident-data.js";

const {
  BATTLE_HUD_ACTIVE_SLOT, BATTLE_HUD_BANK_SEPARATOR, BATTLE_HUD_DV_FILL_CEL_FILLING,
  BATTLE_HUD_DV_FILL_CEL_FULL, BATTLE_HUD_DV_FRAME_CEL_INNER, BATTLE_HUD_DV_FRAME_CEL_OUTER,
  BATTLE_HUD_DV_FRAME_X, BATTLE_HUD_DV_FRAME_Y, BATTLE_HUD_DV_GAUGE_OFFSET,
  BATTLE_HUD_DV_GAUGE_STRIDE, BATTLE_HUD_DV_GAUGE_TABLE, BATTLE_HUD_DV_X, BATTLE_HUD_DV_Y,
  BATTLE_HUD_ENEMY_ID_OFFSET, BATTLE_HUD_ENEMY_ID_STRIDE, BATTLE_HUD_ENEMY_ID_TABLE,
  BATTLE_HUD_ENEMY_NAME_ID, BATTLE_HUD_NAME_ENEMY, BATTLE_HUD_NAME_PLAYER,
  BATTLE_HUD_PIP_X, BATTLE_HUD_PIP_XS, BATTLE_HUD_RECORDS, BATTLE_HUD_POLY_G4,
  BATTLE_HUD_POLY_G4_SEMI, BATTLE_HUD_SEPARATOR, BATTLE_HUD_SEPARATOR_INDEX,
  BATTLE_HUD_SIDE_MODE, BATTLE_HUD_SIDE_STRIDE, BATTLE_HUD_STRING_BASE,
  battleHudBuildSeparator, battleHudDrawPartyPips, battleHudDvGauge,
  battleHudDvLeftEdge, battleHudGradientRgb, battleHudHpBarLength, battleHudHpBarRamp,
  battleHudHpGradient,
} = ui;

/** The Digimon-name bank, family 0x4e (the pause/pause/report manifests call it that). */
export const BATTLE_HUD_NAME_BANK = 0x4e;

/** The fill cels are 40x8 in the chrome pack (ids 51-58), so the fill cannot exceed it. */
const BATTLE_HUD_DV_FILL_W = 40;

/** `?legacyBattleHud=1` keeps the walker's hand-drawn plate. */
export function translatedBattleHudEnabled(search) {
    return !new URLSearchParams(search).has("legacyBattleHud");
}

function rgbHex([r, g, b]) {
    return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The port reads a 16-bit record field layout, so the browser's store is a flat
 * halfword map and read32 is the original's little-endian word of two halfwords.
 */
function recordStore() {
    const half = new Map();
    const mem = {
        read8(addr) { return (mem.read16(addr) & 0xff) | 0; },
        read16(addr) { return half.get(addr & ~1) | 0; },
        read32(addr) { return (mem.read16(addr) | (mem.read16(addr + 2) << 16)) | 0; },
        write16(addr, value) { half.set(addr & ~1, value & 0xffff); },
        write32(addr, value) { mem.write16(addr, value & 0xffff); mem.write16(addr + 2, (value >>> 16) & 0xffff); },
    };
    return mem;
}

/** The ailment byte the marker state test reads (record +0x1c): any set bit counts. */
export function battleHudAilmentByte(member) {
    if (!member) return 0;
    if (Number.isInteger(member.statusBits)) return member.statusBits & 0xff;
    const a = member.ailments ?? {};
    return (a.poison ? 1 : 0) | (a.frozen ? 2 : 0) | (a.confuse ? 4 : 0) | (a.sleep ? 8 : 0);
}

function writeRecord(mem, sideIndex, slot, member) {
    if (!member) return;
    const rec = BATTLE_HUD_RECORDS + sideIndex * BATTLE_HUD_SIDE_STRIDE + slot * 0x20;
    mem.write16(rec + 0x00, 1);
    mem.write16(rec + 0x06, Number(member.maxHp ?? 0) | 0);
    mem.write16(rec + 0x08, Number(member.hp ?? 0) | 0);
    mem.write8(rec + 0x1c, battleHudAilmentByte(member));
}

/**
 * Run the ported marker loop and return the markers the original would have drawn:
 * `{side, index, cel, x, y}` per member, in the original's order.
 */
export function battleHudPartyPips(players, enemies, options = {}) {
    const mem = recordStore();
    mem.write8 = (addr, value) => mem.write16(addr, value & 0xffff);
    players.forEach((m, i) => writeRecord(mem, 0, i, m));
    enemies.forEach((m, i) => writeRecord(mem, 1, i, m));
    mem.write16(BATTLE_HUD_SIDE_MODE, options.mode ?? 0);
    BATTLE_HUD_PIP_XS.forEach((x, i) => mem.write16(BATTLE_HUD_PIP_X + i * 2, x));
    mem.write32(BATTLE_HUD_ACTIVE_SLOT, options.activePlayerIndex ?? 0);
    mem.write32(BATTLE_HUD_ACTIVE_SLOT + 4, options.activeEnemyIndex ?? 0);
    const host = {
        packResolve: () => 0, drawSprite() {}, drawQuad() {},
        createTextElement: () => 0, callMethod() {},
    };
    return battleHudDrawPartyPips(mem, host);
}

/** The three party members as the original's records see them (a missing member is absent). */
export function battleHudPlayerRecords(b) {
    // The three live combat records, NOT the roster. `playerRoster[i]` is the
    // persistent character (species, name, saved stats) and carries no hp at all, so
    // reading it here gave every party member hp 0 -- which the decoded marker rule
    // (state 2, "knocked out") turned into three red markers, and a poisoned partner
    // could never show the orange afflicted marker. The marker test is
    // FIGHTSTG_F0x800934f0 .L0x800939a0: `lbu $v0, 0x1c($s1)` on the combatant
    // record, then .L0x800939b0 `lh $v1, 0x8($s1)` and .L0x800939c0 `lh $v0, 0x6($s1)`
    // for hp and max hp -- the battle's own record fields.
    const records = Array.isArray(b.playerRecords) ? b.playerRecords : [];
    return [0, 1, 2].map((i) => {
        const m = records[i];
        if (!m) return null;
        return { hp: Number(m.hp ?? 0), maxHp: Number(m.maxHp ?? 0),
            ailments: m.ailments, statusBits: m.statusBits };
    });
}

/** The enemy side's one record (a missing enemy is absent, so no marker is drawn). */
export function battleHudEnemyRecords(b) {
    const e = b.enemy;
    if (!e) return [null, null, null];
    return [{ hp: Number(e.hp ?? 0), maxHp: Number(e.maxHp ?? 0),
        ailments: e.ailments, statusBits: e.statusBits }, null, null];
}

/** The bar length in 128ths of the full 128-pixel bar (.L0x800936b4-.L0x800936d4). */
export { battleHudHpBarLength };

/**
 * The bar's two vertex colours in SCREEN order — the left edge first — taken from
 * the four the original draws. `side` is 0 for the player's plate and 1 for the
 * enemy's, whose quad lists vertex 0 on the right, so its ramp runs the other way.
 * @returns {readonly [string, string]}
 */
export function battleHudBarColors(shownHp, maxHp, side = 0) {
    const table = battleHudHpGradient(shownHp, maxHp);
    const v0 = battleHudGradientRgb(table, 0);
    const v1 = battleHudGradientRgb(table, 1);
    const leftFirst = battleHudHpBarRamp(side) === 1;
    return [rgbHex(leftFirst ? v0 : v1), rgbHex(leftFirst ? v1 : v0)];
}

/**
 * The GPU command the original's quad carries: POLY_G4, or the semi-transparent
 * form of the same quad (F0x8009e77c .L0x8009e838 and .L0x8009e844). The bar draws
 * opaque; the walker's plates are not drawn semi-transparent.
 */
export function battleHudBarPolygonCode(semiTransparent = false) {
    return semiTransparent ? BATTLE_HUD_POLY_G4_SEMI : BATTLE_HUD_POLY_G4;
}

// --------------------------------------------------------------- DV / Blast gauge
/**
 * Run the ported gauge block (engine/dw3/ui/native/battle-hud.ts's battleHudDvGauge,
 * the original's .L0x80093820-.L0x8009392c) against the walker's own fight state and
 * return the four draw calls it made, in its order.
 *
 * `tick` is [0x8004df98]() — the same monotonic frame counter the whole game counts
 * animations with, which web/battle.js keeps as `_hudClock` at HUD_CLOCK_HZ. The
 * gauge's own value never moves the phase: the cel steps once every four frames.
 *
 * `slot` is the combatant the gauge belongs to. The original gets it from
 * `[0x8004b44c]([0x800a4468])` — the active party slot through the party-record
 * accessor — and reads the eight-entry Blast gauge array at 0x80042b74 with it
 * (docs/research/battle/battle-ram-layout.md:113). The caller passes the combatant
 * index it keeps its gauge in.
 */
export function battleHudDvFrame({ gauge = 0, tick = 0, slot = 0 } = {}) {
    const mem = recordStore();
    mem.write8 = (addr, value) => mem.write16(addr, value & 0xffff);
    const index = Math.max(0, Math.trunc(slot) || 0);
    mem.write16(BATTLE_HUD_DV_GAUGE_TABLE + index * BATTLE_HUD_DV_GAUGE_STRIDE
        + BATTLE_HUD_DV_GAUGE_OFFSET, Number(gauge) || 0);
    const host = {
        packResolve: () => 0, drawSprite() {}, drawQuad() {},
        createTextElement: () => 0, callMethod() {},
        tick: () => Math.trunc(tick) || 0,
        gaugeSlotIndex: () => index,
    };
const frame = battleHudDvGauge(mem, host);
    // The trough quad's eight halfwords are four vertices in GPU order (x, y); the
    // routine rewrites vertices 0 and 2, so the black rectangle runs from its left
    // column to the shipped right edge. At the full gauge the routine skips that write
    // entirely and the quad is degenerate — the quad is what darkens the UNFILLED
    // remainder, so it vanishes exactly when there is nothing left to fill.
    const hw = frame.halfwords;
    frame.trough = {
      x: Math.min(hw[0], hw[4]), y: Math.min(hw[1], hw[5]),
      w: Math.abs(hw[2] - hw[0]), h: Math.abs(hw[5] - hw[1]),
      rgb: frame.words.map((word) => [(word & 0xff), (word >>> 8) & 0xff, (word >>> 16) & 0xff]),
    };
    // The fill's width is the gauge's own left edge less the trough's start, clamped
    // to the cel: the four filling cels are 40x8 pictures in the chrome pack, so 1000
    // reaches the full 40 and the full cels (0x37+) are then drawn whole.
    frame.fill = {
      x: BATTLE_HUD_DV_X, y: BATTLE_HUD_DV_Y,
      width: Math.max(0, Math.min(BATTLE_HUD_DV_FILL_W,
        battleHudDvLeftEdge(frame.gauge) - BATTLE_HUD_DV_X)),
    };
    frame.outer = { cel: BATTLE_HUD_DV_FRAME_CEL_OUTER, x: BATTLE_HUD_DV_FRAME_X, y: BATTLE_HUD_DV_FRAME_Y };
    frame.inner = { cel: BATTLE_HUD_DV_FRAME_CEL_INNER, x: BATTLE_HUD_DV_FRAME_X, y: BATTLE_HUD_DV_FRAME_Y };
    frame.baseCel = frame.fillCel < 0x37 ? BATTLE_HUD_DV_FILL_CEL_FILLING : BATTLE_HUD_DV_FILL_CEL_FULL;
    return frame;
}

/**
 * The original's fourth gauge call, cel 0x0b at (260, 61), is NOT painted here, and the
 * reason is measured rather than guessed:
 *
 *   - the call is real (fightstg.s .L0x80093920-.L0x8009392c, confirmed by the lane-B
 *     oracle), so the ported routine emits it and the painter sees it in `frame.inner`;
 *   - the extracted art for that cel (web/assets/ui/pgfgc00_sheet.json id 11) is a
 *     single 40x8 layer of which all 320 texels are opaque dark blue-black, and its
 *     authored offset (+5, +1) puts it exactly over the 265..305 x 62..69 trough;
 *   - so painting it in submission order — the order the assembly uses — would cover the
 *     fill the player is watching fill, which the ledger's live-checked claim
 *     `dv-gauge-sprite-selection-2026-09-14` says must be visible.
 *
 * Either the pack's cel 11 is not this picture (a CLUT/transparent-index extraction
 * question this checkout cannot settle: the pgfgc00 sheets come off the disc image,
 * which is absent) or the original's primitive order is not paint order. Set this to
 * true to paint it and watch the fill disappear.
 */
export const BATTLE_HUD_DV_PAINT_INNER_FRAME = false;

/**
 * Paint one frame of the ported gauge in the original's order: the outer frame, the
 * black trough over the unfilled remainder, then the fill. The outer frame is the
 * chrome pack's own cel 0x1e (52x10 at (260,61)); the fill is one of cels 51-58.
 *
 * How the fill is kept to the gauge's width is NOT established: the original's sprite
 * call carries four arguments and no width (.L0x80093918), yet the cel is a 40x8
 * picture and the black trough is submitted before it, so it cannot be masking. This
 * clips the source rectangle to `gauge/25` native pixels, which is what the walker
 * already did.
 */
export function battleHudDvPaint(ctx, frame, packs) {
    const pack = packs?.pgfgc00 ?? null;
    const ready = !!pack && packReady(pack);
    if (ready) drawClip(ctx, pack, String(frame.outer.cel), frame.outer.x, frame.outer.y);
    if (frame.backing) {
        const { x, y, w, h, rgb } = frame.trough;
        if (w > 0 && h > 0) {
            ctx.fillStyle = `rgb(${rgb[0].join(",")})`;
            ctx.fillRect(x, y, w, h);
        }
    }
    if (ready && frame.fill.width > 0) {
        drawClipWidth(ctx, pack, String(frame.fillCel), frame.fill.x, frame.fill.y, frame.fill.width);
    }
    if (ready && BATTLE_HUD_DV_PAINT_INNER_FRAME) {
        drawClip(ctx, pack, String(frame.inner.cel), frame.inner.x, frame.inner.y);
    }
    return ready;
}

/** The gauge's decoded placement, for a headless read-out. */
export function battleHudDvGeometry() {
    return {
        frame: { outer: { cel: BATTLE_HUD_DV_FRAME_CEL_OUTER, x: BATTLE_HUD_DV_FRAME_X, y: BATTLE_HUD_DV_FRAME_Y },
            inner: { cel: BATTLE_HUD_DV_FRAME_CEL_INNER, x: BATTLE_HUD_DV_FRAME_X, y: BATTLE_HUD_DV_FRAME_Y } },
        fill: { x: BATTLE_HUD_DV_X, y: BATTLE_HUD_DV_Y, widthPx: 40, baseCels: [BATTLE_HUD_DV_FILL_CEL_FILLING, BATTLE_HUD_DV_FILL_CEL_FULL] },
    };
}
// ------------------------------------------------------- name plates and the slash
//
// FIGHTSTG_F0x80093a74's BUILD arm (fightstg.s .L0x80093abc-.L0x80093b1c) resets both
// name caches to -1, calls FIGHTSTG_F0x80093364 for the two names, then creates the
// slash element at (268, 26) and hands it line 16 of bank 0x7f. That line is the single
// glyph `/`, so the plate reads shown-HP, slash, maximum-HP. `battleHudPlateLabels`
// runs that block through the port and resolves the three strings.

// The two bank ids the original adds to the word at 0x8005cca8 (the language base):
// 0x7f is the battle command/message family the walker already loads decoded, 0x4e is
// the Digimon-name family, which ships as raw bank bytes (`u32 count`, then `count`
// u32 relative offsets, then NUL-terminated strings — the shape
// engine/dw3/ui/fetch-table.ts reads) under web/assets/data/wizard/.
const NAME_BANK_DIR = "wizard";
const LABEL_DATA = "Battle plate names";

/**
 * Each bank id gets a synthetic resident base, handed out in the order the original
 * asks for the families, exactly as engine/dw3/ui/screen-text-banks.ts allocates its
 * banks from one base and remembers which address is which id. The two maps are that
 * registry; nothing reads a bank straight out of memory, because the glyph codes need
 * decoding and the decoded tables are what the walker already uses elsewhere.
 */
const BANK_BASE = 0x801e0000;
const BANK_STRIDE = 0x4000;
const BANK_BASES = new Map();
const BANK_IDS = new Map();

let nameBankPromise = null;
/**
 * Load the Digimon-name bank for the current language and decode every line into text.
 * The bank's bytes are the game's own codes, and `decodeGameName` is the decoder the
 * naming screen already uses for them (0x04+d digits, 0x0e+n A-Z, 0x28+n a-z).
 */
export function battleHudNameBank(language = 2) {
    nameBankPromise ??= fetchBytes(`${NAME_BANK_DIR}/${BATTLE_HUD_NAME_BANK + language}.bin`, LABEL_DATA)
        .then((bytes) => {
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const count = view.getUint32(0, true);
            const lines = new Array(count);
            for (let i = 0; i < count; i++) {
                const start = view.getUint32(4 + i * 4, true);
                let end = start;
                while (end < bytes.length && bytes[end] !== 0) end += 1;
                lines[i] = decodeGameName(bytes.subarray(start, end));
            }
            return Object.freeze(lines);
        }).catch((error) => { nameBankPromise = null; throw error; });
    return nameBankPromise;
}

let loadedNameBank = null;
/** Called once the bank resolves, so a battle that starts early still finds the names. */
export function battleHudSetNameBank(lines) { loadedNameBank = lines ?? null; }
battleHudNameBank().then(battleHudSetNameBank).catch(() => {});

/** Test seam: the decoded Digimon-name bank, or null until it has loaded. */
export function battleHudNameBankSync() { return loadedNameBank; }

/** The synthetic resident address one bank id resolves to, mirroring ScreenTextBanks. */
export function battleHudBankBase(id) {
    const key = id | 0;
    if (!BANK_BASES.has(key)) {
        const at = (BANK_BASE + BANK_BASES.size * BANK_STRIDE) >>> 0;
        BANK_BASES.set(key, at);
        BANK_IDS.set(at, key);
    }
    return BANK_BASES.get(key);
}

/**
 * One string out of the bank the original's setter was handed. Bank 0x7f comes from the
 * already-decoded table the message line reads; bank 0x4e from the Digimon-name bank;
 * anything else is the original's empty string, because `fetchTableEntry` returns 0 for
 * an index past the table.
 */
export function battleHudBankString(source, index) {
    const id = BANK_IDS.get(source >>> 0);
    if (id === undefined) return "";
    if (id === BATTLE_HUD_BANK_SEPARATOR) return battleMsgText(BATTLE_HUD_BANK_SEPARATOR, index | 0);
    if (id === BATTLE_HUD_NAME_BANK) return loadedNameBank?.[index | 0] ?? "";
    return "";
}

/** The widget stand-ins the ported build hands out, one address per element. */
const LABEL_WIDGET_BASE = 0x80180000;
const LABEL_STATS_BASE = 0x80140000;
const LABEL_ENEMY_STATS = LABEL_STATS_BASE;

/**
 * Run the ported plate build and return what the player reads on it.
 *
 * `playerName` is the string the original reads as a LITERAL out of the active party
 * member's roster record (`0x8004949c + slot*0x3dc`, installed by `+0x114` with index
 * -1): the nickname, or the roster's own name when the Digimon has not been renamed.
 * The port decides which record; the caller supplies its text.
 *
 * `enemyNameId` is the original's `enemy stat record + 0x06` — the line of bank 0x4e
 * the enemy's name comes from. Resource `0x1cf`, the 0x46-stride enemy stat table that
 * holds that halfword, ships decoded as
 * `web/assets/data/battlecmd/enemy_stats.json` (193 records, the count the resolver's
 * own zero-id scan finds), so the caller looks the line up there. When the enemy is not
 * in the table the id stays null and the port follows the original exactly: the element
 * is still created, and the text is left empty because the stat record is null.
 */
export function battleHudPlateLabels({
    activePlayerIndex = 0, activeEnemyIndex = 0, playerName = "", enemyName = "",
    enemyNameId = null, enemyId = 0, rosterSlot = null, language = 2,
} = {}) {
    const mem = recordStore();
    mem.write8 = (addr, value) => mem.write16(addr, value & 0xffff);
    mem.write32(BATTLE_HUD_STRING_BASE, language);
    mem.write32(BATTLE_HUD_ACTIVE_SLOT, activePlayerIndex);
    mem.write32(BATTLE_HUD_ACTIVE_SLOT + 4, activeEnemyIndex);
    mem.write32(BATTLE_HUD_ENEMY_ID_TABLE + BATTLE_HUD_ENEMY_ID_OFFSET
        + activeEnemyIndex * BATTLE_HUD_ENEMY_ID_STRIDE, enemyId | 0);
    if (enemyNameId != null) {
        mem.write16(LABEL_ENEMY_STATS + BATTLE_HUD_ENEMY_NAME_ID, enemyNameId | 0);
    }
    // The port hands each created element its own address so the call log can be read.
    let next = 0;
    const calls = [];
    const host = {
        packResolve: () => 0, drawSprite() {}, drawQuad() {},
        createTextElement(target, kind, x, y) {
            const element = LABEL_WIDGET_BASE + next * 0x100;
            next += 1;
            calls.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            return element;
        },
        callMethod(element, slot, args) { calls.push(["method", element | 0, slot, ...args.map((a) => a | 0)]); },
        tick: () => 0,
        gaugeSlotIndex: () => 0,
        // [0x80044f4c] is handed the language base plus the family offset, exactly as
        // ScreenTextBanks keys its own banks by `offset + language`; the family is the
        // offset, so that is what the synthetic base is registered under.
        resourceBase: (id) => battleHudBankBase((id | 0) - (language | 0)),
        rosterSlot: () => (rosterSlot == null ? (activePlayerIndex | 0) : (rosterSlot | 0)),
        // FIGHTSTG_F0x8009b8d0 over the synthetic table this read-out lays down: one
        // record whose leading u16 is `enemyId`, terminating at the next index (a zero id
        // ends the scan). A found id returns the record's base, a miss returns 0 — the
        // original's `bltz` delay-slot answer. A caller that supplies only the name line
        // (a headless read-out with no numeric id) keeps the plain base, as before.
        enemyStatsBlock: (id) => {
            if (enemyNameId == null) return 0;
            if (!enemyId) return LABEL_ENEMY_STATS;
            return engineEnemyStatsBlock(LABEL_ENEMY_STATS,
                (index) => (index === 0 ? (enemyId | 0) : 0), id | 0);
        },
    };
    const hud = LABEL_WIDGET_BASE + 0x8000;
    const widget = LABEL_WIDGET_BASE + 0x9000;
    const built = battleHudBuildSeparator(mem, hud, widget, host);
    const enemy = built.names.enemy;
    return {
        calls,
        player: {
            text: String(playerName ?? ""), kind: 1,
            x: BATTLE_HUD_NAME_PLAYER.x, y: BATTLE_HUD_NAME_PLAYER.y,
            // The original's setter is handed the record pointer with index -1, which
            // installs the string itself; the port's source is the record address.
            source: built.names.player?.source ?? 0,
            index: built.names.player?.index ?? null,
            rebuilt: built.names.player?.rebuilt ?? false,
        },
        enemy: {
            text: enemy ? (enemyNameId == null ? String(enemyName ?? "") : battleHudBankString(enemy.source, enemy.index)) : String(enemyName ?? ""),
            kind: 1, x: BATTLE_HUD_NAME_ENEMY.x, y: BATTLE_HUD_NAME_ENEMY.y,
            nameId: enemyNameId == null ? null : enemy?.index ?? null,
            rebuilt: enemy?.rebuilt ?? false,
        },
        separator: {
            text: battleHudBankString(built.bank, built.index),
            kind: 3, x: BATTLE_HUD_SEPARATOR.x, y: BATTLE_HUD_SEPARATOR.y,
            bank: BATTLE_HUD_BANK_SEPARATOR, index: built.index,
        },
    };
}

/** The names and the slash as a headless read-out, for `?battlehud=`. */
export function battleHudLabelsGeometry() {
    return {
        names: { player: { ...BATTLE_HUD_NAME_PLAYER }, enemy: { ...BATTLE_HUD_NAME_ENEMY } },
        separator: { ...BATTLE_HUD_SEPARATOR, bank: BATTLE_HUD_BANK_SEPARATOR, index: BATTLE_HUD_SEPARATOR_INDEX },
    };
}

// Load the decoded 0x7f table this module reads the separator out of, exactly as the
// message line does, so a battle that starts before the first open still finds it.
battleMsgBank().catch(() => {});
