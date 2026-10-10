// Census for the field stage-object registry: data/stage_registry_members.json
// must list exactly the members the decoded system has, the research document
// must list the same ones, and the port column must agree with the shipped
// translated modules.
//
// Run: node --test tests/stage-registry-members.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const json = JSON.parse(
  readFileSync(resolve(ROOT, "data/stage_registry_members.json"), "utf8"),
);
const doc = readFileSync(
  resolve(ROOT, "docs/research/field/stage-object-registry-2026-10-04.md"),
  "utf8",
);
const falling = JSON.parse(
  readFileSync(resolve(ROOT, "web/assets/data/falling_objects.json"), "utf8"),
);

/** Every (stage, id) member row, flattened out of the per-stage map. */
function memberRows() {
  const out = [];
  for (const [stage, rows] of Object.entries(json.members)) {
    for (const row of rows) out.push({ stage, ...row });
  }
  return out;
}

const ROWS = memberRows();
const byKey = new Map(ROWS.map((r) => [`${r.stage}/${r.id_hex}`, r]));

/** The `## 6.` per-stage table's rows: "| s415 | `0x330` | ... | ported |". */
function stageTableRows(markdown) {
  const start = markdown.indexOf("## 6. Every member on every stage");
  assert.notEqual(start, -1, "the document must keep its '## 6.' heading");
  const end = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  const rows = [];
  for (const line of section.split("\n")) {
    const m = /^\| (s\d+) \| `(0x[0-9a-f]{3})` \|.*\| (\w[\w ]*) \|$/.exec(line);
    if (m) rows.push({ stage: m[1].slice(1), id: m[2], port: m[3].trim() });
  }
  return rows;
}

/** The `## 5.` record table's rows, one per registry record. */
function recordTableRows(markdown) {
  const start = markdown.indexOf("## 5. The 56 records");
  assert.notEqual(start, -1, "the document must keep its '## 5.' heading");
  const end = markdown.indexOf("\n## ", start + 1);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  return section
    .split("\n")
    .map((line) => /^\| `(0x[0-9a-f]{3})` \((\d+)\) \|/.exec(line))
    .filter(Boolean)
    .map((m) => ({ id: m[1], dec: Number(m[2]) }));
}

test("the registry has 56 records, 0x320..0x357, and no gaps", () => {
  assert.equal(json.records.length, 56);
  const ids = json.records.map((r) => r.id);
  assert.deepEqual(
    ids,
    Array.from({ length: 56 }, (_, i) => 0x320 + i),
    "the table is a contiguous run of ids from 0x320",
  );
  assert.equal(
    json.summary.registry_ram,
    "0x8009B3E8",
    "the registry is the static table in FIELDSTG.PRO",
  );
  assert.equal(json.summary.registry_stride, 12);
});

test("six records are fieldstg's own and fifty name the stage overlay window", () => {
  const fieldstg = json.records.filter((r) => r.ctor_home === "fieldstg");
  assert.equal(fieldstg.length, 6);
  assert.deepEqual(
    fieldstg.map((r) => r.id_hex),
    ["0x323", "0x324", "0x325", "0x326", "0x32d", "0x33a"],
  );
  assert.equal(
    json.records.filter((r) => r.ctor_home === "stage" || r.ctor === 0).length,
    50,
    "every other record names an address inside the stage overlay window",
  );
  for (const rec of json.records) {
    if (rec.ctor_home !== "stage") continue;
    assert.ok(
      rec.ctor === 0 || (rec.ctor >= 0x800a5de0 && rec.ctor < 0x800c0000),
      `${rec.id_hex} construct ${rec.ctor_hex} must be 0 or inside the overlay window`,
    );
  }
});

test("the thirteen null constructors are exactly the stage-created ids", () => {
  assert.deepEqual(json.summary.records_with_null_ctor, [
    "0x32c", "0x344", "0x345", "0x348", "0x349", "0x34a", "0x34b", "0x34c",
    "0x34d", "0x34e", "0x34f", "0x352", "0x353",
  ]);
  // A null constructor is only legal because the owning stage already made the
  // object, so every one of them must have a creation site in its own stage.
  const nulls = ROWS.filter((r) => (r.record?.ctor ?? "") === "0x00000000");
  assert.equal(nulls.length, 13, "all thirteen must appear as members");
  for (const row of nulls) {
    assert.ok(
      row.stage_created,
      `${row.stage}/${row.id_hex} has no constructor and no stage creation site`,
    );
    assert.ok(
      row.creation_sites.some((s) => s.tick),
      `${row.stage}/${row.id_hex} has no tick from its creation site`,
    );
    assert.ok(row.tick, `${row.stage}/${row.id_hex} resolved no tick at all`);
  }
  // The reverse direction too: a record WITH a constructor is built through
  // the registry, so the tick must come from the record's own address.
  const withCtor = ROWS.filter(
    (r) => r.owner === "stage" && r.record.ctor !== "0x00000000",
  );
  assert.equal(withCtor.length, 35, "35 stage-owned records have a constructor");
  for (const row of withCtor) {
    assert.ok(row.construct.resolves, `${row.stage}/${row.id_hex} unresolved`);
    assert.equal(row.tick_source, "registry construct_fn");
  }
});

test("the twenty null draws are construct-only records", () => {
  assert.equal(json.summary.records_with_null_draw.length, 20);
  for (const row of ROWS) {
    if (row.record?.draw !== "0x00000000") continue;
    assert.equal(
      row.draw_here,
      "null (the original skips it)",
      `${row.stage}/${row.id_hex} has a null draw`,
    );
    assert.ok(row.tick, `${row.stage}/${row.id_hex} must still install a tick`);
  }
});

test("s310 id 0x354 and s311 id 0x346 are listed as ported", () => {
  // The fixed still-sprite family (engine/systems/stage-fixed-sprite.ts). Both
  // members are the same two builder instructions over the same allocator, so
  // one port covers the pair; the census must say so for each of them.
  const rows = [
    ["310", 0x354, "0x800a72cc", "0x800a70ac"],
    ["311", 0x346, "0x800a73e4", "0x800a70f8"],
  ];
  for (const [stage, id, ctor, tick] of rows) {
    const row = byKey.get(`${stage}/0x${id.toString(16)}`);
    assert.ok(row, `${stage} must list id 0x${id.toString(16)}`);
    assert.equal(row.port, "ported", `${stage}/${row.id_hex} port mark`);
    assert.ok(
      row.port_cite.includes("engine/systems/stage-fixed-sprite.ts"),
      `${stage}/${row.id_hex} must cite the fixed still-sprite port`,
    );
    assert.equal(row.record.ctor, ctor, `${stage}/${row.id_hex} constructor`);
    assert.equal(row.tick, tick, `${stage}/${row.id_hex} tick`);
  }
});

test("s305 id 0x352 and s306 id 0x353 are listed as ported", () => {
  // The display-slot channel players (engine/systems/stage-slot-player.ts).
  // Both members are the same routine over the same clip run, so one port covers
  // the pair; the census must say so for each of them.
  const rows = [
    ["305", 0x352, "0x00000000", "0x800a5eb8"],
    ["306", 0x353, "0x00000000", "0x800a5eb8"],
  ];
  for (const [stage, id, ctor, tick] of rows) {
    const row = byKey.get(`${stage}/0x${id.toString(16)}`);
    assert.ok(row, `${stage} must list id 0x${id.toString(16)}`);
    assert.equal(row.port, "ported", `${stage}/${row.id_hex} port mark`);
    assert.ok(
      row.port_cite.includes("engine/systems/stage-slot-player.ts"),
      `${stage}/${row.id_hex} must cite the display-slot port`,
    );
    assert.equal(row.record.ctor, ctor, `${stage}/${row.id_hex} constructor`);
    assert.equal(row.tick, tick, `${stage}/${row.id_hex} tick`);
    // The stage script that fires it: SETANIM <id> <sub>, and the sub-command is
    // the member's own configure handler's.
    assert.ok(row.params.length >= 1, `${stage}/${row.id_hex} must be fired`);
  }
  // The two must name the same tick: one routine, two overlays.
  assert.equal(byKey.get("305/0x352").tick, byKey.get("306/0x353").tick);
});

test("s310 ids 831 and 832 are listed as ported, as ONE family", () => {
  // The six-slot display ensembles (engine/systems/stage-slot-ensemble.ts).
  // Both members claim a RUN of six tags in the field's own display chain, so
  // one port covers the pair; the census must say so for each of them.
  const rows = [
    ["310", 0x33f, 831, "0x800a65d4", "0x800a61d0", "1cd887c34016"],
    ["310", 0x340, 832, "0x800a6b58", "0x800a6758", "b31f90eb65b7"],
  ];
  for (const [stage, id, dec, ctor, tick, family] of rows) {
    const row = byKey.get(`${stage}/0x${id.toString(16)}`);
    assert.ok(row, `${stage} must list id 0x${id.toString(16)}`);
    assert.equal(row.port, "ported", `${stage}/${row.id_hex} port mark`);
    assert.ok(
      row.port_cite.includes("engine/systems/stage-slot-ensemble.ts"),
      `${stage}/${row.id_hex} must cite the display-slot ensemble port`,
    );
    assert.equal(row.record.ctor, ctor, `${stage}/${row.id_hex} constructor`);
    assert.equal(row.tick, tick, `${stage}/${row.id_hex} tick`);
    assert.equal(row.family, family, `${stage}/${row.id_hex} family hash`);
    assert.equal(row.id, dec);
    assert.equal(800 + (id - 0x320), dec);
    // The stage script fires it with the sub-command the configure handler
    // answers (857), so the census must carry the parameters.
    assert.ok(row.params.length >= 1, `${stage}/${row.id_hex} must be fired`);
    assert.deepEqual(row.params[0], [857, 2]);
  }
  // The extractor's own member list is the census's member list, so a member
  // cannot be ported without the table and the table cannot name an id the
  // census does not carry.
  const walls = JSON.parse(
    readFileSync(resolve(ROOT, "web/assets/data/stage_slot_ensembles.json"), "utf8"),
  );
  const found = Object.values(walls.stages["310"]).map((m) => m.id).sort();
  assert.deepEqual(found, [831, 832]);
  assert.equal(walls.summary.members, 2);
  assert.equal(walls.summary.stages, 1);
  assert.ok(
    readFileSync(resolve(ROOT, "engine/systems/stage-slot-ensemble.ts"), "utf8").length > 0,
    "engine/systems/stage-slot-ensemble.ts must exist",
  );
});

test("s415 ids 816-825 and the three s780 street ids are listed as ported", () => {
  const rocks = [0x330, 0x331, 0x332, 0x333, 0x334, 0x335, 0x336, 0x337, 0x338, 0x339];
  for (const id of rocks) {
    const row = byKey.get(`415/0x${id.toString(16)}`);
    assert.ok(row, `s415 must list id 0x${id.toString(16)} (${800 + (id - 0x320)})`);
    assert.equal(row.port, "ported", `s415/${row.id_hex} port mark`);
    assert.ok(
      row.port_cite.includes("engine/systems/falling-object.ts"),
      `s415/${row.id_hex} must cite the rockfall port`,
    );
    // All ten builders install the same tick: one object family, one port.
    assert.equal(row.tick, "0x800a5fa8");
    assert.equal(row.family, "493e32ee1e09");
  }
  const broadcast = byKey.get("780/0x320");
  assert.ok(broadcast, "s780 must list the broadcast id 0x320");
  assert.equal(broadcast.port, "ported");
  assert.ok(
    broadcast.port_cite.includes("engine/systems/street-vehicles.ts"),
    "s780/0x320 must cite the street broadcast port",
  );
  assert.equal(broadcast.tick, "0x800a6dc4");

  // The two ports' citations must exist on disk, or the port column is a lie.
  for (const rel of [
    "engine/systems/falling-object.ts",
    "engine/systems/street-vehicles.ts",
    "engine/systems/stage-fixed-sprite.ts",
    "engine/systems/stage-slot-player.ts",
    "engine/systems/stage-slot-ensemble.ts",
    "engine/systems/cutscene-manager.ts",
  ]) {
    assert.ok(
      readFileSync(resolve(ROOT, rel), "utf8").length > 0,
      `${rel} must exist`,
    );
  }
  // And the ten rock ids must be the ones the extractor actually paired with
  // the registry, so the port list cannot drift from the extracted data.
  const cited = new Set(
    (falling["415"].builders ?? []).map((b) => b.effectId),
  );
  for (const id of rocks) {
    assert.ok(cited.has(id), `falling_objects.json s415 must name id ${id}`);
  }
});

test("all twenty-three point-record actor members are listed as ported", () => {
    // engine/systems/point-record-actor.ts, hooked through web/stage-objects.js.
    // 853 is ported as the sound-only member it is on the console: a registry
    // constructor with a null configure slot, so the SETANIM only builds it.
    const actors = JSON.parse(
        readFileSync(resolve(ROOT, "web/assets/data/point_record_actors.json"), "utf8"),
    );
    const members = [
        ["212", 0x32a, 810, "pad-flash"],
        ["225", 0x32f, 815, "pad-flash"],
        ["750", 0x34e, 846, "pad-flash"],
        ["925", 0x357, 855, "pad-flash"],
        ["785", 0x343, 835, "decor"],
        ["790", 0x328, 808, "decor"],
        ["790", 0x329, 809, "decor"],
        ["795", 0x344, 836, "decor"],
        ["800", 0x345, 837, "decor"],
        ["800", 0x347, 839, "decor"],
        ["785", 0x327, 807, "picture-steps"],
        ["415", 0x32b, 811, "ride-walker"],
        ["805", 0x348, 840, "point-record"],
        ["810", 0x34a, 842, "point-record"],
        ["810", 0x34b, 843, "point-record"],
        ["810", 0x34c, 844, "point-record"],
        ["820", 0x355, 853, "point-record"],
        ["455", 0x33c, 828, "single"],
        ["926", 0x356, 854, "rise"],
        ["545", 0x34f, 847, "point-record"],
        ["620", 0x351, 849, "slots"],
        ["680", 0x32e, 814, "slots"],
        ["261", 0x33b, 827, "two-slot"],
    ];
  const rows = [];
  for (const [st, ms] of Object.entries(actors.stages)) {
    for (const m of Object.values(ms)) rows.push([st, m]);
  }
  for (const [s, m] of rows) {
    const idHex = m.idHex;
    const dec = m.id;
    const row = byKey.get(`${s.replace(/^s/, "")}/${idHex}`);
    if (!row) {
      // An UNREGISTERED in-place copy: the stage builds it with the
      // three-argument allocator wrapper (EXE F0x80014504), which registers no
      // id, so there is no census row and no SETANIM ever reaches it.  It is
      // keyed by its own tick and `registryCtor` is null, which is what makes
      // the browser build it at stage entry.
      assert.equal(m.registryCtor, null,
        `${s}/${idHex} has no census row, so it must be a stage-built copy`);
      continue;
    }
    assert.ok(row, `${s} must list ${idHex} (${dec})`);
    assert.equal(row.port, "ported", `s${s}/${idHex} port mark`);
    assert.ok(
      row.port_cite.includes("engine/systems/point-record-actor.ts"),
      `s${s}/${idHex} must cite the ONE point-record actor port`,
    );
    assert.equal(row.tick, m.tick, `s${s}/${idHex} installs the ported tick`);
    assert.equal(m.id, dec);
    assert.equal(m.idHex, idHex);
    assert.ok(["pad-flash", "decor", "point-record", "single", "rise", "slots",
      "two-slot", "picture-steps", "ride-walker"].includes(m.machine),
      `${s}/${idHex} names an unknown machine ${m.machine}`);
    assert.equal(800 + (Number(idHex) - 0x320), dec,
      `${s}/${idHex}: the decimal id is 800 + (id - 0x320)`);
  }
  // The census and the ONE table must carry the same twenty members, so a
  // member cannot be ported without the table and a table member cannot be
  // missing from the census.
  const fromTable = [];
  for (const [s, ms] of Object.entries(actors.stages)) {
    for (const m of Object.values(ms)) {
      // Registry-id members only: the unregistered in-place copies have no
      // census row to match.
      if (byKey.get(`${s.replace(/^s/, "")}/${m.idHex}`)) {
        fromTable.push(`${s}/${m.idHex}`);
      }
    }
  }
  const fromCensus = members.map(([s, id]) => `s${s}/0x${id.toString(16)}`);
  assert.deepEqual(fromTable.sort(), fromCensus.sort());
  // The pins that keep the port honest: the count and the citations.  What
  // moved here: s455 (0x33c) and s926 (0x356) came out of the separate
  // materialize-effect module into this one, so interpreter-only drops by two
  // and ported rises by two against the lead branch's 232 / 29.
  assert.equal(json.summary.members_ported, 260,
    "226 shared/bubble/rock/broadcast members, the s780 news screens, stinger "
    + "and street lights, the two fixed still sprites on s310/s311, the two "
    + "arena markers on s305/s306, the twenty-three point-record actor members "
    + "(the s785 picture stepper and the s415 ride walker included), "
    + "the two draw-context annotators on s805/s820, the two six-slot "
    + "display ensembles on s310, s545's child-pool parent and the two "
    + "\"triple\" parents on s460/s526, each of which exists only below its "
    + "own story-ordinal gate");
  assert.equal(json.summary.members_interpreter_only, 1);
  assert.deepEqual(json.summary.broken_port_citations, []);
  assert.ok(
    readFileSync(resolve(ROOT, "engine/systems/point-record-actor.ts"), "utf8").length > 0,
    "engine/systems/point-record-actor.ts must exist",
  );
});

test("every stage-owned id is fired by exactly one stage, and 813 is shared", () => {
  const byId = new Map();
  for (const row of ROWS) {
    if (row.owner !== "stage") continue;
    if (!byId.has(row.id_hex)) byId.set(row.id_hex, []);
    byId.get(row.id_hex).push(row.stage);
  }
  assert.equal(byId.size, 48, "48 stage-owned ids are fired by a script");
  for (const [id, stages] of byId) {
    assert.equal(
      stages.length,
      1,
      `${id} must be fired by exactly one stage, got ${stages.join(",")}`,
    );
  }
  // The shared fieldstg records are the opposite case, and 813 is the widest.
  const scene = ROWS.filter((r) => r.id === 0x32d);
  assert.ok(
    scene.length > 100,
    `id 813 must be shared across stages, found ${scene.length}`,
  );
  for (const row of scene) {
    assert.equal(row.record.ctor, "0x80083cd8", "813 is fieldstg's own object");
  }
});

test("the document's per-stage table lists the same members as the JSON", () => {
  const rows = stageTableRows(doc);
  assert.equal(
    rows.length,
    ROWS.length,
    `the document lists ${rows.length} members, the JSON has ${ROWS.length}`,
  );
  assert.equal(new Set(rows.map((r) => `${r.stage}/${r.id}`)).size, rows.length,
    "the document must not repeat a member");
  for (const row of rows) {
    const found = byKey.get(`${row.stage}/${row.id}`);
    assert.ok(found, `${row.stage}/${row.id} is in the document but not the JSON`);
    assert.equal(
      row.port,
      found.port,
      `${row.stage}/${row.id} port mark differs between document and JSON`,
    );
  }
});

test("the document's record table lists all 56 records with their decimal ids", () => {
  const rows = recordTableRows(doc);
  assert.equal(rows.length, json.records.length);
  for (const row of rows) {
    const rec = json.records.find((r) => r.id_hex === row.id);
    assert.ok(rec, `${row.id} is in the document but not the JSON`);
    assert.equal(rec.id, row.dec, `${row.id} decimal spelling`);
  }
});

test("the census is whole: every member resolves and is accounted for", () => {
  // Pinned so a member cannot quietly move between "ported" and "interpreter
  // only": the six decor drivers and the five picture drivers took it from 228
  // to 239; the two in-place copies of the same actor (s455's 828, the
  // one-record shape, and s926's 854, the record that walks up the screen) took
  // it from 239 to 241; the lead branch's own street corner took it from 241 to
  // 243; the two fixed still sprites on the A.o.A. Headquarters walls (s310's
  // 852, s311's 838) from 243 to 245; and the two Master Room arena markers
  // (s305's 850, s306's 851) from 245 to 247; the two draw-context
  // annotators (s805's 841, s820's 845) from 247 to 249; the two six-slot
  // display ensembles on s310 (831, 832) from 249 to 251; and s545's 847 /
  // s620's 849 / s680's 814 from 251 to 254; and s545's 848 -- the child-pool
  // parent whose five children are the ported pad flash -- from 254 to 255;
  // and s261's 827, the two-slot writer that drives the live field character,
  // from 255 to 256; and s785's 807, the picture stepper that claims no record
  // at all, from 258 to 259 (the s785 read of 2026-10-05); and s415's 811, the
  // ride walker that falls onto the rail and runs the three roll-in scripts,
  // from 259 to 260 (the s415 read of 2026-10-05).
  assert.equal(json.summary.members_ported, 260);
  assert.equal(json.summary.members_interpreter_only, 1);
  assert.equal(json.summary.members_none, 0);
  assert.equal(json.summary.records, 56);
  assert.equal(
    json.summary.members_total,
    ROWS.length,
    "the summary's member count must equal the rows",
  );
  assert.equal(
    json.summary.stage_owned_members +
      json.summary.fieldstg_owned_members,
    ROWS.length,
    "every member is either stage-owned or fieldstg-owned",
  );
  assert.equal(
    json.summary.members_ported +
      json.summary.members_interpreter_only +
      json.summary.members_none,
    ROWS.length,
    "every member has exactly one port status",
  );
  for (const row of ROWS) {
    assert.ok(["ported", "interpreter only", "none"].includes(row.port));
    if (row.owner === "stage") {
      assert.ok(
        row.tick,
        `${row.stage}/${row.id_hex} is a stage-owned member with no tick`,
      );
      assert.ok(row.family, `${row.stage}/${row.id_hex} has no family hash`);
    }
  }
  assert.deepEqual(
    json.summary.broken_port_citations,
    [],
    "every port citation must still check out",
  );
});

test("the stages without a recovered script table are reported, not hidden", () => {
  const noScript = json.unresolved.filter((u) => !("id" in u));
  assert.equal(
    noScript.length,
    json.summary.stages_scanned - json.summary.stages_with_a_script_table,
    "every stage without a script table must appear in unresolved",
  );
  for (const item of noScript) {
    assert.match(item.reason, /no event table recovered/);
  }
  assert.deepEqual(
    json.unresolved.filter((u) => "id" in u),
    [],
    "no confirmed member may be unresolved",
  );
  // Ids the table carries that no recovered script fires, so the rule is visible.
  assert.deepEqual(json.summary.ids_never_fired_by_a_recovered_script, [
    "0x33a",
    "0x341",
    "0x342",
  ]);
});