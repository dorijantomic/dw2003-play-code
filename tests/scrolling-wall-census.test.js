// Census for the diagonal scrolling backdrop wall.
//
// data/scrolling_walls.json is the decoded member list (tools/extract_scroll_walls.py
// matches the shape in ~/ddw3/asm/dw2003/{pro,exe}/*.s). tools/scrolling-walls.mjs
// holds the rows the browser check measures. Two hand-kept lists of one system
// are how the naming screen went unmeasured for a year: the 2026-08-14 census
// matched only `slti $v0, $v1, 0x60`, and pro/stdgname.s:3548 writes the same
// wrap as the short form `slti $v0, 0x5f`, so the tenth member was never in the
// list and no check could ask about it.
//
// Run: node --test tests/scrolling-wall-census.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { WALL_SCREENS } from "../tools/scrolling-walls.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const census = JSON.parse(readFileSync(resolve(ROOT, "data/scrolling_walls.json"), "utf8"));
const doc = readFileSync(
    resolve(ROOT, "docs/research/ui/scrolling-backdrop-walls-2026-08-14.md"),
    "utf8",
);

/**
 * The decode, pinned. Every value is read out of the assembly at the file line
 * the census names, so a re-read that moves one of them fails here rather than
 * quietly changing what the check measures.
 */
const DECODED = {
    ststatus: { clip: "0x1d", counter: "0x54", toggle: "0x58", wrap: 23271 },
    stitshop: { clip: "0x14", counter: "0x58", toggle: "0x5c", wrap: 8959 },
    stgdglab: { clip: "0x37", counter: "0x54", toggle: "0x58", wrap: 12386 },
    stgmcard: { clip: "0x1e", counter: "0x58", toggle: "0x5c", wrap: 4957 },
    stfgtrep: { clip: "0x1e", counter: "0x58", toggle: "0x5c", wrap: 2042 },
    stcrdabm: { clip: "0x08", counter: "0x58", toggle: "0x5c", wrap: 1590 },
    stcrddek: { clip: "0x08", counter: "0x58", toggle: "0x5c", wrap: 6293 },
    stcrdshp: { clip: "0x08", counter: "0x58", toggle: "0x5c", wrap: 5413 },
    // stgtrain takes its clip from the object field +0x58, not an immediate
    // (pro/stgtrain.s:1884 `lw $a1, 0x58($s5)`), so it has no clip immediate.
    stgtrain: { clip: null, counter: "0x5c", toggle: "0x60", wrap: 1873 },
    // The tenth member, and the one the first census missed: its wrap is
    // `slti $v0, 0x5f` (pro/stdgname.s:3545) rather than `slti $v0, $v1, 0x60`.
    stdgname: { clip: "0x24", counter: "0x58", toggle: "0x5c", wrap: 3545 },
};

const members = new Map(census.members.map((m) => [m.overlay, m]));

test("the census has exactly the ten decoded wall sites", () => {
    assert.equal(census.members.length, Object.keys(DECODED).length);
    assert.deepEqual([...members.keys()].sort(), Object.keys(DECODED).sort());
    assert.equal(census.summary.members, census.members.length);
    assert.equal(census.summary.period_px, 0x60);
    assert.equal(census.summary.rate_px_per_s, 25);
});

test("every member carries the decoded clip, counter, toggle and wrap line", () => {
    for (const [overlay, want] of Object.entries(DECODED)) {
        const got = members.get(overlay);
        assert.ok(got, `${overlay}: no census row`);
        assert.equal(got.clip, want.clip, `${overlay}: the wall clip`);
        assert.equal(got.counter, want.counter, `${overlay}: the counter field`);
        assert.equal(got.toggle, want.toggle, `${overlay}: the frame toggle field`);
        assert.equal(got.wrap_file_line, want.wrap, `${overlay}: the wrap line in ${got.source}`);
        // The draw's y must come from the delay slot, and x from the counter.
        assert.match(got.draw_text, /move_ \$a3, \$a2/, `${overlay}: the diagonal draw`);
        assert.match(got.wrap_text, /slti \$v[01],/, `${overlay}: the wrap compare`);
    }
});

test("the gym's wall clip comes from a field, and every other clip is an immediate", () => {
    const fields = census.members.filter((m) => m.clip_field !== null).map((m) => m.overlay);
    assert.deepEqual(fields, ["stgtrain"], "only pro/stgtrain.s reads its clip from the object");
    assert.equal(members.get("stgtrain").clip_field, "0x58");
});

test("the check measures every decoded member, and each row is one member", () => {
    const measured = WALL_SCREENS.filter((row) => row.bare !== false);
    assert.deepEqual(measured.map((row) => row.overlay).sort(), Object.keys(DECODED).sort(),
        "one measured row per decoded wall site; a new member needs a row here");
    // A second row for the same screen is allowed only for the pause list's two
    // states, and it must be the one screen with both a correct wall and a
    // correct absence.
    const counts = new Map();
    for (const row of WALL_SCREENS) counts.set(row.overlay, (counts.get(row.overlay) ?? 0) + 1);
    assert.deepEqual([...counts.entries()].filter(([, n]) => n > 1), [["ststatus", 2]]);
    assert.equal(WALL_SCREENS.find((r) => r.name === "pausehome").bare, false);
});

test("each row asks for the clip the original draws", () => {
    for (const row of WALL_SCREENS) {
        if (row.bare === false) continue;
        const want = DECODED[row.overlay].clip;
        if (want === null) {
            assert.equal(row.wallClip, undefined, `${row.name}: stgtrain's clip is read from the object`);
            continue;
        }
        assert.equal(row.wallClip, Number.parseInt(want, 16), `${row.name}: the wall clip`);
        assert.ok(row.session, `${row.name}: a position row needs the session that holds the picture calls`);
    }
});

test("the research document's member table names the same ten screens", () => {
    const start = doc.indexOf("## The ten");
    assert.notEqual(start, -1, "the document keeps its '## The ten' heading");
    const end = doc.indexOf("\n## ", start + 1);
    const section = doc.slice(start, end === -1 ? undefined : end);
    const named = [...section.matchAll(/^\| `(st[a-z0-9]+)` \|/gm)].map((m) => m[1]);
    assert.deepEqual(named.sort(), Object.keys(DECODED).sort(),
        "the document's table must list every wall site the asm census finds");
});
