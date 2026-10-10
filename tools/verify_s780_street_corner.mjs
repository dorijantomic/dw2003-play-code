// Ordinary-play capture for the Kusanagi City street corner's own objects.
//
// Boots the street in NORMAL play (no ?nativeStages), plays the A.O.A
// announcement, and reports every ported s780 object the corner owns: the
// corner stinger the `SETANIM 802 803` line pops, the three traffic-light glows
// the broadcast object draws above the street, the street manager's six glows
// and the two lamp records it lights — the last only at master story ordinal
// 0x1B, which the tool can set.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_s780_street_corner.mjs [outdir]
//
// NATIVE=1 runs the same script against the original machine code instead, so
// the two routes can be compared on the same page.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/s780-corner";
const NATIVE = process.env.NATIVE === "1";
const ORDINAL = process.env.ORDINAL ? Number(process.env.ORDINAL) : null;
const SECONDS = Number(process.env.SECONDS || 80);
const SHOT_MS = Number(process.env.SHOT_MS || 250);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

/** Everything the corner owns, read out of the shipped modules. */
const sample = () =>
    page.evaluate(async () => {
        const mod = await import("/vendor/engine.js");
        const native = await import("/native-stage.js");
        const stage = "s780";
        const rt = native.nativeStage(stage);
        const tables = mod.STREET_LIGHT_TABLES;
        const s = window.__stageObjects.state(stage);
        return {
            native: Boolean(rt),
            stinger: mod.stingerPopupState(stage),
            stingerDraws: mod.stingerPopupDraws(stage),
            props: mod.streetPropDraws(stage),
            glows: mod.streetGlowDraws(stage),
            writes: mod.streetLightWrites(stage),
            corner: mod.streetLightState(stage),
            sequenceClips: tables.s780.sequences.map((seq) =>
                seq.map((e) => e[0]).filter((c) => c !== 255),
            ),
            cars: mod.streetVehicleDraws(stage),
            // Under the research route the ported modules stand down, so the
            // evidence is the ORIGINAL's own output: its drawSprite calls and
            // the bytes it writes into the two lamp records.
            nativeProps: rt
                ? rt.rt.drawCalls
                      .filter(
                          (c) =>
                              c.method === "drawSprite" &&
                              [0xc6, 0x156, 0xea].includes(c.args[2] >>> 0),
                      )
                      .slice(-24)
                      .map((c) => `${c.args[1]}@${c.args[2]},${c.args[3]}`)
                : null,
            // One entry per pole, so each can be checked against its OWN
            // sequence: pole 0 plays 10..18 and pole 1 plays 18..25.
            nativeLamps: rt
                ? [0, 1].map((i) => {
                      const rec = rt.pointTable + i * 18;
                      return `${rt.rt.mem.read8(rec)},${rt.rt.mem.read8(rec + 4)}`;
                  })
                : null,
        };
    });

let sequenceClips = [];
const results = {
    seenStinger: false,
    stingerClips: new Set(),
    maxProps: 0,
    propSet: null,
    maxGlows: 0,
    maxWrites: 0,
    writeSprites: new Set(),
    maxCars: 0,
    nativeProps: new Set(),
    nativeLampClips: [new Set(), new Set()],
    nativeLampActive: new Set(),
};
// The nine (clip, x, y) triples the port's STREET_PROP_GROUPS can emit, read out
// of the overlay's own immediates: `li $a1, 0x44/0x45/0x46` with
// `li $a2, 0xc6/0x156` and `li $a3, 0xb3/0xbc/0xc4`, then the same pair at
// `0x41/0x42/0x43` with `li $a2, 0xea` (file 0xe20-0xfc8).
const PROP_ROWS = new Set(
    [
        { x: 0xc6, clips: [0x44, 0x45, 0x46], y: [0xb3, 0xbc, 0xc4] },
        { x: 0x156, clips: [0x44, 0x45, 0x46], y: [0xfb, 0x104, 0x10c] },
        { x: 0xea, clips: [0x41, 0x42, 0x43], y: [0xb3, 0xbc, 0xc4] },
    ].flatMap((g) => g.clips.map((c, r) => `${c}@${g.x},${g.y[r]}`)),
);
let failures = 0;
const check = (ok, what) => {
    if (!ok) {
        failures += 1;
        console.log(`FAIL ${what}`);
    } else {
        console.log(`ok   ${what}`);
    }
};

try {
    const url = `${baseUrl(8966)}/?skipTitle=1&map=s780${NATIVE ? "&nativeStages=1" : ""}`;
    await page.goto(url);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
    if (ORDINAL !== null) {
        await page.evaluate((o) => {
            window.__state.progressOrdinal = o;
        }, ORDINAL);
    }
    // Re-enter so the corner is built by the stage's own first tick.
    await page.evaluate(() => {
        const idx = window.__state.manifest.maps.findIndex((m) => m.id === "s780");
        if (idx >= 0) window.__setMap(idx, null);
    });
    await page.waitForTimeout(300);
    if (ORDINAL !== null) {
        // The interpreter keeps the master story ordinal in its own emulated
        // RAM at [0x8005b370], which the browser's story ordinal does not reach.
        // Write it and re-arm the overlay's street entry, whose state-0 arm is
        // what builds the corner (file 0x1720-0x1774).
        console.log("PATCH", await page.evaluate(async (o) => {
            const native = await import("/native-stage.js");
            const rt = native.nativeStage("s780");
            if (!rt) return "no native stage (translated route: nothing to patch)";
            rt.rt.mem.write32(0x8005b370, o >>> 0);
            const entry = (rt.rt.world?.objects ?? []).find((x) => x.cb === 0x800a74cc);
            if (entry) rt.rt.mem.write32(entry.addr + 0xc, 0);
            return `ordinal=${o} entry=${entry ? "0x" + entry.addr.toString(16) : "none"}`;
        }, ORDINAL));
        await page.waitForTimeout(250);
    }

    const deadline = Date.now() + SECONDS * 1000;
    let shots = 0;
    while (Date.now() < deadline) {
        await page.keyboard.press("Enter");
        await page.waitForTimeout(60);
        await page.keyboard.press("Space");
        const s = await sample();
        sequenceClips = s.sequenceClips ?? sequenceClips;
        if (s.stingerDraws?.length) {
            results.seenStinger = true;
            results.stingerClips.add(s.stingerDraws[0].clip);
            if (shots < 40 && shots % 4 === 0) {
                await page.screenshot({ path: `${OUT}/stinger${String(shots).padStart(2, "0")}.png` });
            }
        }
        if (s.props?.length) {
            results.maxProps = Math.max(results.maxProps, s.props.length);
            results.propSet = s.props.map((p) => `${p.clip}@${p.x},${p.y}`).join(" ");
        }
        if (s.glows?.length) results.maxGlows = Math.max(results.maxGlows, s.glows.length);
        if (s.writes?.length) {
            results.maxWrites = Math.max(results.maxWrites, s.writes.length);
            for (const w of s.writes) results.writeSprites.add(w.sprite);
        }
        results.maxCars = Math.max(results.maxCars, s.cars?.length ?? 0);
        for (const d of s.nativeProps ?? []) results.nativeProps.add(d);
        (s.nativeLamps ?? []).forEach((d, pole) => {
            const [active, clip] = d.split(",");
            results.nativeLampActive.add(active);
            if (active === "1") results.nativeLampClips[pole].add(Number(clip));
        });
        shots += 1;
        await page.waitForTimeout(SHOT_MS);
    }
    await page.screenshot({ path: `${OUT}/last.png` });

    console.log("STINGER clips", [...results.stingerClips].sort((a, b) => a - b).join(","));
    console.log("PROPS", results.propSet ?? "-", "max", results.maxProps);
    console.log("GLOWS max", results.maxGlows);
    console.log("LAMP WRITES max", results.maxWrites, "sprites", [...results.writeSprites].sort((a, b) => a - b).join(","));
    console.log("CARS max", results.maxCars);
    if (NATIVE) {
        // Research route: the port stands down, so this asserts the ORIGINAL
        // against the port's tables. Both must name the same thing.
        const rows = [...results.nativeProps].sort();
        console.log("NATIVE prop rows", rows.join(" "));
        check(rows.length > 0, "the original draws the traffic-light glows");
        check(
            rows.every((r) => PROP_ROWS.has(r)),
            "every row it draws is one the port's table names",
        );
        console.log(
            "NATIVE lamp clips",
            results.nativeLampClips.map((set) => [...set].sort((a, b) => a - b).join(",")).join(" | "),
        );
        if (ORDINAL === 27) {
            check(
                results.nativeLampActive.has("1"),
                "the original lights the pole records at the ordinal-0x1B beat",
            );
            check(
                results.nativeLampClips[0].size >= 4 && results.nativeLampClips[1].size >= 4,
                `and cycles them (${results.nativeLampClips[0].size} and ${results.nativeLampClips[1].size} clips)`,
            );
            // Each pole walks its OWN list, and the port's two tables name
            // exactly those clips (engine/dw3/street-light-tables.ts).
            const wanted = sequenceClips.map((clips) => new Set(clips));
            check(
                [...results.nativeLampClips[0]].every((c) => wanted[0].has(c)),
                "pole 0 only ever shows clips from its own sequence",
            );
            check(
                [...results.nativeLampClips[1]].every((c) => wanted[1].has(c)),
                "pole 1 only ever shows clips from its own sequence",
            );
        }
    } else {
        check(results.maxProps === 3, "the broadcast object draws its three traffic-light glows");
        check(results.maxCars >= 2, "the announcement's cars are on the street");
        if (ORDINAL === null) {
            // The stinger belongs to the opening announcement's own script line
            // `SETANIM 802 803`; the ordinal-0x1B beat is a different scene.
            check(results.seenStinger, "the corner stinger appears during the announcement");
            check(results.stingerClips.size >= 2, `and runs through several clips (${results.stingerClips.size})`);
        }
        if (ORDINAL === 27) {
            check(results.maxGlows === 6, "six glows at the ordinal-0x1B beat");
            check(results.maxWrites === 2, "both poles' lamp records are written");
            check(results.writeSprites.size >= 4, `and the lamp sequence runs (${results.writeSprites.size} clips)`);
            check(
                [...results.writeSprites].every((c) => (c >= 10 && c <= 15) || (c >= 18 && c <= 25)),
                "and every clip is one the overlay's own two sequences name",
            );
        } else {
            check(results.maxGlows === 0, "no traffic-light corner at the opening broadcast");
            check(results.maxWrites === 0, "and no lamp record writes");
        }
    }
    console.log(failures === 0 ? "VERDICT OK" : `VERDICT ${failures} FAILURE(S)`);
} finally {
    console.log("--- console log ---");
    for (const l of logs.slice(-12)) console.log(l);
    await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
