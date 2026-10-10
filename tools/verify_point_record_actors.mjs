// Player-visible check: THE point-record actors, in ORDINARY play.
//
// All seventeen members of engine/systems/point-record-actor.ts -- the stage
// objects that claim their own stage's dormant point-sprite records by their
// atlas byte and animate them:
//
//   pad-flash    s212 810 (0x32a) the three Asuka City download pads
//                s225 815 (0x32f) the login-room flash
//                s750 846 (0x34e) the north-sector chamber-room pad
//                s925 855 (0x357) a construct-only copy
//   decor        s785 835 (0x343) the Online Center's four stacked records
//                s790 808/809 (0x328/0x329) one re-pointed record, then the
//                        eight-record reveal
//                s795 836 (0x344), s800 837 (0x345) the Magasta panels
//                s800 839 (0x347) the construct-only one-shot pair
//   point-record s805 840 (0x348) the machine room's four picture slots
//                s810 842/843/844 (0x34a/0x34b/0x34c) the three stations
//                s820 853 (0x355) sound only
//   single       s455 828 (0x33c) the swamp shrine's own sprite, lit where the
//                        stage's table put it and run once through its script
//   rise         s926 854 (0x356) one row sliding down the screen a pixel a
//                        blank, then stopping where it got to
//   slots/point  s545 847 (0x34f) a row that sits in its flash frame until the
//                        room's own command, then runs one script and hands
//                        itself back to the flash
//   slots        s620 849 (0x351) four claimed rows, each writing its clip into
//                        one of the record's two animation bytes, and picking
//                        its script out of the overlay's own entry table
//                s680 814 (0x32e) eleven lane rows and three traffic rows off
//                        one claim walk, lit by tag, with the end entry walking
//                        a lane down the screen
//
// Every stage is entered the ordinary way (?skipTitle=1&map=..., no
// ?nativeStages, so the original overlay machine code is NOT running).  The
// members whose registry record has a NULL constructor are reached with no
// firing at all -- the stage builds them at stage entry -- and the rest through
// the game's own SETANIM route with the operand the stage's recovered script
// passes.  The check reads what the point renderer would draw, so a clip cycle
// is read directly instead of guessed from averaged pixels.
//
// Decode and the per-member table: docs/research/field/stage-object-registry-
// 2026-10-04.md.  This file replaces tools/verify_materialize_pads.mjs,
// tools/verify_decor_drivers.mjs and tools/verify_point_record_drivers.mjs.
//
// Run:  python3 -m http.server <port> --directory web &
//       VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_point_record_actors.mjs [outdir]
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { baseUrl } from "./verify-base-url.mjs";

/** The ONE table, so the record indices a member claims are never hand-typed. */
const MEMBERS = JSON.parse(
    await readFile("web/assets/data/point_record_actors.json", "utf8"));

/** The record index a member claims for ONE atlas tag. */
const tagIndex = (stage, id, tag) =>
    MEMBERS.stages[stage][String(id)].tags[String(tag)].index;

/** Every record index a member claims, in atlas-tag order. */
const memberTags = (stage, id) =>
    Object.keys(MEMBERS.stages[stage][String(id)].tags)
        .map(Number)
        .sort((a, b) => a - b)
        .map((t) => tagIndex(stage, id, t));

const OUT = process.argv[2] || ".bunny-scratch/shots/point-record-actors";
const PORT = Number(process.env.VERIFY_PORT ?? 8961);
const FRAMES = Number(process.env.FRAMES || 16);
const STEP_MS = Number(process.env.STEP_MS || 120);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));

const fails = [];
const check = (name, ok, detail) => {
    console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail === undefined ? "" : ` — ${detail}`}`);
    if (!ok) fails.push(name);
};

/** Boot a stage, switch to the authentic art, and stand where the member acts. */
async function enter(map, at) {
    await page.goto(`${baseUrl(PORT)}?skipTitle=1&map=${map}`);
    const style = page.locator("#asset-mode-authentic");
    if (await style.isVisible().catch(() => false)) await style.click();
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 25000 });
    if (at) {
        await page.evaluate(([x, y]) => window.__teleport(x, y), at);
        await page.waitForTimeout(400);
    }
    await page.waitForTimeout(1200);
}

/** One snapshot: the live actors, the records, and whether the original is in. */
const read = (map) =>
    page.evaluate(async (m) => {
        const native = await import("/native-stage.js");
        return {
            actors: window.__pointRecordActors.state(m),
            records: window.__pointRecordActors.records(m),
            native: native.nativeStage(m) !== null,
        };
    }, map);

/** N snapshots with a screenshot each, so a clip cycle is visible too. */
async function sample(map, tag, n = FRAMES) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push(await read(map));
        await page.screenshot({ path: `${OUT}/${map}-${tag}-${String(i).padStart(2, "0")}.png` });
        await page.waitForTimeout(STEP_MS);
    }
    return out;
}

const rowsOf = (snap, idxs) => snap.records.filter((r) => idxs.includes(r.index));
const rowOf = (rows, i) => rows.filter((r) => r.index === i)[0];

/** Does the column change across the samples? */
function moves(rows, idx) {
    return new Set(rows.map((r) => `${r[idx]}`).filter((v) => v !== "undefined")).size > 1;
}

/**
 * The sprites the member's OWN `fire` script names, terminator excluded. The
 * cells are `{clip, hold, mode}` triples and the terminator is clip `0xff`.
 */
const fireFrames = (stage, id) =>
    MEMBERS.stages[stage][String(id)].scripts.fire
        .map((cell) => cell[0])
        .filter((clip) => clip !== 0xff);

/**
 * Watch ONE run of a script to its end, from INSIDE the page.
 *
 * The earlier form of this check took a fixed number of wall-clock samples with a
 * screenshot in each and asked how many DIFFERENT sprites it happened to catch,
 * which is a coin flip: the run is ten frames of four blanks each, a round trip
 * out to the page lands every two or three frames, and whether four landed inside
 * the window depended on how fast the machine was. That is a sampling artefact,
 * not a property of the port. This reads the row once per animation frame for
 * four seconds, which cannot step over a frame that lasts three of them, and
 * reports every sprite the row REALLY showed -- the whole script, not a sample.
 */
async function watchRun(map, id, sub, front, frames = 240) {
    const run = await page.evaluate(async ({ map: m, id: aid, sub: asub, front: f, n }) => {
        const fx = await import("/effects.js");
        const so = await import("/stage-objects.js");
        so.fireStageObject(m, aid, asub);
        const sprites = [];
        let backSeen = false;
        for (let i = 0; i < n; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            const row = fx.pointSpriteProbe(m)[f];
            if (row.active && sprites[sprites.length - 1] !== row.sprite) sprites.push(row.sprite);
            if (fx.pointSpriteProbe(m).some((r) => r.active === 1 && r.sprite === 0x51)) {
                backSeen = true;
            }
        }
        return { sprites, backSeen };
    }, { map, id, sub, front, n: frames });
    await page.screenshot({ path: `${OUT}/${map}-${id}-fire-end.png` });
    const script = fireFrames(map, id);
    return {
        sprites: run.sprites,
        backSeen: run.backSeen,
        missing: script.filter((f) => !run.sprites.includes(f)),
        script,
    };
}

try {
    // ── arm 1: the pad flashes ──────────────────────────────────────────
    // The operand NAMES the pad, and the actor moves its three claimed records
    // onto it, so this is the one arm with a position to check.
    const PADS = [
        { stage: "s212", id: 810, sub: 815, pad: [217, 292], cue: "0x010c0000",
            what: "Asuka City lobby, the first download pad" },
        { stage: "s212", id: 810, sub: 826, pad: [257, 272], cue: "0x010c0001",
            what: "Asuka City lobby, the second download pad" },
        { stage: "s225", id: 815, sub: 838, pad: [336, 274], cue: "0x00cc0001",
            what: "Asuka City login room, the login pad" },
        { stage: "s750", id: 846, sub: 821, pad: [320, 186], cue: "0x01000000",
            what: "North-sector chamber room, its one pad" },
        { stage: "s925", id: 855, sub: 821, pad: [336, 274], cue: "0x00cc0001",
            what: "the construct-only copy, its constructor-literal pad" },
    ];
    for (const c of PADS) {
        await enter(c.stage, [c.pad[0], c.pad[1] + 30]);
        await page.screenshot({ path: `${OUT}/${c.stage}-${c.sub}-before.png` });
        const fired = await page.evaluate(async ({ stage, id, sub }) => {
            const so = await import("/stage-objects.js");
            const fx = await import("/effects.js");
            const consumed = so.fireStageObject(stage, id, sub);
            const run = window.__pointRecordActors.state(stage)
                .find((a) => a.machine === "pad-flash" && a.pad);
            return {
                consumed,
                pad: run ? [run.pad.x, run.pad.y] : null,
                cue: fx.padRunSound(stage),
                native: (await import("/native-stage.js")).nativeStage(stage) !== null,
            };
        }, c);
        check(`${c.stage}: SETANIM ${c.id} ${c.sub} is consumed`,
            fired.consumed === true);
        check(`${c.stage}: the pad is at ${JSON.stringify(c.pad)}`,
            fired.pad !== null && fired.pad[0] === c.pad[0] && fired.pad[1] === c.pad[1],
            JSON.stringify(fired.pad));
        check(`${c.stage}: the cue it plays is ${c.cue}`, fired.cue === c.cue,
            String(fired.cue));
        check(`${c.stage}: the original overlay machine code is NOT running`,
            !fired.native);
        const shots = [];
        for (let i = 0; i < FRAMES; i++) {
            shots.push(await read(c.stage));
            await page.screenshot({
                path: `${OUT}/${c.stage}-${c.sub}-f${String(i).padStart(2, "0")}.png`,
            });
            await page.waitForTimeout(STEP_MS);
        }
        const claimed = memberTags(c.stage, c.id);
        const lit = shots.map((s) => rowsOf(s, claimed).filter((r) => r.active));
        check(`${c.stage}: the halo shows on its claimed records`,
            lit.some((rows) => rows.length > 0),
            `${claimed.length} records, lit ${JSON.stringify(lit.map((r) => r.length))}`);
        // A flash is a few seconds long, so the last sample can already be past
        // its end; the check is on the busiest sample, by which time every slot
        // the flash uses has been moved onto the pad.
        const best = lit.reduce((a, b) => (b.length > (a?.length ?? 0) ? b : a), null) ?? [];
        const atPad = best.length > 0 && best.every((r) =>
            Math.abs(r.x - c.pad[0]) <= 2 && Math.abs(r.y - c.pad[1]) <= 48);
        check(`${c.stage}: the halo lands on ${c.what}`, atPad,
            JSON.stringify(best.map((r) => [r.index, r.x, r.y])));
        check(`${c.stage}: the halo animates`, moves(lit.flat(), "sprite"),
            `sprites ${[...new Set(lit.flat().map((r) => r.sprite))].sort((a, b) => a - b).join(",")}`);
    }

    // ── arm 2: the decor actors ─────────────────────────────────────────
    // s795's 836 and s800's 837 have a NULL registry constructor, so the stage
    // builds them at stage entry and they animate with no firing at all.
    await enter("s795", [430, 810]);
    const b1 = await sample("s795", "836");
    const d836 = b1[0].actors.find((a) => a.id === 836);
    check("s795 actor 836 exists with no research flags", !!d836);
    check("s795 836 is not running the original machine code", !b1[0].native);
    check("s795 836 reaches state 1 (blinking)", d836?.state === 1, `state ${d836?.state}`);
    const front795 = tagIndex("s795", 836, 1);
    const back795 = tagIndex("s795", 836, 2);
    check("s795 836 shows sprite 70 on its front record",
        b1.some((s) => rowsOf(s, [front795]).some((r) => r.sprite === 0x46 && r.active === 1)));
    check("s795 836's blink animates its palette row, not its sprite",
        moves(b1.map((s) => rowsOf(s, [front795])[0]), "ctr"),
        `ctr seen ${[...new Set(b1.map((s) => rowsOf(s, [front795])[0].ctr))].join(",")}`);
    await page.screenshot({ path: `${OUT}/s795-before-859.png` });
    const run795 = await watchRun("s795", 836, 859, front795);
    check("s795 836 plays its whole ten-frame fire on sub 859",
        run795.missing.length === 0,
        `script ${run795.script.join(",")}; the row showed ${run795.sprites.join(",")}`
        + (run795.missing.length ? `; missing ${run795.missing.join(",")}` : ""));
    check("s795 836 brings the record behind it up at sprite 81",
        run795.backSeen,
        `back row sprite 81 seen ${run795.backSeen}`);
    await page.screenshot({ path: `${OUT}/s795-after-859.png` });

    await enter("s800", [900, 740]);
    const b3 = await sample("s800", "837");
    check("s800 actor 837 exists with no research flags",
        b3[0].actors.some((a) => a.id === 837));
    const run800 = await watchRun("s800", 837, 859, tagIndex("s800", 837, 1));
    await page.evaluate(() => window.__stageObjects.fireSub(839, 859));
    const b4 = await sample("s800", "fire");
    const front800 = tagIndex("s800", 837, 1);
    const one839 = tagIndex("s800", 839, 3);
    const hidden839 = tagIndex("s800", 839, 4);
    check("s800 837 plays its whole ten-frame fire on sub 859",
        run800.missing.length === 0,
        `script ${run800.script.join(",")}; the row showed ${run800.sprites.join(",")}`
        + (run800.missing.length ? `; missing ${run800.missing.join(",")}` : ""));
    check("s800 839 runs its one-shot",
        new Set(b4.map((s) => rowsOf(s, [one839])[0].sprite)).size > 2,
        `sprites ${[...new Set(b4.map((s) => rowsOf(s, [one839])[0].sprite))].join(",")}`);
    check("s800 839 never lights its hidden record, as in the original",
        b4.every((s) => rowsOf(s, [hidden839])[0].active === 0));

    await enter("s785", [299, 260]);
    await page.screenshot({ path: `${OUT}/s785-before-835.png` });
    await page.evaluate(() => window.__stageObjects.fireSub(835, 821));
    const b5 = await sample("s785", "835");
    const d835 = b5[0].actors.find((a) => a.id === 835);
    check("s785 actor 835 exists and claims four records",
        d835?.rec?.length === 4 && d835.rec.every((r) => r !== null),
        JSON.stringify(d835?.rec));
    const stacked = b5.map((s) => rowsOf(s, memberTags("s785", 835)));
    check("s785 835's records animate", moves(stacked.map((rows) => rows[0]), "ctr"),
        `ctr seen ${[...new Set(stacked.map((rows) => rows[0].ctr))].join(",")}`);
    await page.screenshot({ path: `${OUT}/s785-after-835.png` });

    // s785 807 (0x327): the picture-steps member -- no record claim at all.
    // Watch every frame from inside the page: three 4-blank pictures, then the
    // arm word's picture (SETANIM 808 arms 2), then SETANIM 810's state-2 pair
    // (54, 55) and the end of the run.  The drawn entries are what
    // drawStageObjectSprites paints, and their position must be the anchor
    // character's own world pixels minus 0x18 (the helper's `addiu $v0,-0x18`)
    // -- here the scene's npc 12, the same id the script's operand names.
    await page.screenshot({ path: `${OUT}/s785-327-before.png` });
    const lamp = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        const PICS = new Set([50, 51, 52, 53, 54, 55, 56, 57, 60, 61]);
        const scene = window.__state.scenes["s785"];
        const npc = scene?.npcs?.find((n) => n.npc_id === 12) ?? null;
        const seq = [];
        const positions = [];
        const step = async (fire) => {
            if (fire) so.fireStageObject("s785", 807, fire);
            for (let i = 0; i < 90; i++) {
                await new Promise((r) => requestAnimationFrame(r));
                const d = so.stageObjectDraws("s785")
                    .filter((e) => e && PICS.has(e.clip));
                const clip = d.length ? d[0].clip : null;
                if (clip !== seq[seq.length - 1]) seq.push(clip);
                if (d.length) positions.push([d[0].x, d[0].y]);
            }
        };
        await step(808);
        const before810 = seq.length;
        await step(810);
        return { npc: npc ? { x: npc.x, y: npc.y } : null, seq, before810, positions };
    });
    check("s785 has the npc the script's find operand names (npc 12)",
        lamp.npc !== null, JSON.stringify(lamp.npc));
    const firstRun = lamp.seq.slice(0, lamp.before810).filter((v) => v !== null);
    check("s785 807 steps 50 -> 51 -> 52 and then the arm word's 60",
        firstRun.slice(0, 3).join(",") === "50,51,52"
        && firstRun.includes(60),
        `pictures ${lamp.seq.slice(0, lamp.before810).join(",")}`);
    const tailRun = lamp.seq.slice(lamp.before810);
    check("s785 807's SETANIM 810 runs 54 then 55 and the pictures stop",
        tailRun.includes(54) && tailRun.includes(55)
        && tailRun[tailRun.length - 1] === null,
        `pictures ${tailRun.join(",")}`);
    const placed = lamp.npc && lamp.positions.length > 0
        && lamp.positions.every(([x, y]) => x === lamp.npc.x && y === lamp.npc.y - 24);
    check("s785 807 draws at the anchor's pixels minus 0x18",
        placed, `${lamp.positions.length} draws, first ${JSON.stringify(lamp.positions[0])}`);
    await page.screenshot({ path: `${OUT}/s785-327-after.png` });

    await enter("s790", [420, 130]);
    await page.evaluate(() => window.__stageObjects.fireSub(808, 813));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__stageObjects.fireSub(808, 814));
    await page.waitForTimeout(300);
    const re = memberTags("s790", 808)[0];
    check("s790 808 re-points its record on sub 814",
        (await read("s790")).records[re].sprite === 0,
        `sprite ${(await read("s790")).records[re].sprite}`);
    await page.screenshot({ path: `${OUT}/s790-808.png` });
    await page.evaluate(() => window.__stageObjects.fireSub(809, 813));
    await page.waitForTimeout(300);
    const x0 = (await read("s790")).records.map((r) => r.x);
    await page.screenshot({ path: `${OUT}/s790-809-before.png` });
    await page.evaluate(() => window.__stageObjects.fireSub(809, 812));
    const b6 = await sample("s790", "809", 14);
    const x1 = b6[b6.length - 1].records.map((r) => r.x);
    const slid = memberTags("s790", 809).filter((i) => x1[i] > x0[i]);
    check("s790 809 slides its records right", slid.length >= 4,
        `${slid.length} moved: ${slid.map((i) => `${i}:${x0[i]}->${x1[i]}`).join(" ")}`);
    await page.screenshot({ path: `${OUT}/s790-809-after.png` });

    // ── arm 3: the picture drivers ──────────────────────────────────────
    // s805's four panels: three PIN their clip byte in a `jal`'s delay slot and
    // the first one does NOT -- it stores the stepper's value.  This is the byte
    // the earlier reading got wrong, so it is checked from the live records.
    await enter("s805", [235, 110]);
    await page.evaluate(() => window.__stageObjects.fireSub(840, 859));
    const b7 = await sample("s805", "840");
    const tags805 = memberTags("s805", 840);
    const panel0 = b7.map((s) => rowsOf(s, [tags805[0]])[0]);
    check("s805 840's first panel walks its clip sequence",
        moves(panel0, "sprite"),
        `sprites ${[...new Set(panel0.map((r) => r.sprite))].join(",")}`);
    // Panels 2 and 3 PIN their clip byte (21 and 22) in the `jal`'s delay slot,
    // so nothing the script does can move them.  Panel 4 pins 19 only in STATE 1
    // (wstag805.s file 0x4ac/0x4b8) and the handler goes straight to state 2,
    // where its arm writes active 0 -- so its sprite byte is the disc's own.
    check("s805 840's panel 2 keeps its pinned clip 21",
        b7.every((s) => rowsOf(s, [tagIndex("s805", 840, 2)])[0].sprite === 21),
        `sprites ${[...new Set(b7.map((s) => rowsOf(s, [tagIndex("s805", 840, 2)])[0].sprite))].join(",")}`);
    check("s805 840's panel 3 keeps its pinned clip 22",
        b7.every((s) => rowsOf(s, [tagIndex("s805", 840, 3)])[0].sprite === 22),
        `sprites ${[...new Set(b7.map((s) => rowsOf(s, [tagIndex("s805", 840, 3)])[0].sprite))].join(",")}`);
    check("s805 840's panel 4 is switched off in state 2",
        b7.some((s) => rowsOf(s, [tagIndex("s805", 840, 4)])[0].active === 0));
    await page.screenshot({ path: `${OUT}/s805-after-840.png` });

    await enter("s810", [910, 110]);
    await page.evaluate(() => {
        for (const id of [842, 843, 844]) window.__stageObjects.fireSub(id, 859);
    });
    const b8 = await sample("s810", "842");
    const tags810 = memberTags("s810", 842);
    const front = b8.map((s) => rowsOf(s, [tags810[0]])[0]);
    const seen = [...new Set(front.map((r) => r.sprite))].sort((a, b) => a - b);
    check("s810 842's front picture walks 71..84", seen.includes(71) && seen.includes(84),
        `sprites ${seen.join(",")}`);
    check("s810 842's front picture holds on 84",
        front[front.length - 1].sprite === 84, `sprite ${front[front.length - 1].sprite}`);
    const back = b8.map((s) => rowsOf(s, [tags810[1]])[0]);
    check("s810 842's back picture stays on 70",
        back.every((r) => r.sprite === 70), `sprites ${[...new Set(back.map((r) => r.sprite))].join(",")}`);
    check("s810 842's back picture keeps pulsing after the front one ended",
        moves(back, "ctr"),
        `ctr seen ${[...new Set(back.map((r) => r.ctr))].join(",")}`);
    await page.screenshot({ path: `${OUT}/s810-after-842.png` });

    await enter("s820", [268, 194]);
    const before820 = await read("s820");
    await page.evaluate(() => window.__stageObjects.fireSub(853, 821));
    const b9 = await sample("s820", "853", 8);
    const rec853 = memberTags("s820", 853)[0];
    check("s820 853 is built by its SETANIM and claims its record",
        b9.some((s) => s.actors.some((a) => a.id === 853)),
        JSON.stringify(b9[0].actors.map((a) => a.id)));
    const moved = ["active", "sprite", "ctr"]
        .filter((k) => b9.some((s) => s.records[rec853][k] !== before820.records[rec853][k]));
    check("s820 853 never writes the record it claims, as in the original",
        moved.length === 0, `changed: ${moved.join(",")}`);
    await page.screenshot({ path: `${OUT}/s820-after-853.png` });

    // ── arm 5: the two in-place shapes ───────────────────────────────────
    // Neither of these two moves its row onto a pad: each lights the row
    // exactly where its OWN stage's point table put it, and that resting spot
    // is read out of the one table rather than typed here.
    //   s455's row runs the 16-cell script the table carries and the 0xFF cell
    //   switches it off for good (wstag455 file 0x1f4 `sb $zr, ($s0)`); its cue
    //   is the packed word 0x8004213e, played once (file 0x188).
    //   s926's row slides DOWN the screen one map pixel a blank -- the record's
    //   Y is the draw's Y (fieldstg file 0x635c `lh $a3, 0xc($s0)`) -- and stops
    //   on the 150th blank (wstag926 file 0x28c `slti $v0, 0x96`).
    const shrine = MEMBERS.stages.s455["828"].tags["1"];
    await enter("s455", [shrine.x, shrine.y + 30]);
    await page.screenshot({ path: `${OUT}/s455-828-before.png` });
    const before455 = (await read("s455")).records[shrine.index];
    await page.evaluate(() => {
        window.__packed = [];
        const orig = window.__sfx.playPacked.bind(window.__sfx);
        window.__sfx.playPacked = (id, ...rest) => { window.__packed.push(id); return orig(id, ...rest); };
    });
    const fired455 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s455", 828, 821);
    });
    check("s455: SETANIM 828 821 is consumed", fired455 === true);
    const c455 = await sample("s455", "828", 26);
    const row455 = c455.map((s) => s.records[shrine.index]);
    const clip455 = [...new Set(row455.map((r) => r.sprite))].sort((a, b) => a - b);
    check("s455 828 lights its row where the table put it, without moving it",
        row455.some((r) => r.active === 1)
        && row455.every((r) => r.x === before455.x && r.y === before455.y),
        `at ${row455[0].x},${row455[0].y} (table ${before455.x},${before455.y}), `
        + `lit ${JSON.stringify(row455.map((r) => r.active))}`);
    check("s455 828 runs its 16-cell script", clip455.length > 3,
        `sprites ${clip455.join(",")}`);
    check("s455 828 switches its row off when the script ends, as the original does",
        row455[row455.length - 1].active === 0,
        `last active ${row455[row455.length - 1].active}`);
    const cue455 = await page.evaluate(() => window.__packed.filter((w) => w === 0x8004213e).length);
    check("s455 828 plays its one cue 0x8004213e once", cue455 === 1, `heard ${cue455}`);
    check("s455 is not running the original overlay machine code",
        !(await read("s455")).native);
    await page.screenshot({ path: `${OUT}/s455-828-after.png` });

    const riser = MEMBERS.stages.s926["854"].tags["1"];
    await enter("s926", [riser.x, riser.y]);
    await page.screenshot({ path: `${OUT}/s926-854-before.png` });
    const before926 = (await read("s926")).records[riser.index];
    const fired926 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s926", 854, 1);
    });
    check("s926: SETANIM 854 is consumed", fired926 === true);
    const c926 = await sample("s926", "854", 40);
    const row926 = c926.map((s) => s.records[riser.index]);
    const ys926 = [...new Set(row926.map((r) => r.y))];
    const fell926 = ys926.length > 3 && ys926.every((y, i) => i === 0 || y >= ys926[i - 1]);
    check("s926 854 lights its row and slides it DOWN the screen, one pixel a blank",
        fell926 && row926[0].active === 1,
        `y ${ys926[0]} -> ${ys926[ys926.length - 1]}, lit ${row926[0].active}`);
    const rest926 = row926[row926.length - 1];
    check("s926 854 stops 149 pixels below where the table put it, and stays there",
        rest926.y === before926.y + 149,
        `y ${before926.y} -> ${rest926.y}`);
    check("s926 854 leaves its row lit where it stopped",
        rest926.active === 1, `active ${rest926.active}`);
    await page.screenshot({ path: `${OUT}/s926-854-after.png` });
    // ── arm 6: the flash row and the two many-slot copies ───────────────
    // Every cue from here on is read through the same packed-sound hook the
    // s455 check installs, on whichever stage is up.
    const hookPacked = () => page.evaluate(() => {
        window.__packed = [];
        const orig = window.__sfx.playPacked.bind(window.__sfx);
        window.__sfx.playPacked = (id, ...rest) => { window.__packed.push(id); return orig(id, ...rest); };
    });
    const packedCount = (word) => page.evaluate((w) =>
        (window.__packed ?? []).filter((x) => x === w).length, word);

    // s545's 847 has a NULL registry constructor, so the stage builds it at
    // stage entry and it sits in its flash until the room's own command.
    const flash = MEMBERS.stages.s545["847"].tags["1"];
    await enter("s545", [flash.x, flash.y + 40]);
    await hookPacked();
    await page.screenshot({ path: `${OUT}/s545-847-before.png` });
    const f0 = (await read("s545")).records[flash.index];
    check("s545 847 exists with no research flags",
        (await read("s545")).actors.some((a) => a.id === 847));
    check("s545 847 sits in its flash frame from the moment the room loads",
        f0.active === 1 && f0.sprite === 24 && f0.ctr === 9,
        `active ${f0.active}, sprite ${f0.sprite}, ctr ${f0.ctr}`);
    await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s545", 847, 0x35a);
    });
    // The FIRST entry of s545's script holds 25 blanks, so the row shows the
    // flash's own 9 for a quarter of a second before the script's values start.
    // 600 frames is ten seconds, which is the whole run and the whole restart.
    const flashRun = await page.evaluate(async (n) => {
        const fx = await import("/effects.js");
        const ctrs = new Set();
        const sprites = new Set();
        for (let i = 0; i < n; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            // `pointSpriteProbe` builds a fresh array every call, so the row has
            // to be read again inside the loop.
            const row = fx.pointSpriteProbe("s545")[10];
            ctrs.add(row.ctr);
            sprites.add(row.sprite);
        }
        return { ctrs: [...ctrs].sort((a, b) => a - b), sprites: [...sprites] };
    }, 600);
    check("s545 847 leaves its flash and runs its 19-entry script",
        flashRun.ctrs.length > 4, `ctr seen ${flashRun.ctrs.join(",")}`);
    check("s545 847 keeps sprite 24 pinned on every animate blank",
        flashRun.sprites.every((v) => v === 24),
        `sprites ${flashRun.sprites.join(",")}`);
    const cue545 = await packedCount(0x004c0002);
    check("s545 847 plays its one cue 0x004c0002 once", cue545 === 1, `heard ${cue545}`);
    await page.screenshot({ path: `${OUT}/s545-847-after.png` });

    // s620's 849 has a NULL configure slot, so the SETANIM only builds it.
    const grid = MEMBERS.stages.s620["849"];
    await enter("s620", [400, 360]);
    await page.screenshot({ path: `${OUT}/s620-849-before.png` });
    const consumed620 = await page.evaluate(async () => {
        const so = await import("/stage-objects.js");
        return so.fireStageObject("s620", 849, 0x335);
    });
    check("s620: SETANIM 849 821 is consumed", consumed620 === true);
    const gridRun = await page.evaluate(async (idxs) => {
        const fx = await import("/effects.js");
        const seen = idxs.map(() => ({ ctr: new Set(), sprite: new Set(), active: new Set() }));
        for (let i = 0; i < 200; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            const rows = fx.pointSpriteProbe("s620");
            idxs.forEach((ix, k) => {
                seen[k].ctr.add(rows[ix].ctr);
                seen[k].sprite.add(rows[ix].sprite);
                seen[k].active.add(rows[ix].active);
            });
        }
        return seen.map((s) => ({
            ctr: [...s.ctr].sort((a, b) => a - b),
            sprite: [...s.sprite].sort((a, b) => a - b),
            active: [...s.active].sort((a, b) => a - b),
        }));
    }, grid.grid.slots.map((s) => s.index));
    check("s620 849 claims four rows", grid.grid.slots.length === 4);
    check("s620 849's three ctr rows animate their palette row, not their sprite",
        gridRun.slice(0, 3).every((r) => r.ctr.length > 3 && r.sprite.length === 1),
        gridRun.slice(0, 3).map((r) => `ctr ${r.ctr.join(",")} sprite ${r.sprite.join(",")}`)
            .join(" | "));
    check("s620 849's fourth row animates its sprite, not its palette row",
        gridRun[3].sprite.length > 3 && gridRun[3].ctr.length === 1,
        `sprite ${gridRun[3].sprite.join(",")} ctr ${gridRun[3].ctr.join(",")}`);
    check("s620 849's third row blinks dark on the 300 its script opens with",
        gridRun[2].active.includes(0) && gridRun[2].active.includes(1),
        `active ${gridRun[2].active.join(",")}`);
    await page.screenshot({ path: `${OUT}/s620-849-after.png` });

    // s680's 814 lights a lane by TAG, and the end entry walks its row down.
    const lanes = MEMBERS.stages.s680["814"];
    const lane = lanes.lanes.lanes.find((l) => l.tag === 1);
    await enter("s680", [120, 160]);
    await hookPacked();
    await page.screenshot({ path: `${OUT}/s680-32e-before.png` });
    const before680 = (await read("s680")).records[lane.index];
    const restIdx680 = lanes.lanes.lanes.filter((l) => l.tag !== 1).map((l) => l.index);
    const beforeLanes680 = await page.evaluate(async (idxs) => {
        const fx = await import("/effects.js");
        const rows = fx.pointSpriteProbe("s680");
        return idxs.map((i) => rows[i].sprite);
    }, restIdx680);
    const run680 = await page.evaluate(async ({ ix, sub }) => {
        const so = await import("/stage-objects.js");
        const fx = await import("/effects.js");
        // The registry's handler constructs AND configures in one call
        // (fieldstg file 0x21bc then 0x21c8), and the claim arm zeroes every
        // lane's cursor index (`sh $zr, 0x58($a0)`, wstag680 file 0x2b8), so
        // the first SETANIM's arm is wiped on the next blank -- exactly as on
        // the console.  The scene sends each subId once, and this one lands on
        // an object that has already been claimed.
        so.fireStageObject("s680", 814, sub);
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => requestAnimationFrame(r));
        so.fireStageObject("s680", 814, sub);
        const first = fx.pointSpriteProbe("s680")[ix];
        const samples = [];
        for (let i = 0; i < 200; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            const row = fx.pointSpriteProbe("s680")[ix];
            samples.push({ sprite: row.sprite, y: row.y, active: row.active });
        }
        return { before: first, samples };
    }, { ix: lane.index, sub: 829 });
    const yEnd = run680.samples[run680.samples.length - 1].y;
    const rise = lanes.scripts[lane.script].at(-1)[2] & 0xff;
    check("s680 814 lights the tag-1 lane and walks its row down the screen",
        yEnd === before680.y + rise,
        `y ${before680.y} -> ${yEnd}, the end entry's third byte is ${rise}`);
    check("s680 814's lane shows its own script's clips",
        new Set(run680.samples.map((r) => r.sprite)).size > 1,
        `sprites ${[...new Set(run680.samples.map((r) => r.sprite))].join(",")}`);
    // The honest question is not "does the row still hold the ROM sprite" -- the
    // ambient renderer owns some of these -- but "did this subId move a lane it
    // did not name".  So the comparison is against the state just before the
    // fire, taken on the same page.
    const rest680 = lanes.lanes.lanes.filter((l) => l.tag !== 1).map((l) => l.index);
    const still680 = await page.evaluate(async (idxs) => {
        const fx = await import("/effects.js");
        const rows = fx.pointSpriteProbe("s680");
        return idxs.map((i) => rows[i].sprite);
    }, rest680);
    check("s680 814 leaves the lanes it did not light alone",
        still680.every((v, k) => v === beforeLanes680[k]),
        `${still680.join(",")} against the pre-fire ${beforeLanes680.join(",")}`);
    await page.screenshot({ path: `${OUT}/s680-32e-after.png` });

    const cue680 = await packedCount(0xec000001);
    check("s680 814 plays its one light cue 0xec000001", cue680 >= 1, `heard ${cue680}`);
    check("s680 is not running the original overlay machine code",
        !(await read("s680")).native);

    // ── arm 10: the crevice ride's own actor (s415 0x32b) ───────────────
    // One claimed row, five phases and a fall onto the rail.  The stage's own
    // event script fires SETANIM 816 (prewarm), then 817 (the fall), 818, 819
    // and 820 (the three roll-in sequences) -- web/assets/events/
    // wstag_events.json s415 event 150, in its own order.  This drives the
    // same operands through the game's own SETANIM route and reads the row
    // the actor writes back every blank.
    const ride = MEMBERS.stages.s415["811"];
    const rideIdx = ride.tags["1"].index;
    await enter("s415", [150, 330]);
    await hookPacked();
    await page.screenshot({ path: `${OUT}/s415-32b-before.png` });
    const rideRun = await page.evaluate(async ({ idx }) => {
        const fx = await import("/effects.js");
        const so = await import("/stage-objects.js");
        const actors = () => window.__pointRecordActors.state("s415");
        const read = () => {
            const r = fx.pointSpriteProbe("s415")[idx];
            return { sprite: r.sprite, active: r.active, x: r.x, y: r.y };
        };
        const builtBefore = actors().some((a) => a.id === 811);
        const seq = [];
        let prev = null;
        let first = false;
        const runFrames = async (fire, frames) => {
            if (fire !== null) so.fireStageObject("s415", 811, fire);
            first = true;
            for (let i = 0; i < frames; i++) {
                await new Promise((r) => requestAnimationFrame(r));
                const s = read();
                if (s.sprite !== prev || first) {
                    prev = s.sprite;
                    first = false;
                    seq.push(s.sprite);
                }
            }
        };
        await runFrames(816, 6);   // the prewarm: construct only
        const builtAfter = actors().some((a) => a.id === 811);
        const still = read();
        await runFrames(817, 140); // the fall onto the rail
        const landed = read();
        seq.length = 0;
        prev = read().sprite;
        await runFrames(818, 380); // seq1: 50,52..59
        const seq1 = [...seq];
        seq.length = 0;
        prev = read().sprite;
        await runFrames(819, 60);  // seq2: 60..62
        const seq2 = [...seq];
        seq.length = 0;
        prev = read().sprite;
        await runFrames(820, 260); // seq3: 1..47
        const seq3 = [...seq];
        return { builtBefore, builtAfter, still, landed, seq1, seq2, seq3 };
    }, { idx: rideIdx });
    check("s415 811 exists once its stage script's SETANIM 816 has fired",
        rideRun.builtAfter,
        rideRun.builtBefore
            ? "already built before the fire (the stage's own entry ran first)"
            : "built by the fire, as the stage's own script does");
    check("s415 811 shows its still frame on the claimed row",
        rideRun.still.sprite === ride.tags["1"].romSprite && rideRun.still.active === 1,
        `sprite ${rideRun.still.sprite} (rom ${ride.tags["1"].romSprite}), active ${rideRun.still.active}`);
    check("s415 811 falls onto the rail at x 150 / y 430",
        rideRun.landed.x === 150 && rideRun.landed.y === 430,
        `x ${rideRun.landed.x}, y ${rideRun.landed.y}`);
    check("s415 811 runs seq1's own frames in order",
        rideRun.seq1.join(",") === "50,52,53,54,55,56,57,58,59",
        `seq1 ${rideRun.seq1.join(",")}`);
    check("s415 811 runs seq2's own frames in order",
        rideRun.seq2.join(",") === "60,61,62", `seq2 ${rideRun.seq2.join(",")}`);
    check("s415 811 runs seq3's own 47 frames in order",
        rideRun.seq3.join(",") === Array.from({ length: 47 }, (_, i) => i + 1).join(","),
        `seq3 saw ${rideRun.seq3.length} of 47: ${rideRun.seq3.join(",")}`);
    const rideCues = await page.evaluate(() => window.__packed ?? []);
    check("s415 811 plays its impact cue and its script cues",
        rideCues.includes(0x8004474a) && rideCues.includes(0x800442c1)
        && rideCues.includes(0x80044648) && rideCues.includes(0x00340001),
        `heard ${rideCues.map((w) => "0x" + w.toString(16)).join(",")}`);
    await page.screenshot({ path: `${OUT}/s415-32b-after.png` });
    check("s415 is not running the original overlay machine code",
        !(await read("s415")).native);
} finally {
    console.log("VERDICT", fails.length === 0 ? "OK" : `FAIL ${fails.join("; ")}`);
    console.log("--- console log ---");
    for (const l of logs.slice(-40)) console.log(l);
    await browser.close();
    if (fails.length) process.exitCode = 1;
}
