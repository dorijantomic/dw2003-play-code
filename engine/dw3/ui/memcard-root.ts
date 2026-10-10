// The memory-card screen's root object, translated from pro/stgmcard
// F0x80087B08 (create), F0x80087C18 (build identity / staging buffers) and
// F0x80087DF0 (are the text banks ready?). The root tick F0x800877F0 is the
// next piece and is not in this module yet.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/memcard-root-oracle.test.js runs the original through
// engine/native with the save-context getters, the resident context/fetcher/
// allocator services and the pack/bank services stubbed and compares the
// fields, the shared staging block and the ordered calls.
//
// DECODED: exe-decomp/stgmcard_c/_asm/F0x80087b08.s / F0x80087c18.s /
// F0x80087df0.s (authority 2) and the accepted memory-card-hud answer Family A.
// Create: F0x80014504(handler 0x800877F0, size 0x70, class 8); +0x54 = 0x1000;
// +0x50 = ((saveCtx+0x2708() >> 31) ^ 1); +0x68 = the category byte found in
// the 0x800883A4 table whose second halfword equals saveCtx+0x2714(); +0x6C =
// region table 0x8008833C[(saveCtx+0x2704() & 0xFF)]; then
// ensureSoundArchiveLoaded(0x20).
//
// Identity: install the standard context, set its origin (0x280,0), bind pack
// 0x029E0000, init the 0x41 state context, init the fetcher, fetch table entry
// 0x27 of resourceGetBase(lang+0x78), push it, call saveBuildHeader with the
// 0x80088940 record, then free + re-allocate the shared block's main image
// (0x2780) and side block (0x180) and request banks lang+0x78 / +0xA9 / +0x94.
//
// Banks-ready: 1 while any of those three banks is still loading, else 0.

export interface MemcardRootMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface MemcardRootHost {
    /** F0x80014504(handler, size, extra) -> the new root object. */
    allocRoot(handler: number, size: number, extra: number): number;
    /** (*saveCtx+0x2704)() = F0x80016B68: category / region index. */
    selectorCategory(): number;
    /** (*saveCtx+0x2708)() = F0x80016B78: the side/language word. */
    sideBit(): number;
    /** (*saveCtx+0x2714)() = F0x80016B58: the previous selector. */
    previousSelector(): number;
    /** (*0x80055C54)(id) = F0x80020574: request a sound archive. */
    requestSoundArchive(id: number): void;
}

/** The identity's boundary services. */
export interface MemcardRootIdentityHost extends MemcardRootHost {
    /** F0x8001FFA8(ctx): install the standard context vtable. */
    installStandardContext(): number;
    /** ctx+0x34 (sp34): set the context origin. */
    contextSetOrigin(ctx: number, x: number, y: number): void;
    /** (*0x80044B38+0x424)(handle) = F0x800140D8: pack handle -> directory. */
    packResolve(handle: number): number;
    /** ctx+0x3C (sp3C): bind a resolved pack sheet. */
    contextBindSheet(ctx: number, handle: number): void;
    /** (*0x8005B5DC+0x24)(ctx, kind): init the state context. */
    initStateContext(kind: number): number;
    /** F0x8001FCC0(ctx): initialise the fetcher table at ctx+0x48. */
    initFetcher(): void;
    /** (*0x80044B38+0x414)(id) = F0x80013E5C: resource bank id -> RAM base. */
    resourceGetBase(id: number): number;
    /** ctx+0x48 (sp48): fetch table entry `index` from the resource base. */
    fetchTableEntry(base: number, index: number): number;
    /** ctx+0x50 (sp50): push a fetched entry into the state context. */
    contextPush(ctx: number, value: number, flag: number): void;
    /** (*0x80058A80)(ctx, a1, a2, &record) = F0x80014930: build the save header. */
    saveBuildHeader(ctx: number, a1: number, a2: number, r0: number, r1: number, r2: number): void;
    /** (*0x8005B5DC+0x10)(ptr): free a staging buffer. */
    freeBuffer(ptr: number): void;
    /** (*0x8005B5DC+0x18)(size, mode): allocate a staging buffer. */
    allocBuffer(size: number, mode: number): number;
    /** (*0x80044B38+0x40C)(id) = F0x80013C30: request a text bank. */
    requestBank(id: number): void;
    /** (*0x80044B38+0x404)(id) = F0x80013A6C: nonzero while loading. */
    bankPending(id: number): number;
}

export const MEMCARD_ROOT_HANDLER = 0x800877f0;
export const MEMCARD_ROOT_SIZE = 0x70;
export const MEMCARD_ROOT_CLASS = 8;
export const MEMCARD_IDENTITY_TABLE = 0x800883a4;
export const MEMCARD_REGION_TABLE = 0x8008833c;
export const MEMCARD_SAVE_HEADER_RECORD = 0x80088940;
export const MEMCARD_IDENTITY_PACK = 0x029e0000;
export const MEMCARD_LANGUAGE_BANK = 0x78;
/** The shared staging block (also used by the block grid and the state machine). */
export const MEMCARD_STAGING = 0x80088768;
export const MEMCARD_STAGING_SIDE_PTR = 0x0c;
export const MEMCARD_STAGING_MAIN_PTR = 0x10;
export const MEMCARD_STAGING_SIDE_SIZE = 0x14;
export const MEMCARD_STAGING_MAIN_SIZE = 0x18;
export const MEMCARD_MAIN_IMAGE_SIZE = 0x2780;
export const MEMCARD_SIDE_BLOCK_SIZE = 0x180;
/** The three text banks the root requests / polls. */
export const MEMCARD_ROOT_BANKS: ReadonlyArray<number> = [0x78, 0xa9, 0x94];

/** Root fields. */
export const MEMCARD_ROOT = {
    state: 0x0c,
    substate: 0x10,
    step: 0x14,
    side: 0x50,
    target: 0x54,
    ambient: 0x58,
    ambientToggle: 0x5c,
    category: 0x68,
    region: 0x6c,
} as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x80087B08(): build and return the memory-card root object. */
export function memcardRootCreate(mem: MemcardRootMemory, host: MemcardRootHost): number {
    const obj = host.allocRoot(MEMCARD_ROOT_HANDLER, MEMCARD_ROOT_SIZE, MEMCARD_ROOT_CLASS) >>> 0;
    mem.write32(obj + MEMCARD_ROOT.target, 0x1000);
    const category = host.selectorCategory();
    const side = host.sideBit();
    const previous = host.previousSelector();
    mem.write32(obj + MEMCARD_ROOT.side, (((side >>> 31) ^ 1) >>> 0));
    for (let addr = MEMCARD_IDENTITY_TABLE; ; addr += 4) {
        const id = s16(mem.read16(addr + 2));
        if (id === 0) break;
        if (id === s32(previous)) mem.write32(obj + MEMCARD_ROOT.category, mem.read8(addr) >>> 0);
    }
    mem.write32(obj + MEMCARD_ROOT.region, mem.read32(MEMCARD_REGION_TABLE + (category & 0xff) * 4) >>> 0);
    host.requestSoundArchive(0x20);
    return obj;
}

/** F0x80087C18(): build the save identity and the shared staging buffers. */
export function memcardRootIdentity(
    mem: MemcardRootMemory,
    host: MemcardRootIdentityHost,
): void {
    const ctx = host.installStandardContext();
    host.contextSetOrigin(ctx, 0x280, 0);
    host.contextBindSheet(ctx, host.packResolve(MEMCARD_IDENTITY_PACK) >>> 0);
    const state = host.initStateContext(0x41);
    host.initFetcher();
    const language = mem.read32(0x8005cca8) >>> 0;
    const base = host.resourceGetBase((language + MEMCARD_LANGUAGE_BANK) >>> 0);
    const fetched = host.fetchTableEntry(base, 0x27);
    host.contextPush(state, fetched, 0);
    host.saveBuildHeader(
        state,
        mem.read32(MEMCARD_SAVE_HEADER_RECORD) >>> 0,
        3,
        mem.read32(MEMCARD_SAVE_HEADER_RECORD + 4) >>> 0,
        mem.read32(MEMCARD_SAVE_HEADER_RECORD + 8) >>> 0,
        mem.read32(MEMCARD_SAVE_HEADER_RECORD + 0xc) >>> 0,
    );
    const mainOld = mem.read32(MEMCARD_STAGING + MEMCARD_STAGING_MAIN_PTR) >>> 0;
    if (mainOld !== 0) host.freeBuffer(mainOld);
    const mainPtr = host.allocBuffer(MEMCARD_MAIN_IMAGE_SIZE, 2) >>> 0;
    mem.write32(MEMCARD_STAGING + MEMCARD_STAGING_MAIN_SIZE, MEMCARD_MAIN_IMAGE_SIZE);
    const sideOld = mem.read32(MEMCARD_STAGING + MEMCARD_STAGING_SIDE_PTR) >>> 0;
    mem.write32(MEMCARD_STAGING + MEMCARD_STAGING_MAIN_PTR, mainPtr);
    if (sideOld !== 0) host.freeBuffer(sideOld);
    const sidePtr = host.allocBuffer(MEMCARD_SIDE_BLOCK_SIZE, 2) >>> 0;
    mem.write32(MEMCARD_STAGING + MEMCARD_STAGING_SIDE_SIZE, MEMCARD_SIDE_BLOCK_SIZE);
    mem.write32(MEMCARD_STAGING + MEMCARD_STAGING_SIDE_PTR, sidePtr);
    for (const off of MEMCARD_ROOT_BANKS) host.requestBank((language + off) >>> 0);
}

/** F0x80087DF0(): 1 while any of the three text banks is still loading. */
export function memcardRootBanksReady(
    mem: MemcardRootMemory,
    host: MemcardRootIdentityHost,
): number {
    const language = mem.read32(0x8005cca8) >>> 0;
    for (const off of MEMCARD_ROOT_BANKS) {
        if (host.bankPending((language + off) >>> 0) !== 0) return 1;
    }
    return 0;
}

/** The root tick's boundary services. */
export interface MemcardRootTickHost {
    /** screen->0x38 (F0x800142AC): advance the lifecycle. */
    advancePhase(screen: number): void;
    /** screen->0x3C (F0x800142C8): advance the sub-state / run the child. */
    advanceSubstate(screen: number): void;
    /** *(0x80088784) = F0x80087C18: build the identity + staging buffers. */
    buildIdentity(): void;
    /** *(0x80088788) = F0x80087DF0: 1 while any text bank is loading. */
    banksReady(): number;
    /** (*0x80055C60)(arg) = F0x8002043C: nonzero while audio is loading. */
    audioPending(arg: number): number;
    /** (*0x80055C48)(id) = F0x8002006C: play a packed sound. */
    playSound(id: number): void;
    /** (*0x80055C68)(id) = F0x800202D4: the exit sound. */
    playSoundExit(id: number): void;
    /** F0x80087798(screen) -> the message/confirm window. */
    createMessageWindow(screen: number): number;
    /** F0x80083074(): the fade object constructor. */
    fadeCtor(): number;
    /** fade->0x64(fade, a1, a2): start the fade. */
    fadeStart(fade: number, a1: number, a2: number): void;
    /** *(0x80048D34+0x270C): the request-transition method. */
    requestTransition(selector: number, arg: number): void;
    /** *(0x80048D34+0x2714)(): the previous selector. */
    selectorMethod(): number;
    /** *(0x80048D34+0x34): the saved/current field id. */
    saveSelector(): number;
    /** *(0x8008878C) = F0x80087E78: free the icon + title. */
    freeIconTitle(): void;
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] = F0x800140D8: pack handle -> directory pointer. */
    packResolve(handle: number): number;
}

/** The message-window slot and fade slot inside the aux block. */
export const MEMCARD_AUX_WINDOW = 0x00;
export const MEMCARD_AUX_FADE = 0x04;
/** The root's exit sound and the ambient counter bounds. */
export const MEMCARD_ROOT_EXIT_SOUND = 0x60800000;
export const MEMCARD_AMBIENT_LIMIT = 0x60;

/** F0x800877F0(screen, aux): one memory-card root frame. */
export function memcardRootTick(
    mem: MemcardRootMemory,
    screen: number,
    aux: number,
    host: MemcardRootTickHost,
): void {
    const state = s32(mem.read32(screen + MEMCARD_ROOT.state));

    if (state === 1) {
        const substate = s32(mem.read32(screen + MEMCARD_ROOT.substate));
        if (substate === 1) {
            const window = mem.read32(aux + MEMCARD_AUX_WINDOW) >>> 0;
            if (s32(mem.read32(window + 0x0c)) === 2) {
                const fade = host.fadeCtor() >>> 0;
                mem.write32(aux + MEMCARD_AUX_FADE, fade);
                host.fadeStart(fade, 0, 0x1e);
                mem.write32(screen + MEMCARD_ROOT.substate, 2);
            }
        } else if (substate === 2) {
            const fade = mem.read32(aux + MEMCARD_AUX_FADE) >>> 0;
            if (s32(mem.read32(fade + 0x0c)) === 2) {
                mem.write32(screen + MEMCARD_ROOT.state, 3);
            }
        } else {
            let window = mem.read32(aux + MEMCARD_AUX_WINDOW) >>> 0;
            if (window === 0) {
                window = host.createMessageWindow(screen) >>> 0;
                mem.write32(aux + MEMCARD_AUX_WINDOW, window);
            }
            host.advanceSubstate(screen);
        }
        memcardRootDraw(mem, screen, host);
        return;
    }

    if (state === 3) {
        host.playSoundExit(MEMCARD_ROOT_EXIT_SOUND);
        let selector: number;
        if (s32(mem.read32(screen + MEMCARD_ROOT.step)) === 0) {
            selector = host.saveSelector();
        } else if (s32(mem.read32(screen + MEMCARD_ROOT.side)) !== 0) {
            selector = 0xe00;
        } else {
            selector = host.selectorMethod();
        }
        host.requestTransition(selector, 0);
        host.freeIconTitle();
        return;
    }

    if (state === 2 || (state > 0 && state < 4)) return;

    // default band: state 0 or >= 4
    const substate = s32(mem.read32(screen + MEMCARD_ROOT.substate));
    if (substate !== 1) {
        host.buildIdentity();
        mem.write32(screen + MEMCARD_ROOT.substate, (substate + 1) >>> 0);
        return;
    }
    if (host.banksReady() !== 0) return;
    if (host.audioPending(state) !== 0) return;
    host.playSound(MEMCARD_ROOT_EXIT_SOUND);
    host.advancePhase(screen);
}

/** The root tick's draw band. */
function memcardRootDraw(
    mem: MemcardRootMemory,
    screen: number,
    host: MemcardRootTickHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(screen + MEMCARD_ROOT.target), 3);
    host.setOrigin(0x280, 0);
    host.drawSprite(host.packResolve(0x029d0000) >>> 0, 0x1f, 0x19, 0);
    if (s32(mem.read32(screen + MEMCARD_ROOT.ambientToggle)) !== 0) {
        const counter = s32(mem.read32(screen + MEMCARD_ROOT.ambient));
        mem.write32(
            screen + MEMCARD_ROOT.ambient,
            ((counter + 1 < MEMCARD_AMBIENT_LIMIT) ? counter + 1 : 0) >>> 0,
        );
        mem.write32(screen + MEMCARD_ROOT.ambientToggle, 0);
    } else {
        mem.write32(screen + MEMCARD_ROOT.ambientToggle, 1);
    }
    const counter = mem.read32(screen + MEMCARD_ROOT.ambient);
    host.drawSprite(host.packResolve(0x029d0000) >>> 0, 0x1e, counter, counter);
}
