// tools/play_cardduel_walker.mjs — PLAY the walker's duel closed-loop, to a
// winner, and log one beat per state change in the same shape the disc driver
// logs (tools/windows-rig/play-cardduel.lua).
//
// Why this exists: tools/compare_cardduel_to_disc.mjs walks a FIXED list of
// thirteen beats and stops. It can never show that the duel diverges after
// beat thirteen, which is most of the duel. This one is driven by the walker's
// own state, exactly as the disc driver is driven by the duel object's, so the
// two logs are comparable beat for beat instead of screen for screen.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/cardduel-walker-full";
const MAX = Number(process.argv[3] ?? 4000);   // decisions, not frames
const SHOTS = 300;
mkdirSync(out, { recursive: true });

const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errs = [];
p.on("pageerror", (e) => { errs.push(e.message); console.log("PAGEERROR:", e.message); });
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("cardduel"); w.__labDuel.open(null, "Opponent", null, 13);
});
await p.waitForTimeout(1200);

const state = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  const u = d.duel;
  return {
    open: d.openingScreen(),
    phase: d.phaseKey(),
    stage: d.play?.stage ?? null,
    ask: d.play?.ask ?? null,
    frozen: d.play?.frozen ? 1 : 0,
    cur: d.play?.cursor ?? null,
    scur: d.summonCursor?.() ?? null,
    smine: d.summonIsMine?.() ? 1 : 0,
    busy: d.boardBusyDebug ? d.boardBusyDebug() : null,
    picker: d.picker ? 1 : 0,
    epicker: d.effectPicker ? 1 : 0,
    setEnd: d.setEndState()?.step ?? null,
    coin: d.coin ? 1 : 0,
    hand: u?.player.hand.length ?? null,
    field: u?.player.field.length ?? null,
    ps: u?.player.score ?? null,
    os: u?.opponent.score ?? null,
    over: d.isOpen() ? 0 : 1,
  };
});
const key = (s) => [s.open, s.phase, s.stage, s.ask, s.frozen, s.scur, s.smine, s.picker, s.epicker,
                    s.setEnd, s.coin, s.ps, s.os, s.over].join("|");

// The duel refuses input while the board is animating -- boardBusy() ORs into
// the same gate the original uses. A driver that presses on a busy frame has
// its press silently dropped, which looks exactly like a screen that will not
// move. So wait for the board to go quiet first, as a player watching the
// animation would, and say so when it never does.
let neverIdle = 0;
async function waitIdle(maxMs = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const busy = await p.evaluate(() => {
      const d = document.getElementById("game").contentWindow.__labDuel;
      const b = d.boardBusyDebug ? d.boardBusyDebug() : null;
      return b ? b.scheduled > 0 || b.busySprites.length > 0 : false;
    });
    if (!busy) return true;
    await p.waitForTimeout(60);
  }
  neverIdle += 1;
  return false;
}
const press = async (k, ms = 90) => {
  await waitIdle();
  await p.evaluate(() => document.getElementById("game").contentWindow.focus());
  await p.keyboard.press(k);
  await p.waitForTimeout(ms);
};
let shots = 0;
async function shot(name) {
  if (shots >= SHOTS) return "-";
  const url = await p.evaluate(() => {
    const w = document.getElementById("game").contentWindow;
    const c = w.document.createElement("canvas");
    c.width = 320; c.height = 240;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    w.__labDuel.draw(g, 320, 240);
    return c.toDataURL("image/png");
  });
  writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  shots += 1;
  return name;
}

// Which walker slots are playable — the walker's own verdict, the counterpart
// of the disc's duel+0x446 byte per hand slot.
// The Summon Phase and the Load/Compile phases ask DIFFERENT questions of a
// hand slot, so the driver must ask the matching one or it reads a whole hand
// as unusable and passes the phase.
const playable = () => p.evaluate(() => {
  const d = document.getElementById("game").contentWindow.__labDuel;
  const n = d.duel?.player.hand.length ?? 0;
  const summon = d.phaseKey() === "summon";
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push((summon ? d.summonableSlot(i) : d.playableSlot(i)) ? 1 : 0);
  }
  return out;
});

const lines = [
  "# walker duel PLAYED closed-loop, " + new Date().toISOString(),
  "# i open phase stage ask cur pick epick setEnd coin hand field ps os | usable | ACT",
];
let lastKey = "", stuck = 0, stuckKey = "", i = 0, ended = "";
for (; i < MAX; i++) {
  const s = await state();
  const k = key(s);
  let shotName = "-";
  if (k !== lastKey) {
    lastKey = k;
    shotName = await shot(`w${String(i).padStart(5, "0")}_${(s.open ?? s.phase ?? "x")}_${s.stage ?? "-"}_ps${s.ps}_os${s.os}`);
  }
  if (s.over) { ended = "duel closed (a winner)"; break; }

  if (k === stuckKey) stuck += 1; else { stuckKey = k; stuck = 0; }
  if (stuck > 60) { ended = `STUCK on ${k}`; break; }

  const u = await playable();
  const ustr = u.join("");
  let act;
  const first = u.indexOf(1);
  if (s.stage === "ask") {
    // Enter is CIRCLE (confirm). Answer 0 is "yes, open my hand"; the cursor
    // starts on 1 and UP/DOWN toggle it -- but only when the phase is not
    // frozen, which is the walker's way of saying nothing is playable.
    if (s.frozen) { act = "Enter(ask FROZEN - forced to pass)"; await press("Enter"); }
    else if (s.ask !== 0) { act = "Up(ask 1->0)"; await press("ArrowUp"); }
    else { act = "Enter(yes, open hand)"; await press("Enter"); }
  } else if (s.phase === "summon") {
    // The Summon Phase has its own cursor and its own button: square, which is
    // "v" in this key map -- Space is CIRCLE here, and circle ENDS the turn.
    // Pressing confirm here is what passes the phase without summoning.
    if (!s.smine) { act = "Enter(begin/not my turn)"; await press("Enter"); }
    else if (first < 0) { act = "Enter(end turn, nothing summonable)"; await press("Enter"); }
    else if (u[s.scur] === 1) { act = `v(summon ${s.scur})`; await press("v"); }
    else if (s.scur > first) { act = `Left(${s.scur}->${first})`; await press("ArrowLeft"); }
    else { act = `Right(${s.scur}->${first})`; await press("ArrowRight"); }
  } else if (s.stage === "pick") {
    if (first < 0) { act = "Enter(nothing playable)"; await press("Enter"); }
    else if (u[s.cur] === 1) { act = `Enter(play ${s.cur})`; await press("Enter"); }
    else if (s.cur > first) { act = `Left(${s.cur}->${first})`; await press("ArrowLeft"); }
    else { act = `Right(${s.cur}->${first})`; await press("ArrowRight"); }
  } else {
    act = "Enter"; await press("Enter");
  }
  lines.push(`i=${i} open=${s.open} ph=${s.phase} st=${s.stage} ask=${s.ask} fz=${s.frozen} cur=${s.cur} sc=${s.scur} sm=${s.smine} busy=${s.busy?JSON.stringify(s.busy):'-'} pick=${s.picker} ep=${s.epicker} se=${s.setEnd} coin=${s.coin} hand=${s.hand} fld=${s.field} ps=${s.ps} os=${s.os} | ${ustr} | ${act} | shot=${shotName}`);
}
lines.push(`# ${ended || "budget spent"} at decision ${i}, ${shots} shots, ${neverIdle} presses on a board that never went idle`);
if (errs.length) lines.push("# PAGE ERRORS: " + errs.slice(0, 5).join(" ;; "));
writeFileSync(`${out}/beats.txt`, lines.join("\n") + "\n");
console.log(lines.slice(-14).join("\n"));
await b.close();
