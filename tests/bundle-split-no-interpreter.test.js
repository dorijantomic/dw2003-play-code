// The production build's OUTPUT must contain no PlayStation interpreter.
//
// This inspects the BUILT artefact (web/vendor/engine.js), not the source: an
// engine module could be clean in TypeScript and still pull the interpreter into
// the bundle through a transitive import. The check looks for the interpreter's
// classes as esbuild emits them (`var R3000 = class`, `var NativeStageRuntime =
// class`, `var StubWorld = class`), which a doc comment that merely names
// `engine/native/runtime.ts` cannot match.
//
// The negative control bundles the research entry (engine/native-entry.ts) the
// same way and asserts the SAME check reports the interpreter present, so a
// check that silently stopped matching would fail here instead of passing.
//
// See tests/execution-forbidden-audit.test.js for the route-by-route classes and
// web/native-runtime.js for the single dynamic import that keeps the interpreter
// out of the ordinary page.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { INTERPRETER_MARKERS, containsInterpreterSource, pageStaticGraph } from "../tools/execution_forbidden_audit.mjs";

const ROOT = process.cwd();
const PRODUCTION = "web/vendor/engine.js";
const RESEARCH = "web/vendor/engine-native.js";

test("the built production bundle contains no interpreter code", () => {
  const src = readFileSync(join(ROOT, PRODUCTION), "utf8");
  const hits = INTERPRETER_MARKERS.filter((re) => re.test(src)).map((re) => re.source);
  assert.deepEqual(hits, [],
    `${PRODUCTION} carries interpreter code (${hits.join(", ")}); the ordinary page must not be able to load a PlayStation CPU`);
  assert.equal(containsInterpreterSource(src), false);
});

test("the checker reports the interpreter present when it IS in a bundle (negative control)", async () => {
  // Bundle the research entry exactly as the build does, and prove the check
  // catches the interpreter there. If this ever returns false the production
  // assertion above is meaningless.
  const result = await build({
    entryPoints: [join(ROOT, "engine/native-entry.ts")],
    outdir: "/tmp/bundle-split-negative-control",
    bundle: true, write: false, metafile: true, format: "esm", logLevel: "silent",
  });
  const text = result.outputFiles?.[0]?.text ?? "";
  assert.ok(containsInterpreterSource(text),
    "the interpreter check did not flag a bundle built from engine/native-entry.ts; the check is blind");
  assert.ok(text.includes("NativeStageRuntime"), "the negative control bundle did not contain the runtime class at all");
});

test("the built research bundle exists and carries the interpreter", () => {
  assert.ok(existsSync(join(ROOT, RESEARCH)), `${RESEARCH} is missing; run npm run build:engine`);
  assert.equal(containsInterpreterSource(readFileSync(join(ROOT, RESEARCH), "utf8")), true,
    `${RESEARCH} does not carry the interpreter; research routes would break`);
});

test("the ordinary page's static graph never reaches the interpreter", async () => {
  const graph = await pageStaticGraph();
  assert.deepEqual(graph.interpreter, [], `the page statically reaches ${graph.interpreter.join(", ")}; it may only be a dynamic import`);
  assert.equal(graph.reachesInterpreter, false);
});

test("web/native-runtime.js is the only web importer, and it imports dynamically", () => {
  const src = readFileSync(join(ROOT, "web/native-runtime.js"), "utf8");
  assert.match(src, /import\(\s*["']\.\/vendor\/engine-native\.js["']\s*\)/,
    "web/native-runtime.js must reach the research bundle with a dynamic import()");
  assert.doesNotMatch(src, /from\s+["']\.\/vendor\/engine-native\.js["']/,
    "web/native-runtime.js must not statically import the research bundle");
});
