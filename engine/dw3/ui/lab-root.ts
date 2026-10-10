// The developer lab's root screen, translated from pro/stgdglab F0x8008EFD0
// (create), F0x8008ED0C (tick), F0x8008EB30 (action tick), F0x8008EC50
// (count + pack party), F0x8008F040 (text pages bind) and F0x8008F16C
// (text banks loading).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lab-root-oracle.test.js runs the original through
// engine/native with the child factories, the standard-context slots, the
// pack/bank services and the draw-context methods stubbed and compares the
// fields and the ordered calls.
//
// DECODED: the six `exe-decomp/stgdglab_c/_asm/F0x8008*.s` closures
// (authority 2) and the accepted stgdglab-lab-families answer Family L. The
// root is F0x80014504(handler 0x8008ED0C, size 0x7C, extra 0x0C) with +0x50 =
// 0x1000 and the helper slots +0x68/+0x6C/+0x70/+0x74/+0x78. The tick's
// phases bind the text pages (0x8008F040) then wait on the five banks
// (0x8008F16C), advance the lifecycle, set +0x5C = 3 and compact the party; the
// live lifecycle runs the action tick and draws the scrolling-lab wall
// (0x02C50000 clip 0x37 at the ambient counter); the exit restores the field.
//
// The chunk of the whole lab screen that many people first meet is the Select
// Action child (0x8008A610) and its choice table 0x8008F4B8 — not translated
// yet, so the action tick takes them as boundaries.

export interface LabRootMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface LabRootHost {
    /** F0x80014504(handler, size, extra) -> the new root object. */
    allocLabRoot(handler: number, size: number, extra: number): number;
}

/** The tick's boundary services. */
export interface LabRootTickHost extends LabRootHost {
    /** screen->0x38 (F0x800142AC): advance the lifecycle. */
    advancePhase(screen: number): void;
    /** screen->0x28 (F0x80014274): set the phase. */
    setState(screen: number, phase: number): void;
    /** *(0x80048D34+0x270C): request the field restore. */
    requestTransition(selector: number, arg: number): void;
    /** *(0x80048D34+0x34): the saved field id. */
    saveSelector(): number;
    /** F0x8008A610(root) -> the Select Action child. */
    spawnSelectAction(root: number): number;
    /** 0x8008F4B8[cursor](root, 1) -> the chosen child. */
    choiceChild(root: number, cursor: number): number;
    /** F0x8001FFA8(ctx): install the 0x34-byte standard context. */
    installStandardContext(): number;
    /** ctx+0x24/0x28/0x2C/0x30: run one standard-context slot. */
    contextCall(slot: number, a: number, b: number): void;
    /** (*0x80044B38+0x424)(handle) = F0x800140D8: pack handle -> directory. */
    packResolve(handle: number): number;
    /** (*0x80044B38+0x40C)(id) = F0x80013C30: request a text bank. */
    requestBank(id: number): void;
    /** (*0x80044B38+0x404)(id) = F0x80013A6C: nonzero while loading. */
    bankPending(id: number): number;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
}

export const LAB_ROOT_HANDLER = 0x8008ed0c;
export const LAB_ROOT_SIZE = 0x7c;
export const LAB_ROOT_EXTRA = 0x0c;
export const LAB_ROOT_CLOSE = 0x8008eea0;
export const LAB_ROOT_REOPEN = 0x8008eefc;
export const LAB_ROOT_PREDICATE = 0x8008ef58;
export const LAB_ROOT_COUNT_PACK = 0x8008ec50;
export const LAB_ROOT_FADE_PANEL = 0x8008ef8c;
export const LAB_ROOT_PAGES_BIND = 0x8008f040;
export const LAB_ROOT_BANKS_LOADING = 0x8008f16c;
export const LAB_ROOT_PACK = 0x02c50000;
export const LAB_ROOT_AMBIENT_LIMIT = 0x60;
/** The five text banks the pages bind requests and the loading gate polls. */
export const LAB_ROOT_BANKS: ReadonlyArray<number> = [0x39, 0x4e, 0x47, 0xa2, 0x9b];

/** Root object and extra-block fields. */
export const LAB_ROOT = {
    phase: 0x0c,
    substate: 0x10,
    setState: 0x28,
    advance: 0x38,
    target: 0x50,
    ambient: 0x54,
    ambientToggle: 0x58,
    result: 0x5c,
    partyCount: 0x60,
    slotClose: 0x68,
    slotReopen: 0x6c,
    slotPredicate: 0x70,
    slotCountPack: 0x74,
    slotFade: 0x78,
} as const;

const s32 = (v: number): number => v | 0;

/** F0x8008EFD0(): build the lab root object. */
export function labRootConstruct(mem: LabRootMemory, host: LabRootHost): number {
    const obj = host.allocLabRoot(LAB_ROOT_HANDLER, LAB_ROOT_SIZE, LAB_ROOT_EXTRA) >>> 0;
    mem.write32(obj + LAB_ROOT.slotClose, LAB_ROOT_CLOSE);
    mem.write32(obj + LAB_ROOT.slotReopen, LAB_ROOT_REOPEN);
    mem.write32(obj + LAB_ROOT.slotPredicate, LAB_ROOT_PREDICATE);
    mem.write32(obj + LAB_ROOT.slotCountPack, LAB_ROOT_COUNT_PACK);
    mem.write32(obj + LAB_ROOT.slotFade, LAB_ROOT_FADE_PANEL);
    mem.write32(obj + LAB_ROOT.target, 0x1000);
    return obj;
}

/** F0x8008EC50(self): count the standing party and compact the holes away. */
export function labRootCountAndPackParty(mem: LabRootMemory, self: number): void {
    mem.write32(self + LAB_ROOT.partyCount, 0);
    const party = 0x80048d34 + 0x70;
    for (let i = 0; i < 3; i++) {
        if (s32(mem.read32(party + i * 4)) >= 0) {
            mem.write32(self + LAB_ROOT.partyCount, (mem.read32(self + LAB_ROOT.partyCount) + 1) >>> 0);
        }
    }
    for (let i = 0; i < 3; i++) {
        if (s32(mem.read32(party + i * 4)) >= 0) continue;
        for (let j = i; j < 3; j++) {
            const value = s32(mem.read32(party + j * 4));
            if (value >= 0) {
                mem.write32(party + i * 4, value >>> 0);
                mem.write32(party + j * 4, 0xffffffff);
                break;
            }
        }
    }
}

/** F0x8008F16C(): 1 while any of the five text banks is still loading. */
export function labRootTextBanksLoading(mem: LabRootMemory, host: LabRootTickHost): number {
    const language = mem.read32(0x8005cca8) >>> 0;
    for (const off of LAB_ROOT_BANKS) {
        if (host.bankPending((language + off) >>> 0) !== 0) return 1;
    }
    return 0;
}

/** F0x8008F040(): bind the lab's text pages and request the five banks. */
export function labRootTimPagesBind(mem: LabRootMemory, host: LabRootTickHost): void {
    host.installStandardContext();
    host.contextCall(0x24, 0x280, 0x100);
    host.contextCall(0x2c, host.packResolve(0x02c60000) >>> 0, 0);
    host.contextCall(0x24, 0x140, 0x100);
    host.contextCall(0x28, 0x280, 0);
    host.contextCall(0x30, 0x10000, 0);
    host.contextCall(0x2c, host.packResolve(0x02c60002) >>> 0, 0);
    const language = mem.read32(0x8005cca8) >>> 0;
    for (const off of LAB_ROOT_BANKS) host.requestBank((language + off) >>> 0);
}

/** F0x8008EB30(root, aux): the Select Action substate machine. */
export function labRootActionTick(
    mem: LabRootMemory,
    root: number,
    aux: number,
    host: LabRootTickHost,
): void {
    const step = s32(mem.read32(root + LAB_ROOT.substate));

    if (step === 1) {
        const child = mem.read32(aux) >>> 0;
        if (child === 0) {
            mem.write32(root + LAB_ROOT.substate, 3);
            return;
        }
        if (s32(mem.read32(child + 0x54)) !== 0) {
            const cursor = s32(mem.read32(child + 0x60));
            mem.write32(aux + 4, host.choiceChild(root, cursor) >>> 0);
            mem.write32(root + LAB_ROOT.substate, 2);
        }
        return;
    }
    if (step === 2) {
        if (mem.read32(aux + 4) !== 0) return;
        mem.write32(root + LAB_ROOT.substate, 1);
        const child = mem.read32(aux) >>> 0;
        mem.write32(child + 0x54, 0);
        return;
    }
    if (step === 3) {
        const fade = mem.read32(aux + 8) >>> 0;
        if (s32(mem.read32(fade + 0x0c)) === 2) host.setState(root, 3);
        return;
    }
    // step 0 and anything >= 4
    if (mem.read32(aux) === 0) {
        mem.write32(aux, host.spawnSelectAction(root) >>> 0);
    }
    mem.write32(root + LAB_ROOT.substate, (step + 1) >>> 0);
}

/** F0x8008ED0C(root, aux): one lab-root frame. */
export function labRootTick(
    mem: LabRootMemory,
    root: number,
    aux: number,
    host: LabRootTickHost,
): void {
    const phase = s32(mem.read32(root + LAB_ROOT.phase));

    if (phase === 1) {
        labRootActionTick(mem, root, aux, host);
        host.initDrawContext();
        host.setLayer(mem.read32(root + LAB_ROOT.target), 7);
        host.setOrigin(0x280, 0x100);
        if (s32(mem.read32(root + LAB_ROOT.ambientToggle)) !== 0) {
            const counter = s32(mem.read32(root + LAB_ROOT.ambient));
            mem.write32(
                root + LAB_ROOT.ambient,
                ((counter + 1 < LAB_ROOT_AMBIENT_LIMIT) ? counter + 1 : 0) >>> 0,
            );
            mem.write32(root + LAB_ROOT.ambientToggle, 0);
        } else {
            mem.write32(root + LAB_ROOT.ambientToggle, 1);
        }
        const counter = mem.read32(root + LAB_ROOT.ambient);
        host.drawSprite(host.packResolve(LAB_ROOT_PACK) >>> 0, 0x37, counter, counter);
        return;
    }
    if (phase === 3) {
        host.requestTransition(host.saveSelector(), 0);
        return;
    }
    if (phase === 2) return;

    // phases: phase 0 or >= 4
    const substate = s32(mem.read32(root + LAB_ROOT.substate));
    if (substate === 1) {
        if (labRootTextBanksLoading(mem, host) !== 0) return;
        host.advancePhase(root);
        mem.write32(root + LAB_ROOT.result, 3);
        labRootCountAndPackParty(mem, root);
    } else {
        labRootTimPagesBind(mem, host);
        mem.write32(root + LAB_ROOT.substate, (substate + 1) >>> 0);
    }
}
