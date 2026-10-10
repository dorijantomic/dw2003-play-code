// Shared oracle kit for the Digimon lab ports (pro/stgdglab).
//
// Same method as gym-kit.js: the ORIGINAL routine runs from the shipped overlay image through
// engine/native with every service it calls replaced by a recording stub, the PORT runs against a
// host that records the same events, and one comparison covers the ordered calls, the return value
// and every word of the named memory windows.
//
// Services (the resident cell or overlay cell each stands for, and the event it records):
//   alloc 0x80014504 ["alloc" h s e]          text 0x8001AE38 ["createText" ...]   cursor 0x8001B364 ["createCursor" ...]
//   pad 0x8004B7D0+0x3F4/3F8/3FC/408 ["pressed"] ["held"] ["repeat"] ["bit" logical]
//   sound 0x80055C48 ["play" id]              text bank 0x80044F4C ["bank" id]      pack 0x80044F5C ["pack" handle]
//   frame 0x8004DF98 ["frame"]                fold cells 0x8008FD98/9C ["foldStart" t d] ["foldTick" t]
//   draw context F0x8001F648 ["initDraw"] then ["setOrigin"|"setDepth"|"setLayer"|"drawSprite"|"paletteShift"|"setScale"|"setPos" ...]
//   save context cells +0x2718.. ["partner" pos] ["follower" pos] ["effective" slot dest] ["equipped" slot out]
//        ["setEquipped" slot in] ["acquired" slot out] ["entryCopy" ...] ["writeEntry" ...] ["record" slot] ["profile" form]
//   an object method through its table ["m" target slot ...args]
import { createKit, overlayImage, rng, RESIDENT } from "./gym-kit.js";

export { createKit, overlayImage, rng, RESIDENT };
export const STGDGLAB = () => overlayImage("pro_stgdglab.bin");
export const createLabKit = () => createKit(STGDGLAB());

/** Method tables by object kind: slot -> argument count (the receiver excluded). */
export const KINDS = {
    text: { 0x110: 1, 0x114: 2, 0x118: 2, 0x120: 3, 0x134: 2, 0x138: 1, 0x140: 2, 0x144: 1, 0x148: 1, 0x15c: 1, 0x160: 1, 0x12c: 3 },
    cursor: { 0x80: 1, 0x84: 2, 0x88: 1, 0x8c: 1, 0x90: 1, 0x94: 1 },
    task: { 0x28: 1, 0x2c: 1, 0x30: 1, 0x34: 1, 0x38: 0, 0x3c: 0, 0x40: 0, 0x44: 0 },
    capsule: { 0x8c: 2, 0x90: 2, 0x94: 2, 0x98: 1 },
};

/** A stack-range pointer is logged as "stack": the original's frame and the port's scratch differ. */
export const norm = (v) => ((v >>> 0) >= 0x801f0000 && (v >>> 0) < 0x80200000 ? "stack" : v);
export const SCRATCH = 0x801f4000;

export const SVC = {
    ui: 0x8004b7d0,
};

/**
 * Install every lab service as a recording stub for the original and return the matching host.
 * `cfg` is read at call time: pressed / held / repeat, fold(t), method(target, slot), partner(pos),
 * follower(pos), profile(form), record(slot), created[] (text widget queue), cursors[], allocs[].
 */
export function installLab(kit, cfg) {
    const mem = kit.mem;
    const state = { text: 0, cursor: 0, alloc: 0 };
    const ret = (fn, ...a) => (typeof fn === "function" ? fn(...a) : fn ?? 0);

    /** Give an object a method table of recording stubs (the original calls through these). */
    const cache = new Map();
    const methods = (addr, kind) => {
        const table = typeof kind === "string" ? KINDS[kind] : kind;
        for (const [slot, arity] of Object.entries(table)) {
            const s = Number(slot);
            const key = `${s}:${arity}`;
            if (!cache.has(key)) {
                cache.set(key, kit.stub("m", (...a) => ret(cfg.method, a[0] >>> 0, s), {
                    args: arity + 1, silent: true,
                    before: (_c, a) => kit.push("m", a[0], s, ...a.slice(1)),
                }));
            }
            mem.write32(addr + s, cache.get(key));
        }
    };

    const widget = (k) => 0x801b0000 + k * 0x200;
    const icon = (k) => 0x801b8000 + k * 0x100;
    for (let k = 0; k < 40; k++) methods(widget(k), "text");
    for (let k = 0; k < 8; k++) methods(icon(k), "cursor");

    kit.at(0x80014504, "alloc", (h, s, e) => (cfg.allocs ?? [])[state.alloc++] ?? 0x80154000, { args: 3 });
    kit.at(0x8001ae38, "createText", () => (cfg.created ?? [])[state.text++] ?? widget(state.text - 1), { args: 4 });
    kit.at(0x8001b364, "createCursor", () => (cfg.cursors ?? [])[state.cursor++] ?? icon(state.cursor - 1), { args: 4 });
    kit.cell(SVC.ui + 0x3f4, "pressed", () => cfg.pressed ?? 0, { args: 0 });
    kit.cell(SVC.ui + 0x3f8, "held", () => cfg.held ?? 0, { args: 0 });
    kit.cell(SVC.ui + 0x3fc, "repeat", () => cfg.repeat ?? 0, { args: 0 });
    kit.cell(SVC.ui + 0x408, "bit", (_p, logical) => logical, { args: 2, silent: true, before: (_c, a) => kit.push("bit", a[1]) });
    kit.cell(0x80055c48, "play", () => cfg.channel ?? 0, { args: 1 });
    kit.cell(0x80044f4c, "bank", (id) => 0x80190000 + ((id & 0xfff) << 4), { args: 1 });
    kit.cell(0x80044f5c, "pack", (h) => 0x0a000000 + (h >>> 16), { args: 1 });
    kit.cell(0x8004df98, "frame", () => cfg.frame ?? 0, { args: 0 });
    kit.cell(0x8008fd98, "foldStart", 0, { args: 2 });
    kit.cell(0x8008fd9c, "foldTick", (t) => ret(cfg.fold, t), { args: 1 });
    kit.cell(0x8004b44c, "partner", (p) => ret(cfg.partner, p), { args: 1 });
    kit.cell(0x8004b45c, "follower", (p) => ret(cfg.follower, p), { args: 1 });
    kit.cell(0x8004b468, "effective", 0, { args: 2, silent: true, before: (_c, a) => { kit.push("effective", a[0], norm(a[1])); cfg.effective?.(...a); } });
    kit.cell(0x8004b46c, "equipped", 0, { args: 2, silent: true, before: (_c, a) => { kit.push("equipped", a[0], norm(a[1])); cfg.equipped?.(...a); } });
    kit.cell(0x8004b470, "setEquipped", 0, { args: 2, silent: true, before: (_c, a) => kit.push("setEquipped", a[0], norm(a[1])) });
    kit.cell(0x8004b474, "acquired", (s, o) => ret(cfg.acquired, s, o), { args: 2, silent: true, before: (_c, a) => { kit.push("acquired", a[0], norm(a[1])); cfg.acquiredFill?.(...a); } });
    kit.cell(0x8004b47c, "entryCopy", 0, { args: 3, silent: true, before: (_c, a) => { kit.push("entryCopy", a[0], a[1], norm(a[2])); cfg.entryFill?.(...a); } });
    kit.cell(0x8004b480, "writeEntry", (s, f) => ret(cfg.writeEntry, s, f), { args: 3, silent: true, before: (_c, a) => kit.push("writeEntry", a[0], a[1], norm(a[2])) });
    kit.cell(0x8004b484, "record", (s) => ret(cfg.record, s), { args: 1 });
    kit.cell(0x8005cca0, "profile", (f) => ret(cfg.profile, f), { args: 1 });

    kit.at(0x8001f648, "initDraw", 0, {
        args: 1, silent: true, before: (_c, a) => {
            kit.push("initDraw");
            const t = a[0];
            const draw = (name, offset, arity) => {
                mem.write32(t + offset, kit.stub(name, 0, { args: arity }));
            };
            draw("setOrigin", 0x74, 2); draw("setDepth", 0x78, 2); draw("setLayer", 0x7c, 2); draw("drawSprite", 0x84, 4);
            draw("paletteShift", 0x88, 1); draw("setScale", 0x8c, 3); draw("setPos", 0x94, 2);
        },
    });

    // The scroll bar's picture primitive: the ordering-table services and the prim allocator.
    const PRIM = 0x801b4000, SLOT = 0x801b4100, VIEW = 0x801b4200;
    kit.cell(0x8004de10 + 0x17c, "ot", () => VIEW, { args: 1 });
    mem.write32(VIEW + 0x138, kit.stub("slot", () => SLOT, { args: 2, silent: true, before: (_c, a) => kit.push("slot", a[1]) }));
    kit.cell(0x8004de10 + 0x158, "prim", () => PRIM, { args: 0, silent: true });
    kit.cell(0x8004de10 + 0x15c, "link", 0, {
        args: 3, silent: true, before: () => {
            const h = (o) => mem.read16(PRIM + o);
            kit.push("quad", h(8), h(0xa), h(0xc), h(0xe), h(0x10), h(0x12), h(0x14), h(0x16));
        },
    });

    const host = {
        methods,
        widget, icon,
        call(target, slot, args) { kit.push("m", target, slot, ...args); return ret(cfg.method, target, slot) | 0; },
        callMethod(target, slot, args) { kit.push("m", target, slot, ...args); return ret(cfg.method, target, slot) | 0; },
        alloc(h, s, e) { kit.push("alloc", h, s, e); return (cfg.allocs ?? [])[state.alloc++] ?? 0x80154000; },
        createText(a, b, c, d) { kit.push("createText", a, b, c, d); return (cfg.created ?? [])[state.text++] ?? widget(state.text - 1); },
        createCursor(a, b, c, d) { kit.push("createCursor", a, b, c, d); return (cfg.cursors ?? [])[state.cursor++] ?? icon(state.cursor - 1); },
        padPressed() { kit.push("pressed"); return cfg.pressed ?? 0; },
        padHeld() { kit.push("held"); return cfg.held ?? 0; },
        padRepeat() { kit.push("repeat"); return cfg.repeat ?? 0; },
        padBit(logical) { kit.push("bit", logical); return logical; },
        playSound(id) { kit.push("play", id); return cfg.channel ?? 0; },
        textBank(id) { kit.push("bank", id); return 0x80190000 + ((id & 0xfff) << 4); },
        packResolve(h) { kit.push("pack", h); return 0x0a000000 + (h >>> 16); },
        frameTick() { kit.push("frame"); return cfg.frame ?? 0; },
        foldStart(t, d) { kit.push("foldStart", t, d); },
        foldTick(t) { kit.push("foldTick", t); return ret(cfg.fold, t) | 0; },
        foldStatus(t) { kit.push("foldTick", t); return ret(cfg.fold, t) | 0; },
        initDrawContext() { kit.push("initDraw"); },
        setOrigin(x, y) { kit.push("setOrigin", x, y); },
        setDepth(x, y) { kit.push("setDepth", x, y); },
        setLayer(t, b) { kit.push("setLayer", t, b); },
        drawSprite(p, c, x, y) { kit.push("drawSprite", p, c, x, y); },
        paletteShift(v) { kit.push("paletteShift", v); },
        setScale(x, y, z) { kit.push("setScale", x, y, z); },
        setPos(x, y) { kit.push("setPos", x, y); },
        partnerSlot(p) { kit.push("partner", p); return ret(cfg.partner, p) | 0; },
        followerSlot(p) { kit.push("follower", p); return ret(cfg.follower, p) | 0; },
        scratch(i) { return SCRATCH + i * 0x100; },
        effectiveStats(s, d) { kit.push("effective", s, norm(d)); cfg.effective?.(s, d); },
        equippedForms(s, o) { kit.push("equipped", s, norm(o)); cfg.equipped?.(s, o); return 0; },
        setEquipped(s, i) { kit.push("setEquipped", s, norm(i)); },
        acquiredForms(s, o) { kit.push("acquired", s, norm(o)); cfg.acquiredFill?.(s, o); return ret(cfg.acquired, s, o) | 0; },
        formEntryCopy(a, b, c) { kit.push("entryCopy", a, b, norm(c)); cfg.entryFill?.(a, b, c); },
        writeFormEntry(s, f, i) { kit.push("writeEntry", s, f, norm(i)); return ret(cfg.writeEntry, s, f) | 0; },
        fillQuad(layer, bucket, x0, y0, x1, y1) {
            kit.push("ot", layer); kit.push("slot", bucket);
            kit.push("quad", x0, y0, x1, y0, x0, y1, x1, y1);
        },
        recordPointer(s) { kit.push("record", s); return ret(cfg.record, s) | 0; },
        profileRecord(f) { kit.push("profile", f); return ret(cfg.profile, f) | 0; },
    };
    return { host, widget, icon, methods, reset() { state.text = 0; state.cursor = 0; state.alloc = 0; } };
}
