// sound-audit.js — pure resolver for the battle sound-audit page (web/sound-audit.html).
// Turns the committed game data into "every sound this digimon can emit in battle",
// named, per situation. No invented fallbacks: a contact marker with no tech record
// behind it is reported as absent ("no tech data"), because some enemies genuinely
// have no techs and absence is the authentic behavior.
//
// Data contract (all fetched from web/assets/, same files the game uses):
//   index      assets/battle/models/index.json          [pack, ...]
//   modelMap   assets/battle/model_map.json             {name: pack}
//   op10Map    assets/sfx/op10_map.json                 {type: sfxKey}
//   manifest   assets/sfx/manifest.json                 {sfxKey: {id, rate, loop, ...}}
//   techTable  assets/data/fight_tech_table.json        {techId: {motion, effect, clip, ...}}
//   digimon    assets/data/digimon.json                 {digimon:[...], skills:[...]}
//   enemies    assets/data/enemies.json                 {enemies:[...]}
//
// Decode background (docs/research/fight-3d/tech-effects-decode.md):
//   op10 [type, duration] plays common sound 0x800a368c[type]; duration>0 = timed
//   effect object (sustains loop-pointed samples, keyed off after duration frames).
//   Contact markers 98/99 resolve through the attack context's +0x70 = tech +0x0f
//   ("motion"); plain basics with effect==0 && clip==5 default to 0x1e (30).
//   When the per-contact damage result is 3 (evade), the handler substitutes 0x38 (56).

export const EVADE_CONTACT_TYPE = 0x38; // F0x8008c454: contact result 3 -> type 56

// The fightstg contact rule (F0x8008ee84 0x8008f21c..0x8008f32c), verbatim.
export function contactTypeForTech(rec) {
  if (!rec) return null;
  if ((rec.effect | 0) === 0 && (rec.clip | 0) === 5) return 0x1e;
  return rec.motion ?? null;
}

// Known battle clip semantics (disc survey + user ground truth; fight-tables.js).
const CLIP_LABELS = {
  2: "Being hit (survive: flinch → floor → get up)",
  3: "Death (hit → floor → dead)",
  5: "Basic attack",
  6: "Attack (1 contact)",
  7: "Attack (2-hit combo)",
  8: "Attack (3-hit combo)",
  10: "Item use",
  11: "Signature attack",
  13: "Attack (3-hit combo)",
};

export function clipLabel(clip) {
  return CLIP_LABELS[clip] || `Clip ${clip}`;
}

// Reverse the name->pack map: pack -> [names].
export function namesForPack(modelMap) {
  const rev = {};
  for (const [name, pack] of Object.entries(modelMap || {})) {
    (rev[pack] = rev[pack] || []).push(name);
  }
  return rev;
}

// Roster: all packs, labeled with their known names.
export function buildRoster({ index, modelMap }) {
  const rev = namesForPack(modelMap);
  return (index || []).map((pack) => ({
    pack,
    names: rev[pack] || [],
    label: (rev[pack] || []).join(" / ") || pack,
  }));
}

// Every species (player profile and/or enemy record) that uses this pack, with its
// real tech ids. A species may appear as both (player Agumon + wild Agumon).
export function speciesForPack(pack, { modelMap, digimon, enemies }) {
  const names = Object.entries(modelMap || {})
    .filter(([, p]) => p === pack)
    .map(([n]) => n);
  const out = [];
  for (const name of names) {
    const prof = (digimon?.digimon || []).find((d) => d.name === name);
    if (prof) {
      out.push({
        name,
        kind: "player",
        basic: prof.tech_basic || null,
        techs: (prof.techs || []).filter((t) => t && t !== prof.tech_basic),
      });
    }
    const en = (enemies?.enemies || []).find((e) => e.enemy_id === name);
    if (en) {
      out.push({
        name,
        kind: "enemy",
        basic: en.attack || null,
        techs: [en.move_1, en.move_2].filter((t) => t),
      });
    }
  }
  return out;
}

function skillName(id, digimon) {
  const s = (digimon?.skills || []).find((x) => x.id === id);
  return s && s.name && s.name !== "Fight" ? s.name : null;
}

// One op10 row: resolve the sound (or the contact marker) to a named sample.
function op10Row(type, duration, { op10Map, manifest }) {
  const key = op10Map?.[String(type)] || null;
  const meta = key ? manifest?.[key] : null;
  return {
    type,
    duration,
    key,
    soundName: key ? key.toUpperCase() : null,
    packedId: meta?.id ?? null,
    loop: !!meta?.loop,
    sustained: !!meta?.loop && duration > 0,
  };
}

// Rows for one clip's script: every op10 in order. Contact markers (98/99) carry
// per-species-tech resolutions (empty = no tech data; reported, not invented).
export function clipRows(ops, resolutions, data) {
  const rows = [];
  for (const o of ops || []) {
    if (o.op !== 10) continue;
    const [type, duration = 0] = o.words;
    if (type === 98 || type === 99) {
      rows.push({
        contact: type === 99 ? "final strike" : "combo hit",
        type,
        duration,
        resolutions: (resolutions || []).map((r) => ({
          ...r,
          row: r.contactType != null ? op10Row(r.contactType, duration, data) : null,
        })),
      });
    } else {
      rows.push(op10Row(type, duration, data));
    }
  }
  return rows;
}

// Full audit for one model pack. anim = the pack's anim.json.
export function resolveModel(pack, anim, data) {
  const species = speciesForPack(pack, data);
  const actions = anim?.actions || [];
  const sections = [];
  const coveredClips = new Set();

  const contactResolutionsFor = (techIds) =>
    techIds.map(({ name, kind, techId }) => {
      const rec = data.techTable?.[String(techId)] || null;
      return {
        species: name,
        kind,
        techId,
        techName: skillName(techId, data.digimon),
        contactType: contactTypeForTech(rec),
        effectId: rec ? rec.effect : null,
        noTechData: !rec,
      };
    });

  // Basic attack: clip 5, contacts resolved through each species' real basic tech.
  const basics = species
    .filter((s) => s.basic)
    .map((s) => ({ name: s.name, kind: s.kind, techId: s.basic }));
  if (actions[5]?.ops?.some((o) => o.op === 10)) {
    coveredClips.add(5);
    sections.push({
      title: "Basic attack — clip 5",
      clip: 5,
      rows: clipRows(actions[5].ops, contactResolutionsFor(basics), data),
      evadeRow: op10Row(EVADE_CONTACT_TYPE, 0, data),
    });
  }

  // Techs/specials: each species tech drives ITS clip with ITS contact resolution.
  const seen = new Set();
  for (const s of species) {
    for (const techId of s.techs) {
      const dedup = `${techId}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const rec = data.techTable?.[String(techId)] || null;
      const clip = rec?.clip;
      const ops = clip != null ? actions[clip]?.ops : null;
      if (!ops?.some((o) => o.op === 10)) continue;
      coveredClips.add(clip);
      const nm = skillName(techId, data.digimon);
      sections.push({
        title: `${nm || `Tech #${techId}`} (as ${s.name}) — ${clipLabel(clip)} (clip ${clip})`,
        clip,
        techId,
        rows: clipRows(ops, contactResolutionsFor([{ name: s.name, kind: s.kind, techId }]), data),
        evadeRow: op10Row(EVADE_CONTACT_TYPE, 0, data),
      });
    }
  }

  // Reactions: clip 2 (survive) and clip 3 (death) — the sounds it emits when hit.
  for (const clip of [2, 3]) {
    if (actions[clip]?.ops?.some((o) => o.op === 10)) {
      coveredClips.add(clip);
      sections.push({
        title: `${clipLabel(clip)} — clip ${clip}`,
        clip,
        rows: clipRows(actions[clip].ops, [], data),
      });
    }
  }

  // Everything else that makes noise — nothing hidden.
  for (let clip = 0; clip < actions.length; clip++) {
    if (coveredClips.has(clip)) continue;
    if (!actions[clip]?.ops?.some((o) => o.op === 10)) continue;
    sections.push({
      title: `${clipLabel(clip)} — clip ${clip}`,
      clip,
      other: true,
      rows: clipRows(actions[clip].ops, [], data),
    });
  }

  return { pack, species, sections };
}
