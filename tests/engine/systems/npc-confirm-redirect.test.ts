// tests/engine/systems/npc-confirm-redirect.test.ts
// The confirm press's id-REDIRECT table and refuse ids (fieldstg F0x8008E2CC,
// pro/fieldstg.s file 0xb61c-0xb7a8). The table itself is re-read from the
// shipped overlay image here, byte for byte, so the generated constant cannot
// drift from the disc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  confirmRedirectId, confirmRedirectPairs, NPC_CONFIRM_REDIRECT_TABLE_RAM,
} from "../../../engine/dw3/npc-confirm-redirects.ts";
import {
  resolveConfirmTarget, confirmRefusesTarget, CONFIRM_REFUSED_IDS, talkCandidates,
} from "../../../engine/dw3/npc-manager.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

test("the table constant equals the bytes in the shipped overlay image", () => {
  const image = readFileSync(join(ROOT, "web/assets/native/fieldstg.bin"));
  const off = NPC_CONFIRM_REDIRECT_TABLE_RAM - 0x80082cb0; // the overlay load base
  const pairs: [number, number][] = [];
  for (let i = 0; i < 64; i++) {
    const id = image.readUInt16LE(off + i * 4);
    if (id === 0) break;
    pairs.push([id, image.readUInt16LE(off + i * 4 + 2)]);
  }
  assert.ok(pairs.length > 0, "the image carries the table");
  assert.deepEqual(confirmRedirectPairs(), pairs);
  // The fifteen shipped pairs, pinned literally: this is the whole table.
  assert.deepEqual(pairs, [
    [112, 32], [113, 36], [219, 20], [220, 206], [221, 41], [222, 40],
    [223, 42], [224, 25], [225, 51], [256, 52], [268, 267], [270, 157],
    [271, 158], [284, 75], [288, 12],
  ]);
});

test("confirmRedirectId resolves only the table's ids", () => {
  assert.equal(confirmRedirectId(112), 32);
  assert.equal(confirmRedirectId(270), 157);
  assert.equal(confirmRedirectId(288), 12);
  assert.equal(confirmRedirectId(32), null);   // a target is not itself a source
  assert.equal(confirmRedirectId(384), null);
  assert.equal(confirmRedirectId(null), null);
  assert.equal(confirmRedirectId(undefined), null);
});

test("the interact handler refuses npc ids 0x180-0x182 outright", () => {
  assert.deepEqual([...CONFIRM_REFUSED_IDS], [0x180, 0x181, 0x182]);
  assert.equal(confirmRefusesTarget(384), true);
  assert.equal(confirmRefusesTarget(385), true);
  assert.equal(confirmRefusesTarget(386), true);
  assert.equal(confirmRefusesTarget(383), false);
  assert.equal(confirmRefusesTarget(387), false);
  assert.equal(confirmRefusesTarget(null), false);
});

test("resolveConfirmTarget: refuse, redirect, pass-through, missing target", () => {
  const marker = { npc_id: 112, x: 1, y: 1 };
  const clerk = { npc_id: 32, x: 2, y: 2 };
  const other = { npc_id: 7, x: 3, y: 3 };
  const refused = { npc_id: 384, x: 4, y: 4 };
  // A redirect resolves to the cast member carrying the redirect id.
  assert.equal(resolveConfirmTarget([clerk, marker, other], marker), clerk);
  // The redirect target is found wherever it sits in the cast (registry order).
  assert.equal(resolveConfirmTarget([other, clerk], marker), clerk);
  // A refused id interacts with nothing.
  assert.equal(resolveConfirmTarget([clerk, refused], refused), null);
  // An id outside the table is its own target.
  assert.equal(resolveConfirmTarget([clerk, other], other), other);
  // A redirect whose target is not in the cast interacts with nothing — the disc
  // would call through a null (find_entity returned 0); it never falls back to
  // the marker, which has no dialogue record.
  assert.equal(resolveConfirmTarget([other], marker), null);
  // An object with no npc_id at all is untouched.
  const anon = { x: 0, y: 0 };
  assert.equal(resolveConfirmTarget([anon], anon), anon);
});

test("every shipped scene that carries a redirect source carries its target too", () => {
  const dir = join(ROOT, "web/assets/scenes");
  const sources = new Map(confirmRedirectPairs());
  let scenesWithSources = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const scene = JSON.parse(readFileSync(join(dir, file), "utf8")) as { npcs?: { npc_id?: number }[] };
    const ids = new Set((scene.npcs ?? []).map((n) => n.npc_id));
    const found = [...ids].filter((id) => id != null && sources.has(id));
    if (!found.length) continue;
    scenesWithSources++;
    for (const id of found) {
      assert.ok(ids.has(sources.get(id!)!), `${file}: npc ${id} redirects to ${sources.get(id!)}, which must exist in the same scene`);
    }
  }
  // The 2026-10-14 census: 28 scenes carry a source, each with its target present.
  assert.equal(scenesWithSources, 28);
});

test("talkCandidates keeps a redirect marker and still drops a dead marker", () => {
  const marker = { invisible: true, npc_id: 112 };            // redirects -> clerk
  const dead = { invisible: true, npc_id: 3000 };             // no redirect, no dialogue
  const searchPoint = { invisible: true, npc_id: 63, ptrB: 1 };
  const normal = { npc_id: 5 };
  assert.deepEqual(talkCandidates([marker, dead, searchPoint, normal]), [marker, searchPoint, normal]);
});
