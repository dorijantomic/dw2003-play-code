// Every DW2 model the game loads must be one the DW2 add-on builds from the player's disc (tools/dw2/needed.json),
// or a player who did the add-on step still gets a hidden feature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOUNTS } from "../web/mount.js";

const needed = JSON.parse(readFileSync(new URL("../tools/dw2/needed.json", import.meta.url), "utf8")).models;
const stem = (p) => p.split("/").pop().replace(/\.gltf$/, "");

test("every mount model is built by the DW2 add-on", () => {
  for (const m of MOUNTS) {
    for (const p of [m.model, m.actor?.hurt?.model].filter(Boolean)) {
      assert.ok(p.startsWith("dw2models/"), `${m.id}: ${p} loads from web/dw2models/`);
      assert.ok(stem(p) in needed, `${m.id}: ${stem(p)} is in tools/dw2/needed.json`);
    }
  }
});
