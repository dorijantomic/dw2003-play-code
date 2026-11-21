// erase-types.mjs: delete TypeScript-only syntax from .ts text, leaving the plain
// JavaScript that was there before the types were added.
//
//   import { eraseTypes } from "../tools/rewrite/erase-types.mjs";
//   eraseTypes(tsText)            // -> JS text
//   eraseTypes(tsText, "a.ts")    // file name, only used in messages
//
// Node's module.stripTypeScriptTypes(tsText, { mode: "strip" }) blanks type syntax to
// spaces instead of removing it, so positions and line numbers survive: at every index i
// the stripped text has a space where the .ts had a type character. That is the whole
// parser this file needs — the work left is turning "type -> spaces" into "type -> gone"
// without gluing the neighbours together:
//
//   1. changed[i] = text[i] !== stripped[i] marks type characters. A changed position whose
//      stripped character is NOT whitespace (node inserts ";" now and then, to keep ASI
//      safe) is kept as that character, never deleted.
//   2. Runs of deleted characters on a line merge across the spaces/tabs between them (the
//      space inside "as Foo" is a type space too). A run takes the spaces/tabs just before
//      it with it ("{} as B" -> "{}"), but it never eats the line's indentation, and it
//      leaves a "<" alone when that "<" is not attached to a name ("= <T,>(x)" -> "= (x)",
//      "async <T,>(" -> "async("). The space after a run goes too when it was only there to
//      separate the type ("onKey(this: Window, e)" -> "onKey(e)"), unless that would glue
//      two word characters. Same story the other way round: a single space is put back when
//      deleting the run would glue two word/number characters.
//   3. A line that had code in the .ts but is only whitespace in the stripped text (import
//      type, interface / type blocks, declare fields, overload signatures) goes away with
//      its newline, so no blank line is left behind.
//   4. A run that reaches the end of its line, followed (after any deleted lines) by a line
//      whose first run starts at the first code character of the line, means one type
//      carried over the line break: the break goes too, so "cb: (\n  err: T,\n) => void,"
//      becomes "cb," and not "cb\n,". This is what keeps multi-line annotations exact.
//
// Two constructs node's stripper will not touch itself, both handled here:
//   - "<T>expr" angle-bracket assertions make it throw, so they are blanked first and the
//     result is stripped again (the blanks are then deleted like any other type text);
//   - "import { type A } from x" leaves an empty import statement behind, which would load
//     a module the JS never asked for, so an all-type specifier list is dropped with its
//     statement.
//
// Whitespace is not always bit-identical to the original JS (a deleted annotation takes its
// own spacing with it) but every kept character and the token order is; the token-level
// proof against node's strip lives in tests/erase-types.test.js.
//
// On input node's stripper still rejects after the angle-bracket pass (enums, namespaces,
// parameter properties — none of which the rewritten code has) the text comes back
// unchanged instead of throwing, so one odd file cannot take a whole test run down.
import { stripTypeScriptTypes } from "node:module";

const WORD = /[A-Za-z0-9_$]/;
const WS = /\s/;
const BLANK_REST = /^[ \t\r]*$/;
const INDENT = /[ \t]/;

function isAttachedBefore(text, pos) {
  // is the "<" at pos attached to something that can be a callee / a name?
  let k = pos - 1;
  while (k >= 0 && INDENT.test(text[k])) k--;
  return k >= 0 && (WORD.test(text[k]) || text[k] === ")" || text[k] === "]");
}

function linesOf(text) {
  const n = text.length;
  const lines = [];
  let p = 0;
  for (;;) {
    const nl = text.indexOf("\n", p);
    const end = nl === -1 ? n : nl;
    let contentStart = p;
    while (contentStart < end && INDENT.test(text[contentStart])) contentStart++;
    lines.push({
      start: p,
      end,
      next: nl === -1 ? n : nl + 1,
      contentStart,
      hasNewline: nl !== -1,
      spans: [],
      whole: false,
    });
    if (nl === -1) break;
    p = nl + 1;
  }
  return lines;
}

// "<T>expr" -> same length, all blanks, so the strip below can parse it and the blanks are
// then deleted as type text. Only "<" in a position where an expression may start is
// considered, and the type between the angle brackets has to look like a type.
function blankAngleCasts(text) {
  let out = null;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "<") continue;
    let k = i - 1;
    while (k >= 0 && INDENT.test(text[k])) k--;
    const before = k >= 0 ? text[k] : "";
    if (before && (WORD.test(before) || before === ")" || before === "]" || before === ">")) continue;
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "\n" || c === ";" || c === "{" || c === "}" || c === "=") break;
      if (c === "<") depth++;
      else if (c === ">") {
        depth--;
        if (depth === 0) break;
      } else if (!/[A-Za-z0-9_$.\[\]|&,\s]/.test(c)) break;
    }
    if (depth !== 0 || j >= text.length || text[j] !== ">") continue;
    const after = text[j + 1] || "";
    if (!after || !/[A-Za-z_$([{"'0-9!~-]/.test(after)) continue;
    const inner = text.slice(i + 1, j);
    if (!/^[A-Za-z_$][A-Za-z0-9_$.]*(\[\])?(\s*<[^<>]*>)?$/.test(inner.trim())) continue;
    if (out === null) out = text.split("");
    for (let q = i; q <= j; q++) out[q] = " ";
    i = j;
  }
  return out === null ? text : out.join("");
}

function stripOrNull(text) {
  try {
    return stripTypeScriptTypes(text, { mode: "strip" });
  } catch {
    return null;
  }
}

function erase(text, fileName, stats) {
  let stripped = stripOrNull(text);
  if (stripped === null) {
    const blanked = blankAngleCasts(text);
    if (blanked !== text) stripped = stripOrNull(blanked);
  }
  if (stripped === null) {
    stats.rejected = `${fileName}: node strip refused the file; returned unchanged`;
    return text;
  }
  if (stripped.length !== text.length) {
    stats.rejected = `${fileName}: node strip changed the text length; returned unchanged`;
    return text;
  }
  if (stripped === text) return text;

  const n = text.length;
  // 0 = keep the .ts character, 1 = type, delete it, 2 = take the stripped character
  const kind = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = text[i];
    const b = stripped[i];
    if (a === b) continue;
    if (WS.test(b)) kind[i] = 1;
    else {
      kind[i] = 2;
      stats.substituted.push(b);
    }
  }

  const lines = linesOf(text);

  // 3. lines that were only types go away with their newline
  for (const line of lines) {
    let code = false;
    let codeInStripped = false;
    for (let i = line.start; i < line.end; i++) {
      if (!WS.test(text[i])) code = true;
      if (!WS.test(stripped[i])) codeInStripped = true;
      if (code && codeInStripped) break;
    }
    if (code && !codeInStripped) {
      line.whole = true;
      for (let i = line.start; i < line.next; i++) kind[i] = 1;
    }
  }

  // an import / export whose specifier list was entirely types leaves "import { } from x",
  // which would load a module the original JS never loaded: drop the statement
  for (const line of lines) {
    const m = /^[ \t]*(?:import|export)[ \t]*\{/.exec(text.slice(line.start, line.end));
    if (!m) continue;
    const open = line.start + m[0].length - 1;
    const close = text.indexOf("}", open);
    if (close === -1 || close >= line.end) continue;
    let allType = true;
    let any = false;
    for (let i = open + 1; i < close; i++) {
      if (WS.test(text[i])) continue;
      any = true;
      if (kind[i] !== 1) { allType = false; break; }
    }
    if (!allType || !any) continue;
    const tail = text.slice(close + 1, line.end);
    if (!/^[ \t]*from[ \t]*"[^"]*"[ \t]*;[ \t]*\r?$/.test(tail)) continue;
    line.whole = true;
    for (let i = line.start; i < line.next; i++) kind[i] = 1;
  }

  // 2. runs of deleted characters, merged across the spaces between them
  for (const line of lines) {
    if (line.whole) continue;
    const { start, end, contentStart } = line;
    let i = start;
    while (i < end) {
      if (kind[i] !== 1) { i++; continue; }
      const gs = i;
      let ge = i + 1;
      i++;
      while (i < end) {
        if (kind[i] === 1) { ge = i + 1; i++; }
        else if (kind[i] === 0 && INDENT.test(text[i])) i++;
        else break;
      }
      let s = gs;
      if (text[gs] !== "<" || isAttachedBefore(text, gs)) {
        while (s > contentStart && INDENT.test(text[s - 1])) s--;
        // "{ type A }" keeps the space after the brace; an opener owns its spacing
        if (s < gs && s > 0 && "([{".includes(text[s - 1])) s = gs;
      }
      line.spans.push({ s, e: ge });
    }
  }

  const prevKept = (pos) => {
    for (let k = pos - 1; k >= 0; k--) if (kind[k] !== 1) return kind[k] === 2 ? stripped[k] : text[k];
    return "";
  };
  const nextKept = (pos) => {
    for (let k = pos; k < n; k++) if (kind[k] !== 1) return kind[k] === 2 ? stripped[k] : text[k];
    return "";
  };

  const inserts = new Set();
  for (const line of lines) {
    if (line.whole) continue;
    const { end } = line;
    const last = line.spans.length - 1;
    for (let k = 0; k <= last; k++) {
      const sp = line.spans[k];
      // blanks after the last run of a line are type spacing too
      if (k === last && BLANK_REST.test(text.slice(sp.e, end))) sp.e = end;
      // so is the space after a run that began the line's code (a leading modifier) or that
      // ended a specifier / parameter list ("{ type A, b }" -> "{ b }", "f(this: W, e)" -> "f(e)")
      if (sp.e < end && INDENT.test(text[sp.e]) && (sp.s === line.contentStart || text[sp.e - 1] === ",")) {
        const p = prevKept(sp.s);
        const q = nextKept(sp.e + 1);
        if (!(p && q && WORD.test(p) && WORD.test(q))) sp.e += 1;
      }
      const p = prevKept(sp.s);
      if (p && WORD.test(p) && WORD.test(nextKept(sp.e))) inserts.add(sp.s);
    }
  }

  // 4. one type continued over a line break: take the break with it
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (line.whole || !line.spans.length || !line.hasNewline) continue;
    const lastSpan = line.spans[line.spans.length - 1];
    if (!BLANK_REST.test(text.slice(lastSpan.e, line.end))) continue;
    let lj = li + 1;
    while (lj < lines.length && lines[lj].whole) lj++;
    if (lj >= lines.length) continue;
    const target = lines[lj];
    if (!target.spans.length || target.spans[0].s !== target.contentStart) continue;
    target.spans[0].s = target.start; // its indentation is type continuation too
    lastSpan.e = line.next;
  }

  for (const line of lines) for (const sp of line.spans) for (let i = sp.s; i < sp.e; i++) kind[i] = 1;

  let out = "";
  for (let i = 0; i < n; i++) {
    if (inserts.has(i)) out += " ";
    if (kind[i] === 1) continue;
    out += kind[i] === 2 ? stripped[i] : text[i];
  }
  if (inserts.has(n)) out += " ";
  stats.deletedLines += lines.filter((l) => l.whole).length;
  return out;
}

export function eraseTypes(tsText, fileName = "x.ts") {
  return erase(String(tsText), fileName, { substituted: [], deletedLines: 0, rejected: null });
}

// Same thing plus what it had to work around — used by the report and the probes, not by
// the tests: how many characters node replaced with something that is not a space, how many
// whole lines went, and whether the file was refused.
export function eraseTypesReport(tsText, fileName = "x.ts") {
  const stats = { substituted: [], deletedLines: 0, rejected: null };
  const out = erase(String(tsText), fileName, stats);
  return { out, substituted: stats.substituted, deletedLines: stats.deletedLines, rejected: stats.rejected };
}

export default eraseTypes;
