// The training gym's per-frame flow machine, translated from pro/stgtrain
// F0x8008517C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/gym-flow-oracle.test.js runs the original through engine/native
// with the child-screen factories, the pad cells, the gate/sound hooks and every
// widget method stubbed and compares the ordered calls and the screen fields.
//
// DECODED: the accepted gym-flow-tick answer (authority-2 asm anchors) plus the
// gym-hud-text answer. The machine walks the left HUD panels open (states 1-4),
// lets the pad pick a pod (state 5), and closes them again (0x14/0x32/0x33/0x34);
// the drill picker, confirm screen, training session and panel are child objects
// in the hud pointer array at hud+0x70/+0x74/+0x78/+0x7C. Folds are the shared
// window-fold tween (translated in window-fold.ts); the three HUD fills are the
// translated functions in gym-hud.ts. States 0, 6-9, 0xC-0x13, 0x16-0x18, 0x1D,
// 0x20-0x22, 0x26-0x31 and >= 0x35 share the default arm that only opens the
// first two folds.

import {
    gymHudTextFill,
    gymPartnerSummaryFill,
    gymStatReadoutsFill,
    type GymHudHost,
    type GymHudMemory,
} from "./gym-hud.ts";
import { windowFoldStart, windowFoldTick } from "./window-fold.ts";

export interface GymFlowHost extends GymHudHost {
    /** Pad pressed-this-frame bitmask (port 0 of the pad service). */
    padPressed(): number;
    /** Pad auto-repeat bitmask. */
    padRepeat(): number;
    /** The logical->physical bit map (identity as shipped). */
    padBit(logical: number): number;
    /** The resident packed-sound player. */
    playSound(id: number): void;
    /** F0x8008B838(screen): construct the drill picker. */
    drillPicker(screen: number): number;
    /** F0x80089764(screen): construct the confirm/TP screen. */
    confirmScreen(screen: number): number;
    /** F0x80088070(screen, slot, screen+0x78): construct the training session. */
    trainingSession(screen: number, slot: number, drill: number): number;
    /** F0x80086174(): construct the closing panel object. */
    panel(screen: number): number;
    /** (hud+0x74)->+0xF8(child): close the confirm screen. */
    closeConfirm(child: number): void;
    /** (hud+0x7C)->+0x64(child, a1, a2): run the panel handler. */
    panelRun(child: number, a1: number, a2: number): void;
    /** F0x8008BAA8(index): preload the gym's TRANIN pack. */
    preloadGym(index: number): void;
    /** F0x8008BB38(): the training-offer gate. */
    trainingOfferReady(): number;
}

/** The seven fold records, stride 0x10 from screen+0xA0. */
export const GYM_FOLD_BASE = 0xa0;
/** Screen/hud fields the flow reads or writes. */
export const GYM_FLOW_FIELDS = {
    state: 0x10,
    lifecycle: 0x0c,
    podCount: 0x64,
    pod: 0x68,
    settled: 0x6c,
    drill: 0x78,
    reset98: 0x98,
    resetF8: 0xf8,
    picker: 0x70,
    confirm: 0x74,
    session: 0x78,
    panel: 0x7c,
    widgetA: 0x68,
    widgetB: 0x6c,
} as const;
const HANDLER_READY = 3;
/** Pad logical bits. */
const PAD_LEFT = 7;
const PAD_RIGHT = 5;
const PAD_CIRCLE = 0x0d;
const PAD_CROSS = 0x0e;

/** F0x8008517C(screen, hud, proj): advance the gym flow machine. */
export function gymFlowTick(
    mem: GymHudMemory,
    screen: number,
    hud: number,
    host: GymFlowHost,
    proj: number,
): void {
    const state = mem.read32(screen + GYM_FLOW_FIELDS.state) | 0;
    const w = (off: number): number => mem.read32(hud + off) >>> 0;
    const screenWord = (off: number): number => mem.read32(screen + off) | 0;
    const setScreen = (off: number, value: number): void => mem.write32(screen + off, value >>> 0);
    const fold = (rec: number): number => windowFoldTick(mem, screen + rec) | 0;
    const openFold = (rec: number, dir: number): void => windowFoldStart(mem, screen + rec, dir);
    const bump = (): void => setScreen(GYM_FLOW_FIELDS.state, screenWord(GYM_FLOW_FIELDS.state) + 1);
    const padBit = (logical: number): number => (host.padPressed() >> host.padBit(logical)) & 1;
    const repeatBit = (logical: number): number => (host.padRepeat() >> host.padBit(logical)) & 1;
    const setWidgetA = (index: number): void =>
        host.widgetSetLine0(w(GYM_FLOW_FIELDS.widgetA), host.resolveText(0x10b), index);
    const setWidgetB = (index: number): void =>
        host.widgetSetLine0(w(GYM_FLOW_FIELDS.widgetB), host.resolveText(0x10b), index);

    switch (state) {
        case 1:
            fold(0xd0);
            if (fold(0xa0) !== 0) {
                gymHudTextFill(mem, screen, hud, 1, host, proj);
                setWidgetA(5);
                openFold(0xb0, 1);
                openFold(0xe0, 1);
                bump();
            }
            return;
        case 2:
            fold(0xe0);
            if (fold(0xb0) !== 0) {
                gymStatReadoutsFill(mem, screen, hud, 1, host, proj);
                setWidgetB(6);
                openFold(0xc0, 1);
                openFold(0x100, 1);
                bump();
            }
            return;
        case 3:
            fold(0x100);
            if (fold(0xc0) !== 0) {
                gymPartnerSummaryFill(mem, screen, hud, 1, host, proj);
                openFold(0xf0, 1);
                bump();
            }
            return;
        case 4:
            if (fold(0xf0) !== 0) {
                setScreen(GYM_FLOW_FIELDS.settled, 1);
                bump();
            }
            return;
        case 5: {
            const before = screenWord(GYM_FLOW_FIELDS.pod);
            if (padBit(PAD_LEFT) !== 0 || repeatBit(PAD_LEFT) !== 0) {
                const next = before - 1;
                setScreen(GYM_FLOW_FIELDS.pod, next < 0 ? 0 : next);
            } else if (padBit(PAD_RIGHT) !== 0 || repeatBit(PAD_RIGHT) !== 0) {
                const next = before + 1;
                const max = screenWord(GYM_FLOW_FIELDS.podCount) - 1;
                setScreen(GYM_FLOW_FIELDS.pod, max < next ? max : next);
            }
            if (before !== screenWord(GYM_FLOW_FIELDS.pod)) {
                host.playSound(0x4001b);
                gymHudTextFill(mem, screen, hud, 1, host, proj);
                gymStatReadoutsFill(mem, screen, hud, 1, host, proj);
                gymPartnerSummaryFill(mem, screen, hud, 1, host, proj);
                setScreen(GYM_FLOW_FIELDS.reset98, 0);
                return;
            }
            if (padBit(PAD_CIRCLE) !== 0) {
                host.playSound(0x4001c);
                setScreen(GYM_FLOW_FIELDS.state, 0x14);
                const picker = w(GYM_FLOW_FIELDS.picker);
                if (picker !== 0) mem.write32(picker + 0x0c, HANDLER_READY);
                return;
            }
            if (padBit(PAD_CROSS) !== 0) {
                host.playSound(0x800450bd);
                setScreen(GYM_FLOW_FIELDS.state, 0x32);
            }
            return;
        }
        case 0x0a:
            if (w(GYM_FLOW_FIELDS.picker) === 0) {
                mem.write32(hud + GYM_FLOW_FIELDS.picker, host.drillPicker(screen) >>> 0);
                bump();
            }
            return;
        case 0x0b: {
            const picker = w(GYM_FLOW_FIELDS.picker);
            if (picker === 0) {
                setScreen(GYM_FLOW_FIELDS.state, 0x1e);
                return;
            }
            if ((mem.read32(picker + 0x0c) | 0) === 2) {
                setScreen(GYM_FLOW_FIELDS.drill, 0);
                mem.write32(picker + 0x0c, HANDLER_READY);
                setScreen(GYM_FLOW_FIELDS.state, 0x19);
            }
            return;
        }
        case 0x14:
            setScreen(GYM_FLOW_FIELDS.resetF8, 0);
            openFold(0x100, 0);
            setScreen(GYM_FLOW_FIELDS.settled, 0);
            openFold(0xe0, 0);
            host.widgetSetFlagC1(w(GYM_FLOW_FIELDS.widgetB), 0);
            openFold(0xd0, 0);
            host.widgetSetFlagC1(w(GYM_FLOW_FIELDS.widgetA), 0);
            bump();
            return;
        case 0x15:
            fold(0x100);
            fold(0xe0);
            if (fold(0xd0) !== 0) setScreen(GYM_FLOW_FIELDS.state, 0x0a);
            return;
        case 0x19:
            openFold(0xd0, 1);
            bump();
            return;
        case 0x1a:
            if (fold(0xd0) !== 0) {
                setWidgetA(5);
                openFold(0xe0, 1);
                bump();
            }
            return;
        case 0x1b:
            if (fold(0xe0) !== 0) {
                setWidgetB(6);
                openFold(0x100, 1);
                bump();
            }
            return;
        case 0x1c:
            if (fold(0x100) !== 0) {
                openFold(0xf0, 1);
                setScreen(GYM_FLOW_FIELDS.state, 4);
            }
            return;
        case 0x1e:
            if (w(GYM_FLOW_FIELDS.confirm) === 0) {
                mem.write32(hud + GYM_FLOW_FIELDS.confirm, host.confirmScreen(screen) >>> 0);
                bump();
                host.preloadGym(screenWord(GYM_FLOW_FIELDS.drill));
            }
            return;
        case 0x1f: {
            const confirm = w(GYM_FLOW_FIELDS.confirm);
            const mode = mem.read32(confirm + 0x10) | 0;
            if (mode === 0x23) {
                const session = w(GYM_FLOW_FIELDS.session);
                if (session !== 0) {
                    mem.write32(session + 0x0c, HANDLER_READY);
                    return;
                }
                setScreen(GYM_FLOW_FIELDS.state, 0x23);
                gymPartnerSummaryFill(mem, screen, hud, 1, host, proj);
                return;
            }
            if ((mem.read32(confirm + 0x0c) | 0) === 2) {
                mem.write32(confirm + 0x0c, HANDLER_READY);
                setScreen(GYM_FLOW_FIELDS.state, 0x0a);
            }
            return;
        }
        case 0x23:
            if (host.trainingOfferReady() !== 0 && w(GYM_FLOW_FIELDS.session) === 0) {
                const slot = host.rosterSlot(screenWord(GYM_FLOW_FIELDS.pod)) | 0;
                mem.write32(
                    hud + GYM_FLOW_FIELDS.session,
                    host.trainingSession(screen, slot, screenWord(GYM_FLOW_FIELDS.drill)) >>> 0,
                );
                bump();
            }
            return;
        case 0x24:
            if (w(GYM_FLOW_FIELDS.session) === 0) {
                host.closeConfirm(w(GYM_FLOW_FIELDS.confirm));
                bump();
            }
            return;
        case 0x25:
            if (w(GYM_FLOW_FIELDS.confirm) === 0) {
                gymStatReadoutsFill(mem, screen, hud, 1, host, proj);
                setScreen(GYM_FLOW_FIELDS.state, 0x19);
            }
            return;
        case 0x32:
            mem.write32(hud + GYM_FLOW_FIELDS.panel, host.panel(screen) >>> 0);
            host.panelRun(w(GYM_FLOW_FIELDS.panel), 0, 0x1e);
            setScreen(GYM_FLOW_FIELDS.resetF8, 0);
            for (let i = 0; i < 3; i++) openFold(GYM_FOLD_BASE + 0x10 * i, 0);
            gymHudTextFill(mem, screen, hud, 0, host, proj);
            gymStatReadoutsFill(mem, screen, hud, 0, host, proj);
            gymPartnerSummaryFill(mem, screen, hud, 0, host, proj);
            openFold(0x100, 0);
            setScreen(GYM_FLOW_FIELDS.settled, 0);
            openFold(0xe0, 0);
            host.widgetSetFlagC1(w(GYM_FLOW_FIELDS.widgetB), 0);
            openFold(0xd0, 0);
            host.widgetSetFlagC1(w(GYM_FLOW_FIELDS.widgetA), 0);
            bump();
            return;
        case 0x33:
            for (let i = 0; i < 3; i++) fold(GYM_FOLD_BASE + 0x10 * i);
            fold(0x100);
            fold(0xe0);
            if (fold(0xd0) !== 0) bump();
            return;
        case 0x34:
            if ((mem.read32(w(GYM_FLOW_FIELDS.panel) + 0x0c) | 0) === 2) {
                setScreen(GYM_FLOW_FIELDS.lifecycle, HANDLER_READY);
            }
            return;
        default:
            openFold(0xa0, 1);
            openFold(0xd0, 1);
            bump();
            return;
    }
}
