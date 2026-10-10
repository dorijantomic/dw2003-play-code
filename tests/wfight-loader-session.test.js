// The translated battle boot loader (pro/wfightmn), driven the way a battle
// drives it: it asks the cache for the scene packs, uploads them to VRAM,
// releases them, waits for the text banks and retires. No original instruction
// runs in the session; the interpreter appears only as the oracle in the last
// test, which runs the shipped loader over the same packs and compares.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WfightLoaderSession } from "../engine/dw3/ui/wfight-loader-session.ts";
import { NativeStageRuntime } from "../engine/native/runtime.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "web/assets/data");
const manifest = JSON.parse(readFileSync(join(data, "wfight/manifest.json"), "utf8"));
const packs = new Map(manifest.resources.filter((r) => r.file)
    .map((r) => [r.id, new Uint8Array(readFileSync(join(data, "wfight", r.file)))]));
const PACKS = [0x456, 0x79e, 0x7ae, 0x7e1, 0x7e3];

function run(language = 2, limit = 200) {
    const session = new WfightLoaderSession(language, { manifest, packs });
    let ticks = 0;
    while (!session.finished() && ticks < limit) { session.tick(); ticks++; }
    return { session, ticks };
}

test("the data build ships the five scene packs and every bank's sector count", () => {
    assert.deepEqual(manifest.resources.filter((r) => r.file).map((r) => r.id), PACKS);
    assert.equal(manifest.resources.length, 5 + 2 + 6 * 7);
    for (const r of manifest.resources) assert.ok(r.sectors > 0, `bank ${r.id.toString(16)}`);
    for (const [id, bytes] of packs) {
        assert.equal(bytes.length, manifest.resources.find((r) => r.id === id).sectors * 2048);
    }
});

test("the loader asks for the five packs, then the eight text banks, and retires itself", () => {
    const { session, ticks } = run(2);
    assert.equal(session.finished(), true);
    assert.ok(ticks > 5 && ticks < 60, `retired after ${ticks} ticks`);
    assert.deepEqual(session.requested, [...PACKS, 0x286, 0x455, 0x7f + 2, 0x4e + 2, 0xa2 + 2, 0x9b + 2, 0x6a + 2, 0x63 + 2]);
    assert.deepEqual(session.released, PACKS);
    assert.equal(session.tree.tasks.size, 0);
});

test("the loader takes its text banks from the current language", () => {
    for (let language = 0; language < 7; language++) {
        const { session } = run(language);
        assert.deepEqual(session.requested.slice(7),
            [0x7f, 0x4e, 0xa2, 0x9b, 0x6a, 0x63].map((base) => base + language), `language ${language}`);
    }
});

test("the uploads land where the battle expects them", () => {
    const { session } = run();
    assert.deepEqual(session.uploads, [
        { x: 0x200, y: 0, w: 64, h: 256 },      // PGFGTW00 entry 1
        { x: 0, y: 0xf4, w: 156, h: 12 },       // PGFGTW00 entry 0, the marker strip
        { x: 0x140, y: 0x100, w: 64, h: 256 },  // 0x79E record 0
        { x: 0x180, y: 0x100, w: 64, h: 256 },  // 0x79E record 1 (x advances 0x40 per record)
        { x: 0x1c0, y: 0x100, w: 64, h: 256 },  // 0x7AE
        { x: 0x200, y: 0x100, w: 64, h: 256 },  // 0x7E1
        { x: 0x240, y: 0x100, w: 64, h: 256 },  // 0x7E3
    ]);
});

test("the marker strip the command list copies from is the loader's own upload", () => {
    const { session } = run();
    const strip = session.stripPixels();
    assert.ok(strip, "the loader left the strip in VRAM (0, 0xF4)");
    assert.deepEqual(Buffer.from(strip), readFileSync(join(data, "battlecmd/strip.bin")));
});

test("the pack transfers ship their bytes; the text banks are served without content", () => {
    const { session } = run();
    for (const t of session.transfers) {
        const shipped = PACKS.includes(t.id);
        assert.equal(t.shipped, shipped, `bank ${t.id.toString(16)}`);
        assert.equal(t.bytes > 0, shipped);
    }
    assert.equal(session.transfers.length, 13);
});

test("an unknown resource id throws instead of being invented", () => {
    const thin = { resources: manifest.resources.filter((r) => r.id !== 0x286) };
    const session = new WfightLoaderSession(2, { manifest: thin, packs });
    assert.throws(() => { for (let i = 0; i < 60; i++) session.tick(); }, /Unknown battle loader resource 286/);
    assert.throws(() => new WfightLoaderSession(9, { manifest, packs }), /language/);
    assert.throws(() => new WfightLoaderSession(2, { manifest, packs: new Map() }), /missing/);
});

test("disposing mid-load removes the task", () => {
    const session = new WfightLoaderSession(2, { manifest, packs });
    session.tick(); session.tick();
    assert.equal(session.finished(), false);
    session.dispose();
    assert.equal(session.finished(), true);
});

// ---- the interpreter oracle -------------------------------------------------
// The shipped loader runs over the same pack bytes with the resident cache,
// resident upload helper and libgpu LoadImage boundary in place. Both sides must
// ask for the same banks in the same order and upload the same rectangles with
// the same pixels.
const shipped = resolve(root, "web/assets/native/screens");
const BASE = 0x800a5de0;

test("oracle: the shipped loader requests and uploads exactly what the translation does", () => {
    const resident = new Uint8Array(readFileSync(join(shipped, "resident.bin")));
    const overlay = new Uint8Array(readFileSync(join(shipped, "pro_wfightmn.bin")));
    const banks = new Map(packs);
    const host = {
        setFlag() {}, getFlag: () => 0, rand16: () => 0x777, log() {},
        readBank(id, dest, nbytes) {
            const bank = banks.get(id);
            if (!bank) return;
            for (let i = 0; i < Math.min(nbytes, bank.length); i++) rt.mem.write8(dest + i, bank[i]);
        },
    };
    const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0x800a6414 - BASE, allocs: [], effect_ids: [] };
    const rt = new NativeStageRuntime(overlay, entry, host, undefined, undefined, BASE, { image: resident, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    // The screen runtime stands in for the pack resolver with a zeroed scratch block; the
    // loader needs the real F0x800140D8, which walks the loaded pack's offset table.
    rt.cpu.clearStub(0x800140d8);
    rt.mem.write32(0x8005cca8, 2);
    assert.equal(rt.boot(), true);
    const original = [];
    const seen = new Set();
    for (let frame = 0; frame < 200; frame++) {
        rt.tick(1);
        for (let i = 0; i < 0x40; i++) {
            const at = 0x80044b3c + i * 0x10;
            const id = rt.mem.read32(at + 4) & 0xffff;
            if (rt.mem.read32(at) !== 0 && id && !seen.has(id)) { seen.add(id); original.push(id); }
        }
        if (!rt.liveObjects.some((o) => (o.cb >>> 0) === 0x800a5ecc)) break;
    }
    const { session } = run(2);
    assert.deepEqual(session.requested, original, "bank requests");
    const rects = (loads) => loads.map((l) => [l.x, l.y, l.w, l.h]);
    assert.deepEqual(session.vram.loads.map((l) => [l.x, l.y, l.w, l.h]), rects(rt.vram.loads), "uploaded rectangles");
    for (const [i, load] of rt.vram.loads.entries()) {
        assert.deepEqual(Buffer.from(session.vram.loads[i].pixels), Buffer.from(load.pixels), `pixels of upload ${i}`);
    }
});
