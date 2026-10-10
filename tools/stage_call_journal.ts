// Ordered call journal for the native stage overlays.
//
// Boots a stage's original MIPS overlay in the browser interpreter, records
// every executed PC through the R3000 trace ring, and joins the PC sequence
// against the recovered function inventory. The result is what actually ran,
// in the order it ran, per frame and per story ordinal — the cheap replacement
// for per-address emulator breakpoints.
//
//   node tools/stage_call_journal.ts --stages s780 --beats 0,27
//   node tools/stage_call_journal.ts --stages all --out-json /tmp/opencode/journals.json
//   node tools/stage_call_journal.ts --stages all --write docs/generated/stage-call-journals.md
//
// The journal is a reading artifact by itself: it says which recovered function
// ran and when, not what it draws. Draw-call counts are recorded per frame so a
// later pass can name the visible output.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { NativeStageRuntime, OVERLAY_BASE } from "../engine/native/runtime.ts";
import type { StageManifestEntry } from "../engine/native/runtime.ts";
import type { NativeHost } from "../engine/native/stubs.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "web/assets/native");

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stagesArg = getArg("--stages") ?? "all";
const beatsArg = getArg("--beats") ?? "auto";
const frames = Number(getArg("--frames") ?? 180);
const outJson = getArg("--out-json");
const writeMd = getArg("--write");
const quiet = args.includes("--quiet");

const manifest: Record<string, StageManifestEntry> = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
// Optional research manifest: entry-only stages built by
// `build_native_overlays.py --entry-only` (their only native object is the
// story-event entry). Never loaded by the game; merged here for the journal.
try {
  Object.assign(manifest, JSON.parse(readFileSync(join(dir, "manifest_entry_only.json"), "utf8")));
} catch {
  /* no entry-only manifest built */
}
const exeTables = JSON.parse(readFileSync(join(dir, "exe_tables.json"), "utf8"));
const fieldstg = new Uint8Array(readFileSync(join(dir, "fieldstg.bin")));
const inventory = JSON.parse(readFileSync(join(root, "recovered/ddw3/function-inventory.json"), "utf8"));
const semantics = JSON.parse(readFileSync(join(root, "recovered/ddw3/semantics.json"), "utf8"));
const gates: Record<string, Record<string, { conds: number[][] }>> = JSON.parse(
  readFileSync(join(root, "web/assets/data/auto_event_gates.json"), "utf8"),
);
const progress = JSON.parse(readFileSync(join(root, "web/assets/data/progress_ordinal.json"), "utf8"));

interface FnStart {
  name: string;
  module: string;
}

interface Extent {
  start: number;
  end: number;
  name: string;
  module: string;
}

const starters: Record<string, Map<number, FnStart>> = {};
const extentsByStage: Record<string, Extent[]> = {};

function buildStarters(stage: string): Map<number, FnStart> {
  const cached = starters[stage];
  if (cached) return cached;
  const map = new Map<number, FnStart>();
  const extents: Extent[] = [];
  const overlayId = `pro/wstag${stage.replace(/^s/, "")}`;
  for (const module of inventory.modules) {
    if (module.id !== overlayId && module.id !== "pro/fieldstg") continue;
    for (const fn of [...module.functions, ...(module.pointer_candidates ?? [])]) {
      const addr = Number(fn.address ?? fn.target_address ?? 0) >>> 0;
      if (!addr) continue;
      const name = fn.semantic_name ?? fn.original_name ?? fn.id;
      map.set(addr, { name, module: module.id });
      const end = Number(fn.provisional_end_address ?? 0) >>> 0;
      if (end > addr) extents.push({ start: addr, end, name, module: module.id });
    }
  }
  // Curated annotations and family member names carry the addresses the
  // per-module function list missed (nested entries and family copies).
  for (const [key, fn] of Object.entries<any>(semantics.functions ?? {})) {
    const [module, addr] = key.split(":");
    if (module !== overlayId && module !== "pro/fieldstg") continue;
    const a = Number(addr?.replace?.(/^F0x/, "0x") ?? 0) >>> 0;
    const existing = map.get(a);
    if (a && (!existing || /^F0x[0-9a-f]+$/.test(existing.name))) map.set(a, { name: fn.name, module });
  }
  for (const family of Object.values<any>(semantics.families ?? {})) {
    for (const [key, name] of Object.entries<string>(family.members ?? {})) {
      const [module, addr] = key.split(":");
      if (module !== overlayId && module !== "pro/fieldstg") continue;
      const a = Number(addr?.replace?.(/^F0x/, "0x") ?? 0) >>> 0;
      const existing = map.get(a);
      if (a && (!existing || /^F0x[0-9a-f]+$/.test(existing.name))) map.set(a, { name, module });
    }
  }
  extents.sort((a, b) => a.start - b.start);
  extentsByStage[stage] = extents;
  // Manifest addresses are a safety net for entries the inventory rejected as
  // data labels; only add when they look like code inside the overlay image.
  const entry = manifest[stage];
  if (entry) {
    const add = (v: number, label: string): void => {
      const a = (v >= OVERLAY_BASE ? v : OVERLAY_BASE + v) >>> 0;
      if (a >= OVERLAY_BASE && a < OVERLAY_BASE + entry.size && !map.has(a)) map.set(a, { name: label, module: overlayId });
    };
    add(entry.root_ctor, "(manifest root ctor)");
    add(entry.init_fn, "(manifest init fn)");
    for (const alloc of entry.allocs) {
      add(alloc.site, "(manifest alloc site)");
      add(alloc.ctor_fn, "(manifest alloc ctor)");
      add(alloc.cb, "(manifest alloc callback)");
    }
  }
  starters[stage] = map;
  return map;
}

function stageNumber(stage: string): number {
  return Number(stage.replace(/^s/, ""));
}

/** Story ordinals worth running: default 0, the stage's own earliest gate, ladder beats. */
function beatsFor(stage: string): number[] {
  if (beatsArg === "none") return [0];
  if (beatsArg !== "auto") return beatsArg.split(",").map(Number).filter((n) => !Number.isNaN(n));
  const out = new Set<number>([0]);
  const gate = gates[stage] ?? gates[String(stageNumber(stage))];
  if (gate) {
    for (const { conds } of Object.values(gate)) {
      for (const [bank, value] of conds) {
        if (bank >= 0x6000 && bank <= 0x60ff && value === 1) out.add(bank - 0x6000);
      }
    }
  }
  const ladder = progress.ladder ?? [];
  for (const row of ladder) {
    if (row.stage === stageNumber(stage)) for (const o of row.ordinals) out.add(o);
  }
  return [...out].sort((a, b) => a - b);
}

interface Entry {
  frame: number;
  pc: number;
  name: string;
  module: string;
  caller: string;
  kind: "call" | "branch" | "host";
}

interface BeatResult {
  stage: string;
  ordinal: number;
  frames: number;
  boot: boolean;
  bootTrap: string | null;
  firstTouch: {
    name: string;
    pc: number;
    frame: number;
    order: number;
    count: number;
    kind: Entry["kind"];
    caller: string;
  }[];
  nestedCalls: { target: string; caller: string; count: number }[];
  neverRan: { address: string; name: string }[];
  events: { frame: number; id: number }[];
  drawCalls: number;
  sfx: number;
  objects: number;
}

function runBeat(stage: string, ordinal: number): BeatResult {
  const entry = manifest[stage] as StageManifestEntry;
  const overlay = new Uint8Array(readFileSync(join(dir, `${stage}.bin`)));
  const starts = buildStarters(stage);
  const flags = new Map<number, number>();
  const host: NativeHost = {
    setFlag: (id, v) => void flags.set(id, v),
    getFlag: (id) => flags.get(id) ?? 0,
    rand16: () => 0x777,
    ordinal: () => ordinal,
  };
  const rt = new NativeStageRuntime(overlay, entry, host, exeTables, fieldstg);
  const cpu = rt.cpu as unknown as {
    traceRing: Int32Array | null;
    tracePos: number;
    call: (a: number, b: number[], c?: number) => number;
  };
  cpu.traceRing = new Int32Array(16_000_000);
  cpu.tracePos = 0;

  const counts = new Map<string, { name: string; pc: number; frame: number; order: number; count: number; kind: Entry["kind"]; caller: string }>();
  const nested = new Map<string, { target: string; caller: string; count: number }>();
  const events: { frame: number; id: number }[] = [];
  let order = 0;
  let frame = -1;

  const extents = extentsByStage[stage] ?? [];
  const containing = (pc: number): string => {
    const p = pc >>> 0;
    const s = starts.get(p);
    if (s) return s.name;
    for (const e of extents) {
      if (p >= e.start && p < e.end) return `${e.name}+0x${(p - e.start).toString(16)}`;
      if (e.start > p) break;
    }
    return `0x${p.toString(16)}`;
  };

  const record = (name: string, _module: string, pc: number, caller: string, kind: Entry["kind"]): void => {
    order += 1;
    const prev = counts.get(name);
    if (prev) prev.count += 1;
    else counts.set(name, { name, pc: pc >>> 0, frame, order, count: 1, kind, caller });
  };

  const origCall = cpu.call.bind(rt.cpu);
  cpu.call = ((addr: number, callArgs: number[], budget?: number) => {
    const s = starts.get(addr >>> 0);
    record(s?.name ?? containing(addr), s?.module ?? "?", addr, "host", "host");
    return origCall(addr, callArgs, budget);
  }) as typeof cpu.call;

  const isJal = (pc: number): boolean => {
    const w = rt.mem.read32(pc >>> 0) >>> 0;
    return w >>> 26 === 3 || ((w >>> 26) === 0 && (w & 0x3f) === 9);
  };

  const drain = (): void => {
    const pos = cpu.tracePos;
    const ring = cpu.traceRing as Int32Array;
    let prev = -8;
    for (let i = 0; i < pos; i++) {
      const pc = ring[i] as number;
      if (i >= 2) {
        const maybeCall = ring[i - 2] as number;
        if (maybeCall === (ring[i - 1] as number) - 4 && isJal(maybeCall)) {
          const s = starts.get(pc >>> 0);
          if (s) {
            record(s.name, s.module, pc, containing(maybeCall), "call");
          } else {
            const target = containing(pc);
            const caller = containing(maybeCall);
            const key = `${caller}->${target}`;
            const prevNested = nested.get(key);
            if (prevNested) prevNested.count += 1;
            else nested.set(key, { target, caller, count: 1 });
          }
          prev = pc;
          continue;
        }
      }
      const s = starts.get(pc >>> 0);
      if (s && pc !== prev + 4) record(s.name, s.module, pc, "branch", "branch");
      prev = pc;
    }
    cpu.tracePos = 0;
  };

  const boot = rt.boot();
  drain();
  let drawCalls = 0;
  if (boot) {
    for (let f = 0; f < frames; f++) {
      frame = f;
      const before = rt.drawCalls.length;
      rt.tick(1);
      drain();
      drawCalls += rt.drawCalls.length - before;
      if (frame === 0) for (const id of rt.events) events.push({ frame, id });
    }
  }

  const neverRan = [...starts.entries()]
    .filter(([addr]) => addr >= OVERLAY_BASE && addr < OVERLAY_BASE + entry.size)
    .filter(([, s]) => !counts.has(s.name))
    .map(([addr, s]) => ({ address: `0x${addr.toString(16)}`, name: s.name }));

  return {
    stage,
    ordinal,
    frames: boot ? frames : 0,
    boot,
    bootTrap: rt.bootTrap ? `${rt.bootTrap.reason}` : null,
    firstTouch: [...counts.values()].sort((a, b) => a.order - b.order),
    nestedCalls: [...nested.values()].sort((a, b) => b.count - a.count),
    neverRan,
    events,
    drawCalls,
    sfx: rt.sfx.length,
    objects: rt.world.objects.length,
  };
}

const wanted = stagesArg === "all" ? Object.keys(manifest).sort() : stagesArg.split(",").map((s) => s.trim());
const results: BeatResult[] = [];
for (const stage of wanted) {
  for (const ordinal of beatsFor(stage)) {
    results.push(runBeat(stage, ordinal));
    if (!quiet) {
      const r = results[results.length - 1];
      console.log(`${stage}@${ordinal}: ${r.firstTouch.length} ran, ${r.neverRan.length} never, boot=${r.boot}`);
    }
  }
}

if (outJson) {
  writeFileSync(outJson, JSON.stringify({ generated_by: "tools/stage_call_journal.ts", frames, results }, null, 1));
  console.log(`wrote ${outJson}`);
}

if (writeMd) {
  const lines: string[] = [];
  lines.push("---");
  lines.push("reach: Reading what ran in a native stage, in what order, at which story ordinal — the browser-interpreter journal that replaces per-address rig breakpoints.");
  lines.push("status: generated");
  lines.push("---");
  lines.push("");
  lines.push("# Stage call journals — what runs, in order, per story ordinal");
  lines.push("");
  lines.push("> Generated by `node tools/stage_call_journal.ts --stages all --write docs/generated/stage-call-journals.md`.");
  lines.push("> Do not edit by hand; fix the journal tool.");
  lines.push("");
  lines.push("Each block boots the stage's original overlay in the interpreter at one story ordinal,");
  lines.push("records every executed PC through the R3000 trace ring, and joins it to the recovered");
  lines.push("function names. `order` is the sequence of first touch: constructors and one-shots appear");
  lines.push("early, per-frame ticks keep counting. `frame` is the frame of first touch (-1 = boot).");
  lines.push("The journal proves execution order, not what a function draws.");
  lines.push("");
  for (const r of results) {
    lines.push(`## ${r.stage} — ordinal ${r.ordinal}`);
    lines.push("");
    if (!r.boot) {
      lines.push(`Boot trap: ${r.bootTrap}`);
      lines.push("");
      continue;
    }
    lines.push(`${r.firstTouch.length} functions ran over ${r.frames} frames (${r.objects} objects, ${r.drawCalls} draw calls, ${r.sfx} sfx).`);
    lines.push("");
    lines.push("| order | first frame | runs | function | triggered by |");
    lines.push("|---:|---:|---:|---|---|");
    for (const t of r.firstTouch) {
      lines.push(`| ${t.order} | ${t.frame} | ${t.count} | \`${t.name}\` | ${t.kind === "host" ? "host frame call" : t.caller} |`);
    }
    if (r.neverRan.length) {
      lines.push("");
      lines.push(`Never ran: ${r.neverRan.map((n) => `\`${n.name}\``).join(", ")}`);
    }
    if (r.nestedCalls.length) {
      lines.push("");
      lines.push("Internal targets called from inside a known function's extent (candidate local helpers or jump-table entries, not recovered function starts):");
      lines.push("");
      for (const n of r.nestedCalls.slice(0, 12)) lines.push(`- \`${n.target}\` x${n.count} from \`${n.caller}\``);
    }
    lines.push("");
  }
  writeFileSync(writeMd, lines.join("\n") + "\n");
  console.log(`wrote ${writeMd}`);
}
