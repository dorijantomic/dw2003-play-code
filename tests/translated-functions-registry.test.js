// The translated-function registry (data/translated_functions.json) is the list the
// status page counts as "translated": each row names one ORIGINAL routine by its
// (module, address), the port that implements it and the oracle that checks it.
//
// Two rows for one original routine — the same (module, address) under two labels,
// or one label at two addresses inside a module — double-count the translated total
// and hide a mis-registration (the 2026-10-06 `0x8008d3b4` conflict: the reaction
// machine and the item-use port both claimed it). This pins the registry
// collision-free and every row pointing at something real.
//
// The key is PER MODULE, not global. The stage overlays are all linked into one
// address window — pro/cnty_sel, pro/stfgtrep, pro/stgtrain, pro/stgdglab,
// pro/fightstg and the rest all place code across 0x80082xxx-0x8009xxxx and are
// swapped in and out of that window — so the SAME absolute address is a different
// routine in each overlay. Only within one module must address and name be a
// bijection.
//
// Run: node --test tests/translated-functions-registry.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const registry = JSON.parse(
  readFileSync(resolve(ROOT, "data/translated_functions.json"), "utf8"),
);
const inventory = JSON.parse(
  readFileSync(resolve(ROOT, "recovered/ddw3/function-inventory.json"), "utf8"),
);
/** Every overlay / exe module the recovered inventory knows, as of this commit. */
const MODULES = new Set(inventory.modules.map((m) => m.id));

function push(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

/** Every collision in `rows`: one module+address under two names, or one module+name at two addresses. */
export function collisions(rows) {
  const byAddress = new Map();
  const byName = new Map();
  for (const r of rows) {
    push(byAddress, `${r.module}|${String(r.address).toLowerCase()}`, r.name);
    push(byName, `${r.module}|${r.name}`, String(r.address).toLowerCase());
  }
  const out = [];
  for (const [key, names] of byAddress) {
    if (names.length > 1) out.push(`one address, ${names.length} names: ${key} -> ${names.join(", ")}`);
  }
  for (const [key, addrs] of byName) {
    if (addrs.length > 1) out.push(`one name, ${addrs.length} addresses: ${key} -> ${addrs.join(", ")}`);
  }
  return out;
}

test("the registry maps every (module, address) and (module, name) to exactly one row", () => {
  const dupes = collisions(registry);
  assert.deepEqual(dupes, [],
    `registry collisions (one original routine must have one row):\n${dupes.join("\n")}`);
});

test("the collision check bites on a duplicate (mutation control)", () => {
  const row = registry[0];
  const dupAddress = [{ ...row }, { ...row, name: `${row.name}_copy` }];
  assert.ok(collisions(dupAddress).some((d) => d.startsWith("one address")),
    "two rows at one address must be reported");
  const dupName = [{ ...row }, { ...row, address: "0x80000000" }];
  assert.ok(collisions(dupName).some((d) => d.startsWith("one name")),
    "one label at two addresses must be reported");
  assert.deepEqual(collisions([{ ...row }]), [], "a single row is not a collision");
});

test("every registry row names a module that exists at HEAD", () => {
  const bad = registry
    .filter((r) => !MODULES.has(r.module))
    .map((r) => `${r.module} (${r.address} ${r.name})`);
  assert.deepEqual(bad, [],
    `registry rows name modules the recovered inventory does not carry:\n${bad.join("\n")}`);
});

test("every registry row names an oracle file that exists", () => {
  const bad = registry
    .filter((r) => typeof r.oracle !== "string" || !existsSync(resolve(ROOT, r.oracle)))
    .map((r) => `${r.module} ${r.address} ${r.name} -> ${r.oracle}`);
  assert.deepEqual(bad, [],
    `registry rows name oracle files that are not on disk:\n${bad.join("\n")}`);
});

test("every registry row names a port file that exists", () => {
  const bad = registry
    .filter((r) => typeof r.port === "string" && r.port.length > 0
      && !existsSync(resolve(ROOT, r.port.split("#")[0])))
    .map((r) => `${r.module} ${r.address} ${r.name} -> ${r.port}`);
  assert.deepEqual(bad, [],
    `registry rows name port files that are not on disk:\n${bad.join("\n")}`);
});
