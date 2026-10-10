// Browser proof for the field's stage ambience (the wstag overlay's own
// per-stage actor registry), the ordinary route.
//
// Two runs through the real web/game.js:
//   1. reference: `?nativeStages=1`, the original overlay through the MIPS
//      interpreter (the "before" picture). It needs the executable files under
//      assets/native/**.
//   2. ordinary route, no flags, every assets/native/** request denied FROM PAGE
//      LOAD: the translated stage-object actors run the whole stage, and
//      window.__stageAmbience reports execution "translated".
//
// The surface measured by tools/execution_forbidden_audit.mjs (`field`): a
// stage boots its own ambience actors, and in ordinary play those are the
// translated modules under engine/systems/** driven by web/stage-objects.js and
// web/effects.js. The original overlay is the explicit ?nativeStages research
// switch. This check drives s415's own crevice-ride actor (registry id 0x32b,
// SETANIM 816..820 the stage's own event script fires) through the game's
// SETANIM route and reads the row it writes, then boots the reference route to
// show the flag still runs the original code.
//
//   python3 -m http.server <port> --directory web
//   VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_translated_field_ambience.mjs [outdir]

import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = Number(process.env.VERIFY_PORT ?? 8763);
const ROOT = baseUrl(PORT);
const OUT = process.argv[2] ?? ".bunny-scratch/shots/field-ambience-translated";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => {
    const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
    console.log(line);
    results.push(line);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function openPage({ query = "", denyNative = false }) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const net = { denied: [], allowed: [] };
    await page.route("**/assets/native/**", (route) => {
        if (denyNative) { net.denied.push(route.request().url()); return route.abort(); }
        net.allowed.push(route.request().url());
        return route.continue();
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.addInitScript(() => { try { localStorage.setItem("assetMode", "authentic"); } catch { /* storage may be blocked */ } });
    await page.goto(`${ROOT}/?skipTitle=1&map=s415&noEncounters=1${query}`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    return { page, net, errors };
}

try {
    // ── before: the reference route (original code through the interpreter) ──
    {
        const { page, errors, net } = await openPage({ query: "&nativeStages=1" });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${OUT}/before-reference.png` });
        const ref = await page.evaluate(() => window.__stageAmbience.diagnostics("s415"));
        check("reference: ?nativeStages=1 boots the original overlay", ref.nativeOverlay === true, JSON.stringify(ref));
        check("reference: no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
        check("reference: the overlay images were requested", net.allowed.some((u) => /assets\/native\/s415\.bin/.test(u)),
            `${net.allowed.length} executable requests`);
        await page.close();
    }

    // ── after: the ordinary route, executables denied ───────────────────────
    const { page, net, errors } = await openPage({ denyNative: true });
    const diag = () => page.evaluate(() => window.__stageAmbience.diagnostics("s415"));

    check("production: the field's ambience reports translated execution",
        (await page.evaluate(() => window.__stageAmbience.execution)) === "translated");
    const d = await diag();
    check("production: the original overlay is NOT booted", d.nativeOverlay === false, JSON.stringify(d));
    check("production: the stage-object tables loaded", d.loaded === true, JSON.stringify(d));

    // Drive s415's own crevice-ride actor through the game's SETANIM route, the
    // way the stage's event script does (816 prewarm, then 817 the fall onto the
    // rail), and read the claimed row the actor writes.
    await page.evaluate(() => window.__teleport(150, 330));
    await page.waitForTimeout(400);
    const rideTag = JSON.parse(readFileSync("web/assets/data/point_record_actors.json", "utf8"))
        .stages.s415["811"].tags["1"];
    const ride = await page.evaluate(async ({ idx }) => {
        const so = await import("/stage-objects.js");
        const fx = await import("/effects.js");
        const before = window.__pointRecordActors.state("s415").some((a) => a.id === 811);
        so.fireStageObject("s415", 811, 816); // prewarm: construct only
        await new Promise((r) => requestAnimationFrame(r));
        const built = window.__pointRecordActors.state("s415").some((a) => a.id === 811);
        so.fireStageObject("s415", 811, 817); // the fall onto the rail
        for (let i = 0; i < 140; i++) await new Promise((r) => requestAnimationFrame(r));
        const row = fx.pointSpriteProbe("s415")[idx];
        return { before, built, row: { x: row.x, y: row.y, active: row.active, sprite: row.sprite } };
    }, { idx: rideTag.index });
    check("production: the stage's own actor is built and runs (SETANIM 816/817)",
        ride.built && !ride.before, JSON.stringify(ride));
    await page.screenshot({ path: `${OUT}/after-ordinary.png` });
    check("production: the walker writes the claimed row on the rail at 150,430",
        ride.row.x === 150 && ride.row.y === 430 && ride.row.active === 1, JSON.stringify(ride.row));

    check("production: no executable asset was requested",
        net.allowed.length === 0 && net.denied.length === 0,
        `denied=${net.denied.length} allowed=${net.allowed.length}`);
    check("production: the stage's own tables were fetched",
        (await page.evaluate(() => window.__stageObjects.state("s415").loaded)) === true);
    check("production: no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

    writeFileSync(`${OUT}/verify-output.txt`, results.join("\n") + "\n");
} catch (e) {
    failures++;
    console.error("ERROR", e?.stack ?? e);
} finally {
    console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
}
