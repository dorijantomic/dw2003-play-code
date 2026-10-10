#!/usr/bin/env node
// tools/extract_battle_action_table.mjs
//
// Extractor / verifier for the secondary battle-action sequencer's two 24-entry
// tables in `pro/wfightmn`:
//   - the ACTION-ARM TABLE   at file 0x5010..0x506c (RAM 0x800a7418..0x800a9c10);
//   - the ACTION-OPCODE TABLE at file 0x008c..0x00e8 (RAM 0x800a9e08..0x800a9fac),
//     whose opcode is the `li $a1, N` in the delay slot of the thunk's
//     `j 0x800a9fd4`.
//
// Usage:
//   node tools/extract_battle_action_table.mjs            # print the table JSON
//   node tools/extract_battle_action_table.mjs --check    # compare against
//                                                         # engine/dw3/battle-action-sequencer.ts
//
// Source: ~/ddw3/asm/dw2003/pro/wfightmn.s (read-only). It is a `.word` dump —
// there are no function labels — so the tables are read by file offset.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ASM = join(homedir(), "ddw3", "asm", "dw2003", "pro", "wfightmn.s");
const BASE = 0x800a5de0;

const text = readFileSync(ASM, "utf8").split("\n");

/** offset -> { word, mnemonic } for every `.L0x0000XXXX:` assembly line. */
const byOffset = new Map();
for (const line of text) {
  const m = /^\.L0x([0-9a-f]{8}):\s+(.*?)\s*(?:#|$)/.exec(line);
  if (!m) continue;
  const off = Number.parseInt(m[1], 16);
  const rest = m[2].trim();
  const wordMatch = /^\.word\s+(0x[0-9a-f]+)/i.exec(rest);
  byOffset.set(off, {
    mnemonic: wordMatch ? "" : rest,
    word: wordMatch ? Number.parseInt(wordMatch[1], 16) : null,
  });
}

function wordAt(off) {
  const row = byOffset.get(off);
  if (!row || row.word === null) throw new Error(`no .word at file 0x${off.toString(16)}`);
  return row.word >>> 0;
}

const arms = [];
for (let i = 0; i < 24; i++) arms.push(wordAt(0x5010 + i * 4));

const thunks = [];
const opcodes = [];
for (let i = 0; i < 24; i++) {
  const thunk = wordAt(0x08c + i * 4);
  thunks.push(thunk);
  if (i === 2) {
    // subState 3 is the one non-thunk: it reads the workspace mode and always
    // hands opcode 2.
    opcodes.push(2);
    continue;
  }
  const delayOff = thunk - BASE + 0x0c;
  const row = byOffset.get(delayOff);
  const m = row && /^li\s+\$a1,\s*(0x[0-9a-f]+)/i.exec(row.mnemonic);
  if (!m) throw new Error(`no li $a1 at file 0x${delayOff.toString(16)} for thunk ${thunk.toString(16)}`);
  opcodes.push(Number.parseInt(m[1], 16));
}

const table = {
  base: BASE,
  armTable: arms.map((address, i) => ({ phase: i + 3, address })),
  opcodeTable: thunks.map((thunk, i) => ({ subState: i + 1, thunk, opcode: opcodes[i] })),
};

if (process.argv.includes("--check")) {
  const mod = await import("../engine/dw3/battle-action-sequencer.ts");
  const failure = [];
  for (const row of table.armTable) {
    const arm = mod.waActionArmForPhase(row.phase);
    if (!arm || arm.address !== row.address) failure.push(`arm phase ${row.phase}`);
  }
  for (const row of table.opcodeTable) {
    const op = mod.waActionOpcodeForSubState(row.subState);
    if (!op || op.thunk !== row.thunk || op.opcode !== row.opcode) failure.push(`opcode subState ${row.subState}`);
  }
  if (failure.length) {
    console.error(`battle action table drifted: ${failure.join(", ")}`);
    process.exit(1);
  }
  console.log(`battle action table matches ${ASM} (24 arms, 24 opcodes)`);
} else {
  console.log(JSON.stringify(table, null, 1));
}
