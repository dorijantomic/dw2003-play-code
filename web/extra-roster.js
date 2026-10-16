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

let loading = null;
/** The extra species data (and registers their profile records), or null when the build has none. Cached. */
export function loadExtraRoster(realFetch = globalThis.fetch.bind(globalThis)) {
  loading ??= (async () => {
    try {
      const [meta, bin] = await Promise.all([
        realFetch("assets/data/extra_species.json"), realFetch("assets/data/extra_profiles.bin"),
      ]);
      if (!meta.ok || !bin.ok) return null;
      const data = await meta.json();
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
