#!/usr/bin/env node
// Audit existing translations and their composition boundaries. This is a
// derived report, not a second translation registry or an authenticity grade.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { BRIDGE_ENTRIES, BRIDGE_BLOCKERS } from '../engine/native/bridge.ts';
import { UI_FLOWS } from '../web/ui-flow-data.js';
import { NATIVE_ROOT_CTORS } from '../web/native-screen-roots.js';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const json = file => JSON.parse(read(file));
const hash = file => createHash('sha256').update(read(file)).digest('hex');
const registry = json('data/translated_functions.json');
const roots = json('data/native_screen_roots.json');
const stages = json('web/assets/native/manifest.json');
const files = [...new Set(registry.map(r => r.port.split('#')[0]))].sort();
const program = ts.createProgram(files.map(f => path.join(root, f)), {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, allowImportingTsExtensions: true,
    noEmit: true,
});
const checker = program.getTypeChecker();
const key = (module, address) => `${module}:${Number(address)}`;
const installed = new Set(BRIDGE_ENTRIES.map(r => key(r.module, r.address)));
const byEntry = new Map(registry.map(r => [key(r.module, r.address), r]));
if (byEntry.size !== registry.length) throw new Error('Duplicate module/address in translation registry');
const ports = [];
for (const port of [...new Set(registry.map(r => r.port))].sort()) {
    const [file, name] = port.split('#');
    const source = program.getSourceFile(path.join(root, file));
    const module = source && checker.getSymbolAtLocation(source);
    let symbol = module && checker.getExportsOfModule(module).find(s => s.name === name);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.valueDeclaration;
    // A port may be an exported function, a const arrow function (its initializer), or an
    // exported class. All three are written code the registry can resolve. A class keeps its
    // statements in `members` in this TypeScript build (`body` is undefined), so a class is
    // recognised by its declaration kind, not by a body node — the class case was missed, and
    // a registered class port was reported as a missing export.
    const isClass = declaration !== undefined && ts.isClassDeclaration(declaration);
    const fn = declaration && (ts.isFunctionDeclaration(declaration) || isClass
        ? declaration : declaration.initializer);
    const hasBody = isClass || !!fn?.body;
    const rows = registry.filter(r => r.port === port);
    const parameters = fn?.parameters?.map(p => ({
        name: p.name.getText(), type: p.type?.getText() ?? 'inferred',
        // Interface members are obligations, NOT proof of a working provider.
        members: checker.getPropertiesOfType(checker.getTypeAtLocation(p))
            .filter(s => s.declarations?.some(d => ts.isMethodSignature(d) || ts.isPropertySignature(d)))
            .map(s => s.name).sort(),
    })) ?? [];
    const calls = [];
    const visit = node => {
        if (ts.isCallExpression(node)) calls.push({
            callee: node.expression.getText(),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        });
        ts.forEachChild(node, visit);
    };
    if (isClass) for (const member of declaration.members) visit(member);
    else if (fn?.body) visit(fn.body);
    ports.push({ port, resolved: hasBody, resolution: !name ? 'file-only reference' : hasBody ? 'exported body' : 'missing exported body', line: declaration
        ? source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1 : null,
        entries: rows.map(r => ({ module: r.module, address: r.address,
            installed: installed.has(key(r.module, r.address)),
            blocker: BRIDGE_BLOCKERS.get(`${r.module}:0x${Number(r.address).toString(16)}`) ?? null })),
        oracles: [...new Set(rows.map(r => r.oracle))], parameters, calls,
    });
}
const censusRun = spawnSync(process.execPath, ['tools/rosetta_source_census.mjs'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
if (censusRun.status !== 0) throw new Error(censusRun.stderr);
const census = JSON.parse(censusRun.stdout);
const inventoryRun = spawnSync(path.join(root, '.venv/bin/python3'), ['tools/query_recovered_inventory.py', 'translation-coverage'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
if (inventoryRun.status !== 0) throw new Error(inventoryRun.stderr);
const inventoryJoin = JSON.parse(inventoryRun.stdout);
const rootRows = roots.map(r => ({ ...r, constructor: endpoint(r.module, r.ctor), update: endpoint(r.module, r.tick),
    productionConstructorOverride: NATIVE_ROOT_CTORS[r.module] ? endpoint(r.module, NATIVE_ROOT_CTORS[r.module]) : null }));
function endpoint(module, address) {
    const row = byEntry.get(key(module, address));
    return { port: row?.port ?? null, installed: installed.has(key(module, address)) };
}
const modules = [...new Set(registry.map(r => r.module))].sort().map(module => {
    const rows = registry.filter(r => r.module === module);
    return { module, registeredEntries: rows.length, distinctPorts: new Set(rows.map(r => r.port)).size,
        installedEntries: rows.filter(r => installed.has(key(module, r.address))).length,
        uninstalledEntries: rows.filter(r => !installed.has(key(module, r.address))).length };
});
const oracleFiles = [...new Set(registry.map(r => r.oracle))].sort();
const flowRows = UI_FLOWS.map(f => ({ id: f.id, nodes: f.nodes.length, edges: f.edges.length,
    nodeIds: f.nodes.map(n => n.id),
    // Keep the existing source map; do not invent original-side coverage.
    source: f.source, knowledge: f.knowledge, runtime: f.runtime }));
const sourcePaths = [...new Set(['data/translated_functions.json', 'data/native_screen_roots.json',
    'engine/native/bridge.ts', 'web/assets/native/manifest.json', 'web/ui-flow-data.js', 'web/native-screen-roots.js',
    'recovered/ddw3/function-inventory.json', ...files, ...oracleFiles])].sort();
const out = {
    generatedBy: 'tools/report_translation_readiness.mjs',
    scope: 'Current translation register, its exported bodies and declared parameter contracts, catalogued screen roots, stage manifest, existing UI flow map, and Rosetta source census. No claim of exhaustive original-game semantics or execution coverage.',
    sourceHashes: Object.fromEntries(sourcePaths.map(f => [f, hash(f)])),
    summary: { registryEntries: registry.length, distinctPortReferences: ports.length, portFiles: files.length,
        translatedProductionRoutes: roots.filter(r => r.production?.execution === 'translated').length,
        translatedProductionScreens: roots.filter(r => r.production?.execution === 'translated' && r.production.complete === true).length,
        resolvedPorts: ports.filter(p => p.resolved).length, oracleFiles: oracleFiles.length,
        fileOnlyRegistryEntries: registry.filter(r => !r.port.includes('#')).length,
        nestedOracleFiles: oracleFiles.filter(f => f.slice('tests/'.length).includes('/')).length,
        installedRegistryEntries: registry.filter(r => installed.has(key(r.module, r.address))).length,
        installedEntriesTotal: BRIDGE_ENTRIES.length,
        rootUpdatesRegistered: rootRows.filter(r => r.update.port).length,
        rootUpdatesInstalled: rootRows.filter(r => r.update.installed).length,
        stageRuntimeEntries: Object.values(stages).filter(s => s.root_ctor >= 0).length,
        mappedFlowNodes: flowRows.reduce((n, r) => n + r.nodes, 0),
        mappedFlowEdges: flowRows.reduce((n, r) => n + r.edges, 0),
        sourceCensus: census.summary },
    modules, roots: rootRows, ports, oracleFiles, flows: flowRows, inventoryJoin,
    sourceCensus: census,
    limitations: [
        'Registry entries include switch arms and repeated families; entry counts are not percentages of gameplay.',
        'A resolved export is written code, not a correctness or full-understanding verdict.',
        'Parameter members and syntactic calls identify composition work; no transitive host closure is asserted.',
        'Rosetta module reachability follows imports and the engine barrel; it is not evidence a function runs.',
        'Flow nodes can repeat a screen across routes. The map lacks exhaustive state/branch coverage.',
        'Tests are listed, not run by this command. Run test:translations separately.',
        'A root absent from the registry may have an unregistered translation; absence is not an undecoded finding.',
    ],
};
const esc = s => String(s).replaceAll('|', '\\|');
const link = (file, line) => `[${file}](/home/dorij/ddw3-walker/${file}${line ? ':' + line : ''})`;
const lines = ['---', 'reach: Measuring existing translated functions, screen root wiring, host contracts, and browser integration before removing production PlayStation execution.', 'status: generated', '---', '',
    '# Translation readiness', '',
    'Regenerate with `node tools/report_translation_readiness.mjs`. These are implementation measurements, not original-game findings. The full JSON contains every registered port, parameter contract, syntactic call site, test path, source hash and browser/engine census row.', '',
    '## Current measurements', '',
    '| Measurement | Count |', '|---|---:|',
    ...Object.entries(out.summary).filter(([,v]) => typeof v === 'number').map(([k,v]) => `| ${k} | ${v} |`), '',
    'Counts do not establish a whole-game percentage. Several original entries map to one translated body, and code outside the translation registry already implements much of the game.', '',
    `The recovered inventory has ${inventoryJoin.inventory_entries} entries. ${inventoryJoin.exact_joins} join the translation registry by exact module/address; ${inventoryJoin.inventory_without_registry_join} inventory entries lack that join, and ${inventoryJoin.registry_without_inventory_join} registered entries lack an inventory join. These are reconciliation obligations, not counts of untranslated functions.`, '',
    '## Written versus installed entries', '',
    'Installed here means registered in the mixed-runtime bridge. Directly composed translated screens do not need that bridge; their production routes are listed separately below.', '',
    '| Module | Registered entries | Distinct port references | Installed | Uninstalled |', '|---|---:|---:|---:|---:|',
    ...modules.map(m => `| ${m.module} | ${m.registeredEntries} | ${m.distinctPorts} | ${m.installedEntries} | ${m.uninstalledEntries} |`), '',
    '## Catalogued screen roots', '',
    'This catalog also contains developer roots. These are the probe roots, not a complete list of production entry variants. Installation is not proof of a complete screen.', '',
    '| Module | Constructor port | Update port | Update installed |', '|---|---|---|---|',
    ...rootRows.map(r => `| ${r.module} | ${r.constructor.port ?? 'Not registered'} | ${r.update.port ?? 'Not registered'} | ${r.update.installed} |`), '',
    '## Direct translated production routes', '',
    'These routes are recorded in the existing screen catalog. Complete means the current plan accepts the entire screen journey, not merely an installed method or an isolated check. This report lists proof commands; it does not execute them.', '',
    '| Screen | Complete | Controller | Browser adapter | Tests and browser check |', '|---|---|---|---|---|',
    ...rootRows.filter(r => r.production?.execution === 'translated').map(r => `| ${r.module} | ${r.production.complete === true} | ${r.production.controller} | ${r.production.adapter} | ${r.production.oracle}; ${r.production.proof} |`), '',
    '## Every registered port and its composition boundary', '',
    'The parameters below come from TypeScript declarations. Resolve each service to a translated function or an explicit browser service before claiming the screen can run independently. Calls and interface members are expanded in the JSON. A row with no service parameter can still call imported or local helpers.', '',
    '| Port | Source | Entry aliases | Service parameters (excluding memory/state) | Registered oracle |', '|---|---|---:|---|---|',
    ...ports.map(p => `| ${p.port.split('#')[1] ?? 'FILE ONLY — symbol not recorded'} | ${link(p.port.split('#')[0],p.line)} | ${p.entries.length} | ${esc(p.parameters.filter(x => /host|service|callback|driver/i.test(x.type)).map(x => `${x.name}: ${x.type}`).join('; ') || 'Inspect calls / state parameters')} | ${p.oracles.join(', ')} |`), '',
    '## Limits', '', ...out.limitations.map(s => `- ${s}`), '',
];
fs.writeFileSync(path.join(root, 'docs/generated/translation-readiness.json'), JSON.stringify(out, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'docs/generated/translation-readiness.md'), lines.join('\n'));
console.log(JSON.stringify(out.summary));
if (ports.some(p => p.resolution === 'missing exported body')) {
    console.error('Unresolved registered port exports:', ports.filter(p => p.resolution === 'missing exported body').map(p => p.port));
    process.exitCode = 1;
}
