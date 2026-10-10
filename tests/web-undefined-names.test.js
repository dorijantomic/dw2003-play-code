// Every name a browser module uses must be defined where it is used.
//
// A function at module level in web/battle.js once read `evolutionTrees`, which
// only exists inside createBattle. Nothing failed until a player opened the
// debug panel or the pause Digivolve page, and then the game crashed with
// "evolutionTrees is not defined". TypeScript's checker reports exactly these
// names (codes 2304 and 2552), so this test asks it about every web/*.js file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import ts from "typescript";

const UNDEFINED_NAME = new Set([2304, 2552]);

test("no browser module uses a name that is not defined in its scope", () => {
  const files = readdirSync("web").filter((f) => f.endsWith(".js")).map((f) => `web/${f}`);
  const program = ts.createProgram(files, {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  });
  const found = [];
  for (const file of files) {
    for (const d of program.getSemanticDiagnostics(program.getSourceFile(file))) {
      if (!UNDEFINED_NAME.has(d.code)) continue;
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      // A JSDoc line such as "@param opts { map, onClose }" is read as a type;
      // those names are documentation, not code.
      const text = d.file.text.split("\n")[line].trim();
      if (text.startsWith("*") || text.startsWith("/**")) continue;
      found.push(`${file}:${line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
  }
  assert.deepEqual(found, []);
});
