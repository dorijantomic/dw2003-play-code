// readSource(path): the source text of a web/ module for tests that assert on it.
// 'web/x.js' (also an absolute path or a file: URL) returns web/x.ts followed by every
// .ts file under the folder web/x/ (where the split parts of x live), if they exist.
// Anything that is not web game code (assets, lib3d, vendor, json, ...) is read as is.
//
// The .ts text is put through eraseTypes first: the code was JavaScript before it was given
// types, and the tests were written against that JavaScript (function bodies, call order,
// literal text). Erasing the types here means a test never has to know whether a parameter
// grew a ": number" or a file grew an interface block.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { eraseTypes } from "../../tools/rewrite/erase-types.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKIP = new Set(["lib3d", "vendor", "node_modules"]);

function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith("assets")) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...tsFiles(p));
    else if (/\.m?ts$/.test(name) && !/\.d\.m?ts$/.test(name)) out.push(p);
  }
  return out;
}

export function readSource(path, encoding = "utf8") {
  let abs = path instanceof URL ? fileURLToPath(path) : String(path);
  if (abs.startsWith("file:")) abs = fileURLToPath(abs);
  abs = resolve(ROOT, abs);
  const rel = relative(ROOT, abs).split(sep);
  const m = /^(.*)\.(m?)js$/.exec(abs);
  if (rel[0] !== "web" || rel.length < 2 || SKIP.has(rel[1]) || rel[1].startsWith("assets") || !m) {
    return readFileSync(abs, encoding);
  }
  const ts = `${m[1]}.${m[2]}ts`;
  if (!existsSync(ts)) return readFileSync(abs, encoding);
  // types out: what the tests knew as JavaScript
  const erased = (file) => eraseTypes(readFileSync(file, "utf8"), file);
  const parts = [erased(ts)];
  const dir = m[1];
  if (existsSync(dir) && lstatSync(dir).isDirectory()) {
    for (const f of tsFiles(dir)) parts.push(erased(f));
  }
  return parts.join("\n");
}
