// Browser adapter for the translated in-battle message line. The logic lives in
// engine/dw3/ui/native/battle-message-line.ts (the ports of the controller
// FIGHTSTG_F0x8009a298, its step routine FIGHTSTG_F0x80098c9c, the draw
// FIGHTSTG_F0x80098924, the reveal machine FIGHTSTG_F0x80098a84 and the VM
// FIGHTSTG_F0x80099588's preamble and 22-arm jump table) composed by
// engine/dw3/ui/battle-message-session.ts. This file supplies the three host services
// the original reaches through function pointers — the text-bank getter, the pack
// resolver and the sprite painter — and paints through the same native-text helper
// web/battle.js already uses. It never executes original instructions.
// `?legacyBattleMsg=1` keeps web/battle.js's hand-drawn rectangle.
//
// What the player sees with this on: the battle's own window picture
// (PGFGTC00 cel 49, 296 x 38) at native (11, 188), the first line at (20, 194) and the
// second at (20, 208) arriving once four display ticks have passed, and a small glyph
// blinking at (291, 208) from the moment the last line lands until Circle closes the line.
// There is no timeout.
//
// Decode: .bunny-scratch/battlemsg-fix2-report.md (2026-10-02), superseding
// .bunny-scratch/battlemsg-report.md, which read the wrong controller.
import { ui } from "./vendor/engine.js";
import { packReady } from "./screenpack.js";
import { drawClip } from "./screenpack.js";
import { fetchJson } from "./resident-data.js";

const {
  BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_FIELD,
  BATTLE_MESSAGE_CLOSE_BIT,
  BATTLE_MESSAGE_EL_SET_NUMBER, BATTLE_MESSAGE_EL_SET_SLOT, BATTLE_MESSAGE_EL_SET_STRING,
  BATTLE_MESSAGE_EL_VISIBLE, BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
  BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2, BATTLE_MESSAGE_PANEL_CEL,
  BATTLE_MESSAGE_PANEL_H, BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_W,
  BATTLE_MESSAGE_PANEL_X, BATTLE_MESSAGE_PANEL_Y, BATTLE_MESSAGE_PROMPT_CLIP,
  BATTLE_MESSAGE_PROMPT_PACK, BATTLE_MESSAGE_PROMPT_SIZE, BATTLE_MESSAGE_PROMPT_X,
  BATTLE_MESSAGE_PROMPT_Y, BATTLE_MESSAGE_PROMPT_TICKS, battleMessageArm,
  battleMessageDraw, battleMessageKindFor, battleMessageLineIndex, battleMessagePromptClipId,
  battleMessagePromptFrame,
} = ui;

/** `?legacyBattleMsg=1` keeps web/battle.js's hand-drawn message rectangle. */
export function translatedBattleMsgEnabled(search) {
    return !new URLSearchParams(search).has("legacyBattleMsg");
}

/** The game key that drives `BATTLE_MESSAGE_CLOSE_BIT` (0x2000 = Circle). */
export const BATTLE_MSG_CLOSE_KEY = "circle";

/** The packs the original resolves: PGFGTC00 for the panel, CMFONT for the prompt. */
const PACK_NAMES = {
    [BATTLE_MESSAGE_PANEL_PACK]: "pgfgc00",
    [BATTLE_MESSAGE_PROMPT_PACK]: "cmfont",
};

export function battleMsgPackName(handle) {
    return PACK_NAMES[handle >>> 0] ?? null;
}

/**
 * The original's message bank is bank 0x7f, the disc's English string file
 * `esmfight.toml`. It ships twice: the disc image itself
 * (`battlecmd/129.bin`, the game's own token encoding — four glyph bytes per letter)
 * and the same table already decoded (`battlecmd/esmfight.json`, built by
 * `tools/extract_battle_text.py`, which refuses to write unless its entry count
 * matches the `.bin` and the exe's own sector count matches both). This adapter
 * reads the decoded one; an index the bank does not hold reads as the original's
 * empty string.
 *
 * Bank 0x6a — the item-name bank, string index == ItemId — ships the same way
 * (`battlecmd/esitmnam.json`, read by kind 14's second slot at `fightstg.s:23838`
 * `-23845` and by the in-battle ITEM list's row names at `fightstg.s:19342`). Its
 * group's image is not one of the seven `extract_battlecmd_data` copies, so the
 * extractor names it against the disc file-index table and checks the exe's own
 * sector count instead; the strings are the same table `engine/dw3/item-names.ts`
 * already carries, entry for entry.
 */
const BANK_FILES = {
    [BATTLE_MESSAGE_BANK]: { file: "battlecmd/esmfight.json", what: "Battle message bank" },
    [BATTLE_MESSAGE_BANK_FIELD]: { file: "battlecmd/esitmnam.json", what: "Battle item-name bank" },
};

const loadedBanks = Object.create(null);

function bankTable(data) {
    const table = Object.create(null);
    (data?.strings ?? []).forEach((text, index) => { table[index] = String(text); });
    return Object.freeze(table);
}

export function battleMsgBank(bank = BATTLE_MESSAGE_BANK) {
    const entry = BANK_FILES[bank | 0];
    if (!entry) return Promise.reject(new Error(`no shipped bank 0x${(bank >>> 0).toString(16)}`));
    entry.promise ??= fetchJson(entry.file, entry.what).then(bankTable)
        .catch((error) => { entry.promise = null; throw error; });
    return entry.promise;
}

/**
 * The bank lookup the ports call, before `battleMsgBank()` has resolved. It reads the
 * decoded English table synchronously once loaded, and the original's empty string
 * until then, which is what the element would hold for an index past the table.
 */
export function battleMsgBankSync(bank = BATTLE_MESSAGE_BANK) {
    return loadedBanks[bank | 0] ?? null;
}

/** Called by each bank's loader once; also exposed so a test can await it. */
export function battleMsgSetBank(table, bank = BATTLE_MESSAGE_BANK) {
    loadedBanks[bank | 0] = table ?? null;
}

/** The bank lookup the ports call. Unknown banks and indices read as the empty string. */
export function battleMsgText(bank, index) {
    const table = loadedBanks[bank | 0];
    if (!table) return "";
    return table[index | 0] ?? "";
}

/** The item-name bank's string for an ItemId, the way kind 14's slot 1 is filled. */
export function battleMsgItemName(itemId) {
    return battleMsgText(BATTLE_MESSAGE_BANK_FIELD, itemId | 0);
}

// Load the decoded banks as soon as the module is imported, so a battle that starts
// before the first `open` still finds the original's words.
for (const bank of Object.keys(BANK_FILES)) {
    battleMsgBank(Number(bank)).then((table) => battleMsgSetBank(table, Number(bank)))
        .catch(() => {});
}

/** The widget-method calls a session records, in the original's order. */
function methodHost(log) {
    return {
        createTextElement(target, kind, x, y) {
            log.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            return 0x80180000 + ((x + y) % 16) * 0x100;
        },
        bankGet(bank) { log.push(["bank", bank | 0]); return bank | 0; },
        callMethod(element, slot, args) {
            log.push(["method", element | 0, slot, ...args.map((a) => a | 0)]);
        },
        packResolve(handle) { log.push(["pack", handle >>> 0]); return handle >>> 0; },
        drawSprite(pack, cel, frame, x, y) {
            log.push(["sprite", pack >>> 0, cel | 0, frame | 0, x | 0, y | 0]);
        },
    };
}

/**
 * Run the ported VM for one `unkAC(task, kind, payload)` call against a recording host.
 * Used by the test and by the UI lab's read-only peek; it never touches the canvas.
 */
export function battleMsgShowCalls(kind, payload, widgetBase = 0x80180000) {
    const log = [];
    const host = methodHost(log);
    const widgets = {
        line1: host.createTextElement(BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
            BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y),
        line2: host.createTextElement(BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
            BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y),
    };
    const show = ui.battleMessageShow;
    const result = show(host, widgets, kind, payload, battleMsgText, String);
    return { calls: log, result, widgets };
}

/** What the verifier reads: the decoded places, the sizes and the reveal/close rules. */
export function battleMsgGeometry() {
    return {
        panel: {
            pack: BATTLE_MESSAGE_PANEL_PACK, cel: BATTLE_MESSAGE_PANEL_CEL,
            x: BATTLE_MESSAGE_PANEL_X, y: BATTLE_MESSAGE_PANEL_Y,
            w: BATTLE_MESSAGE_PANEL_W, h: BATTLE_MESSAGE_PANEL_H,
        },
        lines: [
            { x: BATTLE_MESSAGE_LINE1.x, y: BATTLE_MESSAGE_LINE1.y },
            { x: BATTLE_MESSAGE_LINE2.x, y: BATTLE_MESSAGE_LINE2.y },
        ],
        prompt: {
            pack: BATTLE_MESSAGE_PROMPT_PACK, clip: BATTLE_MESSAGE_PROMPT_CLIP,
            x: BATTLE_MESSAGE_PROMPT_X, y: BATTLE_MESSAGE_PROMPT_Y,
            size: BATTLE_MESSAGE_PROMPT_SIZE,
        },
        reveal: {
            delayTicks: ui.BATTLE_MESSAGE_LINE_DELAY_TICKS,
            phaseTable: ui.BATTLE_MESSAGE_PHASE_TABLE,
            tick: ui.BATTLE_MESSAGE_TICK,
            promptTicks: BATTLE_MESSAGE_PROMPT_TICKS,
            promptFrames: ui.BATTLE_MESSAGE_PROMPT_FRAMES,
        },
        // `.L0x80098bbc` keeps phase 3 waiting; phase 4's 21 ticks (`.L0x80098c58`) are
        // reachable only through `+0xb0`, which nothing in the decoded corpus calls.
        close: {
            bit: BATTLE_MESSAGE_CLOSE_BIT, holdTicks: null,
            autoCloseTicks: ui.BATTLE_MESSAGE_AUTO_CLOSE_TICKS,
            autoCloseSwitch: ui.BATTLE_MESSAGE_AUTO_CLOSE,
        },
        kinds: BATTLE_MESSAGE_ARMS.length,
        elementMethods: {
            setString: BATTLE_MESSAGE_EL_SET_STRING, setNumber: BATTLE_MESSAGE_EL_SET_NUMBER,
            setSlot: BATTLE_MESSAGE_EL_SET_SLOT, visibility: BATTLE_MESSAGE_EL_VISIBLE,
        },
    };
}

/**
 * Paint one frame of the ported line: the window picture, the lines the reveal machine
 * has let through, and the blinking prompt. `nativeText` is web/battle.js's own text
 * helper, passed in so this file does not import the battle renderer.
 */
export function battleMsgPaint(ctx, frame, nativeText, packs) {
    const panel = packs?.[battleMsgPackName(BATTLE_MESSAGE_PANEL_PACK)];
    if (panel && packReady(panel)) {
        drawClip(ctx, panel, String(frame.panel.cel), frame.panel.x, frame.panel.y);
    } else if (!panel) {
        // Nothing loaded yet: leave the region alone rather than paint a guess.
    } else {
        ctx.fillStyle = "rgba(0,4,45,0.94)";
        ctx.fillRect(frame.panel.x, frame.panel.y, frame.panel.w, frame.panel.h);
    }
    frame.lines.forEach((text, i) => {
        if (!text) return;
        const at = i === 0 ? BATTLE_MESSAGE_LINE1 : BATTLE_MESSAGE_LINE2;
        nativeText(text, at.x, at.y, { kind: BATTLE_MESSAGE_FONT_KIND });
    });
    if (frame.prompt) {
        const font = packs?.[battleMsgPackName(BATTLE_MESSAGE_PROMPT_PACK)];
        if (font && packReady(font)) {
            drawClip(ctx, font, frame.prompt.clipId, frame.prompt.x, frame.prompt.y);
        } else if (font) {
            const { x, y, size } = frame.prompt;
            ctx.fillStyle = "#eaffff";
            ctx.fillRect(x + size / 2 - 2, y + 3, 4, 4);
        }
    }
}

/** The prompt's five frames as the extracted pack names them, for a read-only peek. */
export function battleMsgPromptClips() {
    return [0, 1, 2, 3, 4].map((frame) =>
        battleMessagePromptClipId(frame * BATTLE_MESSAGE_PROMPT_TICKS));
}

export {
    BATTLE_MESSAGE_CLOSE_BIT, battleMessageArm, battleMessageDraw, battleMessageKindFor,
    battleMessageLineIndex, battleMessagePromptClipId, battleMessagePromptFrame,
};