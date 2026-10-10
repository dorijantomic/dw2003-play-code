// The committed production bundle must export everything the page imports from it.
//
// WHY THIS EXISTS. web/vendor/engine.js is a COMMITTED build artefact (esbuild,
// `npm run build:engine`). The ordinary page statically links it, so a single
// imported name the bundle does not export is an ES-module LINK error: the whole
// app fails to boot — every screen, every fixture boot, the language screen included.
//
// On 2026-10-07 commit 26b0c747 ("Wire the four ported fight mechanisms onto the
// ordinary route") added `SLOW_MO_PUBLISH_AT, SLOW_MO_ACCUM_COST` (and battle.js /
// battlehud-translated.js added six more) to the browser IMPORTS but did not rebuild
// the committed bundle. The linker names only the FIRST missing export
// ('SLOW_MO_ACCUM_COST'), so tools/verify_deep_playthrough.mjs reported "world did not
// start" on every stage and the ordinary walk failed too. The commit's own test
// (tests/fight-mechanism-ports-wired.test.js) checked the IMPORT edge and the engine
// MODULE's export, but never that the bundled artefact provides the name — so npm
// test stayed green over a clean checkout that could not boot.
//
// This test closes that gap: it reads the committed bundle's export list and asserts
// every name imported from ./vendor/engine.js by any web/**/*.js is present. Fix by
// running `npm run build:engine` and committing web/vendor/engine.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const BUNDLE = join(WEB, "vendor", "engine.js");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (e === "node_modules" || e === "assets" || e === "vendor") continue; walk(p, out); }
    else if (e.endsWith(".js") || e.endsWith(".mjs")) out.push(p);
  }
  return out;
}

// Remove `//` and `/* */` comments without touching string-literal contents, so a
// commented-out import block is not read as a live import.
function stripComments(src) {
  let out = "", i = 0; const n = src.length; let state = "code";
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { state = "block"; i += 2; continue; }
      if (c === "'" || c === '"' || c === "`") { state = c === "'" ? "sq" : c === '"' ? "dq" : "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line") { if (c === "\n") { state = "code"; out += c; } i++; continue; }
    if (state === "block") { if (c === "*" && d === "/") { state = "code"; i += 2; out += " "; continue; } i++; continue; }
    if (c === "\\") { out += c + (d ?? ""); i += 2; continue; }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) { state = "code"; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/** The names the committed bundle exports, from its esbuild `export { ... }` block. */
export function bundleExports() {
  const src = readFileSync(BUNDLE, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*;?/g)) {
    for (let part of m[1].split(",")) {
      part = part.trim();
      if (!part) continue;
      const asMatch = part.split(/\s+as\s+/);
      names.add((asMatch[1] ?? asMatch[0]).trim());
    }
  }
  return names;
}

/** Every `import { a, b as c } from "<...>vendor/engine.js"` across web/**. */
export function bundleImports() {
  const re = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*vendor\/engine\.js)["']/g;
  const found = [];
  for (const file of walk(WEB)) {
    const src = stripComments(readFileSync(file, "utf8"));
    for (const m of src.matchAll(re)) {
      for (let part of m[1].split(",")) {
        part = part.trim();
        if (!part || part.startsWith("type ")) continue;
        const name = part.split(/\s+as\s+/)[0].trim();
        if (name) found.push({ file: relative(WEB, file), name });
      }
    }
  }
  return found;
}

test("the committed engine bundle is not stale: it exports every name web/ imports from it", () => {
  const exported = bundleExports();
  assert.ok(exported.size > 100, `bundle export list looks unreadable (${exported.size} names)`);
  const missing = bundleImports().filter(({ name }) => !exported.has(name));
  const pretty = missing.map((m) => `${m.name} (imported by web/${m.file})`).join(", ");
  assert.equal(missing.length, 0,
    `web/ imports ${missing.length} name(s) the committed web/vendor/engine.js does not export — ` +
    `run \`npm run build:engine\` and commit the bundle: ${pretty}`);
});
