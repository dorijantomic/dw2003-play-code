// Behaviour lab for the resident core: run real console code from RAM dumps.
//
// The parity test proved the R3000 interpreter reproduces the console
// byte-for-byte on real game code from a dump. This tool turns that into an
// observation instrument: call a function (or every object carrying a known
// callback) on captured state, record which resident functions executed, the
// resident call edges, and the stores each function made. The output is
// execution context -- who runs, when, and what changes -- which is the part a
// name alone never carried.
//
//   node tools/native_probe.ts call 0x8001d704 --dump par/f00 --args 0
//   node tools/native_probe.ts trace --name s780-car-ticks --dump par/f00 \
//     --find-callback 0x800a5ec0 --tick 1 --write
//   node tools/native_probe.ts diff par/f00 par/f01 --find-callback 0x800a5ec0
//
// A run is authority 1 evidence about the dumped state only; every trace is
// machine-local RAM evidence, the same grade as the parity oracle. Write
// `--write` to merge the run into docs/generated/resident-traces.json, which is
// what the semantic graph's `observed_in` column reads.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { NativeMemory } from "../engine/native/memory.ts";
import { R3000 } from "../engine/native/mips.ts";
import { installDrawStubs } from "../engine/native/stubs.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = join(ROOT, "recovered/ddw3/function-inventory.json");
const TRACES = join(ROOT, "docs/generated/resident-traces.json");
const DUMP_DIR = process.env.DW3_DUMPS ?? join(homedir(), "vm-spike/dumps");
const RAM_BASE = 0x80000000;
const EXE_END = 0x80041000;
const GP = 0x8005cb50; // boot gp, the same value the parity test uses
const FRAME_DELTA = 0x8004de28;
const DESTROY = 0x80014308;
const DEFAULT_RING = 1 << 22; // 4M pcs = 16 MiB

interface ResidentFn {
  id: string;
  name: string | null;
  start: number;
  end: number;
}

interface RootSpec {
  addr: number;
  args: number[];
  label: string;
}

function usage(): never {
  console.error(
    "usage: native_probe.ts call <addr> --dump <name> [--args a,b,c] [--draw-stubs]\n" +
    "       native_probe.ts trace --name <label> --dump <name> [--root addr[@a,b]]...\n" +
    "            [--find-callback <addr> | --find-objects] [--tick N] [--destroy <addr>]\n" +
    "            [--budget N] [--ring N] [--draw-stubs] [--write] [--out <json>]\n" +
    "       native_probe.ts diff <dumpA> <dumpB> [--find-callback <addr>] [--find-objects] [--tick N]\n" +
    "            [--root addr[@a,b]]... [--draw-stubs] [--budget N] [--out <json>]",
  );
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(name);
}
function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Number(value.startsWith("0x") ? BigInt(value) : Number(value));
}
function argList(value: string | undefined): number[] {
  if (!value) return [];
  return value.split(",").map((item) => int(item.trim(), 0) | 0);
}

function resolveDump(name: string): string {
  const tries = [name, join(DUMP_DIR, name), join(DUMP_DIR, `${name}.bin`)];
  for (const candidate of tries) if (existsSync(candidate)) return candidate;
  throw new Error(`dump not found: ${name} (tried ${tries.join(", ")})`);
}

function loadResident(): ResidentFn[] {
  const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
  const module = inventory.modules.find((m: { id: string }) => m.id === "exe/fns");
  if (!module) throw new Error("exe/fns module missing from the inventory");
  const functions: ResidentFn[] = module.functions
    .filter((f: { role?: string }) => f.role !== "block")
    .map((f: { id: string; semantic_name: string | null; address: string;
               provisional_end_address?: string }) => ({
      id: f.id,
      name: f.semantic_name,
      start: parseInt(f.address, 16),
      end: parseInt(f.provisional_end_address ?? f.address, 16),
    }))
    .sort((a: ResidentFn, b: ResidentFn) => a.start - b.start);
  // A provisional end can absorb the next routine; the next start bounds it.
  for (let i = 0; i + 1 < functions.length; i++) functions[i].end = functions[i + 1].start;
  return functions;
}

function attribute(functions: ResidentFn[], pc: number): ResidentFn | null {
  if (pc < 0x80010000 || pc >= EXE_END) return null;
  let lo = 0, hi = functions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const fn = functions[mid] as ResidentFn;
    if (pc < fn.start) hi = mid - 1;
    else if (pc >= fn.end) lo = mid + 1;
    else return fn;
  }
  return null;
}

interface RunResult {
  name: string;
  dump: string;
  dump_sha256: string;
  roots: string[];
  objects_found: number;
  steps: number;
  ring_length: number;
  wrapped: boolean;
  observed: Record<string, { hits: number; name: string | null }>;
  edges: { caller: string; callee: string; caller_name: string | null;
           callee_name: string | null; count: number }[];
  writes: { id: string; name: string | null; count: number;
            addresses: [string, number][] }[];
  errors: { root: string; error: string }[];
}

function objectsWithCallback(mem: NativeMemory, callback: number, destroy: number): number[] {
  const objects: number[] = [];
  for (let offset = 0; offset < mem.bytes.length - 8; offset += 4) {
    const address = RAM_BASE + offset;
    if ((mem.read32(address) >>> 0) !== (callback >>> 0)) continue;
    if ((mem.read32(address + 4) >>> 0) !== (destroy >>> 0)) continue;
    objects.push((address - 0x48) >>> 0);
  }
  return objects;
}

/**
 * Every live engine object in the dump: a callback word immediately followed by
 * the standard destroy pointer at +0x4c. `objectsWithCallback` pins one callback;
 * this sweep takes whatever the captured state actually has, so a dump with no
 * known root still says which resident functions its objects call.
 */
function objectsByDestroy(mem: NativeMemory, destroy: number): { obj: number; cb: number }[] {
  const objects: { obj: number; cb: number }[] = [];
  for (let offset = 0; offset < mem.bytes.length - 8; offset += 4) {
    const address = RAM_BASE + offset;
    if ((mem.read32(address + 4) >>> 0) !== (destroy >>> 0)) continue;
    const cb = mem.read32(address) >>> 0;
    if (cb < 0x80010000 || cb >= 0x80200000) continue;
    objects.push({ obj: (address - 0x48) >>> 0, cb });
  }
  return objects;
}

interface RunOptions {
  name: string;
  dump: string;
  roots: RootSpec[];
  findCallback: number | null;
  findObjects: boolean;
  tick: number;
  destroy: number;
  budget: number;
  ring: number;
  drawStubs: boolean;
}

function execute(options: RunOptions, functions: ResidentFn[]): RunResult {
  const path = resolveDump(options.dump);
  const bytes = new Uint8Array(readFileSync(path));
  const mem = NativeMemory.fromDump(bytes);
  const cpu = new R3000(mem);
  cpu.gp = GP;
  if (options.drawStubs) installDrawStubs(cpu);
  const ring = new Int32Array(options.ring);
  cpu.traceRing = ring;

  const edges = new Map<string, { caller: string; callee: string; count: number }>();
  const writes = new Map<string, { count: number; addresses: Map<number, number> }>();
  cpu.onCall = (callerPc, target) => {
    const caller = attribute(functions, callerPc);
    const callee = attribute(functions, target);
    if (!caller && !callee) return;
    const key = `${caller?.id ?? "overlay"}->${callee?.id ?? "non-resident"}`;
    const edge = edges.get(key) ?? {
      caller: caller?.id ?? "overlay",
      callee: callee?.id ?? "non-resident",
      count: 0,
    };
    edge.count += 1;
    edges.set(key, edge);
  };
  mem.onWrite = (pc, address, _size, _value) => {
    const fn = attribute(functions, pc);
    if (!fn) return;
    const record = writes.get(fn.id) ?? { count: 0, addresses: new Map<number, number>() };
    record.count += 1;
    if (record.addresses.size < 4096) {
      record.addresses.set(address, (record.addresses.get(address) ?? 0) + 1);
    }
    writes.set(fn.id, record);
  };

  const roots = [...options.roots];
  let objectsFound = 0;
  if (options.findCallback !== null) {
    const objects = objectsWithCallback(mem, options.findCallback, options.destroy);
    objectsFound = objects.length;
    for (const object of objects) {
      roots.push({ addr: options.findCallback, args: [object | 0, mem.read32(object + 0x24)], label: `obj:0x${object.toString(16)}` });
    }
  }
  if (options.findObjects) {
    const objects = objectsByDestroy(mem, options.destroy);
    objectsFound += objects.length;
    for (const object of objects) {
      roots.push({ addr: object.cb, args: [object.obj | 0, mem.read32(object.obj + 0x24)], label: `sweep:0x${object.obj.toString(16)}` });
    }
  }
  const errors: { root: string; error: string }[] = [];
  for (const root of roots) {
    for (let tick = 0; tick < options.tick; tick++) {
      try {
        cpu.call(root.addr, root.args, options.budget);
      } catch (error) {
        errors.push({ root: `${root.label}@0x${root.addr.toString(16)}`, error: String(error) });
        break;
      }
    }
  }
  if (options.findCallback !== null && roots.length > 0 && options.tick > 0) {
    mem.write32(FRAME_DELTA, 1);
  }

  const observed = new Map<string, { hits: number; name: string | null }>();
  const written = cpu.traceWritten();
  const wrapped = written > ring.length;
  const start = wrapped ? written % ring.length : 0;
  const samples = Math.min(written, ring.length);
  for (let i = 0; i < samples; i++) {
    const pc = (ring[(start + i) % ring.length] as number) >>> 0;
    const fn = attribute(functions, pc);
    if (!fn) continue;
    const record = observed.get(fn.id) ?? { hits: 0, name: fn.name };
    record.hits += 1;
    observed.set(fn.id, record);
  }

  const nameOf = new Map(functions.map((fn) => [fn.id, fn.name]));
  const result: RunResult = {
    name: options.name,
    dump: path,
    dump_sha256: createHash("sha256").update(bytes).digest("hex"),
    roots: roots.map((root) => `${root.label}@0x${root.addr.toString(16)}(${root.args.join(",")})`),
    objects_found: objectsFound,
    steps: written,
    ring_length: ring.length,
    wrapped,
    observed: Object.fromEntries([...observed.entries()].sort()),
    edges: [...edges.values()]
      .map((edge) => ({
        ...edge,
        caller_name: nameOf.get(edge.caller) ?? null,
        callee_name: nameOf.get(edge.callee) ?? null,
      }))
      .sort((a, b) => b.count - a.count),
    writes: [...writes.entries()]
      .map(([id, record]) => ({
        id,
        name: nameOf.get(id) ?? null,
        count: record.count,
        addresses: [...record.addresses.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([address, count]) => [`0x${address.toString(16)}`, count] as [string, number]),
      }))
      .sort((a, b) => b.count - a.count),
    errors,
  };
  return result;
}

function summarize(result: RunResult): void {
  console.log(`run ${result.name} dump=${result.dump} objects=${result.objects_found} ` +
    `steps=${result.steps}${result.wrapped ? " (ring wrapped)" : ""}`);
  console.log(`  observed resident functions: ${Object.keys(result.observed).length}`);
  for (const [id, record] of Object.entries(result.observed).slice(0, 25)) {
    console.log(`    ${id} ${record.name ?? ""} hits=${record.hits}`);
  }
  const edges = result.edges.filter((edge) => edge.caller !== "overlay" && edge.callee !== "non-resident");
  if (edges.length > 0) {
    console.log(`  resident call edges: ${edges.length}`);
    for (const edge of edges.slice(0, 15)) {
      console.log(`    ${edge.caller_name ?? edge.caller} -> ${edge.callee_name ?? edge.callee} x${edge.count}`);
    }
  }
  if (result.writes.length > 0) {
    console.log(`  functions making stores: ${result.writes.length}`);
    for (const write of result.writes.slice(0, 15)) {
      console.log(`    ${write.name ?? write.id} stores=${write.count} top=${write.addresses[0]?.[0] ?? ""}`);
    }
  }
  if (result.errors.length > 0) {
    console.log(`  trapped roots: ${result.errors.length}`);
    for (const error of result.errors.slice(0, 10)) {
      console.log(`    ${error.root}: ${error.error.split("\n")[0]}`);
    }
  }
}

function writeTraces(results: RunResult[]): void {
  let document: {
    schema_version: number; generated_by: string; authority: number; note: string;
    runs: RunResult[]; observed: Record<string, string[]>;
  };
  if (existsSync(TRACES)) {
    document = JSON.parse(readFileSync(TRACES, "utf8"));
  } else {
    document = {
      schema_version: 1,
      generated_by: "tools/native_probe.ts",
      authority: 1,
      note: ("Execution observations from machine-local RAM dumps through the "
             + "R3000 interpreter proven by tests/native-parity.test.js. A function "
             + "listed under a run executed in that captured state; an absent "
             + "function is unobserved, not unreachable. The dumps are not committed."),
      runs: [],
      observed: {},
    };
  }
  for (const result of results) {
    document.runs = document.runs.filter((run) => run.name !== result.name);
    document.runs.push(result);
  }
  const union: Record<string, Set<string>> = {};
  for (const run of document.runs) {
    for (const id of Object.keys(run.observed)) {
      (union[id] ??= new Set()).add(run.name);
    }
  }
  document.observed = Object.fromEntries(
    Object.entries(union).sort().map(([id, names]) => [id, [...names].sort()]),
  );
  document.runs.sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(dirname(TRACES), { recursive: true });
  writeFileSync(TRACES, `${JSON.stringify(document, null, 1)}\n`);
  console.log(`wrote ${TRACES} (${document.runs.length} run(s), ${Object.keys(document.observed).length} observed functions)`);
}

function parseRoots(args: string[]): RootSpec[] {
  const roots: RootSpec[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--root") continue;
    const spec = args[i + 1];
    if (!spec) usage();
    const [addr, argsText] = spec.split("@");
    roots.push({
      addr: int(addr, 0),
      args: argList(argsText),
      label: "root",
    });
  }
  return roots;
}

function main(): number {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command) usage();
  const functions = loadResident();

  if (command === "call") {
    const addr = int(args[1], 0);
    const options: RunOptions = {
      name: flag(args, "--name") ?? `call-0x${addr.toString(16)}`,
      dump: flag(args, "--dump") ?? usage(),
      roots: [{ addr, args: argList(flag(args, "--args")), label: "call" }],
      findCallback: null,
      findObjects: false,
      tick: 1,
      destroy: DESTROY,
      budget: int(flag(args, "--budget"), 2_000_000),
      ring: int(flag(args, "--ring"), DEFAULT_RING),
      drawStubs: has(args, "--draw-stubs"),
    };
    const result = execute(options, functions);
    summarize(result);
    if (has(args, "--write")) writeTraces([result]);
    const out = flag(args, "--out");
    if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
    return 0;
  }

  if (command === "trace") {
    const name = flag(args, "--name") ?? usage();
    const callback = flag(args, "--find-callback");
    const options: RunOptions = {
      name,
      dump: flag(args, "--dump") ?? usage(),
      roots: parseRoots(args),
      findCallback: callback ? int(callback, 0) : null,
      findObjects: has(args, "--find-objects"),
      tick: int(flag(args, "--tick"), 1),
      destroy: int(flag(args, "--destroy"), DESTROY),
      budget: int(flag(args, "--budget"), 2_000_000),
      ring: int(flag(args, "--ring"), DEFAULT_RING),
      drawStubs: has(args, "--draw-stubs"),
    };
    if (options.roots.length === 0 && options.findCallback === null && !options.findObjects) usage();
    const result = execute(options, functions);
    summarize(result);
    if (has(args, "--write")) writeTraces([result]);
    const out = flag(args, "--out");
    if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
    return 0;
  }

  if (command === "diff") {
    const dumpA = args[1];
    const dumpB = args[2];
    if (!dumpA || !dumpB) usage();
    const callback = flag(args, "--find-callback");
    const common = {
      roots: parseRoots(args),
      findCallback: callback ? int(callback, 0) : null,
      findObjects: has(args, "--find-objects"),
      tick: int(flag(args, "--tick"), 1),
      destroy: int(flag(args, "--destroy"), DESTROY),
      budget: int(flag(args, "--budget"), 2_000_000),
      ring: int(flag(args, "--ring"), DEFAULT_RING),
      drawStubs: has(args, "--draw-stubs"),
    };
    const a = execute({ ...common, name: `diff:${dumpA}`, dump: dumpA }, functions);
    const b = execute({ ...common, name: `diff:${dumpB}`, dump: dumpB }, functions);
    const onlyA = Object.keys(a.observed).filter((id) => !(id in b.observed));
    const onlyB = Object.keys(b.observed).filter((id) => !(id in a.observed));
    console.log(`diff ${dumpA} vs ${dumpB}`);
    console.log(`  executed by both: ${Object.keys(a.observed).filter((id) => id in b.observed).length}`);
    console.log(`  only ${dumpA}: ${onlyA.length}`);
    for (const id of onlyA.slice(0, 40)) console.log(`    ${id} ${a.observed[id]?.name ?? ""}`);
    console.log(`  only ${dumpB}: ${onlyB.length}`);
    for (const id of onlyB.slice(0, 40)) console.log(`    ${id} ${b.observed[id]?.name ?? ""}`);
    const out = flag(args, "--out");
    if (out) writeFileSync(out, `${JSON.stringify({ a, b, onlyA, onlyB }, null, 1)}\n`);
    return 0;
  }

  usage();
}

process.exit(main());
