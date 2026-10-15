import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Every native screen adapter is a state adapter between web/game.js and the
// screen's RAM contract (web/native-screen-host.js). The ones that read the
// walker state in seed() — the wallet, the bag, the folder records — must be
// HANDED that state by open(), because open() boots the screen and
// openNativeScreen runs `seed` synchronously inside that boot: no key event has
// been routed yet, so handleKey is too late to be the first binding.
//
// The card duel was the one member that read the walker state in seed() and
// bound it only in handleKey, and 374b9e3a ("A booster pack in the bag now opens
// for real") made that seed read the bag — seedBoosterStock walks
// `state.inventory`, so a duel opened from a field event (a tamer's challenge,
// whose launcher runs the duel out of the NPC's own line) threw
// "Cannot read properties of undefined (reading 'find')" and commit() then
// dropped the result because it returns early without a state. The player saw a
// duel that launched with an unseeded hand and no outcome recorded.
//
// The member list is computed, not hand-written: every web/*-native.js whose
// seed() takes its state out of the adapter. So a new adapter that reads the
// walker state and forgets to bind it fails here too.

const adapters = readdirSync("web").filter((f) => /-native\.js$/.test(f));

/** The `name.open = (...) => { ... }` body: past the parameter list, brace-matched
 *  past comments and strings (a parameter default can itself hold braces). */
function openBody(source) {
  const start = source.indexOf(".open = ");
  assert.notEqual(start, -1, "no open()");
  const skip = (i) => {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") { i = source.indexOf("\n", i); return i < 0 ? source.length : i; }
    if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i) + 1; return i < 0 ? source.length : i + 1; }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      for (i++; i < source.length && source[i] !== quote; i++) if (source[i] === "\\") i++;
      return i;
    }
    return i;
  };
  const open = source.indexOf("(", start);
  let depth = 0;
  let i = open;
  for (; i < source.length; i++) {
    i = skip(i);
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) break;
  }
  const body = source.indexOf("{", i);
  assert.notEqual(body, -1, "open() has no body");
  depth = 0;
  for (i = body; i < source.length; i++) {
    i = skip(i);
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(body, i + 1);
  }
  throw new Error("unbalanced open() braces");
}

/** An adapter that seeds from the state it holds: `const state = x._state ?? {}`. */
const readsHeldState = (source) => /const state = \w+\._state \?\? \{\};/.test(source);

const members = adapters.filter((f) => readsHeldState(readFileSync(`web/${f}`, "utf8")));
const binds = (f) => /(\w+)\._state = /.test(openBody(readFileSync(`web/${f}`, "utf8")));

test("the census is non-empty and every member binds the walker state in open()", () => {
  // cardalbum and carddeck seed the collection table from the shared `cards()`
  // object, not from the adapter's state, so they are not members of this family.
  assert.deepEqual(members, [
    "cardduel-native.js", "cardshop-native.js", "dri-native.js", "fightreport-native.js",
    "gym-native.js", "nameentry-native.js", "packselect-native.js", "save-native.js",
    "shop-native.js", "status-native.js",
  ]);
  const unbound = members.filter((f) => !binds(f));
  assert.deepEqual(unbound, [], "adapters that seed from the walker state but never bind it");
});

test("a duel opened from the field carries the walker state, so seed cannot read an empty bag", async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.fetch ??= async () => ({ json: async () => ({}) });
  const { createCardDuelNative } = await import("../web/cardduel-native.js");
  const { BOOSTER_ITEM_IDS, seedBoosterStock } = await import("../web/vendor/engine.js");
  const state = { inventory: [{ id: 9, qty: 99 }, { id: 40, qty: 1 }], bits: 1200 };
  const seed = (adapter) => {
    const ram = new Map();
    seedBoosterStock(adapter._state ?? {}, BOOSTER_ITEM_IDS, (address, size) => ram.set(address, size));
    return ram;
  };

  // The crashing call itself, through the adapter's own binding: web/cardduel-native.js
  // seeds `d._state ?? {}`, and on the old code that `{}` reached heldCount.
  const bare = createCardDuelNative(null, null);
  bare.open(null, "Duelist", null, 7);
  assert.throws(() => seed(bare), TypeError, "no state bound at all is still an empty state");

  const bound = createCardDuelNative(null, null);
  bound.open(null, "Duelist", null, 7, state);
  assert.equal(bound._state, state, "open() must bind the walker state the launcher holds");
  assert.equal(seed(bound).size, BOOSTER_ITEM_IDS.length, "all 35 decoded booster counts are seeded");

  // The walker's own accessor covers every caller that uses the four-argument form
  // (the card-duel verifiers open through `window.__cardDuel.open(onClose, name, deck, id)`).
  const accessor = createCardDuelNative(null, null, { getState: () => state });
  accessor.open(null, "Duelist", null, 7);
  assert.equal(accessor._state, state, "the walker's accessor binds the same state");
  assert.doesNotThrow(() => seed(accessor));
  assert.equal(seed(accessor).size, BOOSTER_ITEM_IDS.length);
});

test("the game's duel adapter is constructed with the walker's own state accessor", () => {
  const source = readFileSync("web/game.js", "utf8");
  assert.match(source, /createCardDuelNative\(sfx, bgm, \{ getState: \(\) => state \}\)/);
  // Both launchers pass it too, so the accessor is a backstop rather than the only
  // route. The challenge launcher carries the close callback (the field's screen-
  // close housekeeping) as its first argument, so its argument list holds a `)`
  // before the trailing `state`; the match is anchored to statement starts so the
  // doc comment above the adapter cannot pass for a call.
  assert.equal(
    (source.match(/(?:^|\n)[ \t]*cardDuel\.open\([^;]*?,\s*state,?\s*\)\s*;/g) ?? []).length,
    2,
  );
});