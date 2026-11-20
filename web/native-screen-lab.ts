// Lab for the native screen port (Phase 2). Boots a real screen overlay through
// engine/native from the shipped assets and paints the recorded picture-service
// intents through the extracted screen pack (web/screenpack.js). Text glyphs are
// not in the intent stream yet (Phase 4); the readout says what was drawn.
//
// THE LAB RUNS AT THE CONSOLE'S BLANK RATE, like the game. One requestAnimationFrame
// is worth however many PAL vertical blanks its elapsed time bought, and the
// overlay is stepped once per blank with that blank's own display delta; the pad
// word is published once per blank too. See `blanks` below.
import {
    bootNativeScreen,
    loadNativeScreens,
    nativeScreenEntry,
    nativeScreenList,
    nativeScreenPackNameForDir,
    nativeTextWidgets,
    nativeScreenDraws,
    nativeScreenObjects,
    nativeScreenRawPrims,
    nativeScreenRead,
    nativeScreenWrite,
    nativeScreenState,
    seedNativeScreenParty,
    setNativeScreenPad,
    tickNativeScreen,
    grantNativeScreenCards,
} from "./native-screen.js";
import { createNativeScreenRenderer } from "./native-screen-render.js";
import { createNativeScreenPadInput } from "./native-screen-pad.js";
import { decodeNativeText, drawNativeTextWidgets } from "./native-screen-text.js";
import { nativeRootCtorFor } from "./native-screen-roots.js";
import { NativeVblankClock } from "./vendor/engine.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const sel = document.getElementById("screen");
const status = document.getElementById("status");
const reboot = document.getElementById("reboot");
const refimg = document.getElementById("refimg");
const refbox = document.getElementById("refbox");

// The original console capture for this screen, when one has been taken with
// the rig and registered under web/assets/ref/native/ (see the ui-lab skill).
// Captured originals are listed in assets/ref/native/index.json, so a screen
// without a capture never requests a missing file.
let refIndex = null;
async function loadRefIndex() {
    if (refIndex) return refIndex;
    try {
        const r = await fetch("assets/ref/native/index.json");
        refIndex = r.ok ? ((await r.json()).captures ?? {}) : {};
    } catch {
        refIndex = {};
    }
    return refIndex;
}

async function setReference(moduleId) {
    refbox.style.display = "none";
    refimg.removeAttribute("src");
    const index = await loadRefIndex();
    const file = index[moduleId];
    if (!file) return;
    refimg.onload = () => { refbox.style.display = ""; };
    refimg.onerror = () => { refbox.style.display = "none"; };
    refimg.src = `assets/ref/native/${file}?t=${Date.now()}`;
}

let raf = 0;
let renderer = null;
let lastTextStats = null;
/** The last vertical blank's runtime: the picture the canvas shows. A browser
 *  frame that owed no blank keeps it rather than clearing the screen. */
let lastRt = null;

// The lab's pad-input service (web/native-screen-pad.js): the keyboard's word
// for the screen's own controller-input record, published once per BLANK before
// the screen reads it. Without it the lab drew the merchant's BUY/SELL menu and
// refused every key, because the overlay reads a pad word and nothing handed it
// one. The same module and the same table serve the game, so the lab cannot
// answer a button the game would not.
//
// A key is published per blank and NOT per browser frame. The original's poll
// counts a held key's auto-repeat in frames of its vertical blank (16, then 6,
// then 4 — exe/fns.s:9784-9789 with the divisor 0x10 set at :9042-9043), so a
// press is a number of blanks. Publishing per browser frame made the lab's press
// a number of whatever the monitor managed: at 120 Hz a one-frame press arrived
// on one blank out of 120 rather than one out of 50, and a hold crossed the
// 16-blank repeat at half the time it should.
const pad = createNativeScreenPadInput({ publish: (held, port) => setNativeScreenPad(held, port) });
pad.attach(window);

// The console's vertical blanks, through the SAME clock the production host
// steps its screens with (engine/systems/native-vblank-clock.ts). The lab used
// to run one overlay frame per requestAnimationFrame, so the screen a researcher
// opened here counted its own frames at the monitor's rate: 120 a second at
// 120 Hz, 60 at 60 Hz, and different again on the box that ran the capture. The
// shipped walls proved it — the card album's backdrop came round in 3.2 s here
// against the disc's 3.84 s. One clock for both owners, so the lab and the
// game cannot drift apart.
const blanks = new NativeVblankClock();

function start(moduleId, opts = {}) {
    cancelAnimationFrame(raf);
    // A screen whose manifest ctor is not the scene the player meets boots the
    // override (web/native-screen-roots.js), so a capture here matches
    // production instead of trapping on the census ctor.
    const rootCtor = opts.rootCtor ?? nativeRootCtorFor(moduleId);
    // The production host boots every screen with objectLifecycle on
    // (web/native-screen-host.js#openNativeScreen): an object whose +0xC reads 3
    // is destroyed and its parent's child-array slot becomes NULL. The lab must
    // do the same or a screen that finishes a loader by dying looks stalled here
    // and nowhere else — pro/stdgname sat at root FSM 1 for 2,400 frames in the
    // lab and advanced to the keyboard the moment the flag was on.
    const bootOpts = { objectLifecycle: true, ...opts };
    bootNativeScreen(moduleId, { ordinal: () => 0 }, rootCtor === undefined ? bootOpts : { ...bootOpts, rootCtor });
    renderer = createNativeScreenRenderer(nativeScreenEntry(moduleId), nativeScreenPackNameForDir);
    blanks.reset();
    lastRt = null;
    status.textContent = `booted ${moduleId} (pack ${renderer.stats.pack ?? "none"}` +
        `${rootCtor === undefined ? "" : `, ctor 0x${rootCtor.toString(16)}`}${opts.bridge ? ", bridge" : ""})`;
    setReference(moduleId);
    const loop = (stamp) => {
        // Every blank this browser frame is worth, each with the display
        // service's own 1-or-2 delta, and the pad word published once per blank
        // (above). At 120 Hz this is 50 ticks a second and 70 idle browser
        // frames; at 50 Hz it is one tick every frame and none idle. A caller
        // that pumps its own animation frames with no timestamp still gets real
        // time, so the lab cannot be frozen by a test harness.
        const now = Number.isFinite(stamp) ? stamp : performance.now();
        for (const delta of blanks.advanceFromStamp(now)) {
            lastRt = tickNativeScreen(pad.publishNow(), delta);
        }
        // The picture on the canvas is the last blank's, repainted every browser
        // frame so the page still redraws at the display's refresh: an idle
        // browser frame redraws the identical picture rather than clearing it, so
        // a 30 Hz monitor sees the same screen a 144 Hz one does.
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (lastRt) {
            renderer.draw(ctx, lastRt.drawCalls, lastRt.vram, lastRt.cardPrims, lastRt.ctxMarkers, lastRt.rawPrims);
            lastTextStats = drawNativeTextWidgets(ctx, nativeTextWidgets());
        }
        const s = nativeScreenState();
        const r = renderer.stats;
        status.textContent = s
            ? `${s.module}: booted=${s.booted} objects=${s.objects} frames=${s.frames} intents=${s.drawIntents} ` +
              `traps=${s.traps} | pad=0x${pad.word().toString(16).padStart(4, "0")} keys=[${pad.held().join(",")}] ` +
              `| packs=${r.packs.join("+")} clips=${r.clips} cards=${r.cards} skipped=${r.skipped} ` +
              `byPack=${JSON.stringify(r.byPack)} seen=[${r.seen.join(",")}] ` +
              `text=${lastTextStats ? `${lastTextStats.drawn}/${lastTextStats.lines}` : "-"} ` +
              `bridge=${s.bridged.length ? `${s.bridged.length} fn` : "off"}`
            : "no screen";
        raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
}

async function main() {
    await loadNativeScreens();
    for (const id of nativeScreenList()) {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = id;
        sel.append(o);
    }
    sel.value = "pro/stitshop";
    const bridge = new URLSearchParams(location.search).get("bridge") === "1";
    sel.addEventListener("change", () => start(sel.value, { bridge }));
    reboot.addEventListener("click", () => start(sel.value, { bridge }));
    start(sel.value, { bridge });
}

window.__nativeScreen = nativeScreenState;
window.__nativeScreenList = nativeScreenList;
window.__nativeScreenRender = () => {
    const r = renderer ? { ready: renderer.ready(), ...renderer.stats } : null;
    if (r) r.text = lastTextStats;
    return r;
};
window.__nativeTextWidgets = nativeTextWidgets;
window.__nativeScreenTextDump = () =>
    nativeTextWidgets().map((w) => ({ ...w, decoded: w.lines.map((l) => decodeNativeText(l.bytes ?? []) ) }));
window.__nativeScreenSeedParty = (seed) => seedNativeScreenParty(seed);
window.__nativeScreenGrantCards = (ids) => grantNativeScreenCards(ids);
window.__nativeScreenRead = (addr, size) => nativeScreenRead(addr, size);
window.__nativeScreenWrite = (addr, value, size) => nativeScreenWrite(addr, value, size);
window.__nativeScreenDraws = () => nativeScreenDraws();
window.__nativeScreenObjects = () => nativeScreenObjects();
// The last blank's raw GPU primitives (engine/native/raw-prims.ts): the dim quad
// and the memory-card POLY_G4 do not travel the picture-service stream, so the
// lab reads them here. One entry per published block, in publish order.
window.__nativeScreenRawPrims = () => nativeScreenRawPrims();
window.__nativeScreenPad = (buttons, port = 0) => {
    // A caller with a word of its own (the focused pad checks) takes the word
    // over; it still publishes through the same service the keyboard uses, so
    // one owner publishes one word per frame.
    pad.setHeldWord(buttons);
    setNativeScreenPad(port === pad.port ? pad.word() : Number(buttons) >>> 0, port);
    return nativeScreenState();
};
window.__nativeScreenKeys = () => ({ held: pad.held(), word: pad.word() });
// A press, counted in published frames rather than milliseconds: the original's
// auto-repeat is 16 frames into a hold, so a hold whose length is measured in
// wall-clock time is a tap on a slow box and a two-row hold on a fast one.
window.__nativeScreenReleaseAfter = (frames) => pad.releaseAfter(frames);
window.__nativeScreenReleasePending = () => pad.releasePending();
window.__nativeScreenRef = () => ({
    shown: refbox.style.display !== "none",
    src: refimg.getAttribute("src") ?? "",
    width: refimg.naturalWidth,
    height: refimg.naturalHeight,
});
window.__nativeScreenBoot = (id, opts) => {
    start(id, opts ?? {});
    return nativeScreenState();
};

main();
