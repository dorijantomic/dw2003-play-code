// The PLAYER's clip → sprite-pack rule — CENSUS + behaviour.
//
// One rule, five packs. FIELDSTG's per-frame clip resolver F0x8008F9C0
// (fieldstg.s:13131-13176) rewrites the player entity's animation-directory
// handle `+0x9c` from the CLIP ID alone, on every frame the clip changes, and
// only for the entity whose character id is 2. Nothing swaps the handle anywhere
// else: there is no repoint-and-restore pair, and the fishing and ladder cases
// are not special — they are two entries of the same range table.
//
// This file exists because the walker's answer used to be three hard-coded pack
// names (POSE_SPRITE / "p002plyl" / KICK_POSE_SPRITE) and no rule at all. A
// per-clip special case outside a table cannot answer a clip nobody has heard
// of yet, which is exactly what the fourth arm (0x16..0x19) was.
//
// The CENSUS is the point: the code's member list must EQUAL the decoded list,
// so a pack that exists in the original but not in the walker fails here rather
// than showing the wrong sprite in a slope tile.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PLAYER_CLIP_PACK_ARMS, PLAYER_CLIP_PACKS,
  PLAYER_PACK_PLAY, PLAYER_PACK_KICK, PLAYER_PACK_FISHING,
  PLAYER_PACK_SLOPE, PLAYER_PACK_LADDER,
  playerPackForClip, playerPackArmForClip, playerPackHandleForClip,
} from "../engine/systems/player-clip-packs.ts";
import {
  POSE_SPRITE, POSE_CAST_CLIP, POSE_THROW_CLIP, POSE_WAIT_CLIP,
  POSE_RESULT_CLIP, POSE_RECOVER_CLIP,
} from "../engine/systems/fishing.ts";
import { KICK_POSE_SPRITE, KICK_POSE_CLIP } from "../engine/systems/tree-kick.ts";
import { SLOPE_CLIP, SLOPE_SPRITE } from "../engine/systems/step-actor-actions.ts";

const manifest = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
const npcs = new Map(manifest.npcs.map((n) => [n.id, n]));

// ── The decoded table, transcribed from the assembly ────────────────────────
// The six arms of the chain at fieldstg.s:13131-13172, each with the constant
// its `lui`/delay-slot `ori` pair builds and the pack that constant names. The
// high half is the disc LBA (~/ddw3/rust/dw2003_exe_data/src/lba.rs) and the low
// half is that pack's own clip-directory bin.
const DECODED_ARMS = [
    { lo: -0x80000000, hi: 7, handle: 0x01870070, pack: "p002play", dirBin: 112 },
    { lo: 8, hi: 8, handle: 0x03cb001e, pack: "p002plyk", dirBin: 30 },
    { lo: 9, hi: 0x15, handle: 0x03ca0064, pack: "p002plyf", dirBin: 100 },
    { lo: 0x16, hi: 0x19, handle: 0x03c9000b, pack: "p002plyd", dirBin: 11 },
    { lo: 0x1a, hi: 0x24, handle: 0x03cc0017, pack: "p002plyl", dirBin: 23 },
    { lo: 0x25, hi: 0x7fffffff, handle: 0x03ca0064, pack: "p002plyf", dirBin: 100 },
];

test("the arm table is exactly the six the resolver tests, in order", () => {
    assert.equal(PLAYER_CLIP_PACK_ARMS.length, DECODED_ARMS.length,
        "the code's arm list must equal the decoded list — a pack added or dropped");
    DECODED_ARMS.forEach((want, i) => {
        const got = PLAYER_CLIP_PACK_ARMS[i];
        assert.equal(got.lo, want.lo, `arm ${i} (${want.pack}) lower bound`);
        assert.equal(got.hi, want.hi, `arm ${i} (${want.pack}) upper bound`);
        assert.equal(got.handle, want.handle,
            `arm ${i} (${want.pack}) constant 0x${want.handle.toString(16)}`);
        assert.equal(got.pack, want.pack, `arm ${i} pack name`);
        assert.equal(got.dirBin, want.dirBin, `arm ${i} clip-directory bin`);
    });
});

test("the arms tile every clip id with no gap and no overlap", () => {
    // Boundary-first: each arm's first and last clip, and both sides of each
    // boundary, so an off-by-one in a bound fails even where coverage holds.
    for (const arm of DECODED_ARMS) {
        assert.equal(playerPackForClip(arm.lo), arm.pack, `first clip of ${arm.pack}'s range`);
        assert.equal(playerPackForClip(arm.hi), arm.pack, `last clip of ${arm.pack}'s range`);
    }
    for (let i = 1; i < DECODED_ARMS.length; i++) {
        const prev = DECODED_ARMS[i - 1];
        const cur = DECODED_ARMS[i];
        assert.equal(cur.lo, prev.hi + 1,
            `arm ${i} starts one past arm ${i - 1} ends`);
        assert.notEqual(playerPackForClip(prev.hi), playerPackForClip(cur.lo),
            `clips ${prev.hi} and ${cur.lo} must not resolve to the same pack`);
    }
    // Sweep the whole 16-bit clip space so a stray gap cannot hide.
    for (let c = 0; c <= 0xffff; c++) {
        const arm = DECODED_ARMS.find((a) => c >= a.lo && c <= a.hi);
        assert.ok(arm, `clip ${c} falls in no decoded arm`);
        assert.equal(playerPackForClip(c), arm.pack, `clip ${c}`);
    }
});

test("each arm's constant low half is that pack's own clip-directory bin", () => {
    for (const arm of PLAYER_CLIP_PACK_ARMS) {
        assert.equal(arm.handle & 0xffff, arm.dirBin,
            `${arm.pack}: the constant's low half must be its clip-directory bin`);
        assert.equal(arm.handle >>> 16, arm.lba,
            `${arm.pack}: the constant's high half must be its disc LBA`);
    }
});

test("the two packs the fishing and ladder packs hang off are the decoded ones", () => {
    // The two paths this whole rule exists to close.
    assert.equal(playerPackForClip(0x11), PLAYER_PACK_FISHING,
        "clip 0x11 for the player resolves through P002PLYF");
    assert.equal(playerPackHandleForClip(0x11), 0x03ca0064,
        "clip 0x11 stores 0x03ca0064 (LBA 970 = P002PLYF, dir bin 100)");
    assert.equal(playerPackForClip(26), PLAYER_PACK_LADDER,
        "clip 26 for the player resolves through P002PLYL");
    assert.equal(playerPackHandleForClip(26), 0x03cc0017,
        "clip 26 stores 0x03cc0017 (LBA 972 = P002PLYL, dir bin 23)");
    // Every clip the ladder and the fishing modes latch, on its own arm.
    for (const c of [0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20])
        assert.equal(playerPackForClip(c), PLAYER_PACK_LADDER, `ladder clip ${c}`);
    for (const c of [0x11, 0x12, 0x13, 0x14, 0x15])
        assert.equal(playerPackForClip(c), PLAYER_PACK_FISHING, `fishing clip ${c}`);
});

test("the player's five packs are all built, with the clips their arm promises", () => {
    // Every pack the rule can name must exist AND define every clip its range
    // covers — otherwise a clip in range falls through to the wrong sheet.
    const EXPECTED = {
        p002play: [1, 4, 5, 6, 7],
        p002plyk: [8],
        p002plyf: [0x11, 0x12, 0x13, 0x14, 0x15, 0x3c],
        p002plyd: [0x16, 0x17, 0x18, 0x19],
        p002plyl: [0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20],
    };
    for (const pack of PLAYER_CLIP_PACKS) {
        const rec = npcs.get(pack);
        assert.ok(rec, `${pack} is named by the clip rule but is not in the manifest`);
        const have = Object.keys(rec.clips ?? {}).map(Number).sort((a, b) => a - b);
        assert.deepEqual(have, EXPECTED[pack],
            `${pack}'s built clip ids must be exactly its own directory's`);
        // Every clip must carry all five authored directions, or a facing draws
        // from the "no match" fallback instead of the clip's frames.
        for (const c of EXPECTED[pack]) {
            const dirs = Object.keys(rec.clips[String(c)] ?? {});
            assert.equal(dirs.length, 5, `${pack} clip ${c} has ${dirs.length} directions`);
        }
    }
});

test("no mode names its own pack — each one reads the clip rule", () => {
    // The four modes that latched a clip. If any of these went back to spelling
    // its pack out, the table would stop being the mechanism.
    assert.equal(POSE_SPRITE, playerPackForClip(POSE_CAST_CLIP));
    assert.equal(KICK_POSE_SPRITE, playerPackForClip(KICK_POSE_CLIP));
    assert.equal(SLOPE_SPRITE, playerPackForClip(SLOPE_CLIP.step));
    // And every clip a mode latches lands on that mode's own pack, which is the
    // property that lets the draw path ask the table instead of asking the mode.
    for (const c of [POSE_CAST_CLIP, POSE_THROW_CLIP, POSE_WAIT_CLIP,
        POSE_RESULT_CLIP, POSE_RECOVER_CLIP])
        assert.equal(playerPackForClip(c), POSE_SPRITE, `fishing clip ${c}`);
    for (const c of Object.values(SLOPE_CLIP))
        assert.equal(playerPackForClip(c), SLOPE_SPRITE, `slope clip ${c}`);
});

test("the walker names no player pack anywhere outside the rule", () => {
    // Guards the shape of the fix: the pack names may appear in the rule and in
    // comments, but the render path must reach them through the table. Any new
    // hard-coded pack in game.js is a special case the table should replace.
    const src = readFileSync("web/game.js", "utf8");
    for (const pack of PLAYER_CLIP_PACKS) {
        const live = src.split("\n").filter((l) => l.includes(`"${pack}"`)
            && !l.trimStart().startsWith("//") && !l.includes("*"));
        assert.deepEqual(live, [], `${pack} is named literally in web/game.js:\n${live.join("\n")}`);
    }
});

test("the draw path asks the rule for the pack, not the mode", () => {
    const src = readFileSync("web/game.js", "utf8");
    assert.match(src, /playerPackForClip\(latched\.clip\)/,
        "the player's draw path must resolve its pack from the latched clip");
    assert.match(src, /PLAYER_CLIP_PACKS/,
        "the preloaded-pack list must come from the rule, not a second hand list");
});

test("playerPackArmForClip returns the arm the constant came from", () => {
    for (const arm of PLAYER_CLIP_PACK_ARMS) {
        const got = playerPackArmForClip(arm.lo);
        assert.equal(got.handle, arm.handle, `arm at clip ${arm.lo}`);
    }
    // The fall-through arm: no test in the chain covers 37+, so those clips land
    // on P002PLYF's pair — the same constant the 9..21 arm stores.
    assert.equal(playerPackArmForClip(0x25).handle, 0x03ca0064);
    assert.equal(playerPackArmForClip(0xffff).handle, 0x03ca0064);
});

test("the clip is compared signed, as the resolver's slti does", () => {
    // +0xa0 is read with `lw` (file 0xcd2c) and every compare is `slti`, so a
    // negative clip takes the clip < 8 arm (0x01870070), not the fall-through.
    assert.equal(playerPackArmForClip(-1).handle, 0x01870070);
    assert.equal(playerPackArmForClip(0xffffffff).handle, 0x01870070);
    assert.equal(playerPackArmForClip(0x7fffffff).handle, 0x03ca0064);
});