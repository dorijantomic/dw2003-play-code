// The card-battle screen object, translated from pro/cardgame:
//   F0x80095BFC cardBattleSceneTick — the screen's four-state callback
//   F0x80095E2C createCardBattleScene — the factory thunk that makes it
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-battle-scene-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin, with the device
// and party-service edges stubbed on both sides.
//
// Source (assembly, authority 2): the shipped overlay at 0x80095BFC; the m2c
// listing (exe-decomp/cardgame_c/F0x80095bfc.c) renders the same switch
// irregularly, so the states were read from the instructions.
//
// What the player sees. The card-battle screen is one object the console builds
// to own the duel. Its state word at obj+0x0C dispatches:
//   0 (and anything above 3) -> build the whole screen: clear the display
//       service, size its packet buffer, set the 320x240 draw region, install
//       the card-view upload helper on a caller-owned 0x34-byte context, upload
//       the two card artwork packs (0x025D0000 at VRAM x 0x280 and 0x025D0001 at
//       0x340) through that helper's own slot, register the display view over the
//       rect descriptor 0x800A5938 and set its rect colour to (0x1F,0x1F,0x1F),
//       create the duel object with the current shop id, store it through the
//       caller's pointer, and advance the object's own state.
//   1 -> when the duel reports finished (its +0x303 byte is 2), set this object's
//       state to 2 and the duel's to 3; otherwise do nothing.
//   2 -> when obj+0x10 is 1, do nothing; otherwise request the party transition
//       (0x1500 when the progress ordinal's low nibble is set, else the saved
//       selector from [0x80048D34+0x34]) and advance the object's sub-state.
//   3 -> nothing; the screen has already handed over.
//
// The four display-service calls, the upload helper and the duel constructor are
// the ports already in the engine (engine/dw3/display-service.ts,
// engine/dw3/display-view.ts, engine/dw3/ui/card-view.ts,
// engine/dw3/ui/duel-create.ts), called directly exactly as the original calls
// them through the service object's and the helper's own slots. The remaining
// edges are the resident/caller-owned ones: the pack resolver, the shop id, the
// helper's 0x34-byte context and the DRAWENV scratch (both caller-owned in the
// original: its own stack), the object's own three factory methods, and the two
// party-service calls the state-2 arm makes through [0x80048D34+0x2704/0x270C].

import { resetDisplayService, setDisplayPacketIndex, setDisplayRegion, registerDisplayView,
    type DisplayRegionHost, type DisplayViewHost } from "../display-service.ts";
import { setRectColour } from "../display-view.ts";
import { cardViewHelperInit, cardViewHelperSetPairA, cardViewHelperUploadPack,
    type PackUploadHost } from "./card-view.ts";
import { createCardDuel, type DuelCreateHost } from "./duel-create.ts";
import { DUEL_OUTCOME_STATE, DUEL_SCENE_STATE_AFTER_SETUP } from "./duel-scene-handler.ts";

export interface CardBattleSceneMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CardBattleSceneHost extends DisplayViewHost, DisplayRegionHost, PackUploadHost, DuelCreateHost {
    /** A caller-owned 0x34-byte context for the card-view upload helper (the
     *  original's own stack). */
    helperBuffer(): number;
    /** A caller-owned scratch for the DRAWENV registerDisplayView builds (the
     *  original's own stack). */
    drawEnvScratch(): number;
    /** [0x80044B38+0x424](handle) = F0x800140D8: a pack handle's base. */
    resolvePack(handle: number): number;
    /** [0x8004B43C](): the shop id createCardDuel is called with. */
    getCurrentShopId(): number;
    /** obj+0x28 (F0x80014274): set the object's state. */
    setState(obj: number, state: number): void;
    /** obj+0x38 (F0x800142AC): advance the object's state. */
    advancePhase(obj: number): void;
    /** obj+0x3C (F0x800142C8): advance the object's sub-state. */
    advanceSub(obj: number): void;
    /** [0x80048D34+0x2704](1): the progress-ordinal query. */
    ordinalQuery(what: number): number;
    /** [0x80048D34+0x270C](value, 0): the ordinal-gated transition request. */
    requestTransition(value: number, arg: number): void;
}

/** The tick's address and the factory thunk's. */
export const CARD_BATTLE_SCENE_ENTRY = 0x80095bfc;
export const CARD_BATTLE_SCENE_CTOR = 0x80095e2c;
/** The factory's size and extra-block arguments (F0x80014504). */
export const CARD_BATTLE_SCENE_SIZE = 0x50;
export const CARD_BATTLE_SCENE_EXTRA = 4;
/** The object's dispatch word and the state-2 handover byte. */
export const CARD_BATTLE_SCENE_STATE = 0x0c;
export const CARD_BATTLE_SCENE_SUB = 0x10;
/** The state the object takes after the handover; state 3 is already done. */
export const CARD_BATTLE_SCENE_HANDOVER = 2;
export const CARD_BATTLE_SCENE_DONE = 3;
/** The state 1 arm waits for in the duel's own outcome byte. */
export const CARD_BATTLE_DUEL_FINISHED = 2;
/** The packet size, draw region and colour the setup writes. */
export const CARD_BATTLE_PACKET_SIZE = 0xa000;
export const CARD_BATTLE_REGION_X = 0x140;
export const CARD_BATTLE_REGION_Y = 0xf0;
export const CARD_BATTLE_RECT = 0x800a5938;
export const CARD_BATTLE_POOL = 3;
export const CARD_BATTLE_HANDLE = 0x100;
export const CARD_BATTLE_COLOUR = 0x1f;
/** The two card artwork packs and the VRAM x each is uploaded to. */
export const CARD_BATTLE_PACK_A = 0x025d0000;
export const CARD_BATTLE_PACK_B = 0x025d0001;
export const CARD_BATTLE_PAIR_A = 0x280;
export const CARD_BATTLE_PAIR_B = 0x340;
export const CARD_BATTLE_PAIR_Y = 0;
/** The state-2 arm's transition value and the party cell it falls back to. */
export const CARD_BATTLE_EXIT_VALUE = 0x1500;
export const CARD_BATTLE_PARTY = 0x80048d34;
export const CARD_BATTLE_SAVED_SELECTOR = 0x34;

const w32 = (mem: CardBattleSceneMemory, addr: number): number => mem.read32(addr) | 0;

/**
 * F0x80095BFC(obj, out): one frame of the card-battle screen. `out` is the
 * caller's pointer slot the duel object is stored through.
 */
export function cardBattleSceneTick(
    mem: CardBattleSceneMemory,
    host: CardBattleSceneHost,
    obj: number,
    out: number,
): void {
    const state = w32(mem, obj + CARD_BATTLE_SCENE_STATE);
    if (state === 1) {
        const duel = w32(mem, out);
        if ((mem.read8(duel + DUEL_OUTCOME_STATE) & 0xff) === CARD_BATTLE_DUEL_FINISHED) {
            host.setState(obj, CARD_BATTLE_SCENE_HANDOVER);
            host.setState(duel, DUEL_SCENE_STATE_AFTER_SETUP + 1);
        }
        return;
    }
    if (state === 2) {
        if (w32(mem, obj + CARD_BATTLE_SCENE_SUB) === 1) return;
        const value = (host.ordinalQuery(1) & 0xf) !== 0
            ? CARD_BATTLE_EXIT_VALUE
            : w32(mem, CARD_BATTLE_PARTY + CARD_BATTLE_SAVED_SELECTOR);
        host.requestTransition(value, 0);
        host.advanceSub(obj);
        return;
    }
    if (state === CARD_BATTLE_SCENE_DONE) return;
    // state 0 and anything above 3: build the screen.
    resetDisplayService(mem, host);
    setDisplayPacketIndex(mem, host, CARD_BATTLE_PACKET_SIZE);
    setDisplayRegion(mem, host, CARD_BATTLE_REGION_X, CARD_BATTLE_REGION_Y, 0, 0);
    const helper = host.helperBuffer() | 0;
    cardViewHelperInit(mem, helper);
    cardViewHelperSetPairA(mem, CARD_BATTLE_PAIR_A, CARD_BATTLE_PAIR_Y);
    cardViewHelperUploadPack(mem, host, host.resolvePack(CARD_BATTLE_PACK_A));
    cardViewHelperSetPairA(mem, CARD_BATTLE_PAIR_B, CARD_BATTLE_PAIR_Y);
    cardViewHelperUploadPack(mem, host, host.resolvePack(CARD_BATTLE_PACK_B));
    const view = registerDisplayView(
        mem, host, host.drawEnvScratch() | 0, CARD_BATTLE_RECT, CARD_BATTLE_POOL, CARD_BATTLE_HANDLE,
    ) | 0;
    setRectColour(mem, view, CARD_BATTLE_COLOUR, CARD_BATTLE_COLOUR, CARD_BATTLE_COLOUR);
    const duel = createCardDuel(mem, host, host.getCurrentShopId() | 0) | 0;
    mem.write32(out, duel);
    host.advancePhase(obj);
}

/**
 * F0x80095E2C(): the screen's factory thunk — F0x80014504(0x80095BFC, 0x50, 4).
 * The original's size argument is 0x50 and its extra block 4.
 */
export function createCardBattleScene(host: DuelCreateHost): number {
    return host.allocate(CARD_BATTLE_SCENE_ENTRY, CARD_BATTLE_SCENE_SIZE, CARD_BATTLE_SCENE_EXTRA) | 0;
}
