// Browser driver for the native wstag MIPS interpreter (engine/native/ via the
// bundle). The ~75 stages listed in assets/native/manifest.json carry their
// ORIGINAL ambience/gimmick machine code (s780 cars + traffic lights, s225
// login halo, chamber doors, satellite dishes, ...). On stage enter we boot
// the overlay through its real root constructor; every rendered frame we tick
// each live object's real callback. Three render/dispatch paths come out:
//   1. point-record writes — native code pokes the shared 18-byte point table
//      in overlay memory; effects.js reads those bytes back (rebase).
//   2. draw intents — the recorded draw-context calls (drawSprite/setPos/...)
//      are replayed as canvas draws by effects.js drawNativeIntents.
//   3. effect firing — the script's SETANIM ≥ 0x320 ops route to the stage's
//      registered native constructor/dispatcher (the fieldstg effect registry,
//      static data now loaded with the fieldstg image).
// Research mode awaits the interpreter data before stage entry: an automatic
// cutscene can fire stage effects on its first step. Ordinary play uses browser
// effects without requesting these executable images.
// Fail-soft by construction: a trap disables that one object and logs; the
// stage keeps playing exactly as before this system existed.

import { NativeVblankClock } from "./vendor/engine.js";
// The interpreter (NativeStageRuntime) is not statically imported: it lives in
// the research-only bundle web/vendor/engine-native.js and is fetched through
// this dynamic doorway only when a native stage is actually asked for
// (?nativeStages, or a research verifier). loadNativeStages() awaits it before
// enterNativeStage can run, so the stage boot stays synchronous.
import { loadNativeRuntime, nativeRuntime } from "./native-runtime.js";

let manifest = null; // assets/native/manifest.json (null until loaded)
let exeTables = null;
let fieldstg = null; // the resident field-engine image (registry + tables + code)
const overlays = {}; // stageId -> Uint8Array
let current = null; // { stageId, rt, pointTable }

/** The console's vertical blanks, through the same clock the screen host steps
 *  its screens with (engine/systems/native-vblank-clock.ts). A stage's objects
 *  are handed one turn per blank by the same main loop that hands a screen its
 *  turn (F0x80018140 -> D0x8004b7c4 = F0x80018230), so this driver must present
 *  blanks at the console's rate: once per browser frame ran a stage at the
 *  monitor's rate, 120 turns a second at 120 Hz, and at 60 Hz ran the s780
 *  traffic lights and every other ambience script 20% fast. */
const blanks = new NativeVblankClock();

/**
 * This browser frame's PAL blanks for the field, as display deltas (1 or 2
 * each, at most four). Call ONCE per rendered frame and hand the same list to
 * every field runtime that counts blanks (tickNativeStage, the ported stage
 * actors in web/stage-objects.js), so the original code and its port step the
 * same blanks. `seconds` is the frame's elapsed time; without it the clock
 * reads `performance.now()`.
 */
export function advanceFieldBlanks(seconds) {
    return typeof seconds === "number"
        ? blanks.advance(seconds)
        : blanks.advanceFromStamp(typeof performance !== "undefined" ? performance.now() : 0);
}

/** Start a fresh run of field blanks (stage entry), so no catch-up carries over. */
export function resetFieldBlanks() {
    blanks.reset();
}

export async function loadNativeStages() {
    const [, m, t, f] = await Promise.all([
        loadNativeRuntime(), // the interpreter bundle, before any stage boot
        fetch("assets/native/manifest.json").then((r) => r.json()),
        fetch("assets/native/exe_tables.json").then((r) => r.json()),
        fetch("assets/native/fieldstg.bin").then((r) => r.arrayBuffer()),
    ]);
    exeTables = t;
    fieldstg = new Uint8Array(f);
    await Promise.all(
        Object.entries(m)
            .filter(([, e]) => e.root_ctor >= 0)
            .map(([id]) =>
                fetch(`assets/native/${id}.bin`)
                    .then((r) => r.arrayBuffer())
                    .then((b) => (overlays[id] = new Uint8Array(b))),
            ),
    );
    manifest = m; // set last: enterNativeStage is a no-op until fully loaded
}

/** Enter a stage: boot its native code if it has any. Synchronous. */
export function enterNativeStage(stageId, host) {
    current = null;
    const entry = manifest?.[stageId];
    const bytes = overlays[stageId];
    const ns = nativeRuntime();
    if (!entry || entry.root_ctor < 0 || !bytes || !ns) return null;
    const rt = new ns.NativeStageRuntime(bytes, entry, host, exeTables, fieldstg ?? undefined);
    if (!rt.boot()) {
        console.warn(`[native] ${stageId} boot trap:`, rt.bootTrap);
        return null;
    }
    // the init fn wrote the point-table pointer into the descriptor bank slot
    // the real renderer reads ([0x80099d90] = descriptor+0x10)
    const pointTable = rt.mem.read32(0x80099d90) >>> 0;
    current = { stageId, rt, pointTable, effects: new Map() };
    // A new stage starts at the console's first blank, so the caller's own first
    // tick is one blank rather than a catch-up burst for the time the map took to
    // load.
    blanks.reset();
    return rt;
}

/** Per-frame: tick the native objects (call once, before drawEffects).
 *
 *  ONE CALL, EVERY BLANK IT IS WORTH. The browser frame rate is not the console's
 *  (see `blanks`), so the elapsed time between calls is measured and turned into
 *  PAL vertical blanks; the stage is stepped once per blank, each with the
 *  display service's own delta. A browser frame that owes no blank leaves the
 *  stage alone and keeps its recorded draw intents, which is why a 30 Hz monitor
 *  and a 144 Hz one show the same stage at the same speed. */
export function tickNativeStage(stageId, deltas = advanceFieldBlanks()) {
    if (!current || current.stageId !== stageId) return null;
    const { rt } = current;
    if (!deltas.length) return rt;
    for (const delta of deltas) {
        rt.drawCalls.length = 0;
        rt.ctxMarkers.length = 0;
        const before = rt.disabled.length;
        rt.tick(delta);
        if (rt.disabled.length > before) {
            for (const d of rt.disabled.slice(before)) {
                console.warn(`[native] ${stageId} disabled object cb=0x${d.cb.toString(16)}: ${d.reason}`);
            }
        }
    }
    return rt;
}

/** The live runtime + point-table base for the current stage (or null). */
export function nativeStage(stageId) {
    return current && current.stageId === stageId ? current : null;
}

/** SETANIM ≥ 0x320 route: fire the id on the current stage's native code.
 *  Returns true when consumed (the caller skips the generic emote bubble). */
export function fireNativeEffect(id, anim, facing) {
    if (!current) return false;
    const ok = current.rt.fireEffect(id, anim, facing);
    if (ok) current.effects.set(id, anim);
    if (!ok && current.rt.disabled.length) {
        const d = current.rt.disabled[current.rt.disabled.length - 1];
        if (d.reason.startsWith("fireEffect")) console.warn(`[native] ${current.stageId} ${d.reason}`);
    }
    return ok;
}
