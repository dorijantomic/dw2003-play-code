#!/usr/bin/env node
// Build web/system-status.json: the one status page for every system of the
// original game (web/systems.html reads it).
//
// WHY THIS EXISTS
// The status of each system was spread over the evidence ledger, the system
// catalog, the screen progress list, the UI code ownership report and many
// Markdown files. Nobody could see in one place how much of a system is
// understood, translated, running in the game and checked against the original.
// This tool joins those sources; it adds no facts of its own.
//
// INPUTS (all checked in; the page is stale when any of them changes)
//   docs/research/systems/catalog.json          systems, frontiers, implementation marks,
//                                               the `owns` file globs and the
//                                               `routine_labels` each system claims
//   docs/research/evidence/ledger.json          claims about the original game
//   docs/research/ui/current-ui-code-ownership.json  per-routine translation state
//   data/screen_progress.json                   screens done / next / open
//   docs/generated/function-table.json          every routine of each code file and
//                                               how far it is read (rebuilt by
//                                               tools/build_semantic_graph.py build)
//   recovered/ddw3/function-inventory.json      every code file of the original,
//                                               including the data-only overlays that
//                                               hold no routine and so have no table row
//   the file tree                               do the named modules and tests exist?
//
// THE FIVE STAGES, and the single source each one is read from
//   learned     ledger claim statuses + catalog frontiers (open / resolved)
//   translated  ownership routines that have a port in our code
//   wired       ownership routines whose replacement is installed; catalog
//               implementation_status for the system as a whole
//   checked     ownership routines with an oracle test; catalog-named tests
//   gaps        open frontiers, contradicted claims, missing files, blockers
//
// Two joins were added on 2026-10-03 because the page was blind to them:
//   owns           the engine/** and web/*.js files each system owns, from the
//                  catalog's `owns` globs, so every file of ours appears under
//                  the system its own header comment names
//   routine_labels the function table's decoded subsystem/topic labels each
//                  system claims, so the 253 `story-flags` routines and the 365
//                  `unclassified` ones are counted per system instead of nowhere
//
// Usage: node tools/build_system_status.mjs          write the file
//        node tools/build_system_status.mjs --check  exit 1 when the file is stale
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = "web/system-status.json";
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const exists = (p) => existsSync(join(ROOT, p));

const STATUSES = ["verified", "partially_verified", "candidate", "contradicted", "unresearched"];
const OPEN = new Set(["open", "needs_evidence"]);
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const globRe = (g) =>
  new RegExp(`^${g.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
const walk = (dir, out = []) => {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith(".ts") || name.endsWith(".js")) out.push(rel);
  }
  return out;
};

export function buildSystemStatus() {
  const catalog = read("docs/research/systems/catalog.json");
  const ledger = read("docs/research/evidence/ledger.json");
  const owner = read("docs/research/ui/current-ui-code-ownership.json");
  const progress = read("data/screen_progress.json");
  const table = read("docs/generated/function-table.json");
  const inventory = read("recovered/ddw3/function-inventory.json");
  // This export's scope record: catalog-named files that are not part of this
  // repository by design (walker-only tests; see data/not-exported-files.json).
  // Absent-by-design files are not gaps of this tree. A catalog-named file
  // missing WITHOUT an entry here still is, and still fails the tests.
  const notExported = new Set(exists("data/not-exported-files.json") ? read("data/not-exported-files.json").files : []);

  const known = new Set(catalog.systems.map((s) => s.system));
  const claimsBy = new Map();
  for (const c of ledger.claims) {
    const k = c.system || "(none)";
    if (!claimsBy.has(k)) claimsBy.set(k, []);
    claimsBy.get(k).push(c);
  }

  // Our own code: which system owns each file, from the catalog's `owns` globs.
  const codePaths = [...walk("engine"), ...walk("web")].sort();
  const ownedBy = new Map(); // path -> [system]
  for (const s of catalog.systems) {
    for (const g of s.owns ?? []) {
      const re = globRe(g);
      for (const p of codePaths) {
        if (!re.test(p)) continue;
        if (!ownedBy.has(p)) ownedBy.set(p, []);
        if (!ownedBy.get(p).includes(s.system)) ownedBy.get(p).push(s.system);
      }
    }
  }

  // Decoded routines per system: the function table's subsystem/topic labels.
  const labelOwner = new Map(); // label -> [system]
  for (const s of catalog.systems) {
    // A label that IS a system id belongs to that system without being listed.
    for (const label of [s.system, ...(s.routine_labels ?? [])]) {
      if (!labelOwner.has(label)) labelOwner.set(label, []);
      if (!labelOwner.get(label).includes(s.system)) labelOwner.get(label).push(s.system);
    }
  }
  const routinesBy = new Map(catalog.systems.map((s) => [s.system, 0]));
  const unassignedLabels = new Map(); // label -> count
  // A routine the table carries no label for is not "claimed by nobody": nobody has
  // read it. It is counted apart, so the gap list cannot blame the catalog for it.
  let unlabeled = 0;
  for (const row of Object.values(table.rows)) {
    const labels = [row.subsystem, row.topic].filter(Boolean);
    if (!labels.length) {
      unlabeled += 1;
      continue;
    }
    const owners = new Set();
    for (const label of labels) for (const id of labelOwner.get(label) ?? []) owners.add(id);
    if (owners.size) for (const id of owners) routinesBy.set(id, (routinesBy.get(id) ?? 0) + 1);
    else {
      // Count a routine once, under the first label no system claims.
      const free = labels.find((l) => !labelOwner.get(l)?.length) ?? "(none)";
      unassignedLabels.set(free, (unassignedLabels.get(free) ?? 0) + 1);
    }
  }

  // Engine shared modules that no catalog system names: a gap in the catalog itself.
  const named = new Set(catalog.systems.flatMap((s) => s.implementation?.modules ?? []));

  const systems = catalog.systems.map((s) => {
    const claims = claimsBy.get(s.system) ?? [];
    const counts = Object.fromEntries(STATUSES.map((st) => [st, claims.filter((c) => c.status === st).length]));
    const fronts = s.frontiers ?? [];
    const impl = s.implementation ?? {};
    const modules = impl.modules ?? [];
    const tests = impl.tests ?? [];
    const missing = [...modules, ...tests].filter((p) => !exists(p) && !notExported.has(p));
    const notExportedHere = [...modules, ...tests].filter((p) => !exists(p) && notExported.has(p));
    const openFronts = fronts.filter((f) => OPEN.has(f.status));
    const owned = (s.owns ?? []).flatMap((g) => codePaths.filter((p) => globRe(g).test(p)));
    return {
      id: s.system,
      summary: clip(s.summary, 400),
      aliases: s.aliases ?? [],
      priority: s.priority ?? null,
      docs: s.canonical_docs ?? [],
      learned: {
        claims: claims.length,
        ...counts,
        frontiers: fronts.length,
        frontiersOpen: openFronts.length,
        exhaustive: Boolean(s.coverage?.exhaustive),
        scope: clip(s.coverage?.scope, 300),
      },
      routines: {
        labels: s.routine_labels ?? [],
        decoded: routinesBy.get(s.system) ?? 0,
      },
      wired: {
        status: s.implementation_status ?? "unknown",
        modules,
        note: clip(impl.note || s.implementation_note, 900),
        // The honest remaining-work list: what is ours and proven, what still
        // depends on the original code path or the interpreter, what is untouched.
        remaining: impl.remaining ?? null,
      },
      checked: {
        tests,
        markVerified: impl.verified ?? null,
        proof: "A named test is a claim that it passes, not a record that it passed. python3 tools/check_implementation_status.py --run-tests is what runs them.",
      },
      gaps: {
        frontiers: openFronts.map((f) => ({ id: f.id, question: clip(f.question, 300), needed: clip(f.evidence_needed, 300) })),
        contradicted: claims.filter((c) => c.status === "contradicted").map((c) => c.id).sort(),
        missingFiles: missing,
        notExportedFiles: notExportedHere,
      },
      labs: impl.labs ?? [],
      owns: (s.owns ?? []).slice().sort(),
      ownedFiles: [...new Set(owned)].sort(),
      claimList: claims
        .map((c) => ({ id: c.id, status: c.status, text: clip(c.statement, 220) }))
        .sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || a.id.localeCompare(b.id)),
    };
  });

  // Per original code file: how far each routine is read (function table) and
  // how far it is translated, running and oracle-checked (ownership report).
  const files = new Map();
  const file = (m) => {
    if (!files.has(m)) files.set(m, { module: m, routines: 0, library: 0, read: {}, verification: {}, translated: 0, wired: 0, oracle: 0, blocked: 0 });
    return files.get(m);
  };
  for (const row of Object.values(table.rows)) {
    const f = file(row.module);
    f.routines += 1;
    if (row.disposition === "psyq" || row.disposition === "library_unidentified") f.library += 1;
    f.read[row.state] = (f.read[row.state] ?? 0) + 1;
    const v = row.verification ?? "unresearched";
    f.verification[v] = (f.verification[v] ?? 0) + 1;
  }
  // The table lags behind the lifts, so a routine that only the ownership report
  // knows still counts; its reading state is shown as "not in the table".
  const seen = new Set(Object.keys(table.rows).map((k) => k.toLowerCase()));
  const counted = new Set();
  for (const r of owner.routines) {
    const f = file(r.module);
    const key = `${r.module}:f${r.address}`.toLowerCase();
    if (!seen.has(key) && !counted.has(key)) {
      counted.add(key);
      f.routines += 1;
      f.read.not_in_table = (f.read.not_in_table ?? 0) + 1;
    }
    if (r.port || r.replacementInstalled) f.translated += 1;
    if (r.replacementInstalled) f.wired += 1;
    if (r.oracle) f.oracle += 1;
    if (r.blocker) f.blocked += 1;
  }
  const covers = (pattern, module) => {
    const m = /asm\/dw2003\/(.+)\.s$/.exec(pattern);
    if (!m) return false;
    const re = new RegExp(`^${m[1].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(module);
  };
  // A data-only overlay (pro/smdldata, pro/wstag260) has no routine and so no
  // function-table row. The inventory is the record that knows it exists, so the
  // page lists it with zero routines instead of dropping it.
  const inventoryModules = inventory.modules.map((m) => m.id).sort();
  for (const m of inventoryModules) {
    if (!files.has(m)) {
      files.set(m, { module: m, routines: 0, library: 0, read: {}, verification: {}, translated: 0, wired: 0, oracle: 0, blocked: 0, dataOnly: true });
    }
  }
  const codeFiles = [...files.values()].sort((a, b) => a.module.localeCompare(b.module))
    .map((f) => ({ ...f, systems: catalog.systems.filter((s) => (s.source_map ?? []).some((p) => covers(p, f.module))).map((s) => s.system) }));

  const engineShared = readdirSync(join(ROOT, "engine/systems")).filter((f) => f.endsWith(".ts")).map((f) => `engine/systems/${f}`);
  const unclaimedEngine = engineShared.filter((p) => !named.has(p)).sort();
  const strayClaims = [...claimsBy.keys()].filter((k) => !known.has(k)).sort()
    .map((k) => ({ system: k, claims: claimsBy.get(k).map((c) => c.id).sort() }));
  const unownedCode = codePaths.filter((p) => !ownedBy.has(p)).map((p) => ({
    path: p,
    reason: p.endsWith("vendor/engine.js") ? "generated bundle"
      : /(^|\/)(index)\.ts$/.test(p) ? "barrel"
      : /^(web\/(editor|sceneEditor|debugPanel|devtools|lab-filter|native-screen-lab|wire|ui-flow|ui-flow-data|systems))\.js$/.test(p) ? "developer tool or harness"
      : "no owner recorded",
  }));
  const unassignedRoutines = [...unassignedLabels.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  // The routines that carry no label at all, by reading state, so the page can say
  // "nobody has read these" instead of "no system claimed them".
  const unlabeledByState = {};
  for (const row of Object.values(table.rows)) {
    if (row.subsystem || row.topic) continue;
    unlabeledByState[row.state] = (unlabeledByState[row.state] ?? 0) + 1;
  }

  const total = Object.fromEntries(STATUSES.map((st) => [st, ledger.claims.filter((c) => c.status === st).length]));
  return {
    generatedBy: "tools/build_system_status.mjs",
    note: "Generated. Do not edit by hand; run node tools/build_system_status.mjs. Every number comes from the inputs listed; this file adds no facts.",
    inputs: {
      catalogUpdated: catalog.updated ?? null,
      ledgerClaims: ledger.claims.length,
      ownershipGeneratedAt: owner.generatedAt ?? null,
      functionTableRows: Object.keys(table.rows).length,
      inventoryModules: inventoryModules.length,
    },
    totals: {
      claims: ledger.claims.length,
      ...total,
      systems: systems.length,
      routines: Object.keys(table.rows).length,
      routinesAssigned: [...routinesBy.values()].reduce((a, b) => a + b, 0),
      routinesUnassigned: unassignedRoutines.reduce((a, r) => a + r.count, 0),
      routinesUnlabeled: unlabeled,
      codeFiles: codeFiles.length,
      codeFilesOwned: ownedBy.size,
      codeFilesUnowned: unownedCode.length,
      notExportedFiles: notExported.size,
    },
    systems,
    codeFiles,
    catalogGaps: { unclaimedEngine, strayClaims, unownedCode, unassignedRoutines, unlabeledRoutines: unlabeledByState },
    screens: {
      done: progress.done ?? [],
      inProgress: progress.inProgress ?? [],
      next: progress.next ?? [],
      open: progress.open ?? [],
    },
  };
}

export function renderSystemStatus() {
  return `${JSON.stringify(buildSystemStatus(), null, 1)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = renderSystemStatus();
  const path = join(ROOT, OUT);
  if (process.argv.includes("--check")) {
    const old = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (old !== text) {
      console.error(`${OUT} is stale. Run: node tools/build_system_status.mjs`);
      process.exit(1);
    }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${OUT}`);
  }
}
