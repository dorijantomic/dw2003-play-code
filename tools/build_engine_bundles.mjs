// Build the browser engine bundles.
//
// Two outputs, and the SPLIT between them is the point:
//   - web/vendor/engine.js         production. Built from engine/index.ts. The
//                                  ordinary page loads this eagerly; it must
//                                  contain NO PlayStation interpreter.
//   - web/vendor/engine-native.js  research-only. Built from engine/native-entry.ts
//                                  (the interpreter + the mixed-mode bridge).
//                                  Fetched ONLY through a dynamic import
//                                  (web/native-runtime.js), so the ordinary page
//                                  never statically links it.
//
// Keeping the two separate is what makes the production artefact safe: a test
// (tests/bundle-split-no-interpreter.test.js) inspects the built engine.js for
// interpreter classes and fails if one ever reappears. Both outputs are
// committed; run this with `npm run build:engine`.
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const bundles = [
  { entry: "engine/index.ts", outfile: "web/vendor/engine.js" },
  { entry: "engine/native-entry.ts", outfile: "web/vendor/engine-native.js" },
];

for (const { entry, outfile } of bundles) {
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile: join(ROOT, outfile),
    bundle: true,
    format: "esm",
    logLevel: "info",
  });
  console.log(`built ${outfile} <- ${entry}`);
}
