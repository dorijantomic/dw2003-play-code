// Can a player actually be dealt each of the 170 opponent card folders?
//
// tools/deck_reachability_census.mjs solves it rather than sampling it: an NPC has to be
// placed, the launcher's own gate has to pass, and every EARLIER dialogue state of that
// NPC has to fail, because pickDialogueState takes the first match. Bank 0x72 (the
// party-Charisma ladder) is monotone and swept as one integer; every other flag is free,
// which makes the answer a ceiling — "could any playthrough reach this".
//
// This test pins the headline result so a change to the generated scene data, or to the
// selection rule, cannot quietly strand a folder again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const run = (...args) =>
  execFileSync("node", ["tools/deck_reachability_census.mjs", ...args], { encoding: "utf8" });

test("every folder but three can be reached by some playthrough", () => {
  const out = run();
  assert.match(out, /launcher states in the shipped scenes: 355/);
  assert.match(out, /reachable 167, blocked by an earlier dialogue state 0, no launcher anywhere 3/);
  // 142, 144 and 148 are the SECOND (bank-0x78, rematch) folders of three tamers.
  // Nothing in the shipped scene data writes their launcher flag, so they are dead data,
  // not progression-gated. 144 and 148 are byte-identical to the first folder of the same
  // tamer; 142 holds builds a player never meets.
  // 158 was the fourth of these until the scene generator stopped dropping an ordered
  // dialogue line whose text it could not resolve: s951 npc 403 state 2 carries the
  // bank-0x78 write for folder 158, so the folder is now dealt (see
  // tests/scene-rebuild-reproduces.test.js, which pins that state in the shipped data).
  assert.match(out, /no launcher: 142, 144, 148/);
  // "blocked by an earlier dialogue state 0" is the load-bearing zero: no folder is
  // permanently shadowed by a state that always wins.
  assert.doesNotMatch(out, /unreachable despite a launcher/);
});

test("a brand-new save can be dealt only a handful of them", () => {
  const out = run("--fresh");
  const m = out.match(/reachable (\d+), waiting on story flags this save has not set (\d+)/);
  assert.ok(m, "the fresh-save census must report its split");
  const [, reachable, waiting] = m.map(Number);
  assert.ok(reachable > 0 && reachable < 30, `a fresh save should see few folders, saw ${reachable}`);
  assert.equal(reachable + waiting, 167, "every folder with a launcher is in one bucket or the other");
});

test("the older gate-only measurement is reproducible, and it overcounts", () => {
  // The card-folder-editor document published 53 -> 98 of 170 from a census that asked
  // only whether the launcher's own gate passes. Kept reproducible so the correction is
  // visible rather than a bare contradiction. It now reproduces the published 98 exactly:
  // folder 158's launcher (s951 npc 403) is back in the scene data.
  const gateOnly = run("--gate-only");
  assert.match(gateOnly, /reachable 98,/);
  const fresh = run("--fresh");
  const strict = Number(fresh.match(/reachable (\d+),/)[1]);
  assert.ok(strict < 98, "applying the first-match rule must shrink the count, not grow it");
});
