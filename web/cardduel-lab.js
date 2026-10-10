// web/cardduel-lab.js
//
// A complete card duel written from scratch for the UI lab. Every strip
// offset, clip id, palette cycle and animation constant is read out of the
// decoded layout (`assets/data/cardduel_ui.json`) and the decoded animation
// constants in engine/systems/card-animation.ts; the rules are the real ones
// (`tickDuel`, the program/summon turn machines, `resolveBattle`), driven here
// turn by turn so the player can act.
//
// Ground rule: no coordinate in this file is invented. Where the disc's own
// geometry is not in cardduel_ui.json it is cited to the measured constant in
// web/cardduel.js and named as such.

import { loadPack, drawClip, drawClipAtPaletteRow, packReady } from "./screenpack.js";
import { createSfxPlayer, createBgmPlayer, createExclusiveRegister } from "./audio.js";
import { drawText } from "./uifont.js";
import {
  createDuel, tickDuel, simpleAgent, phase, DUEL_PHASES,
  DUEL_BOARD, DEAL_START_X, DEAL_DURATION, DEAL_STAGGER, DEAL_FLIP_STAGGER,
  cardFanOut, indexEffects, recomputeTotals, applyDynamicStatMegas,
  handCardSelectable, canPlayProgram, canSummon,
  beginProgramTurns, programTurnSide, playProgramTurn, passProgramTurn,
  tickProgramTurns, pumpProgramTurns,
  beginSummonTurns, summonTurnSide, commitSummons, endSummonTurn, takeSummonTurn,
  awaitingCardChoice, duelChoice, resolveCardChoice,
  ENERGY_COLOURS,
} from "./vendor/engine.js";

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const soundRegister = createExclusiveRegister(); // D0x80055c34: one register, both players
const sfx = createSfxPlayer(soundRegister);
const bgm = createBgmPlayer(soundRegister);

const SOUND = { bgm: "cbtl00", summon: "card_000", land: "card_001", flip: "card_002",
  cursor: "system06", confirm: "system07", cancel: "system04", pass: "system03" };
const ENERGY_KEY = ["white", "blue", "green", "red", "black"];
// UI.strip_origin.alt_ntsc — the trash plate's own origin, no PAL term.
const ALT_ORIGIN = [[288, 143], [288, 80]];
const ALT_ICON_BASE = 49;
// The captures are PAL; the strips take the PAL origins (the game adds 0xC
// when the 50Hz flag is set). UI.strip_origin.pal.
const STRIP_ORIGIN = () => UI.strip_origin.pal;
const FLIP_FRAMES = 8;
// The disc's own message-box rows, measured 2026-08-24/2026-09-12 and carried
// in web/cardduel.js as PLAY_BOX / CONFIRM_BOX (message-box table 0x800A59B0:
// box 0 at y138, box 2 at y50).
const PLAY_BOX = { y: 138, h: 48, textX: 28, textY: 143, lineH: 14, markX: 14 };
const CONFIRM_BOX = { y: 50, h: 48, textX: 28, textY: 55, lineH: 14, markX: 14 };
const FLIGHT_FRAMES = 12;

let UI = null, catalog = null, starter = null, EFFECTS = new Map();
let card = null, board = null, icons = null;
let duel = null;

let ticks = 0, intro = true, auto = false;
let cursor = 0, marks = new Set(), ask = 0, confirm = false;
let banner = "Card Battle", stage = "intro";
let introCards = [], lastLand = new Set();
let flights = [], prevHand = { player: [], opponent: [] }, prevField = { player: 0, opponent: 0 };
let choiceCursor = 0;

async function boot() {
  const [ui, cat, st, eff] = await Promise.all([
    fetch("assets/data/cardduel_ui.json").then((r) => r.json()),
    fetch("assets/data/card_catalog.json").then((r) => r.json()),
    fetch("assets/data/card_starter.json").then((r) => r.json()),
    fetch("assets/data/card_effects.json").then((r) => r.json()),
  ]);
  UI = ui; catalog = cat; starter = st; EFFECTS = indexEffects(eff);
  card = loadPack("carddata2");
  board = loadPack("carddata3");
  icons = new Image();
  icons.src = "assets/cards/card_icons.png";
  newGame();
  requestAnimationFrame(loop);
}

function newGame() {
  const deck = (starter.cardIds ?? []).slice(0, 40);
  duel = createDuel(catalog, deck.slice(), deck.slice(), "You", "Opponent");
  // Let the engine's own Start and Draw phases deal the real hands first, so
  // the entrance animation carries the cards the rules actually dealt rather
  // than a preview that then swaps. Stop exactly at the Load Phase.
  let guard = 0;
  while (phase(duel).key !== "load" && guard++ < 800) tickDuel(duel, simpleAgent, Math.random, EFFECTS);
  ticks = 0; intro = true; auto = false; cursor = 0; marks = new Set(); ask = 0;
  confirm = false; banner = "Card Battle"; stage = "intro"; introClock = 0;
  introCards = []; lastLand = new Set(); flights = []; choiceCursor = 0;
  prevHand = { player: duel.player.hand.slice(), opponent: duel.opponent.hand.slice() };
  prevField = { player: duel.player.field.length, opponent: duel.opponent.field.length };
  const flipStart = 5 * DEAL_STAGGER + DEAL_DURATION;
  for (const si of [0, 1]) for (let i = 0; i < 6; i++) {
    introCards.push({ si, i, start: i * DEAL_STAGGER, land: i * DEAL_STAGGER + DEAL_DURATION,
      flip: flipStart + i * DEAL_FLIP_STAGGER });
  }
}

function introEnd() { return 5 * DEAL_STAGGER + DEAL_DURATION + 5 * DEAL_FLIP_STAGGER + FLIP_FRAMES; }

// ---------------------------------------------------------------------------
// clock + controller

let last = 0, acc = 0;
function loop(now) {
  if (!last) last = now;
  acc += Math.min(120, now - last); last = now;
  const frame = 1000 / 50; // PAL 50 Hz
  let guard = 0;
  while (acc >= frame && guard++ < 6) { acc -= frame; tick(); }
  draw();
  requestAnimationFrame(loop);
}

function tick() {
  ticks += 1;
  if (intro) {
    introClock += 1;
    if (introClock >= introEnd()) { intro = false; }
    for (const c of introCards) {
      if (introClock >= c.land && !lastLand.has(c)) { lastLand.add(c); sfx.play(SOUND.land); }
      if (c.si === 0 && introClock === c.flip) sfx.play(SOUND.flip);
    }
    return;
  }
  if (auto) {
    tickDuel(duel, simpleAgent, Math.random, EFFECTS);
    banner = phase(duel).banner; stage = phase(duel).key;
  } else {
    controller();
  }
  detectMoves();
  for (const f of flights) f.t += 1;
  flights = flights.filter((f) => f.t <= FLIGHT_FRAMES);
  const arrived = flights.filter((f) => f.t === FLIGHT_FRAMES);
  if (arrived.length) sfx.play(SOUND.land);
}

let introClock = 0;
function introT() { return introClock; }

/** One frame of the real duel in manual mode: auto phases drain through the
 *  engine, the Load/Compile and Summon phases are driven a turn at a time and
 *  stop on the player. */
function controller() {
  if (duel.outcome) { stage = "over"; return; }
  const p = phase(duel);
  if (stage !== p.key) { stage = p.key; cursor = 0; marks = new Set(); confirm = false; ask = 0; }
  banner = p.banner;
  if (p.key === "start" || p.key === "draw" || p.key === "battle") {
    tickDuel(duel, simpleAgent, Math.random, EFFECTS);
    return;
  }
  if (p.key === "load" || p.key === "compile") return driveProgram();
  if (p.key === "summon") return driveSummon();
}

function advancePhase() {
  duel.phaseIndex = (duel.phaseIndex + 1) % DUEL_PHASES.length;
}

function driveProgram() {
  if (awaitingCardChoice(duel)) return driveChoice();
  if (!duel.programTurns) { beginProgramTurns(duel); return; }
  const t = duel.programTurns;
  if (t.done) { duel.programTurns = null; advancePhase(); return; }
  if (t.state === "pass") { tickProgramTurns(duel, 1); return; }
  if (t.state === "resolve") { pumpProgramTurns(duel, EFFECTS, Math.random, duel.player); return; }
  const side = programTurnSide(duel);
  if (!side || side === duel.player) return; // the human's turn waits for input
  const slot = simpleAgent.chooseProgram ? simpleAgent.chooseProgram(duel, side, EFFECTS) : -1;
  if (slot < 0 || !playProgramTurn(duel, side, slot, EFFECTS, Math.random)) passProgramTurn(duel, side);
}

function driveSummon() {
  if (!duel.summonTurns) { beginSummonTurns(duel); return; }
  const side = summonTurnSide(duel);
  if (!side) { applyDynamicStatMegas(duel); duel.summonTurns = null; advancePhase(); return; }
  if (side === duel.player) return; // the human's turn waits for input
  const slot = simpleAgent.chooseSummon ? simpleAgent.chooseSummon(duel, side) : -1;
  if (slot < 0 || !takeSummonTurn(duel, side, slot)) endSummonTurn(duel, side);
}

function driveChoice() {
  const ch = duelChoice(duel);
  const vm = duel.effectVm;
  const offered = ch.kind === "board" ? ch.targets : ch.slots;
  if (vm && vm.owner !== duel.player) { resolveCardChoice(duel, 0, Math.random); return; }
  choiceCursor = Math.max(0, Math.min(choiceCursor, Math.max(0, offered.length - 1)));
  // waits for the player: Space resolves the cursor
}

// tracks cards leaving a hand or a field filling, so the board moves rather
// than teleporting
function detectMoves() {
  for (const [key, side] of [["player", duel.player], ["opponent", duel.opponent]]) {
    const now = side.hand.slice();
    for (const id of prevHand[key]) {
      if (!now.includes(id)) {
        const i = Math.min(2, Math.max(0, side.field.length - 1));
        flights.push({ id, x: DUEL_BOARD.rowX + 20, y: key === "player" ? DUEL_BOARD.handY : DUEL_BOARD.oppHandY,
          tx: DUEL_BOARD.boardSlots[i][0], ty: DUEL_BOARD.boardSlots[i][1], t: 0, back: key === "opponent" });
        if (key === "player") sfx.play(SOUND.summon);
      }
    }
    prevHand[key] = now;
    prevField[key] = side.field.length;
  }
}

// ---------------------------------------------------------------------------
// drawing

function draw() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 320, 240);
  if (!UI) { drawText(ctx, "loading cardduel_ui.json…", 8, 8); return; }
  drawBackdrop();
  drawBoardSlots();
  drawPlayerStrip(1);
  drawPlayerStrip(0);
  drawHands();
  drawFlights();
  if (!packReady(card) || !packReady(board)) return;
  drawTurnMarker();
  drawWindows();
  drawBanner();
  if (stage === "over") drawOver();
  drawHint();
}

function drawBackdrop() {
  const t = (ticks >> 1) & 0x3F;
  const fade = Math.min(UI.backdrop.clut_rows - 1, ticks >> 2);
  drawClip(ctx, board, fade ? `0#${fade}` : 0, t, t) || drawClip(ctx, board, 0, t, t);
}

function drawBoardSlots() {
  for (let i = 0; i < 3; i++) {
    const id = duel.player.field?.[i]?.id ?? duel.opponent.field?.[i]?.id;
    if (id != null) drawCard(id, DUEL_BOARD.boardSlots[i][0], DUEL_BOARD.boardSlots[i][1]);
  }
}

function drawNumber(value, x, y, width, pad = false) {
  const { base, advance } = UI.digits;
  let v = Math.max(0, Math.floor(value));
  for (let k = 0; k < width; k++) {
    const d = v % 10;
    if (k > 0 && !pad && d === 0 && Math.floor(v / 10) === 0) break;
    drawClip(ctx, board, base + d, x + (width - (k + 1)) * advance, y);
    v = Math.floor(v / 10);
  }
}

function drawIcon(id, x, y) {
  if (!catalog.icons || !icons || !icons.complete || !id) return false;
  const ic = catalog.icons, idx = id - 1;
  if (idx < 0) return false;
  ctx.drawImage(icons, (idx % ic.cols) * ic.cellW, Math.floor(idx / ic.cols) * ic.cellH,
    ic.cellW, ic.cellH, x, y, ic.cellW, ic.cellH);
  return true;
}

function cardById(id) { return catalog.cards.find((c) => c.id === id) ?? null; }

function drawCard(id, x, y, { back = false, dim = false, glow = false } = {}) {
  const f = UI.face;
  if (glow) { drawClipAtPaletteRow(ctx, board, 8, UI.select_clut_cycle[Math.floor((ticks % 24) / 4)], x - 2, y - 2); }
  if (back || id == null) {
    drawClip(ctx, card, id == null ? f.alt_clip.clip : f.reverse_clip.clip, x, y);
    return;
  }
  const rec = cardById(id);
  if (!rec) { drawClip(ctx, card, f.alt_clip.clip, x, y); return; }
  const [ax, ay, aw, ah] = f.art_window;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + ax, y + ay, aw, ah);
  ctx.clip();
  drawIcon(id, x + ax - 1, y + ay - 2);
  ctx.restore();
  const idx = f.frame_by_colour[rec.colour] ?? 0;
  drawClip(ctx, card, f.frame.base + idx + (dim ? f.frame.alt_add : 0), x, y);
  const st = f.stats;
  if (rec.kind === "program") { drawClip(ctx, board, st.blank.clip, x + st.blank.pos[0], y + st.blank.pos[1]); return; }
  drawClip(ctx, board, st.sep.clip, x + st.sep.pos[0], y + st.sep.pos[1]);
  drawNumber(rec.ap, x + st.ap[0], y + st.ap[1], 2);
  drawNumber(rec.hp, x + st.hp[0], y + st.hp[1], 2);
}

function drawPlayerStrip(p) {
  const rec = UI.players[p];
  const [ox, oy] = STRIP_ORIGIN()[p];
  const side = p === 0 ? duel.player : duel.opponent;
  const aux = UI.aux;
  const k = Math.floor((ticks % 36) / 6);
  drawClip(ctx, card, rec.chrome_clip, ox, oy);
  for (let i = 0; i < 5; i++) {
    const x = rec.field_slots[0] + i * 42;
    drawClipAtPaletteRow(ctx, board, 13, aux.board_clut_cycle[k], ox + x, oy + rec.field_slots[1])
      || drawClip(ctx, board, 13, ox + x, oy + rec.field_slots[1]);
    drawClip(ctx, card, aux.field_slot_clip_bases[i] + aux.slot_number_cycle[0],
      ox + rec.energy_cubes[0] + i * 42, oy + rec.energy_cubes[1]);
    drawNumber(side.energy[ENERGY_KEY[i]] ?? 0, ox + rec.field_numbers[0] + i * 42,
      oy + rec.field_numbers[1], 2);
  }
  const [la, lb] = aux.label_clips_by_lang[2];
  drawClip(ctx, board, la, ox + rec.label_a[0], oy + rec.label_a[1]);
  drawClip(ctx, board, lb, ox + rec.label_b[0], oy + rec.label_b[1]);
  drawNumber(side.totalAp, ox + rec.total_a[0], oy + rec.total_a[1], 3);
  drawNumber(side.totalHp, ox + rec.total_b[0], oy + rec.total_b[1], 3);
  drawClip(ctx, board, 12, ox + rec.pile_a[0], oy + rec.pile_a[1]);
  drawClip(ctx, board, 12, ox + rec.pile_b[0], oy + rec.pile_b[1]);
  drawClip(ctx, board, 14, ox + rec.marker_a[0], oy + rec.marker_a[1]);
  drawClip(ctx, board, 14, ox + rec.marker_b[0], oy + rec.marker_b[1]);
  drawClip(ctx, card, aux.icon_b_cycle[0] + 6, ox + rec.icon_b[0], oy + rec.icon_b[1]);
  drawClip(ctx, card, aux.icon_a_cycle[0] + 9, ox + rec.icon_a[0], oy + rec.icon_a[1]);
  drawNumber(side.deck.length, ox + rec.counter_a[0], oy + rec.counter_a[1], 2);
  drawNumber(side.hand.length, ox + rec.counter_b[0], oy + rec.counter_b[1], 2);
  const [ax, ay] = ALT_ORIGIN[p];
  drawClip(ctx, card, rec.alt_card_clip, ax + rec.alt.alt_card[0], ay + rec.alt.alt_card[1]);
  drawClip(ctx, card, ALT_ICON_BASE + aux.alt_marker_cycle[0], ax, ay);
  drawNumber(side.trash.length, ax + rec.alt.alt_number[0], ay + rec.alt.alt_number[1], 2, true);
}

function handX(count, i) { return DUEL_BOARD.rowX + (cardFanOut(count, i) >> 8); }

function drawHands() {
  const n = duel.player.hand.length;
  // opponent stays face-down
  duel.opponent.hand.forEach((id, i) => {
    if (intro) return;
    drawCard(id, handX(duel.opponent.hand.length, i), DUEL_BOARD.oppHandY, { back: true });
  });
  duel.player.hand.forEach((id, i) => {
    const target = handX(n, i);
    if (intro) {
      const c = introCards.find((x) => x.si === 0 && x.i === i);
      const p = Math.max(0, Math.min(1, (introT() - c.start) / DEAL_DURATION));
      if (p <= 0) return;
      const x = DEAL_START_X + (target - DEAL_START_X) * p;
      ctx.save();
      ctx.translate(x + 20 * p, DUEL_BOARD.handY + 23 * (1 - p));
      ctx.scale(p, p);
      drawCard(id, -20, -23, { back: introT() < c.flip + FLIP_FRAMES });
      ctx.restore();
      return;
    }
    const on = i === cursor && (stage === "load" || stage === "compile" || stage === "summon");
    const legal = !on || isLegal(i);
    drawCard(id, target, DUEL_BOARD.handY, { dim: !legal, glow: on });
    if (marks.has(i)) drawCard(id, target, DUEL_BOARD.handY - 4, { glow: true });
  });
  if (intro) {
    for (const c of introCards.filter((x) => x.si === 1)) {
      const p = Math.max(0, Math.min(1, (introT() - c.start) / DEAL_DURATION));
      if (p <= 0) continue;
      const target = handX(duel.opponent.hand.length, c.i);
      const x = DEAL_START_X + (target - DEAL_START_X) * p;
      ctx.save();
      ctx.translate(x + 20 * p, DUEL_BOARD.oppHandY + 23 * (1 - p));
      ctx.scale(p, p);
      drawCard(duel.opponent.hand[c.i], -20, -23, { back: true });
      ctx.restore();
    }
  }
}

function drawFlights() {
  for (const f of flights) {
    const p = Math.min(1, f.t / FLIGHT_FRAMES);
    const x = f.x + (f.tx - f.x) * p;
    const y = f.y + (f.ty - f.y) * p;
    drawCard(f.id, x, y, { back: f.back || p < 0.5 });
  }
}

function drawTurnMarker() {
  if (intro) return;
  const active = stage === "summon" ? 1 : 0;
  const rec = UI.players[active];
  const [ox, oy] = STRIP_ORIGIN()[active];
  const row = UI.aux.alt_marker_cycle[Math.floor((ticks % 36) / 6)];
  drawClipAtPaletteRow(ctx, board, 14, row, ox + rec.marker_a[0], oy + rec.marker_a[1]);
  drawClipAtPaletteRow(ctx, board, 14, row, ox + rec.marker_b[0], oy + rec.marker_b[1]);
}

function isLegal(slot) {
  if (stage === "summon") { const id = duel.player.hand[slot]; return id != null && canSummon(duel, duel.player, id); }
  const id = duel.player.hand[slot];
  const rec = cardById(id);
  return !!rec && rec.kind === "program" && canPlayProgram(duel, duel.player, EFFECTS.get(id));
}

function drawWindow(x, y, w, h) {
  ctx.fillStyle = "rgba(8,10,24,0.94)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#c8cede";
  ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
}

function phasePrompt() {
  const p = DUEL_PHASES.find((q) => q.key === stage);
  return p ? p.prompt : "";
}

function drawWindows() {
  if (intro || stage === "over") return;
  if (stage === "summon" && confirm) {
    drawWindow(0, CONFIRM_BOX.y, 320, CONFIRM_BOX.h);
    drawText(ctx, "Put in Field?", CONFIRM_BOX.textX, CONFIRM_BOX.textY);
    drawText(ctx, "Yes", CONFIRM_BOX.textX + 40, CONFIRM_BOX.textY + CONFIRM_BOX.lineH);
    drawText(ctx, "No", CONFIRM_BOX.textX + 90, CONFIRM_BOX.textY + CONFIRM_BOX.lineH);
    return;
  }
  if (awaitingCardChoice(duel)) {
    const ch = duelChoice(duel);
    if (duel.effectVm?.owner === duel.player) {
      drawWindow(0, PLAY_BOX.y, 320, PLAY_BOX.h);
      drawText(ctx, "Choose a target", PLAY_BOX.textX, PLAY_BOX.textY);
      const n = ch.kind === "board" ? ch.targets.length : ch.slots.length;
      drawText(ctx, `${choiceCursor + 1} / ${n}`, PLAY_BOX.textX, PLAY_BOX.textY + PLAY_BOX.lineH);
    }
    return;
  }
  if (stage === "load" || stage === "compile" || stage === "summon") {
    drawWindow(0, PLAY_BOX.y, 320, PLAY_BOX.h);
    drawText(ctx, phasePrompt(), PLAY_BOX.textX, PLAY_BOX.textY);
    const turnSide = stage === "summon" ? summonTurnSide(duel) : programTurnSide(duel);
    const mine = turnSide === duel.player;
    const action = stage === "summon" ? "Space mark  Enter summon" : "Space play  Enter pass";
    if (mine) drawText(ctx, action, PLAY_BOX.textX, PLAY_BOX.textY + PLAY_BOX.lineH);
  }
}

function drawBanner() {
  if (intro || stage === "over") return;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, 320, 15);
  drawText(ctx, banner, 6, 3);
}

function drawOver() {
  drawWindow(40, 90, 240, 60);
  drawText(ctx, duel.outcome === "win" ? "You won this battle!" : "You lost this battle!", 70, 105);
  drawText(ctx, "Press Space to play again", 58, 125);
}

function drawHint() {
  const el = document.getElementById("cardinfo");
  if (!el) return;
  if (stage === "over") { el.textContent = "duel over — Space to redeal"; return; }
  const id = duel.player.hand[cursor];
  const rec = id != null ? cardById(id) : null;
  const turnSide = stage === "summon" ? summonTurnSide(duel)
    : (stage === "load" || stage === "compile") ? programTurnSide(duel) : null;
  const who = turnSide ? (turnSide === duel.player ? "your turn" : "opponent") : "";
  el.textContent = `${rec ? `${rec.name} — AP ${rec.ap} / HP ${rec.hp} (${rec.colour})` : ""}${who ? "   [" + who + "]" : ""}`;
}

// ---------------------------------------------------------------------------
// input

window.addEventListener("keydown", (e) => {
  bgm.unlock(); sfx.unlock();
  if (e.key === "r" || e.key === "R") { sfx.play(SOUND.cancel); newGame(); return; }
  if (e.key === "a" || e.key === "A") { auto = !auto; sfx.play(SOUND.confirm); return; }
  if (stage === "over") {
    if (e.key === " ") { sfx.play(SOUND.confirm); newGame(); e.preventDefault(); }
    return;
  }
  if (intro) { if (e.key === " ") { intro = false; e.preventDefault(); } return; }
  if (awaitingCardChoice(duel)) {
    const ch = duelChoice(duel);
    const count = ch.kind === "board" ? ch.targets.length : ch.slots.length;
    if (e.key === "ArrowRight") { choiceCursor = (choiceCursor + 1) % Math.max(1, count); sfx.play(SOUND.cursor); }
    else if (e.key === "ArrowLeft") { choiceCursor = (choiceCursor - 1 + Math.max(1, count)) % Math.max(1, count); sfx.play(SOUND.cursor); }
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (count) { resolveCardChoice(duel, choiceCursor, Math.random); sfx.play(SOUND.confirm); }
    }
    return;
  }
  const n = duel.player.hand.length;
  if (e.key === "ArrowRight") { cursor = (cursor + 1) % Math.max(1, n); sfx.play(SOUND.cursor); }
  else if (e.key === "ArrowLeft") { cursor = (cursor - 1 + Math.max(1, n)) % Math.max(1, n); sfx.play(SOUND.cursor); }
  else if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (stage === "summon") {
      if (confirm) { commitSummons(duel, duel.player, [...marks]); sfx.play(SOUND.summon); marks = new Set(); confirm = false; return; }
      if (e.key === " ") {
        if (marks.has(cursor)) marks.delete(cursor); else marks.add(cursor);
        sfx.play(SOUND.cursor);
      } else if (marks.size) { confirm = true; sfx.play(SOUND.confirm); }
      return;
    }
    if ((stage === "load" || stage === "compile") && programTurnSide(duel) === duel.player) {
      if (e.key === " " && isLegal(cursor)) { playProgramTurn(duel, duel.player, cursor, EFFECTS, Math.random); sfx.play(SOUND.confirm); }
      else { passProgramTurn(duel, duel.player); sfx.play(SOUND.pass); }
    }
  } else if (e.key === "Escape") {
    if (stage === "summon" && summonTurnSide(duel) === duel.player) { endSummonTurn(duel, duel.player); sfx.play(SOUND.pass); }
    else if ((stage === "load" || stage === "compile") && programTurnSide(duel) === duel.player) { passProgramTurn(duel, duel.player); sfx.play(SOUND.pass); }
  }
});

boot();

// Debug hook for the lab harness and the verifier scripts.
window.__duelLab = {
  get stage() { return stage; },
  get phase() { return duel ? phase(duel).key : null; },
  get outcome() { return duel ? duel.outcome : null; },
  get hand() { return duel ? duel.player.hand.length : 0; },
  get field() { return duel ? duel.player.field.length : 0; },
  duel: () => duel,
};
