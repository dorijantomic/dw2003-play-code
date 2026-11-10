// The F2 switches of the in-game Extras screens only ENABLE them. None opens on page load or when
// its switch is ticked; each opens from an "Open ..." button in the F2 panel (window.__openExtra in
// web/game.js); Escape (the pad name "cross") closes it; the switch off closes it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tickCutContent, openCutContent, cutContentOpen, cutContentPress } from "../web/cut-content.js";
import { tickBlastLadder, openBlastLadder, blastOpen, blastPress, blastReset } from "../web/blast-ladder.js";
import { tickPlanner, openPlanner, plannerOpen, plannerPress, plannerReset } from "../web/evolution-planner.js";
import { tickDamageLab, openDamageLab, damageLabOpen, damageLabPress, damageLabReset } from "../web/damage-lab.js";
import { tickReplay, openReplay, replayOpen, replayPress, replayReset } from "../web/replay-theatre.js";
import { createSoundTest } from "../web/soundtest.js";
import { buttonForKey } from "../engine/systems/input-map.ts";

const noFetch = async () => { throw new Error("offline"); };
globalThis.fetch = noFetch;   // a button open starts a data load; in node it just fails quietly

const screens = [
  { name: "cutcontent", tick: tickCutContent, open: () => openCutContent(), isOpen: cutContentOpen, press: cutContentPress, reset: () => {} },
  { name: "blastladder", tick: tickBlastLadder, open: () => openBlastLadder(), isOpen: blastOpen, press: blastPress, reset: blastReset },
  { name: "planner", tick: tickPlanner, open: () => openPlanner(), isOpen: plannerOpen, press: plannerPress, reset: plannerReset },
  { name: "damagelab", tick: tickDamageLab, open: () => openDamageLab(), isOpen: damageLabOpen, press: damageLabPress, reset: damageLabReset },
  { name: "replay", tick: tickReplay, open: () => openReplay({ place: "x", here: [], elsewhere: [] }), isOpen: replayOpen, press: replayPress, reset: replayReset },
];

for (const s of screens) {
  test(`${s.name}: switch on at load does not open; button opens; cross closes; switch off closes`, async () => {
    s.reset();
    s.tick(false);
    for (let frame = 0; frame < 5; frame++) s.tick(true);
    assert.equal(s.isOpen(), false, "switch on at load: not open");
    s.tick(false);
    s.tick(true);
    assert.equal(s.isOpen(), false, "ticking the switch off and on: not open");
    s.open();
    assert.equal(s.isOpen(), true, "the F2 button opens it");
    s.tick(true);
    assert.equal(s.isOpen(), true, "ticking while it is on does not close it");
    assert.equal(s.press("cross"), true);
    assert.equal(s.isOpen(), false, "cross closes it");
    s.open();
    s.tick(false);
    assert.equal(s.isOpen(), false, "the switch off closes it");
    s.reset();
  });
}

test("soundtest: switch alone never opens it (no rising edge in game.js); show() opens, cross closes, hide on switch off", () => {
  const t = createSoundTest({ sfx: {}, music: { play() {}, stop() {} } });
  assert.equal(t.open, false);
  t.show();
  assert.equal(t.open, true);
  t.handleKey("start");
  assert.equal(t.open, false, "Start closes it");
  t.show();
  t.hide();
  assert.equal(t.open, false, "hide (switch off) closes it");
});

test("Escape is the pad name cross in the game's default (English) layout", () => {
  assert.equal(buttonForKey("escape"), "cross");
  assert.equal(buttonForKey("x"), "cross");
});

test("game.js exposes the opener and the F2 page has one Open button per screen", () => {
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  const amb = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
  const model = readFileSync(new URL("../web/dev-panel-model.js", import.meta.url), "utf8");
  assert.match(amb, /window\.__openExtra\?\.\(key\)/, "the F2 page's Open handler calls the opener");
  assert.match(game, /window\.__openExtra = \(name\) =>/);
  for (const n of ["cutcontent", "blastladder", "planner", "damagelab", "replay", "soundtest"]) {
    assert.match(game, new RegExp(`case "${n}":`), `${n} has an opener`);
    assert.match(model, new RegExp(`\\b${n}: X\\(\\)`), `${n} has an Open button (an in-game screen in the F2 page model)`);
  }
  for (const f of ["cut-content", "blast-ladder", "evolution-planner", "damage-lab", "replay-theatre"]) {
    const src = readFileSync(new URL(`../web/${f}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(src, /on && !S\.wasOn|enabled && !S\.wasOn/, `${f} has no rising-edge open`);
  }
});
