// The enemy-only Digimon, made obtainable as player forms (tools/build_extra_species.py).
//
// The build writes assets/data/extra_species.json (rows in digimon.json's shape, ids 56.., plus the records
// each of the eight digivolution lines gains) and extra_profiles.bin (the same rows as the disc's 0x58-byte
// profile records). This module is the one place that adds them to the game:
//
//   - it registers the profile records with the menu engine, whose species getter then answers them like
//     any base row (engine/dw3/ui/native/pause-status.ts), so the game's own Digivolve, Tag, report and
//     pause screens can show them;
//   - it wraps fetch so that every reader of digimon.json and evolutions.json (battle, party, menus, gym,
//     lab ...) gets the extra rows and the extra unlock records without each of them knowing.
//
// It also adds the new partners (data/authored/web/assets/data/new_starters.json, built into extra_species.json's
// `starters`): starter rows after the extras, a roster slot each after the disc's eight, and a whole line each.
//
// Nothing here changes a byte of the disc's data; with no extra_species.json (or ?noextras=1) the game is
// exactly the original 55 species.
import { registerExtraProfiles, registerExtraEvolutionRows, registerNewPartners } from "./vendor/engine.js";
import { CHARID_TO_DIGID } from "./party.js";

const DATA = /assets\/data\/(digimon|evolutions)\.json(?:\?|$)/;

/** digimon.json with the extra species' rows appended. Pure. */
export function mergeDigimon(json, extra) {
  if (!extra?.digimon?.length || !Array.isArray(json?.digimon)) return json;
  const have = new Set(json.digimon.map((d) => d.id));
  return { ...json, digimon: [...json.digimon, ...extra.digimon.filter((d) => !have.has(d.id))] };
}

/**
 * evolutions.json with each line's extra unlock records after the disc's 44, then one whole line per new partner
 * (its tree is all ours, so nothing is appended to it). Pure.
 */
export function mergeEvolutions(json, extra) {
  if (!extra?.tree || !Array.isArray(json?.lines)) return json;
  const lines = json.lines.map((line) => {
    const more = extra.tree[String(line.slot)];
    if (!more || line.records.length > 44) return line;
    return { ...line, records: [...line.records, ...more] };
  });
  const have = new Set(lines.map((line) => line.slot));
  for (const p of extra.starters ?? []) {
    const records = extra.tree[String(p.slot)];
    if (!have.has(p.slot) && records) lines[p.slot] = { slot: p.slot, digimonId: p.id, records };
  }
  return { ...json, lines };
}

/** The new partners as the engine's roster registers them. Pure. */
export function newPartnersOf(extra) {
  return (extra?.starters ?? []).map((p) => ({
    slot: p.slot, id: p.id, charId: p.charId, name: p.name, formId: p.formId, gearSlot: p.gearSlot,
  }));
}

/** Give the new partners their roster slots, starter ids and unlock rows (idempotent). */
export function installNewPartners(extra) {
  const partners = newPartnersOf(extra);
  registerNewPartners(partners);
  for (const p of partners) CHARID_TO_DIGID[p.charId] = p.id;
  return partners;
}

/**
 * The new partners (DemiDevimon, Kunemon, Hagurumon, Betamon, Goburimon) are switched off: each needs its own field
 * sprite, gym workout art and so on, which is more art than there is time for. Their data, tools and sprites stay in
 * the repo; set this to true to bring them back. The enemy-only species stay obtainable as digivolution forms.
 */
export const NEW_PARTNERS_ENABLED = false;

/**
 * Aspect (docs/aspect-system-plan.md): a one-time starting bonus to one element, written into the same stored element bonus the
 * gym and the element chips raise, so the unlock rule's element gates (kinds 8-14) see it. At most ASPECT_SEED points, chosen once
 * per partner: `ps.aspect` records the choice and a second call does nothing. Pure apart from `ps`.
 */
export const ASPECT_ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
export const ASPECT_SEED = 40;
export function applyAspect(ps, element, seed = ASPECT_SEED) {
  if (!ps || !ASPECT_ELEMENTS.includes(element) || ps.aspect) return false;
  const points = Math.max(0, Math.min(seed, ASPECT_SEED));
  ps.aspect = element;
  ps.elemBonuses ??= {};
  ps.elemBonuses[element] = Math.min(999, (Number(ps.elemBonuses[element]) || 0) + points);
  return true;
}

/** `extra` without the new partners: no starter rows, no roster slots, no lines of their own. Pure. */
export function withoutNewPartners(extra) {
  const gone = new Set((extra?.starters ?? []).map((p) => p.id));
  if (!gone.size) return extra;
  const slots = new Set(extra.starters.map((p) => String(p.slot)));
  return {
    ...extra,
    starters: [],
    digimon: (extra.digimon ?? []).filter((d) => !gone.has(d.id)),
    tree: Object.fromEntries(Object.entries(extra.tree ?? {}).filter(([slot]) => !slots.has(slot))),
  };
}

let loading = null;
/** The extra species data (and registers their profile records), or null when the build has none. Cached. */
export function loadExtraRoster(realFetch = globalThis.fetch.bind(globalThis)) {
  loading ??= (async () => {
    try {
      const [meta, bin] = await Promise.all([
        // ?aspect=1 loads the build with the element routes (tools/build_extra_species.py, ASPECT_ROUTES=1), for play-testing
        realFetch(/[?&]aspect=1\b/.test(globalThis.location?.search ?? "") ? "assets/data/extra_species_aspect.json" : "assets/data/extra_species.json"),
        realFetch("assets/data/extra_profiles.bin"),
      ]);
      if (!meta.ok || !bin.ok) return null;
      let data = await meta.json();
      if (!NEW_PARTNERS_ENABLED) data = withoutNewPartners(data);
      registerExtraProfiles(new Uint8Array(await bin.arrayBuffer()));
      const partners = installNewPartners(data);
      // the results screen runs the disc's unlock routine, which only reads the disc's 44 records per line; a new
      // partner's line has no disc records, so its whole tree is extra rows
      const lines = 8 + partners.length;
      registerExtraEvolutionRows(Array.from({ length: lines }, (_, slot) => data.tree?.[String(slot)] ?? []));
      return data;
    } catch (_) {
      return null;
    }
  })();
  return loading;
}

if (typeof window !== "undefined" && !/[?&]noextras=1\b/.test(window.location?.search ?? "") && !window.__extraRosterInstalled) {
  window.__extraRosterInstalled = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const hit = DATA.exec(url);
    if (!hit) return realFetch(input, init);
    const [res, extra] = await Promise.all([realFetch(input, init), loadExtraRoster(realFetch)]);
    if (!extra || !res.ok) return res;
    const json = await res.json();
    const merged = hit[1] === "digimon" ? mergeDigimon(json, extra) : mergeEvolutions(json, extra);
    return new Response(JSON.stringify(merged), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  window.__extraRoster = {
    load: () => loadExtraRoster(realFetch),
    /** Testing aid (browser console): choose the lead's Aspect, e.g. `__extraRoster.setAspect("dark")`. Once per partner; false when refused. */
    setAspect(element) {
      const st = window.__state?.partnerStats;
      if (!applyAspect(st, element)) return false;
      try { localStorage.setItem("partnerStats", JSON.stringify(st)); } catch (_) { /* storage blocked */ }
      return true;
    },
    /**
     * Testing aid (browser console): teach the lead Digimon every enemy-only species as a form at once, so they can be
     * picked in the Digimon Lab and the battle Digivolve list without playing for them. `ids` limits it to some.
     */
    async learnAll(ids = null) {
      const extra = await loadExtraRoster(realFetch);
      const st = window.__state?.partnerStats;
      if (!extra || !st) return 0;
      st.formLedger ??= [];
      const have = new Set(st.formLedger.map((e) => Number(e.id)));
      let added = 0;
      for (const d of extra.digimon) {
        if (have.has(d.id) || (ids && !ids.includes(d.id))) continue;
        st.formLedger.push({ id: d.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
        added++;
      }
      try { localStorage.setItem("partnerStats", JSON.stringify(st)); } catch (_) { /* storage blocked */ }
      const party = window.__state?.partyStats;
      if (Array.isArray(party) && party[0] !== st) party[0] = st;
      try { localStorage.setItem("partyStats", JSON.stringify(window.__state?.partyStats ?? [st])); } catch (_) { /* storage blocked */ }
      return added;
    },
  };
}
