// The quest scenes' place card step (web/quest-scenes.js -> web/placecard.js): the game's own blue location card,
// with two names the quest chooses instead of the stage entry table. Same bars, same typewriter (one character every
// six frames), same hold and slit close -- the decode is engine/systems/location-card.ts and
// docs/research/ui/field-location-title-card-2026-08-16.md. The step is behind F2 -> Extras -> Quest place cards
// (off by default): with the switch off it is refused at compile time instead of half-playing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileScene, validateScene } from "../web/quest-scenes.js";
import { createPlaceCard, loadPlaceCard } from "../web/placecard.js";

const ON = { fx: { questplacecard: true } };
const pos = () => ({ x: 0, y: 0 });
const compile = (steps, extra = ON) => compileScene(steps, { playerId: 2, pos, ...extra });
const STEP = { placecard: { area: "Kusanagi City", place: "Street Corner" } };

test("one step becomes one host event, and the two names ride along untouched", () => {
  const { opcodes, events, errors } = compile([STEP]);
  assert.deepEqual(errors, []);
  assert.deepEqual(events, [{ kind: "placecard", area: "Kusanagi City", place: "Street Corner" }]);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SCENEEVENT 0", "END"]);
});

test("a name is 1 to 20 printable ASCII characters: 20 is what the disc's own table fits", () => {
  // "Wire Forest Entrance" is the longest shipped name (20); 21 characters would run past the card's bar.
  assert.deepEqual(compile([{ placecard: { area: "Wire Forest Entrance", place: "Street Corner" } }]).errors, []);
  assert.deepEqual(compile([{ placecard: { area: "A", place: "B" } }]).errors, [], "one character is a name");
  const bad = [
    [{ area: "Wire Forest Entrances", place: "Street Corner" }],    // 21 characters
    [{ area: "Kusanagi City", place: "Wire Forest Entrances" }],
    [{ area: "", place: "Street Corner" }],                         // a name of nothing
    [{ area: "Kusanagi City", place: "" }],
    [{ area: "Kusanagi\tCity", place: "Street Corner" }],           // a tab is not printable
    [{ area: "Kusanagi\u0000City", place: "Street Corner" }],       // nor a control character
    [{ area: "Kusanagi\u00e9", place: "Street Corner" }],           // nor a letter the card's font cannot draw
    [{ area: 5, place: "Street Corner" }],
    [{ place: "Street Corner" }],
    [true],
  ];
  for (const [pc] of bad) {
    const { errors, events } = compile([{ placecard: pc }]);
    assert.equal(errors.length, 1, JSON.stringify(pc));
    assert.equal(events.length, 0, "nothing half-played");
  }
});

test("with the F2 switch off the step is refused at compile time and emits nothing", () => {
  for (const opts of [{}, { fx: {} }, { fx: { questplacecard: false } }]) {
    const { opcodes, events, errors } = compile([STEP], opts);
    assert.equal(errors.length, 1, JSON.stringify(opts));
    assert.match(errors[0], /Quest place cards/, "the error names the switch to turn on");
    assert.deepEqual(events, [], "no half-played card");
    assert.deepEqual(opcodes, ["FN6A 1 2", "END"]);
  }
});

test("in the game the F2 settings object (window.__fx) is what the gate reads", () => {
  globalThis.window = { __fx: { questplacecard: true } };
  try {
    assert.deepEqual(compile([STEP], {}).errors, []);
  } finally {
    delete globalThis.window;
  }
  globalThis.window = { __fx: { questplacecard: false } };
  try {
    assert.equal(compile([STEP], {}).errors.length, 1, "off stays off");
  } finally {
    delete globalThis.window;
  }
});

test("the card types the quest's own two names and closes on its own", async () => {
  const real = readFileSync("web/assets/data/place_card.json", "utf8");
  globalThis.fetch = async () => ({ json: async () => JSON.parse(real) });
  try {
    await loadPlaceCard();
    const card = createPlaceCard();
    assert.equal(card.beginText("Kusanagi City", "Street Corner"), true, "the card starts");
    assert.ok(card.state(), "and is live");
    assert.equal(card.state().area.text, "Kusanagi City", "the area name is the quest's");
    assert.equal(card.state().place.text, "Street Corner", "and so is the place name");
    assert.equal(card.state().area.revealed, 0, "nothing typed yet");
    card.step(6 / 60);                                            // six frames
    assert.equal(card.state().area.revealed, 1, "one character every six frames, as the field card does");
    card.step(6 / 60);
    assert.equal(card.state().area.revealed, 2);
    let frames = 12;
    while (card.state() && frames < 1200) { card.step(6 / 60); frames += 6; }
    assert.equal(card.state(), null, "the card closed by itself: no stage entry to release it");
    assert.equal(card.isActive(), false);
    assert.ok(frames < 1200, `it took the card's own hold and slit (${frames} frames), not forever`);
  } finally {
    delete globalThis.fetch;
  }
});

test("an empty name is refused, and the card shows nothing", async () => {
  const real = readFileSync("web/assets/data/place_card.json", "utf8");
  globalThis.fetch = async () => ({ json: async () => JSON.parse(real) });
  try {
    await loadPlaceCard();
    const card = createPlaceCard();
    assert.equal(card.beginText("", "Street Corner"), false, "no area name, no card");
    assert.equal(card.state(), null);
    assert.equal(card.beginText("Kusanagi City", ""), false, "no place name, no card");
    assert.equal(card.state(), null);
    assert.equal(card.beginText("Kusanagi City", "Street Corner"), true, "and a real pair still works");
  } finally {
    delete globalThis.fetch;
  }
});

test("the card the game runs by default (the translated one) plays the quest's names on that same card", async () => {
  const real = readFileSync("web/assets/data/place_card.json", "utf8");
  globalThis.fetch = async () => ({ json: async () => JSON.parse(real) });
  try {
    await loadPlaceCard();
    const { createPlaceCardTranslated } = await import("../web/placecard-translated.js");
    const card = createPlaceCardTranslated();
    assert.equal(card.beginText("Kusanagi City", "Street Corner"), true, "the default card answers beginText");
    assert.equal(card.isActive(), true);
    assert.equal(card.state().area.text, "Kusanagi City", "and the quest's own name is what it shows");
    assert.equal(card.beginText("", "B"), false, "an empty name is still refused");
  } finally {
    delete globalThis.fetch;
  }
});

test("validateScene checks the shape with the switch off", () => {
  assert.deepEqual(validateScene([STEP]), []);
  assert.ok(validateScene([{ placecard: { area: "x".repeat(21), place: "Street Corner" } }]).length,
    "validation still reports a name that is too long");
});

test("source: the card draws the caller's names through the field card's own path; the game has the case; F2 carries the pair", () => {
  const cardSrc = readFileSync(new URL("../web/placecard.js", import.meta.url), "utf8");
  const beginText = cardSrc.slice(cardSrc.indexOf("card.beginText"));
  assert.ok(beginText.includes("createLocationCard(data.bars, area, place)"),
    "beginText builds the same card as begin(), with the caller's two names");
  assert.ok(!/\.png|extra_fx|assets\/data\/(?!place_card)/.test(beginText),
    "no art of ours and no other data: the card's own bars and font draw it");
  const transSrc = readFileSync(new URL("../web/placecard-translated.js", import.meta.url), "utf8");
  assert.match(transSrc, /card\.beginText = /, "the card the game runs by default answers beginText too");
  const sceneSrc = readFileSync(new URL("../web/quest-scenes.js", import.meta.url), "utf8");
  const branch = sceneSrc.slice(sceneSrc.indexOf('"placecard" in s'), sceneSrc.indexOf('"face" in s'));
  assert.ok(branch.includes("questplacecard") && branch.includes("event("), "the step is gated and emits one event");
  assert.ok(!/\.png|extra_fx/.test(branch), "opcodes and a data event only: no art");
  const gameSrc = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(gameSrc, /case "placecard":/, "the game performs the event");
  assert.match(gameSrc, /placeCard\.beginText\(ev\.area, ev\.place\)/, "on the game's own card, with the quest's names");
  const ambSrc = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
  assert.match(ambSrc, /\["questplacecard", "Quest place cards"\]/, "the Extras row carries the pair");
  assert.match(ambSrc, /const EXPERIMENTAL = \[[^\]]*"questplacecard"/, "and the key starts OFF with the experimental switches");
});
