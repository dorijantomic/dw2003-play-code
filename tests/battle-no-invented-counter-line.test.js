// The disc has no "<name> braces to counter!" line (its only counter page is
// esmfight[0x0a] "Counter! {1}!"). The invented sentence must stay out of battle.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSource } from "./helpers/source.js";

const src = readSource(new URL("../web/battle.js", import.meta.url));

test("battle.js has no invented braces-to-counter sentence", () => {
  assert.equal(/braces to counter/i.test(src.replace(/\/\/.*$/gm, "")), false);
});
