// The one resident-text host the six translated battle menus share.
//
// fight-command/-tech/-item/-tag/-form/-dna-session.ts each built the same three
// things by hand: the text drawer's view/bucket/packet hosts over a 0x48-byte
// scratch buffer (with the widget arena's ordering table and packet area taken
// just before it), the vsync hook that runs the list model's marker blit, and the
// platform GPU that walks the packets that blit linked. Six copies of one
// routine, differing only in the screen's name in the error text.
//
// The arena order is the screens' own and is kept here: ordering table (8), then
// the packet area (0x4000), then the drawer's scratch (0x48). The resident text
// host (resident-text-host.ts) takes them in a different order for its own
// callers, so it cannot serve these screens without moving every address they
// read back.
//
// No PlayStation instruction is executed here: the packets are the ports' own
// data, read back as the GPU command words the original's chain held.
import type { NativeMemory } from "../../native/memory.ts";
import { clearOtag, setDrawMove, CLEAR_OTAG_HEAD } from "../psyq-video.ts";
import type { ScreenTextBanks } from "./screen-text-banks.ts";
import type { ShopWidgetServices } from "./shop-widget-services.ts";
import { drawTextElement } from "./text-drawer.ts";
import type { TextDrawerStepperHost } from "./text-drawer.ts";
import { textRevealTick } from "./text-window.ts";
import {
    commandMenuVsyncBlit, COMMAND_MENU_UPDATE, COMMAND_TIME_OBJECT,
    type CommandMenuBlitHost, type CommandMenuMemory,
} from "./native/fight-command-menu.ts";

/** One GP0 0x80 VRAM-to-VRAM copy the platform GPU executed this tick. */
export interface FightMenuMove {
    srcX: number; srcY: number; dstX: number; dstY: number; w: number; h: number;
}

export interface FightTextHostsOptions {
    /** The screen's name in its error text, e.g. "Battle tech". */
    label: string;
    /** The screen's shared packed-sound queue ([0x80055C48] onward). */
    playSound: (id: number) => void;
    /** The screen's own text banks: the drawer's stringById reads through them. */
    banks: ScreenTextBanks;
    /** The pad word the text window's button glyphs blink with. */
    padWord: () => number;
}

export interface FightTextHosts {
    drawerHost: TextDrawerStepperHost;
    revealHost: Parameters<typeof textRevealTick>[1];
    /** The 8-byte ordering table the drawer buckets into (allocated first). */
    otAddress: number;
    /** The 0x4000-byte packet area the drawer writes into (allocated second). */
    packetArea: number;
    /** The 0x48-byte scratch the drawer's element is built in (allocated third). */
    drawScratch: number;
}

/**
 * Build a session's text drawer host, its reveal host and the three buffers they
 * need, in the order every battle menu allocated them.
 */
export function createFightTextHosts(mem: NativeMemory, widgets: ShopWidgetServices,
                                     options: FightTextHostsOptions): FightTextHosts {
    const otAddress = widgets.arena.alloc(8, 4);
    const packetArea = widgets.arena.alloc(0x4000, 4);
    const drawScratch = widgets.arena.alloc(0x48, 4);
    const label = options.label;
    const drawerHost: TextDrawerStepperHost = {
        viewForKey: () => 1,
        bucketFor: () => otAddress,
        packetCursor: () => packetArea,
        flushPacketCursor: () => {},
        rotMatrixYXZ: () => { throw new Error(`${label}: rotated text is not translated`); },
        scaleMatrix: () => { throw new Error(`${label}: scaled text is not translated`); },
        applyMatrixSV: () => { throw new Error(`${label}: transformed text is not translated`); },
        alloc: widgets.arena.alloc,
        free: widgets.arena.free,
        stringById: (bank, id) => options.banks.stringById(mem, bank, id),
    };
    const revealHost: Parameters<typeof textRevealTick>[1] = {
        draw: (self) => drawTextElement(mem, drawerHost, self, drawScratch),
        playPackedSound: options.playSound,
        padButtonWord: () => options.padWord(),
        logicalButtonBit: (code) => code,
        free: (ptr) => { if (widgets.arena.has(ptr)) widgets.arena.free(ptr); },
    };
    return { drawerHost, revealHost, otAddress, packetArea, drawScratch };
}

/**
 * The list model's vsync hook ([0x8004DE10]([0x8004DE14])): only the documented
 * blit is translated; anything else in that slot is an untranslated callback.
 */
export function fightMenuVsync(mem: NativeMemory, blitHost: CommandMenuBlitHost): void {
    const hook = mem.read32(COMMAND_TIME_OBJECT) >>> 0;
    if (hook === 0) return;
    if (hook !== COMMAND_MENU_UPDATE) throw new Error(`Untranslated vsync callback ${hook.toString(16)}`);
    commandMenuVsyncBlit(mem, mem.read32(COMMAND_TIME_OBJECT + 4) >>> 0, blitHost);
}

/**
 * The vsync blit's host. Its continueDraw runs the packets the blit linked, which
 * is where the marker copies are read back out.
 */
export function createFightBlitHost(mem: NativeMemory, moves: FightMenuMove[],
                                    label: string): CommandMenuBlitHost {
    return {
        breakDraw: () => 0,
        clearOTag: (ot, count) => {
            clearOtag(mem, ot, count, { debugDispatch: () => { throw new Error("libgpu debug output is not translated"); } });
        },
        setDrawMove: (packet, rect, x, y) => setDrawMove(mem, packet, rect, x, y),
        drawSync: () => 0,
        continueDraw: (ot) => executeFightChain(mem, ot, moves, label),
    };
}

/** Platform GPU: run the packets linked from `ot` up to the libgpu terminator. */
export function executeFightChain(mem: NativeMemory, ot: number, moves: FightMenuMove[],
                                  label: string): void {
    let node = ot >>> 0;
    for (let guard = 0; guard < 64; guard++) {
        if (node === CLEAR_OTAG_HEAD) return;
        const tag = mem.read32(node) >>> 0;
        const length = tag >>> 24;
        for (let i = 0; i < length;) {
            const word = mem.read32(node + 4 + i * 4) >>> 0;
            const command = word >>> 24;
            if (command === 0x01) { i += 1; continue; }
            if (command === 0x80 && i + 4 <= length) {
                const src = mem.read32(node + 8 + i * 4) >>> 0;
                const dst = mem.read32(node + 12 + i * 4) >>> 0;
                const size = mem.read32(node + 16 + i * 4) >>> 0;
                moves.push({ srcX: src & 0xffff, srcY: src >>> 16, dstX: dst & 0xffff, dstY: dst >>> 16,
                    w: size & 0xffff, h: size >>> 16 });
                i += 4;
                continue;
            }
            throw new Error(`${label}: untranslated GPU command ${command.toString(16)}`);
        }
        const next = tag & 0xffffff;
        if (next === 0xffffff) return;
        node = (0x80000000 | next) >>> 0;
    }
    throw new Error(`${label}: GPU chain does not terminate`);
}

/** The memory view the blit port reads: the session's own NativeMemory. */
export type FightMenuMemory = CommandMenuMemory;
