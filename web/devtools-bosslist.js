// DDW3 Dev Toolset — the "Bosses & tamers" list (Battles pane of web/devtools.js).
//
// Pure functions, no DOM, so tests/devtools-boss-list.test.js can run them in node.
//
// WHAT COUNTS AS A SCRIPTED BATTLE. The disc's script launcher (F0x800927a0,
// engine/dw3/encounters.ts scriptedScreenId) takes the live record's FOURTH zone
// block of the stage's encounter table and indexes its 8 slots directly (no dice).
// So the scripted screens are exactly the nonzero slots of zone block 3 of every
// stage, for every group of a multi-group stage (web/assets/data/stage_encounters.json).
// Blocks 0..2 are the wild pools and are NOT listed here (they have "Start battle").
//
// WHERE EACH FIELD COMES FROM
//   screen id ........ stage_encounters.json, zone block 3 slots
//   party / levels ... field_encounters.json `screens[screenId]` (the same table
//                      battle.partyForScreen reads), ALL members, in order
//   place ............ the stage ids above -> manifest.json maps[].name (or the
//                      toolset's stage-name table when it is loaded)
//   opponent name .... scripted_battles.json battle_candidates: the candidate whose
//                      screenId (or screenIdHint) is this screen; its PRE cutscene
//                      (events/esdmg<esdmg_stage>.json entry esdmg_entry, found
//                      through the event with the same flag_key) names its speakers
//                      with [name]X[name] tags. The name is shown only when exactly
//                      one speaker besides the player speaks in that cutscene;
//                      otherwise the speakers are kept as `speakers` and the
//                      opponent stays "unknown". No name is ever invented.

export const UNKNOWN = "unknown";

// Nonzero slots of zone block 3 for every stage and group: Map<screenId, string[] stageKeys>.
export function scriptedScreensByStage(stageEnc) {
  const out = new Map();
  for (const [key, stage] of Object.entries(stageEnc?.stages ?? {})) {
    const groups = stage.groups;
    const blockSets = groups && groups.length >= 2 ? groups.map((g) => g.blocks) : [[0, 1, 2, 3]];
    for (const blocks of blockSets) {
      const zone = stage.zones?.[blocks?.[3]];
      for (const screen of zone?.slots ?? []) {
        if (!screen) continue;
        if (!out.has(screen)) out.set(screen, []);
        const stages = out.get(screen);
        if (!stages.includes(key)) stages.push(key);
      }
    }
  }
  return out;
}

// [name]X[name] speakers of one esdmg entry, minus the player. Trimmed, de-duplicated, in order.
export function speakersOf(entry) {
  const seen = [];
  for (const s of entry?.strings ?? []) {
    for (const m of String(s).matchAll(/\[name\](.*?)\[name\]/g)) {
      const name = m[1].trim();
      if (name && name !== "[player_name]" && !seen.includes(name)) seen.push(name);
    }
  }
  return seen;
}

// Which esdmg files the builder needs: the distinct `esdmg_stage` of every event that
// is the PRE of a battle candidate. The page fetches exactly these.
export function esdmgStagesNeeded(scripted) {
  const need = new Set();
  for (const v of Object.values(scripted ?? {})) {
    for (const c of v.battle_candidates ?? []) {
      const ev = (v.events ?? []).find((e) => e.flag_key === c.preFlagKey);
      if (ev?.esdmg_stage != null) need.add(String(ev.esdmg_stage));
    }
  }
  return [...need];
}

// Opponent info per screen id: Map<screenId, { names: string[], speakers: string[] }>.
function opponentsByScreen(scripted, esdmgByStage) {
  const out = new Map();
  for (const v of Object.values(scripted ?? {})) {
    for (const c of v.battle_candidates ?? []) {
      const screen = c.screenId ?? c.screenIdHint;
      if (!screen) continue;
      const ev = (v.events ?? []).find((e) => e.flag_key === c.preFlagKey);
      const entry = ev ? esdmgByStage?.[String(ev.esdmg_stage)]?.[String(ev.esdmg_entry)] : null;
      const sp = speakersOf(entry);
      if (!out.has(screen)) out.set(screen, { names: [], speakers: [] });
      const o = out.get(screen);
      if (sp.length === 1 && !o.names.includes(sp[0])) o.names.push(sp[0]);
      for (const s of sp) if (!o.speakers.includes(s)) o.speakers.push(s);
    }
  }
  return out;
}

// One row per scripted screen with its FULL party. `stageNames` (optional) maps
// "s200" -> display name and wins over the manifest name.
export function buildBossList({ stageEnc, fieldEnc, scripted, esdmgByStage, manifestMaps, stageNames }) {
  const screens = scriptedScreensByStage(stageEnc);
  const opponents = opponentsByScreen(scripted, esdmgByStage);
  const mapName = (stageKey) => {
    const id = `s${stageKey}`;
    return stageNames?.[id] ?? (manifestMaps ?? []).find((m) => m.id === id)?.name ?? "";
  };
  const rows = [];
  for (const [screenId, stageKeys] of screens) {
    const party = fieldEnc?.screens?.[String(screenId)];
    if (!party || !party.length) continue; // startScreen would refuse it as well
    const opp = opponents.get(screenId);
    const opponent = opp && opp.names.length ? opp.names.join(" / ") : UNKNOWN;
    const row = {
      screenId,
      opponent,
      hasName: opponent !== UNKNOWN,
      speakers: opp ? opp.speakers : [],
      places: stageKeys.map((k) => ({ mapId: `s${k}`, mapName: mapName(k) })),
      party: party.map((p) => ({ name: p.name, level: p.level })),
    };
    row.text = rowText(row);
    rows.push(row);
  }
  rows.sort((a, b) => a.screenId - b.screenId);
  return rows;
}

// The searchable text of a row: every visible field plus all places and speakers.
export function rowText(row) {
  return [
    row.opponent,
    ...row.places.map((p) => `${p.mapId} ${p.mapName}`),
    ...row.party.map((p) => `${p.name} L${p.level} ${p.level}`),
    `screen ${row.screenId}`,
    ...(row.speakers ?? []),
  ].join(" | ").toLowerCase();
}

// Search box: every whitespace-separated word must appear somewhere in the row.
export function filterBossList(rows, query) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => words.every((w) => r.text.includes(w)));
}

// Click handler body: the normal startScreen path with the OPPONENT'S WHOLE PARTY
// (lead:false) so a tag swap can happen. mapId is the stage the game is on now.
export function startBossBattle(dev, row, mapId) {
  return dev.startScreenBattle(row.screenId, { mapId, lead: false });
}
