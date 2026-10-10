// Browser driver for the native SCREEN overlays (engine/native/ via the bundle).
//
// Phase 1 of docs/plans/2026-09-14-native-screen-port-plan.md. The 20 roots in
// data/native_screen_roots.json carry their ORIGINAL screen machine code
// (item shop, gym, naming, wizard, card album/folder/shop, pause, title,
// card duel, ...). The assets are shipped by tools/build_native_screens.py:
// the resident PS-X EXE image (the shared services the screens call), each
// overlay image, and the disc banks the screens request from the resident
// cache service.
//
// Everything is preloaded at load() so boot and tick are SYNCHRONOUS: the
// runtime's bank transfer stub calls host.readBank during a tick, so bank bytes
// cannot be fetched lazily. This module publishes the recorded draw intents
// (drawCalls) for the lab to show; it makes no visual claim of its own.
//
// Fail-soft by construction: a trap disables that one object and is counted;
// nativeScreenState() reports it.

import { ui } from "./vendor/engine.js";
// The interpreter is NEVER statically imported here: it lives in the
// research-only bundle web/vendor/engine-native.js, reached through this
// dynamic doorway (see web/native-runtime.js). loadNativeScreens() awaits it
// before any screen boots, so boot and tick stay synchronous once loaded.
import { loadNativeRuntime, nativeRuntime } from "./native-runtime.js";

const BASE = "assets/native/screens";

const resolverDirs = new Map(); // resolver-made pack directory pointer -> { idx, sub }

const state = {
    manifest: null,
    resident: null,
    overlays: {}, // module -> Uint8Array
    banks: new Map(), // bank id -> Uint8Array
    current: null,
};

export async function loadNativeScreens() {
    // Fetch the interpreter bundle first, so bootNativeScreen can stay
    // synchronous (its bank-transfer stub runs mid-tick and cannot await).
    await loadNativeRuntime();
    const manifest = await (await fetch(`${BASE}/manifest.json`)).json();
    const resident = new Uint8Array(await (await fetch(`${BASE}/resident.bin`)).arrayBuffer());
    const overlays = {};
    await Promise.all(
        Object.entries(manifest.screens).map(async ([id, entry]) => {
            overlays[id] = new Uint8Array(await (await fetch(`${BASE}/${entry.file}`)).arrayBuffer());
        }),
    );
    const ids = new Set();
    for (const entry of Object.values(manifest.screens)) for (const b of entry.bank_ids ?? []) ids.add(b);
    await Promise.all(
        [...ids].map(async (id) => {
            try {
                const r = await fetch(`${BASE}/banks/${id}.bin`);
                if (r.ok) state.banks.set(id, new Uint8Array(await r.arrayBuffer()));
            } catch {
                /* bank not shipped: the cache service zero-fills, as the host contract says */
            }
        }),
    );
    state.manifest = manifest;
    state.resident = resident;
    state.overlays = overlays;
    return manifest;
}

/** Host input service: set the held button word for a port (0/1). The runtime
 *  derives the pressed edge on the next tick. Button bits are the identity map
 *  (docs/research/ui/pad-input-service-behaviour-2026-08-21.md): Start 0x0008,
 *  Up 0x0010, Right 0x0020, Down 0x0040, Left 0x0080, Triangle 0x1000,
 *  Circle 0x2000 (confirm), Cross 0x4000 (cancel), Square 0x8000. */
export function setNativeScreenPad(buttons, port = 0) {
    if (state.current?.rt) state.current.rt.setPadHeld(port, buttons >>> 0);
}

/** Encode a display name into the screen text codec (web/native-screen-text.js:
 *  a single byte 0x04+d = digit, 0x0e+n = A-Z, 0x28+n = a-z; the two-byte pair
 *  0x01,0x01 is the extended space). Names the pause pages show are read as raw
 *  strings out of the roster record (record +0x08), so they use this codec. */
export function encodeNativeScreenText(s, maxBytes = 23) {
    const out = [];
    for (const ch of String(s ?? "")) {
        const c = ch.charCodeAt(0);
        if (ch >= "0" && ch <= "9") out.push(0x04 + (c - 0x30));
        else if (ch >= "A" && ch <= "Z") out.push(0x0e + (c - 0x41));
        else if (ch >= "a" && ch <= "z") out.push(0x28 + (c - 0x61));
        else if (ch === "'" || ch === "-" || ch === ".") out.push(0x01, 0x01); // unknown: space
        else out.push(0x01, 0x01);
        if (out.length >= maxBytes) break;
    }
    return out.slice(0, maxBytes);
}

/** Worn-slot halfword offsets (record relative), in the order the STATUS sheet
 *  and the See Equipment window read them (commit-contract.md §1/§5).
 *  These are the six halfwords the page's equip-apply F0x8009a3e8 walks:
 *  `statsBlock+0x3C0+pos*2` with the stat block at record+0x08, so slot 0 (head) is
 *  record+0x3C8 — the live store on the reference route puts an equipped item there
 *  (`sh $s4, 0x3c0($s1)`, ststatus file 0x17990 = RAM 0x8009A640). The documents
 *  that print `+0x3C0..+0x3CB` for these six are using the stat block's base. */
export const RECORD_EQUIP_OFFSETS = [
    ["head", 0x3c8], ["body", 0x3ca], ["right", 0x3cc],
    ["left", 0x3ce], ["acc0", 0x3d0], ["acc1", 0x3d2],
];

/** Host save-context seed: write the party context the native gym, fight report
 *  and memory-card screens read (ctx 0x80048D34). Party map at ctx+0x70 = u32[3]
 *  roster slots; roster record base 0x80049494, stride 0x3DC. Offsets (record
 *  relative): +0x08 name (raw text, NUL-terminated; see encodeNativeScreenText),
 *  +0x20 EXP u32, +0x24 level, +0x26 TP, +0x28/+0x2A cur/max HP, +0x2C/+0x2E
 *  cur/max MP, +0x30 six core, +0x3C seven elements, +0x3C8..+0x3D2 the six
 *  worn equipment halfwords (ItemId, 0 = empty).
 *  Contract: docs/research/battle/digimon-cur-stats-helpers.md. Input shape:
 *  { positions: number[], stats: [{ slot, level, tp, hp, maxHp, mp, maxMp, exp,
 *    name?, core?: number[6], elements?: number[7],
 *    equipment?: { head?, body?, right?, left?, acc0?, acc1? } }] }. */
export function seedNativeScreenParty(seed = {}) {
    const mem = state.current?.rt?.mem;
    if (!mem) return false;
    const PARTY = 0x80048d34 + 0x70;
    const REC = 0x80049494;
    const STRIDE = 0x3dc;
    const positions = seed.positions ?? [];
    for (let i = 0; i < 3; i++) {
        mem.write32(PARTY + i * 4, i < positions.length ? positions[i] >>> 0 : 0xffffffff);
    }
    for (const s of seed.stats ?? []) {
        const r = REC + (s.slot ?? 0) * STRIDE;
        const w16 = (off, v) => { if (v !== undefined && v !== null) mem.write16(r + off, v & 0xffff); };
        mem.write32(r + 0x00, ((s.starterSlot ?? s.slot ?? 0) + 3) >>> 0);
        if (s.forms) ui.seedRosterForms(mem, r, s.forms);
        if (s.exp !== undefined) mem.write32(r + 0x20, s.exp >>> 0);
        w16(0x24, s.level); w16(0x26, s.tp);
        w16(0x28, s.hp); w16(0x2a, s.maxHp);
        w16(0x2c, s.mp); w16(0x2e, s.maxMp);
        (s.core ?? []).forEach((v, i) => w16(0x30 + i * 2, v));
        (s.elements ?? []).forEach((v, i) => w16(0x3c + i * 2, v));
        // The worn slots, so the See Equipment window shows the walker's gear
        // instead of empty hands. Always written: an absent slot is an empty
        // slot, and a stale id from a previous seed would equip a phantom.
        const eq = s.equipment ?? {};
        for (const [slot, off] of RECORD_EQUIP_OFFSETS) {
            const id = Number(eq[slot]);
            mem.write16(r + off, Number.isInteger(id) && id > 0 && id <= 0xffff ? id : 0);
        }
        // The record's raw name string (widget +0x114(record, -1) draws it). The
        // name field is +0x08..+0x1f; terminate so a shorter name after a longer
        // one cannot inherit stale glyphs.
        if (s.name) {
            const bytes = encodeNativeScreenText(s.name);
            bytes.forEach((b, i) => mem.write8(r + 0x08 + i, b));
            mem.write8(r + 0x08 + bytes.length, 0);
        }
    }
    return true;
}

/** Debug: the live objects (addr, callback, alive) the runtime schedules. */
export function nativeScreenObjects() {
    return (state.current?.rt?.world?.objects ?? []).map((o) => ({ addr: o.addr >>> 0, cb: o.cb >>> 0, alive: o.alive }));
}

/** Debug: the current tick's recorded draw intents (method + args). */
export function nativeScreenDraws() {
    return (state.current?.rt?.drawCalls ?? []).map((c) => ({ method: c.method, args: [...c.args] }));
}

/** Debug: the last tick's captured raw GPU primitives (the dim quad and the
 *  memory-card POLY_G4; engine/native/raw-prims.ts), one entry per published
 *  block with its `at` draw-index and its selected depth bucket. */
export function nativeScreenRawPrims() {
    return (state.current?.rt?.rawPrims ?? []).map((p) => ({
        at: p.at,
        kind: p.kind,
        ...(p.bucket === undefined ? {} : { bucket: p.bucket }),
        intent: JSON.parse(JSON.stringify(p.intent)),
    }));
}

/** Debug read of the running screen's RAM (for focused probes). */
export function nativeScreenRead(addr, size = 4) {
    const mem = state.current?.rt?.mem;
    if (!mem) return null;
    if (size === 1) return mem.read8(addr);
    if (size === 2) return mem.read16(addr);
    return mem.read32(addr) >>> 0;
}

/** Screen root ids shipped in the manifest, in census order. */
export function nativeScreenList() {
    return state.manifest ? Object.keys(state.manifest.screens) : [];
}

/** Boot a screen's real root constructor. Synchronous once loaded.
 *
 *  opts.rootCtor — the overlay-relative root constructor to run, when the
 *  manifest's recorded one is a a sub-screen rather than the scene the player
 *  meets (the item shop's manifest ctor is the BUY tab; its real root is
 *  F0x8008c118, which owns the BUY/SELL menu). Accepts an absolute address.
 *  opts.objectLifecycle — reproduce the original object manager's
 *  lifecycle-3 destroy rule (see engine/native/stubs.ts), which is what lets a
 *  scene return to its parent screen when a sub-screen closes.
 *  opts.playPackedSound — host audio forwarding for the runtime's SFX stub. */
export function bootNativeScreen(moduleId, host = {}, opts = {}) {
    state.current = null;
    resolverDirs.clear();
    const entry = state.manifest?.screens?.[moduleId];
    const bytes = state.overlays[moduleId];
    // The interpreter namespace is present only after loadNativeScreens()
    // awaited loadNativeRuntime(); before that a boot is a no-op the caller
    // retries (the adapters keep a _pending flag for exactly this).
    const ns = nativeRuntime();
    if (!entry || !bytes || !state.resident || !ns) return null;
    const screenHost = {
        setFlag() {},
        getFlag: () => 0,
        rand16: () => 0x777,
        log() {},
        ...(opts.playPackedSound ? { playPackedSound: opts.playPackedSound } : {}),
        // The browser's stand-in memory card, when the caller supplies one (the
        // save screen's adapter). Absent = the retail no-card path.
        ...(opts.memcard ? { memcard: opts.memcard } : {}),
        ...host,
    };
    // The manifest stores root_ctor OVERLAY-RELATIVE (tools/build_native_screens.py
    // writes `ctor - load_base`, and the runtime boots overlayBase + root_ctor).
    // An explicit opts.rootCtor is absolute (the decomp's F0x8008xxxx form), so
    // only the override is rebased. Subtracting load_base from the manifest's
    // already-relative value booted every screen at a wrapped PC
    // (0x2cbc - 0x80082cb0) and trapped "exec outside loaded code".
    const rootCtor = opts.rootCtor === undefined
        ? entry.root_ctor
        : (opts.rootCtor - (entry.load_base >>> 0)) >>> 0;
    const manifestEntry = {
        size: entry.size,
        event_table: 0,
        init_fn: 0,
        root_ctor: rootCtor,
        allocs: [],
        effect_ids: [],
    };
    const residentBase = state.manifest.resident.base >>> 0;
    const rt = new ns.NativeStageRuntime(
        bytes,
        manifestEntry,
        screenHost,
        undefined,
        undefined,
        entry.load_base >>> 0,
        { image: state.resident, base: residentBase },
    );
    rt.cpu.gp = 0x8005cb50; // boot gp the parity/oracle runs use
    // Mixed-mode bridge (optional): run the oracle-proven engine/dw3 ports in
    // place of the original MIPS bodies for this module. Installed before boot
    // so constructor-time calls are replaced too.
    const bridgeBefore = ns.bridgeInvocations();
    const bridgeStart = new Map(bridgeBefore);
    if (opts.bridge) ns.installTranslationBridge(rt.cpu, rt.mem, [moduleId], null, rt.services);
    if (opts.objectLifecycle) rt.objectLifecycle = true;
    // A screen whose manifest root is a sub-object factory needs real arguments
    // (pro/fightstg's root is F0x80093F9C(initialRow, outputCell)).
    if (Array.isArray(opts.rootArgs)) rt.bootArgs = opts.rootArgs.slice();

    // Serve the pack resolver with a DISTINCT directory pointer per requested
    // pack. The screen passes a packed handle = LBA_file_index << 16 (the item
    // shop asks for CMFONTCS 0x02860000 and STSHOPCS 0x04020000,
    // docs/research/ui/shop-system-decompiled.md 3b). One shared scratch pointer
    // collapsed every pack into one tag, so a recorded drawSprite could not say
    // which pack it drew; a per-index pointer restores that.
    //
    // The pointer must also be REAL RAM that reads as an empty record table: the
    // original F0x800140d8 returns a pointer into the loaded resource, and screen
    // code dereferences it — the card-pack uploader F0x8001fe38 walks
    // `[pack+i*4] + pack` until the entry is 0 (F0x80014110). The old tag was
    // 0x0fd00000 + n*0x10, which masks onto the screen-heap base 0x80100000, so
    // the walk ran through live heap until it chanced on a zero word: opening
    // the pause page issued ~22,000 bogus LoadImage uploads (~2.2 GB of copying,
    // the 3-second wait) before the page appeared. A zeroed 16-byte heap block
    // makes the table entry 0 and the walk stops on its first step.
    const resolverBlocks = new Map();
    rt.cpu.setStub(0x800140d8, (c) => {
        const handle = c.reg(4) >>> 0;
        const idx = (handle >>> 16) & 0xffff;
        // Bundle packs (carddata, sttrng, ttcommpk) put the sprite sub-directory
        // in the handle's LOW u16; a per-(idx,sub) directory keeps them distinct
        // so the renderer can pick the matching sheet.
        const sub = handle & 0xffff;
        const key = `${idx}:${sub}`;
        let dir = resolverBlocks.get(key);
        if (dir === undefined) {
            dir = (rt.services?.alloc(0x10, 4) ?? 0) >>> 0;
            resolverBlocks.set(key, dir);
        }
        resolverDirs.set(dir, { idx, sub });
        return dir;
    });
    // The resident cache service calls this mid-tick; banks are preloaded, so it
    // stays synchronous. A missing bank zero-fills exactly like no host service.
    screenHost.readBank = (id, dest, nbytes) => {
        const bank = state.banks.get(id);
        if (!bank) return;
        const n = Math.min(nbytes, bank.length);
        for (let i = 0; i < n; i++) rt.mem.write8(dest + i, bank[i]);
    };
    // Production state seed: a screen whose CONSTRUCTOR reads seeded state (the
    // save screen reads its save/load mode word out of the resident context as
    // it is built) needs the writes to land before `rt.boot()` runs the root
    // constructor. `opts.preBoot` gets the runtime's own memory, so it does not
    // depend on state.current, which is only published after boot.
    if (opts.preBoot) {
        opts.preBoot({
            rt,
            read: (addr, size = 4) => (size === 1
                ? rt.mem.read8(addr) : size === 2 ? rt.mem.read16(addr) : rt.mem.read32(addr) >>> 0),
            write: (addr, value, size = 4) => {
                if (size === 1) rt.mem.write8(addr, value & 0xff);
                else if (size === 2) rt.mem.write16(addr, value & 0xffff);
                else rt.mem.write32(addr, value | 0);
            },
        });
    }
    const booted = rt.boot();
    if (!booted) console.warn(`[native-screen] ${moduleId} boot trap:`, rt.bootTrap);
    state.current = {
        module: moduleId,
        entry,
        rt,
        booted,
        // The root is the first object the boot constructor allocates; it is
        // the scene object whose death means the screen is over.
        rootAddr: rt.world.objects[0]?.addr ?? 0,
        frames: 0,
        drawIntents: 0,
        methods: {},
        traps: 0,
        lastDraw: null,
        lastTrap: null,
        bridgeEnabled: !!opts.bridge,
        bridgeBaseline: bridgeStart,
    };
    return rt;
}

/**
 * One vertical blank: the resident cache tick + every live object's real
 * callback, with `delta` published as this blank's display delta (the display
 * service's own 1-or-2, engine/systems/frame-clock.ts; the runtime writes it
 * into [0x8004DE28] and adds it to the free running tick [0x8004DE20]).
 *
 * One call is ONE blank. How many blanks a browser frame is worth is the
 * caller's decision — the host paces that on the console's PAL 50 Hz through
 * `NativeVblankClock` (engine/systems/native-vblank-clock.ts), because every
 * screen object counts blanks in its own fields. The research lab
 * (web/native-screen-lab.js) steps frames on demand and keeps the default.
 *
 * `padWord` publishes the held-button word first, when given. The screens read
 * the PRESSED edge, which the runtime derives from that word at the top of the
 * tick (engine/native/runtime.ts applyPad), so a word published here is the
 * edge the screen sees on THIS blank — one blank after the key event that set
 * it. A caller with its own held set (the lab, web/native-screen-pad.js) passes
 * it; a caller that already called setNativeScreenPad passes nothing.
 */
export function tickNativeScreen(padWord, delta = 1) {
    const cur = state.current;
    if (!cur || !cur.booted) return null;
    if (typeof padWord === "number") setNativeScreenPad(padWord, 0);
    const { rt } = cur;
    rt.drawCalls.length = 0;
    rt.ctxMarkers.length = 0;
    const before = rt.disabled.length;
    rt.tick(delta);
    cur.frames += 1;
    cur.drawIntents += rt.drawCalls.length;
    for (const c of rt.drawCalls) {
        cur.methods[c.method] = (cur.methods[c.method] ?? 0) + 1;
        cur.lastDraw = { method: c.method, args: c.args };
    }
    for (const d of rt.disabled.slice(before)) {
        cur.traps += 1;
        cur.lastTrap = { pc: d.pc >>> 0, cb: d.cb >>> 0, reason: d.reason };
        console.warn(`[native-screen] ${cur.module} disabled cb=0x${(d.cb >>> 0).toString(16)}: ${d.reason}`);
    }
    return rt;
}

/** Which extracted pack a recorded drawSprite directory pointer belongs to.
 *  The pointer encodes the LBA file index the screen requested; the manifest
 *  maps that index to the extracted pack name for this screen. */
export function nativeScreenPackNameForDir(dir) {
    const e = resolverDirs.get(dir >>> 0);
    if (!e) return null;
    const packs = state.current?.entry?.packs;
    if (!packs) return null;
    return packs[`${e.idx}:${e.sub}`] ?? packs[String(e.idx)] ?? null;
}

/** The raw LBA index/sub-directory a recorded drawSprite directory pointer was
 *  resolved for. Diagnostic companion to nativeScreenPackNameForDir: when a pack
 *  has no manifest entry this names the handle the screen actually asked for, so
 *  the missing extraction is reported instead of silently skipped. */
export function nativeScreenDirKey(dir) {
    const e = resolverDirs.get(dir >>> 0);
    return e ? `${e.idx}:${e.sub}` : null;
}

/** Live class-A text widgets (handler F0x8001ac14) with the fields a renderer
 *  needs. Field offsets (screen-text-widget contract, F0x80019370/F0x800197a4):
 *  +0x50 font record, +0x5C line-record array (stride 0xC: +0x0 string pointer,
 *  +0x4 buffer capacity, +0x6 length, +0x8 draw cursor index, +0xA mode/flag),
 *  +0xB0/+0xB2 pen, +0xC0 colour row, +0xAE palette-row add, +0xC1 visibility,
 *  +0x62 line-0 length, +0xA6 first / +0xA4 end of the reveal window. */
export function nativeTextWidgets() {
    const cur = state.current;
    if (!cur || !cur.booted) return [];
    const mem = cur.rt.mem;
    const out = [];
    for (const o of cur.rt.world.objects) {
        if (!o.alive || (o.cb >>> 0) !== 0x8001ac14) continue;
        const lines = [];
        for (let i = 0; i < 6; i++) {
            // Line record (decompiled F0x80019370): +0x0 buffer, +0x4 capacity,
            // +0x6 length (u16), +0x8 reveal cursor (set by the drawer), +0xA flag.
            const rec = o.addr + 0x5c + i * 0xc;
            const ptr = mem.read32(rec) >>> 0;
            const capacity = mem.read16(rec + 0x4);
            const len = mem.read16(rec + 0x6);
            const index = mem.read16(rec + 0x8);
            const flag = mem.read16(rec + 0xa);
            let bytes = null;
            if (ptr >= 0x80000000 && len > 0 && len < 512) {
                bytes = [];
                for (let k = 0; k < len; k++) bytes.push(mem.read8(ptr + k));
            }
            lines.push({ ptr, capacity, len, index, flag, bytes });
        }
        out.push({
            addr: o.addr,
            font: mem.read32(o.addr + 0x50) >>> 0,
            penX: mem.read16s(o.addr + 0xb0),
            penY: mem.read16s(o.addr + 0xb2),
            fixedPitch: mem.read8(o.addr + 0xc2) !== 0,
            cellWidth: mem.read16(o.addr + 0xb4),
            lineHeight: mem.read8(o.addr + 0xc2)
                ? mem.read16(o.addr + 0xb6)
                : mem.read8(mem.read32(o.addr + 0x50) + 1),
            total: mem.read16(o.addr + 0x62),
            revealFirst: mem.read16s(o.addr + 0xa6),
            revealEnd: mem.read16s(o.addr + 0xa4),
            colour: mem.read8(o.addr + 0xc0),
            // +0xBC = the widget's measured line-0 width (F0x8001a25c / method
            // +0x148). Non-zero means the drawer right-aligns: the run ENDS at
            // penX (F0x800197a4 negates it into +0xB8). 0 = left-aligned.
            alignWidth: mem.read16(o.addr + 0xbc),
            paletteAdd: mem.read8(o.addr + 0xae),
            visible: mem.read8(o.addr + 0xc1),
            // The resident text decoder (F0x8001D264) reads the Shift-JIS pair
            // tables through the font record, so the bridge keeps the widget's
            // memory reader rather than only a byte copy.
            read8: (a) => mem.read8(a),
            read16: (a) => mem.read16(a),
            read16s: (a) => mem.read16s(a),
            read32: (a) => mem.read32(a),
            lines,
        });
    }
    return out;
}

/**
 * Seed the collection the way the game does: call the shipped card-grant
 * routine F0x80016E2C for each id (fixture only - a real run obtains them by
 * playing). Returns the number of ids granted.
 */
export function grantNativeScreenCards(ids) {
    const cur = state.current;
    if (!cur || !cur.rt) return 0;
    let granted = 0;
    for (const id of ids) if (cur.rt.grantCard(id, 1)) granted++;
    return granted;
}

/** The shipped manifest entry for a screen root (load_base, size, pack, ...). */
export function nativeScreenEntry(moduleId) {
    return state.manifest?.screens?.[moduleId] ?? null;
}

/** Debug write into the running screen's RAM (production state seeding). */
export function nativeScreenWrite(addr, value, size = 4) {
    const mem = state.current?.rt?.mem;
    if (!mem) return false;
    if (size === 1) mem.write8(addr, value & 0xff);
    else if (size === 2) mem.write16(addr, value & 0xffff);
    else mem.write32(addr, value | 0);
    return true;
}

/** True once the booted root object has left the live set: either its lifecycle
 *  reached the manager's destroy value (objectLifecycle) or its tick trapped. */
export function nativeScreenFinished() {
    const cur = state.current;
    if (!cur || !cur.booted) return false;
    const root = cur.rt.world.objects.find((o) => (o.addr >>> 0) === (cur.rootAddr >>> 0));
    if (!root) return true;
    if (!root.alive || cur.rt.deadCbs.has(root.addr)) return true;
    return (cur.rt.mem.read32(root.addr + 0x0c) | 0) === 3;
}

/** Is a native screen loaded and running at all? */
export function nativeScreenActive() {
    return !!(state.current && state.current.booted);
}

/** Stop ticking the current screen and forget it (its RAM is dropped with it). */
export function teardownNativeScreen() {
    state.current = null;
}

/** Serializable debug state for the lab and the focused browser check. */
export function nativeScreenState() {
    const cur = state.current;
    if (!cur) return null;
    return {
        module: cur.module,
        booted: cur.booted,
        objects: cur.rt.world.objects.length,
        frames: cur.frames,
        drawIntents: cur.drawIntents,
        methods: { ...cur.methods },
        lastDraw: cur.lastDraw,
        traps: cur.traps,
        lastTrap: cur.lastTrap,
        bridgeEnabled: !!cur.bridgeEnabled,
        bridged: cur.bridgeEnabled
            ? [...(nativeRuntime()?.bridgeInvocations() ?? [])]
                  .map(([key, count]) => [key, count - (cur.bridgeBaseline.get(key) ?? 0)])
                  .filter(([, delta]) => delta > 0)
                  .map(([key, delta]) => ({ key, invocations: delta }))
            : [],
        screensLoaded: state.manifest ? Object.keys(state.manifest.screens).length : 0,
    };
}
