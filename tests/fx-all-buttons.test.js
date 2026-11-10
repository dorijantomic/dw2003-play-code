// F2 panel: "All on" ticks every checkbox (MANUAL keys included), "All off" unticks every one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");

test("All on / All off set every FX_DEFS key, no MANUAL exclusion", () => {
    const m = SRC.match(/closest\("\[data-all\]"\)[\s\S]{0,200}?for \(const \[k\] of FX_DEFS\) (.*);/);
    assert.ok(m, "all-button loop exists");
    assert.equal(m[1].replace(/\s/g, ""), "fx[k]=b.dataset.all===\"1\"");
    assert.ok(!/MANUAL/.test(m[1]));
});

test("defaults still start MANUAL keys off", () => {
    assert.ok(/for \(const k of MANUAL\) fx\[k\] = false;/.test(SRC));
});
