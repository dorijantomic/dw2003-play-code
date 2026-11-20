// Fused forms — the ten DNA bodies and whether they can play (pure, no DOM).
//
// The DNA presentation table (jogress_scripts.json) has ten actions. Each fuses its
// partner models into one body: `fusedModel` names the body, `fusedPack.folder` names
// its model pack (most actions name two partners; action 432 names four). Seven of
// those bodies ship fully authored; three (m468agnm, m469garm,
// m470agry) ship with no clips at all and only 3 / 3 / 5 timeline tables. They stay
// playable only because web/fight/anim-donor-map.js gives them a donor row for the
// three battle clips every fighter must play:
//   5  basic attack, 9  spell, 10  item use.
//
// Nothing here is game behaviour: `fusionForms` turns the shipped tables into one row
// per action, `fusionFaults` says what would break a body's ability to play. The
// checker (tools/check_fused_forms.mjs) prints both.
export const REQUIRED_CLIPS = Object.freeze([5, 9, 10]);
export const CLIP_NAMES = Object.freeze({ 5: "basic attack", 9: "spell", 10: "item use" });

const FOLDER_NUMBER = /^m(\d{3})/;

/** The clip slots a pack actually carries (present: true), ascending. */
const presentClipsOf = (pack) =>
  (pack?.clips ?? []).filter((c) => c?.present).map((c) => c.index | 0).sort((a, b) => a - b);

/** How many timeline tables carry frames (an empty table is not a motion). */
const tableCountOf = (pack) =>
  (pack?.timeline ?? []).filter((t) => Array.isArray(t?.table) && t.table.length > 0).length;

/** The donor row for a folder/clip from ANIM_DONOR_GAPS (or any map of the same shape). */
const donorRowFor = (donors, folder, clip) => donors?.[folder]?.[clip] ?? null;

/**
 * One row per DNA action.
 *
 * @param {object} jogress  the parsed jogress_scripts.json (its `actions` map is read)
 * @param {string[]} index  web/assets/battle/models/index.json (the pack folder names)
 * @param {object} donors  ANIM_DONOR_GAPS: folder -> clip -> donor row
 * @param {object} bodies  folder -> that pack's parsed anim.json
 */
export function fusionForms(jogress, index, donors, bodies) {
  const actions = jogress?.actions ?? {};
  const folders = Array.isArray(index) ? index : [];
  const folderSet = new Set(folders);
  // The model number of a pack is the three digits in its folder name (model_id_map.json's rule).
  const modelNumbers = new Set(folders.map((f) => FOLDER_NUMBER.exec(f)?.[1]).filter(Boolean).map(Number));
  const packFor = (folder) => bodies?.[folder] ?? null;
  const rows = [];
  for (const key of Object.keys(actions).sort((a, b) => Number(a) - Number(b))) {
    const action = actions[key];
    const folder = action?.fusedPack?.folder ?? null;
    const pack = folder ? packFor(folder) : null;
    const presentClips = pack ? presentClipsOf(pack) : [];
    const tables = pack ? tableCountOf(pack) : 0;
    const ownTables = new Set((pack?.timeline ?? []).flatMap((t, i) => (t?.table?.length ? [i] : [])));
    // A body that owns none of a required clip needs a donor row; keep the row so the
    // fault list can tell "covered by a donor" from "nothing at all".
    const gaps = REQUIRED_CLIPS.filter((clip) => !presentClips.includes(clip)).map((clip) => {
      const row = donorRowFor(donors, folder, clip);
      const donorTables = Array.isArray(row?.t) ? row.t.map((t) => t | 0) : [];
      const covered = !!row && donorTables.some((t) => ownTables.has(t));
      return { clip, donor: row?.d ?? null, method: row?.m ?? null, tables: donorTables, covered };
    });
    const partners = Array.isArray(action?.partnerModels) ? action.partnerModels.map((n) => n | 0) : [];
    rows.push({
      actionId: action?.actionId ?? Number(key),
      clip: action?.clip ?? null,
      partners,
      missingPartners: partners.filter((n) => !modelNumbers.has(n)),
      fusedModel: action?.fusedModel ?? null,
      folder,
      exists: !!folder && folderSet.has(folder) && !!pack,
      presentClips,
      tables,
      frames: pack?.total_frames ?? 0,
      gaps,
    });
  }
  return rows;
}

/**
 * What would stop a fused body from playing. One fault per broken thing:
 *   missing-pack     the fused pack folder is not in the model index (or has no anim.json)
 *   unplayable       a required clip (5 basic attack, 9 spell, 10 item use) is neither its
 *                    own clip nor covered by a donor row over a table the pack carries
 *   missing-partner  a partner model number has no pack in the model index
 * The fault always names the body; an unplayable one names the clip(s) too.
 */
export function fusionFaults(rows) {
  const faults = [];
  for (const row of rows) {
    const body = `${row.folder ?? `action ${row.actionId}`} (action ${row.actionId}, fused model ${row.fusedModel})`;
    if (!row.exists) {
      faults.push({
        kind: "missing-pack", folder: row.folder, fusedModel: row.fusedModel, actionId: row.actionId,
        message: `${body} has no pack in the model index`,
      });
    } else {
      const unplayable = REQUIRED_CLIPS.filter((clip) => {
        if (row.presentClips.includes(clip)) return false;
        const gap = row.gaps.find((g) => g.clip === clip);
        return !(gap && gap.covered);
      });
      if (unplayable.length) {
        faults.push({
          kind: "unplayable", folder: row.folder, fusedModel: row.fusedModel, actionId: row.actionId,
          clip: unplayable[0], clips: unplayable,
          message: `${body} has no way to play clip ${unplayable.join(", ")} (no own clip and no donor row)`,
        });
      }
    }
    for (const partner of row.missingPartners ?? []) {
      faults.push({
        kind: "missing-partner", folder: row.folder, fusedModel: row.fusedModel, actionId: row.actionId,
        partner,
        message: `${body} fuses partner ${partner}, which has no pack in the model index`,
      });
    }
  }
  return faults;
}
