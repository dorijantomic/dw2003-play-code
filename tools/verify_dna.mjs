// The DNA fusion, end to end, in the battle lab: two of the disc's own pairs walked
// with real key presses from the command menu through the pane into the cut-in,
// with the fused Digimon's own mesh loaded and on screen.
//
// Why this check exists: it used to open web/battle-test.html?screen=dna, hand the
// page five setTimeout presses of its own and wait for state 16 (ST.DNA_PRESENT),
// which the lab's own press train could never reach: the command list takes each key
// as a queued edge, so the lab's presses landed later than its 120ms step assumed,
// they landed on top of this check's keys (the walk ended on Run and fled), and the
// lab's eight stops one press short of the confirm. The lab then sat in state 15
// with the pane up and nothing left to press (prior/jogress-report.md §6,
// prior/dnaseed-report.md §4). tools/verify_dna_realplay.mjs already proved the pane
// works in an ordinary fight; this one covers what that check cannot see, the beat
// AFTER the pane answers: the "DNA Digivolve!" line, the fused result the Jogress
// director script names, and the mesh that result stands in as.
//
// Runtime is about seven minutes: two whole battles, each with a thirty-second
// cut-in, all of it real frames on a real canvas.
//
// Everything expected of the game is read out of the disc data, not typed:
//   * the DNA action for the pair — the acting member's own profile record's
//     +0x2A halfword at 0x8003EF5C + 0x58*row, with the pairing itself the
//     record's +0x3D (the 1-based row its partner sits in) against the partner's
//     +0x55;
//   * the price on the DNA DV row — the pane's own technique table at
//     0x80042BDC + 0x12*(id-1);
//   * the fused Digimon — jogress_scripts.json's fusedPack.folder for that action,
//     named back through model_map.json, and the geometry of the committed
//     assets/battle/models/<folder>/anim.json the renderer must end up wearing.
//
// Server: python3 -m http.server 8861 --directory web
// Run:    VERIFY_PORT=8861 tools/run-playwright.sh tools/verify_dna.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.DNACUT_ROOT || `${baseUrl(8861)}/`;
const OUT = process.env.DNACUT_SHOT || ".bunny-scratch/dnacut";
mkdirSync(OUT, { recursive: true });
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(REPO, p), "utf8");

// ── The disc's own pairing table, read from the committed resident image ───────
// The species getter F0x800134E8 scans the 55 profile records at 0x8003EF5C for
// the row whose first halfword is the form id, and a record's +0x3D is the
// 1-based row of its DNA partner while +0x2A is the DNA action the two share
// (the pane's own rule, engine/dw3/ui/native/battle-dna-menu.ts). A record's
// +0x55 is its own 1-based row, which is also the walker's own Digimon id — the
// two id spaces line up over all 55 rows (dnaseed-report.md §2b).
const PROFILE_AT = 0x8003ef5c - 0x80010000, STRIDE = 0x58, ROWS = 0x37;
const IMAGE = readFileSync(resolve(REPO, "web/assets/native/screens/resident.bin"));
const u16 = (at) => IMAGE[at] | (IMAGE[at + 1] << 8);
const PROFILES = Array.from({ length: ROWS }, (_, row) => ({
  row,
  form: u16(PROFILE_AT + row * STRIDE),
  nameIndex: IMAGE[PROFILE_AT + row * STRIDE + 0x55],
  partnerRow: IMAGE[PROFILE_AT + row * STRIDE + 0x3d],
  action: u16(PROFILE_AT + row * STRIDE + 0x2a),
}));
const DIGIMON = new Map(JSON.parse(read("web/assets/data/digimon.json"))
  .digimon.map((d) => [d.name, d.id]));
/** The disc's answer for a named pair: both rows, the action they share. */
function pairingFor(leadName, partnerName) {
  const leadId = DIGIMON.get(leadName), partnerId = DIGIMON.get(partnerName);
  if (!leadId || !partnerId) throw new Error(`digimon.json has no ${leadName}/${partnerName}`);
  const a = leadId - 1, b = partnerId - 1;
  const la = PROFILES[a], lb = PROFILES[b];
  return {
    lead: leadName, partner: partnerName, leadId, partnerId,
    rows: [a, b],
    forms: [la.form, lb.form],
    reciprocal: la.partnerRow === lb.nameIndex && lb.partnerRow === la.nameIndex,
    action: la.action,
    actionAgrees: la.action === lb.action,
  };
}
// The fused result each action produces, named from the extracted director
// scripts: the action's own fusedPack folder, named back through model_map.json.
const JOGRESS = JSON.parse(read("web/assets/data/jogress_scripts.json")).actions;
const MODEL_FOR_NAME = JSON.parse(read("web/assets/battle/model_map.json"));
const NAME_FOR_FOLDER = new Map(Object.entries(MODEL_FOR_NAME).map(([name, folder]) => [folder, name]));
const fusedFor = (action) => {
  const folder = JOGRESS[String(action)]?.fusedPack?.folder;
  if (!folder) throw new Error(`no fused pack for DNA action ${action}`);
  const anim = JSON.parse(read(`web/assets/battle/models/${folder}/anim.json`));
  return {
    folder,
    name: NAME_FOR_FOLDER.get(folder) ?? folder,
    geometry: `${anim.bones.length}b/${anim.bones.reduce((a, x) => a + (x.faces?.length ?? 0), 0)}f`,
  };
};
// Two pairs: one that fuses into a Jogress-only Digimon with no walker's own
// roster entry beyond the disc's, and the one beside it in the same table. Both
// are read the same way, so a second pair costs only this line.
const PAIRS = [pairingFor("Grizzmon", "Growlmon"), pairingFor("Dinohumon", "Kyubimon")];

const browser = await chromium.launch({ headless: true });
let failed = null;
const problems = [];
const expect = (ok, msg) => {
  console.log(ok ? "ok  " : "FAIL", msg);
  if (!ok) { problems.push(msg); failed = msg; }
};

/** One real key press: held across frames, released, so the screen sees an edge. */
const tap = async (page, key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(220);
};
const shot = async (page, name) => writeFileSync(`${OUT}/${name}.png`,
  Buffer.from((await page.locator("canvas#c").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));

try {
  for (const pair of PAIRS) {
    const tag = `${pair.lead}-${pair.partner}`;
    const fused = fusedFor(pair.action);
    console.log(`\n== ${pair.lead} + ${pair.partner} → action ${pair.action}, ${fused.name} ==`);
    expect(pair.reciprocal,
      `the disc's two records name each other (+0x3D against +0x55): ${JSON.stringify(pair.rows.map((r) => PROFILES[r].partnerRow))}`);
    expect(pair.actionAgrees,
      `both records carry the same DNA action in +0x2A (${pair.action})`);

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const packs = new Set();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (res) => {
      // The model loader asks for slot_map.json as an OPTIONAL refinement and
      // reads a non-ok answer as "this pack has no slot map" (web/battle3d.js
      // loadSkeletalModel), so that 404 is the loader working, not a fault.
      if (res.status() >= 400 && !/favicon/i.test(res.url()) && !/slot_map\.json/.test(res.url())) {
        errors.push(`HTTP ${res.status()} ${res.url()}`);
      }
    });
    page.on("request", (req) => {
      const m = /assets\/battle\/models\/([^/"]+)\/anim\.json/.exec(req.url());
      if (m) packs.add(m[1]);
    });

    // The lab builds this pair from `?dna=` alone: the same two fields a real save
    // carries (partnerStats.digimonId, partyStats[1].digimonId).
    await page.goto(`${ROOT}battle-test.html?autostart=1&screen=dna&dna=${pair.lead},${pair.partner}`,
      { waitUntil: "load" });

    const state = () => page.evaluate(() => window.__battleB?.()?.state);
    const dna = () => page.evaluate(() => window.__battleDnaNative?.diagnostics?.() ?? null);
    const cmdRow = () => page.evaluate(() =>
      window.__battleCmdNative?.diagnostics?.()?.selection ?? null);

    // The lab's autostart stops on the command menu now; nothing else presses.
    // The opening line has to be read before the menu is armed (verify-battle-wait.mjs).
    await waitForCommandMenu(page, { timeout: 40_000 });
    await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
      null, { timeout: 40_000 });
    const party = await page.evaluate(() => {
      const b = window.__battleB();
      return {
        state: b.state,
        lead: `${b.player.profile.id} ${b.player.profile.name}`,
        roster: b.playerRecords.map((r) => `${r.rosterIndex}:${r.profile.name}(${r.profile.id})`),
        names: b.playerRoster.map((m) => m.name),
      };
    });
    expect(party.state === 2 && party.lead === `${pair.leadId} ${pair.lead}`,
      `?dna= put ${pair.lead} in the lead and the lab stopped on the command menu (${JSON.stringify(party)})`);
    expect(party.roster[1] === `1:${pair.partner}(${pair.partnerId})`,
      `?dna= put ${pair.partner} in the first reserve (${JSON.stringify(party.roster)})`);
    expect(party.names[0] === pair.lead && party.names[1] === pair.partner,
      `the party is named after its own Digimon (${JSON.stringify(party.names)})`);
    await shot(page, `${tag}-1-command-menu`);

    // The command list, walked by reading its own row rather than by counting
    // presses. One press is one row (measured: a 40ms, 70ms and 200ms hold each
    // move exactly one), but the lab used to press its own keys at the same time,
    // and two hands on one list walk it off the row the check meant: with the old
    // press train still running, this walk ended on Run and fled the fight.
    for (let i = 0; i < 8 && (await cmdRow()) !== 3; i++) await tap(page, "ArrowDown");
    expect(await cmdRow() === 3, `the command list is on its Tag row (${await cmdRow()})`);
    await tap(page, "Enter");

    // The partner list. Its first row is the first reserve, which is the pair's
    // other half; ask the battle which live form that row is rather than trusting it.
    await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready === true,
      null, { timeout: 20_000 });
    const chosen = await page.evaluate(() => {
      const t = window.__battleTagNative.diagnostics();
      const b = window.__battleB();
      const slot = t.candidates[t.selection];
      return { slot, form: b.playerRecords[slot]?.profile?.name ?? null };
    });
    expect(chosen.form === pair.partner,
      `the highlighted partner is ${pair.partner} (${JSON.stringify(chosen)})`);
    await tap(page, "Enter");

    // No form screen between the partner list and the pane (playtest bug 12b): the
    // confirm opens the pane directly. The pane. The strip starts on the partner's
    // STARTER species and lists its equipped forms; the pairing itself is settled
    // when the Switch / DNA DV rows are built, so it is read after the Circle
    // below, not here.
    await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.()?.pane?.ready === true,
      null, { timeout: 20_000 });
    let d = await dna();
    // The strip leads with the partner's STARTER (its roster slot's profile row,
    // F0x80016D94) and lists the equipped forms after it, so the partner's live
    // form is one of the later rows. Down walks the species cursor onto it.
    const row = d?.pane?.species?.indexOf(pair.forms[1]) ?? -1;
    expect(row > 0,
      `the strip lists ${pair.partner}'s form ${pair.forms[1]} after its starter (${JSON.stringify(d?.pane?.species)})`);
    for (let i = 0; i < row; i++) await tap(page, "ArrowDown");
    d = await dna();
    expect(d?.pane?.stripCursor === row,
      `Down moved the species cursor onto ${pair.partner} (${d?.pane?.stripCursor})`);
    await shot(page, `${tag}-2-dna-pane`);

    // Circle on the names opens the Switch / DNA DV rows; Down walks the shared
    // list model's cursor onto DNA DV; Circle answers on it.
    await tap(page, "Enter");
    await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.()?.pane?.subState === 1,
      null, { timeout: 10_000 });
    d = await dna();
    expect(d?.pane?.subState === 1, `the Switch / DNA DV rows are up (${d?.pane?.subState})`);
    const price = await page.evaluate((id) => {
      const bytes = window.__battleDnaNative?._data?.techniques;
      if (!bytes) return null;
      const at = 0x12 * (id - 1);
      return bytes[at] | (bytes[at + 1] << 8);
    }, pair.action);
    expect(d?.pane?.dnaId === pair.action,
      `the pane found the DNA action the disc gives this pair, ${pair.action} (${d?.pane?.dnaId})`);
    expect(price !== null && d?.pane?.price === price,
      `the DNA DV row shows the game's own price ${price} (${d?.pane?.price})`);
    await shot(page, `${tag}-3-dna-rows`);

    await tap(page, "ArrowDown");
    d = await dna();
    expect(d?.pane?.optionRow === 1, `DNA DV is the selected row (${d?.pane?.optionRow})`);
    await tap(page, "Enter");
    d = await dna();
    expect(d?.answer !== null && (d.answer & 0xf) === 1,
      `Circle on DNA DV answered on the DNA row (${d?.answer})`);
    expect(d?.speciesOut === pair.action,
      `the result went out through self+0x80 as action ${pair.action} (${d?.speciesOut})`);
    expect(await state() === 5 && (await page.evaluate(() => window.__battleB?.()?.message)) === "DNA DV!",
      'the line says "DNA DV!" and holds the turn');

    // Circle that line away; the committed action then opens the cut-in.
    await tap(page, "Enter");
    await page.waitForFunction(() => window.__battleB?.()?.state === 16, null, { timeout: 20_000 });
    const line = await page.evaluate(() => window.__battleB?.()?.message);
    expect(typeof line === "string" && line.includes(pair.lead) && line.includes(pair.partner)
      && line.includes("DNA Digivolve!"),
      `the cut-in announced the fusion (${JSON.stringify(line)})`);

    // The camera on every frame of the cut-in. The original's camera object holds ONE live
    // record (class 0x12, FIGHTSTG_F0x80092618, +0x54) and nothing clears it: the op5 cut/move,
    // the canned-shot loader, the arena shot and the camera director's own per-frame re-cut all
    // REPLACE it (fightstg.s:9414-9511, :15952-15961, :5096-5105). The cut-in is six scripts
    // split at segment boundaries, so on each boundary frame the record must still be the previous
    // segment's. The walker's own over-the-shoulder fallback — which is not a record at all —
    // reads H = 120/tan(22.5°) = 289.6, while every op5 in this clip states H 280 (staging and
    // reveal) or H 226 (the result attack), so a frame showing the fallback is unambiguous.
    const H_FALLBACK = 120 / Math.tan(Math.PI / 8);
    await page.evaluate(() => {
      window.__camTrace = [];
      const step = () => {
        const b = window.__battleB?.();
        const p = b?.state === 16 ? b._dnaPresentation : null;
        const cam = window.__battle3d?.getCameraInfo?.();
        if (p && cam) {
          window.__camTrace.push({
            chunk: p.chunk, H: Math.round(cam.H * 10) / 10,
            eye: cam.eye.map(Math.round), look: cam.look.map(Math.round),
          });
        }
        if (window.__camTrace.length < 6000) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });

    // The fused result occupies TWO of the cut-in's six chunks and the first of them
    // is the white fusion flash, so the walk waits (in the page, at frame rate) for
    // the chunk that puts the fused model on stage, checks the actor is wearing
    // that pack's own mesh, and then keeps a frame of every 500ms for as long as
    // the script holds the fused model there — which reaches the beat where the
    // Digimon itself is standing in the arena.
    const onFusedChunk = (name) => {
      const b = window.__battleB?.();
      const p = b?.state === 16 ? b._dnaPresentation : null;
      return p?.chunks?.[p.chunk]?.model === name;
    };
    await page.waitForFunction(onFusedChunk, fused.name, { timeout: 90_000 }).catch(() => {});
    const beatNow = () => page.evaluate(() => {
      const b = window.__battleB?.();
      const p = b?.state === 16 ? b._dnaPresentation : null;
      const model = window.__battle3d?.playerAnimator?.model;
      return {
        state: b?.state, chunk: p?.chunk ?? null, model: p?.chunks?.[p.chunk]?.model ?? null,
        geometry: model ? `${model.bones.length}b/${model.bones.reduce((a, x) => a + (x.faces?.length ?? 0), 0)}f` : null,
      };
    });
    const seen = await beatNow();
    expect(seen.model === fused.name,
      `the cut-in put ${fused.name} on stage, on its chunk ${seen.chunk} (${fused.name} is the action ${pair.action}'s own fused result)`);
    expect(seen.geometry === fused.geometry,
      `the player actor is wearing ${fused.folder}'s own mesh, ${fused.geometry} (${JSON.stringify(seen)})`);
    let frames = 0;
    for (let i = 0; i < 24 && frames < 12; i++) {
      await page.waitForTimeout(500);
      const beat = await beatNow();
      if (beat.model !== fused.name) break;
      frames++;
      await shot(page, `${tag}-4-fused-${fused.name}-${frames}`);
    }
    expect(frames > 0, `${frames} frame(s) of ${fused.name} captured in ${OUT}`);
    expect(packs.has(fused.folder),
      `the page fetched assets/battle/models/${fused.folder}/anim.json (${[...packs].join(", ")})`);

    // The cut-in runs out and the fight carries on.
    await page.waitForFunction(() => window.__battleB?.()?.state !== 16, null, { timeout: 60_000 })
      .catch(() => {});
    expect(await state() !== 16, "the cut-in ended and the fight carried on");

    // …and the camera never fell out of its record at a segment boundary.
    const trace = await page.evaluate(() => window.__camTrace ?? []);
    expect(trace.length > 60, `the cut-in was sampled every frame (${trace.length} frames)`);
    const fallbacks = trace.filter((f) => Math.abs(f.H - H_FALLBACK) < 2);
    expect(fallbacks.length === 0,
      `no frame of the cut-in fell back to the walker's own camera (${fallbacks.length} of `
      + `${trace.length}, first at chunk ${fallbacks[0]?.chunk} H ${fallbacks[0]?.H})`);
    const jumps = [];
    for (let i = 1; i < trace.length; i++) {
      if (trace[i].chunk === trace[i - 1].chunk) continue;
      const a = trace[i - 1].eye, b = trace[i].eye;
      const moved = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
      jumps.push({ from: trace[i - 1].chunk, to: trace[i].chunk, moved,
                   fromH: trace[i - 1].H, toH: trace[i].H });
    }
    expect(jumps.length >= 3, `the segment boundaries were sampled (${JSON.stringify(jumps)})`);
    console.log("BOUNDARY", JSON.stringify(jumps));

    await shot(page, `${tag}-5-after`);

    expect(errors.length === 0, `no page error (${errors.join(" ;; ")})`);
    await page.close();
  }
} catch (e) {
  failed = e?.stack ?? e?.message ?? String(e);
  console.error("FAIL", failed);
} finally {
  await browser.close();
}
console.log("RESULT", JSON.stringify({ ok: !failed, failures: problems.length }));
process.exit(failed ? 1 : 0);
