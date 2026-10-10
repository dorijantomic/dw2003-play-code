import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

// One SPU voice per note-on: a bit-31-clear id is a SEQ phrase (mpcommon/1.seq +
// 2.seq) and the original plays it note by note -- F0x8003581c asks F0x80034b9c
// once per note event (fns.s:41033) with that note's own tone priority. So the
// note counts below are read from the table build_sfx.py generates from the
// disc's scores, not typed in: a cue of N notes takes N voices, and a note-off
// frees its slot at once (F0x8003670c / F0x8003674c) without stopping the audio,
// which is why the stop log alone cannot measure how many voices are held.
const PHRASES = JSON.parse(readFileSync("web/sfx-voice/phrases.json", "utf8")).phrases;
const notesOf = (name) => (PHRASES[name]?.notes.length ?? 1);

// Live-browser proof that the walker's packed-sound arbitration matches the
// resident driver, through the REAL web/audio.js in the REAL game page.
//
// Start the repository's server first:
//   python3 -m http.server 8742 --directory web
// Then:
//   tools/run-playwright.sh tools/verify_sfx_arbitration.mjs
//
// It instruments AudioBufferSourceNode.start/stop, fires real cues by their
// real names, and reports which voices were keyed off. The old per-archive
// ("category") model and the decoded per-slot model disagree on every case
// below, so the numbers alone separate them.
//
// TWO rules are checked, and both come out of the exe's sound library:
//
//   1. Which voice an already-keyed-off sound cuts. F0x8003340c keys off every
//      hardware voice OWNED BY THAT (bank | slot<<8) and nothing else
//      (F0x800375ec, exe fns.s:42838-42882), and the positional path
//      F0x8003432c keys nothing off at all.
//   2. Which voice a NEW sound takes. That is the voice allocator F0x80034b9c
//      (exe fns.s:40073-40231), which both paths call: 24 voices (the size the
//      sound init asks for, fns.s:35460-35461), a free one first, else the
//      lowest priority at or below the request with the least audio left and
//      then the oldest, else the sound is DROPPED.
//
// Measurement notes, both learned the hard way:
//   - The samples are fetched and decoded on first play, so a case that fires a
//     cue for the first time measures the fetch, not the rule. Every cue is
//     played once and dropped before anything is counted.
//   - The page is a running game on a field map: it makes its own sounds
//     (footsteps, ambience, stage-entry cues) at the same time as the probe.
//     Those are silenced by wrapping the player's own entry points and letting
//     through ONLY the cues a case names, so every counted voice belongs to
//     the case that counted it.
const url = process.env.SFX_TEST_URL
  || `${baseUrl(8742)}/index.html?skipTitle=1&map=s200`;
const browser = await chromium.launch({ headless: true });

// 25 real common-bank cues with distinct (archive, row, slot) and bit 30 clear,
// so nothing in this set can be explained by the per-slot self-cut or by the
// exclusive-track register. Filled from web/assets/sfx/manifest.json.
const CUES = [
  "dig_demo", "dig_move", "fukidash", "item_get", "player00",
  "player01", "player11", "savedemo", "sub_demo", "switch02",
  "switch03", "system00", "system01", "system02", "system03",
  "system04", "system05", "system06", "system07", "system10",
  "teleport", "digiment", "jingle01", "jingle02", "jingle03",
];

try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGE", e));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__sfx, { timeout: 30_000 });

  // Instrument the real Web Audio nodes, and gate the player's entry points so
  // only the cues under test reach the sound layer.
  await page.evaluate(() => {
    window.__voiceLog = [];
    const P = AudioBufferSourceNode.prototype;
    const start0 = P.start, stop0 = P.stop;
    let n = 0;
    P.start = function (...a) { this.__id = ++n; window.__voiceLog.push({ ev: "start", id: this.__id }); return start0.apply(this, a); };
    P.stop = function (...a) { window.__voiceLog.push({ ev: "stop", id: this.__id ?? null }); return stop0.apply(this, a); };
    // The page's AudioContext starts suspended without a gesture.
    window.__sfx.unlock();

    // null = pass everything through (the game running normally); a Set = only
    // the named cues get through.
    window.__probe = null;
    const sfx = window.__sfx;
    const gate = (name, original) => {
      sfx[name] = (...args) => {
        const key = name === "playPacked" || name === "playBank"
          ? (name === "playBank" ? `${args[0]}:${args[1]}` : args[0])
          : args[0];
        const probe = window.__probe;
        if (probe && !probe.has(String(key)) && !probe.has(String(args[0]))) return;
        return original.apply(sfx, args);
      };
    };
    for (const name of ["play", "playArea", "playBattle", "playSustained", "playPacked", "playBank", "playEffectLoop"]) {
      gate(name, sfx[name]);
    }
  });
  // Let the manifest fetch settle and the context resume.
  await page.waitForTimeout(400);

  // Every sample used below is fetched and decoded once, then dropped, so no
  // case below measures a network fetch. Each cue is played until its voice
  // actually starts, because the decode is what is being waited for.
  const warm = (names) => page.evaluate(async (list) => {
    const countStarts = () => window.__voiceLog.filter((e) => e.ev === "start").length;
    for (const n of list) {
      const before = countStarts();
      window.__sfx.play(n);
      for (let i = 0; i < 150 && countStarts() === before; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    window.__sfx.stopAll();
    await new Promise((r) => setTimeout(r, 100));
  }, names);

  await warm(CUES);
  await page.waitForTimeout(300);

  const run = async (label, names, script) => {
    const r = await page.evaluate(async ([list, src]) => {
      // Each case starts from silence: a voice left registered by the previous
      // case would legitimately be keyed off by this one and confuse the count.
      window.__sfx.stopAll();
      await new Promise((r) => setTimeout(r, 50));
      window.__probe = new Set(list);
      window.__voiceLog.length = 0;
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      // A case's script may return what it measured (the pool's high-water mark
      // below); the voice log is always returned alongside it.
      const result = await new AsyncFunction("sfx", "wait", src)(window.__sfx, (ms) => new Promise((r) => setTimeout(r, ms)));
      await new Promise((r) => setTimeout(r, 250));
      window.__probe = null;
      return { result, log: window.__voiceLog.slice() };
    }, [names, script]);
    const starts = r.log.filter((e) => e.ev === "start");
    const stops = r.log.filter((e) => e.ev === "stop");
    return { label, starts: starts.length, stops: stops.length, log: r.log, result: r.result };
  };

  const cases = [];

  // 1. Three DIFFERENT common-bank cues. Same archive (bits 18-24 == 1),
  //    different slots. Old model: each cuts the previous -> 2 stops.
  //    Decoded model: separate slots are never keyed off -> 0 stops.
  cases.push(await run("three different cues, one archive",
    ["system03", "system04", "system06"],
    `sfx.play("system03"); await wait(60); sfx.play("system04"); await wait(60); sfx.play("system06");`));

  // 2. The SAME 2D cue twice, with a second cue sounding throughout. F0x8003340c
  //    -> F0x800375ec(bank|slot<<8) keys off that very (bank, slot) and nothing
  //    else, and in the one-voice-per-note model that is every note of the first
  //    run -- so the stop count is the cue's own note count, and the other cue
  //    must not be in it.
  cases.push(await run("same 2D cue twice", ["system03", "system04"],
    `sfx.play("system04"); await wait(40); sfx.play("system03"); await wait(60); sfx.play("system03");`));

  // 3. The same POSITIONAL cue twice (bit 31 set -> F0x8003432c allocates a
  //    fresh voice and keys nothing off): zero stops. This is the walk
  //    footstep, which the original refires every 8 frames.
  cases.push(await run("same positional cue twice", ["player00"],
    `sfx.play("player00"); await wait(60); sfx.play("player00");`));

  // 4. The voice pool. The allocator F0x80034b9c hands out 24 voices and no
  //    more. These 25 cues are not 25 sounds: thirteen of them are SEQ phrases
  //    and ask the pool for 263 voices between them, which the browser used to
  //    stack without limit. What the pool guarantees now is that it never holds
  //    more than 24 -- and that a voice it cannot take is DROPPED, so fewer of
  //    those 263 notes start than there are notes. The held count is read from
  //    the pool itself, because a note-off frees a slot without a stop, so the
  //    stop log would overcount by every releasing note.
  const askFor = CUES.reduce((n, c) => n + notesOf(c), 0);
  const many = await run("25 cues, one 24-voice pool", CUES, `
    for (const n of ${JSON.stringify(CUES)}) sfx.play(n);
    let held = 0;
    for (let i = 0; i < 80; i++) { await wait(25); held = Math.max(held, sfx.debugVoices()); }
    return held;
  `);
  many.held = Number(many.result) || 0;
  cases.push(many);

  const out = cases.map((c) => `${c.label.padEnd(34)} starts=${c.starts} stops=${c.stops}`
    + (c.held !== undefined ? ` pool_held_max=${c.held}` : "")).join("\n");
  console.log(out);

  const fail = [];
  const [diff, same2d, samePos] = cases;
  const pool = many;
  if (diff.starts !== 3 || diff.stops !== 0)
    fail.push(`different cues sharing an archive must not cut each other (got ${diff.starts}/${diff.stops}, want 3/0)`);
  // The second SYSTEM03 keys off its own first run -- every note of it -- and
  // leaves SYSTEM04 alone. Its own count comes from the disc's score.
  const own = notesOf("system03");
  if (same2d.stops !== own)
    fail.push(`a 2D cue must key off only its own previous notes (got ${same2d.stops} stops, want ${own} -- SYSTEM03's own note count, and SYSTEM04's voice untouched)`);
  if (samePos.starts !== 2 || samePos.stops !== 0)
    fail.push(`a positional cue must key nothing off (got ${samePos.starts}/${samePos.stops}, want 2/0)`);
  if (pool.held > 24)
    fail.push(`the pool must never hold more than 24 voices (held ${pool.held})`);
  if (pool.starts >= askFor)
    fail.push(`the ${askFor} note voices these cues ask for cannot all start: `
      + `${pool.starts} did, so a refusal dropped none (got ${pool.starts}, want < ${askFor})`);

  writeFileSync("/tmp/sfx_arbitration_report.txt",
    out + "\n" + (fail.length ? "FAIL\n" + fail.join("\n") : "OK") + "\n");

  if (fail.length) { console.error("FAIL:\n" + fail.join("\n")); process.exitCode = 1; }
  else console.log("OK — live arbitration matches the decoded driver.");
} finally {
  await browser.close();
}
