// OPTIONS is registered with the book host in web/game.js (build step 2).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readSource } from "./helpers/source.js";

test("game.js makes the options book from the host arguments, next to the glossary book", () => {
    const game = readSource(new URL("../web/game.js", import.meta.url));
    assert.match(game, /import \{ createOptionsBook \} from "\.\.?\/options-book\.js";/);
    assert.match(game, /glossary: \(args\) => createGlossaryBook\([^\n]*\n\s*options: \(args\) => createOptionsBook\(args\),/);
});
