// web/glossary-digimon.js -- the rows behind GLOSSARY > DIGIMON. Pure: no DOM, no storage, no drawing.
//
// One entry per RECORD name: the partner profiles (digimon.json after web/extra-roster.js's merge, 190) first, then the wild
// records whose name is not already a partner name (enemies.json, 193 records). The numbered records ("Goburimon2", 49 of them) are
// entries of their own, listed right after their base entry; they show the same plain name. Rows are the codex data module's
// own (web/codex-data.js partnerRows / wildRows / encounterIndex), so the two books cannot disagree.
//
// What the tables do NOT hold (read, plan Notes 2 and 3): a level, an element or a family name per species, and a wild MP. None of
// those is shown, and nothing is guessed in their place. The level line is your partner's live level, else "Found at level a-b"
// from its encounter rows, else no line.
import { dropOdds, encounterIndex, lineTargets, partnerRows, wildRows } from "./codex-data.js";
import { plannerRows, requirementText } from "./evolution-planner.js";
import { scaledHp, scaledMp, scaledStat } from "./battle.js";
import { scaleEnemyStat } from "./enemy-stats.js";
import { elementValue } from "./vendor/engine.js";

const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const BARS = [["HP", "hp", null], ["MP", "mp", null], ["STR", "str", "str"], ["DEF", "def", "def"], ["SPT", "spt", "spt"], ["WIS", "wis", "wis"], ["SPD", "spd", "spd"], ["CHR", "chr", "chr"]];

/** Smallest bar scale (a value of 1 is then 1% of a bar, never full). */
export const SCALE_FLOOR = 100;

const WILD_KEYS = ["str", "def", "spt", "wis", "spd"];
const CORE_KEYS = ["str", "def", "spt", "wis", "spd", "chr"];
const FORM_KEYS = ["str", "def", "spt", "wis", "spd"];      // the five stats a worn form adds (engine/dw3/battle-form-change.ts formChangeCoreStats)

/** A digivolution form: a partner profile that is not a starter. Its table numbers are ADD-ONS on the partner's own row, not totals. */
const isForm = (sp) => !!(sp.partner && sp.profile && !sp.profile.is_starter);

/**
 * A partner form's BASE numbers at a level (no table holds a starting level per form, so callers use 1): the game's own rule,
 * web/battle.js scaledHp / scaledMp / scaledStat (what an evolution seeds). A non-starter profile's HP is a placeholder (1);
 * scaledHp answers for it exactly as the game does. A core stat the profile does not hold is null.
 */
export function baseNumbers(profile, level = 1) {
    if (!profile) return null;
    const out = { hp: scaledHp(profile, level), mp: scaledMp(profile, level) };
    for (const k of CORE_KEYS) out[k] = Number.isFinite(Number(profile[k])) ? scaledStat(profile, k, level) : null;
    return out;
}

/**
 * The player's OWN numbers for the form they wear now: max HP / MP and the six core stats plus the permanent chips, read from the
 * live party record as web/party.js does (stored value + bonus, else the profile baseline at that level). null = not this form.
 * The stored numbers are the partner's starter row's; while the worn form is not that starter the fight adds the form's own
 * STR..SPD on top (engine/dw3/battle-form-change.ts formChangeCoreStats), so the bars do too. `profiles` (digimon.json rows) lets
 * a record with no stored numbers fall back to its starter's baseline, as the fight's seed does.
 */
export function ownNumbers(sp, partner, profiles = null) {
    const rec = partner?.live?.stats;
    if (!rec || !sp.profile) return null;
    const id = Number(partner.formId ?? rec.digimonId);
    if (id > 0 ? id !== sp.profileId : !(sp.names ?? [sp.name]).includes(partner.form)) return null;
    const level = Number(partner.level ?? rec.level ?? 1);
    const onStarter = partner.rookie ? (sp.names ?? [sp.name]).includes(partner.rookie) : !isForm(sp);
    const add = onStarter ? null : sp.profile;
    const root = add ? (profiles ?? []).find((p) => p.name === partner.rookie) : null;
    const base = baseNumbers(root ?? sp.profile, level);
    const out = { hp: Number(rec.maxHp ?? base.hp), mp: Number(rec.maxMp ?? base.mp), level };
    for (const k of CORE_KEYS) {
        const worn = add && FORM_KEYS.includes(k) ? Number(add[k]) || 0 : 0;
        const stored = rec.stats?.[k];
        out[k] = stored == null ? base[k] + (root ? worn : 0) : Number(stored) + Number(rec.bonuses?.[k] ?? 0) + worn;
    }
    return out;
}

/** One evolutions.json record's needs in short plain words ("From Agumon Lv 20, STR 280"), parsed by the planner's own requirementText. */
function needText(record, profiles) {
    const rq = requirementText(record, profiles);
    const gate = rq.gate.kind === 0 ? null : rq.gate.kind === 7 ? `Partner Lv ${rq.gate.threshold}` : `${rq.gate.label} ${rq.gate.threshold}`;
    const forms = rq.reqs.map((r) => `${r.name} Lv ${r.level}`);
    if (forms.length === 2) return `DNA: ${forms.join(" + ")}${gate ? `, ${gate}` : ""}`;
    if (forms.length === 1) return `From ${forms[0]}${gate ? `, ${gate}` : ""}`;
    return gate ?? "No requirement";
}

/** "48-96", or "48" when both ends are equal (the font has no long dash). */
export const rangeText = (lo, hi) => (lo === hi ? String(lo) : `${lo}-${hi}`);

/**
 * A wild record's stats as they are fought: for each encounter row the record's five table stats through the battle's own rule
 * (web/enemy-stats.js, row stat_scale / 16), and that row's HP; then low and high over the rows. null when the record has no row.
 */
export function wildAsFought(rawStats, rows) {
    if (!rows?.length || !rawStats) return null;
    const out = {};
    for (const k of WILD_KEYS) {
        const v = rows.map((r) => scaleEnemyStat(rawStats[k], r.statScale > 0 ? r.statScale : 16));
        out[k] = { lo: Math.min(...v), hi: Math.max(...v) };
    }
    const hp = rows.map((r) => r.hp).filter((n) => n > 0);
    if (hp.length) out.hp = { lo: Math.min(...hp), hi: Math.max(...hp) };
    return out;
}

/** The name the player sees: the tables number variants ("Guardromon2"); the number is an internal id. */
export const displayName = (name) => String(name ?? "").replace(/\d+$/, "");

/** Map name as the quest log shows it: the part after the dash. */
export const mapLabel = (stageName) => String(stageName ?? "").replace(/^.*— /, "").trim();

function techniqueNames(partner, wild, skillById) {
    const ids = partner ? partner.techSlots : [wild?.attack?.id, wild?.move1?.id, wild?.move2?.id];
    const names = [];
    for (const id of ids ?? []) {
        const n = skillById.get(Number(id) || 0)?.name;
        if (n && !names.includes(n)) names.push(n);
    }
    return names;
}

/** Lines of evolutions.json that can reach each profile id, and the root (starter) id of each line. */
function lineIndex(evolutions) {
    const lines = Array.isArray(evolutions?.lines) ? evolutions.lines : [];
    const reach = new Map(), rootSlot = new Map();
    lines.forEach((line, slot) => {
        if (line?.digimonId != null) rootSlot.set(line.digimonId, slot);
        for (const r of line?.records ?? []) {
            if (!reach.has(r.to)) reach.set(r.to, new Set());
            reach.get(r.to).add(slot);
        }
    });
    return { lines, reach, rootSlot };
}

export function buildSpecies({ digimon, evolutions = null, enemies, modelMap = null, encounters = {} } = {}) {
    const profiles = Array.isArray(digimon?.digimon) ? digimon.digimon : [];
    const skills = Array.isArray(digimon?.skills) ? digimon.skills : [];
    const skillById = new Map(skills.map((s) => [s.id, s]));
    const nameOf = new Map(profiles.map((p) => [p.id, p.name]));
    const partners = partnerRows({ digimon: profiles, skills }, skills);
    const wilds = wildRows(enemies ?? { enemies: [] }, skills, modelMap);
    const enc = encounterIndex(encounters?.stages ?? null, encounters?.screens ?? null, encounters?.maps ?? null);
    const idx = lineIndex(evolutions);

    // One row per RECORD: the key is the raw name, so "Goburimon" and "Goburimon2" are two entries (each has its own model, stats,
    // encounters and counts; the species log keys by the raw enemy id). A partner profile and the wild record of the same raw name
    // are one entry. The shown name is still the plain one (displayName). A numbered entry is listed right after its base entry
    // (the one with the plain name), after any numbered sibling already placed there.
    const byName = new Map(), first = [];
    const entry = (name) => { if (!byName.has(name)) { byName.set(name, { names: [name], partners: [], wilds: [] }); first.push(name); } return byName.get(name); };
    for (const p of partners) entry(p.name).partners.push(p);
    for (const w of wilds) entry(w.name).wilds.push(w);
    const groups = new Map();
    for (const k of first) { const g = displayName(k); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(k); }
    const order = [];
    for (const [g, keys] of groups) { if (keys.includes(g)) order.push(g); for (const k of keys) if (k !== g) order.push(k); }

    const species = order.map((key, index) => {
        const { names, partners: ps, wilds: ws } = byName.get(key);
        const partner = ps[0] ?? null;
        const wild = ws[0] ?? null;
        const name = partner ? partner.name : wild.name;
        const rows = enc.bySpecies.get(key) ?? [];
        const lv = rows.map((r) => r.level).filter((n) => n > 0);
        const lives = [];
        for (const r of [...rows].sort((a, b) => a.stage - b.stage)) {
            const label = mapLabel(r.stageName) || `Stage ${r.stage}`;
            if (!lives.includes(label)) lives.push(label);
        }
        const encHp = rows.map((r) => r.hp).filter((n) => n > 0);
        const profileId = partner ? partner.id : null;
        const dropBy = new Map();      // item -> best odds over every wild variant of this Digimon
        for (const w of ws) {
            if (!w.drop || w.drop === "Null") continue;
            const k = dropOdds(w.dropRate).n;
            if (!dropBy.has(w.drop) || k > dropBy.get(w.drop)) dropBy.set(w.drop, k);
        }
        const drops = [...dropBy].map(([item, k]) => ({ item, n: k, of: 1024, percent: Math.round((k / 1024) * 1000) / 10 })).sort((a, b) => b.n - a.n);
        let from = null, into = [];
        if (profileId != null) {
            if (idx.rootSlot.has(profileId)) {
                into = lineTargets(evolutions, idx.rootSlot.get(profileId), profiles);   // a starter: its line's forms
            } else {
                const slots = idx.reach.get(profileId);
                if (slots?.size) {
                    from = slots.size === idx.lines.length && idx.lines.length > 1
                        ? `any of the ${idx.lines.length} starters`
                        : [...slots].map((sl) => nameOf.get(idx.lines[sl]?.digimonId)).filter(Boolean).join(", ") || null;
                }
            }
        }
        // How to get it: each record of each line that reaches this form, in short words; one text shared by every reaching line is one line
        const need = new Map();
        if (profileId != null && !idx.rootSlot.has(profileId)) {
            idx.lines.forEach((line, slot) => {
                for (const r of line?.records ?? []) {
                    if (r.to !== profileId) continue;
                    const t = needText(r, profiles);
                    if (!need.has(t)) need.set(t, new Set());
                    need.get(t).add(slot);
                }
            });
        }
        const reaching = idx.reach.get(profileId)?.size ?? 0;
        const getting = [...need].map(([t, slots]) => {
            const who = [...slots].map((sl) => nameOf.get(idx.lines[sl]?.digimonId)).filter(Boolean);
            return reaching > 1 && slots.size < reaching && who.length ? `${who.join(", ")}: ${t}` : t;
        });
        const profile = profileId != null ? profiles.find((p) => p.id === profileId) ?? null : null;
        const base = partner ? baseNumbers(profile, 1) : null;     // the stats page shows these unless the player wears this form
        const fought = partner ? null : wildAsFought(wild?.stats, rows);
        const stats = partner ? (base ? Object.fromEntries(CORE_KEYS.map((k) => [k, base[k]])) : partner.stats) : { ...(wild?.stats ?? {}), chr: null };
        if (fought) for (const k of WILD_KEYS) stats[k] = fought[k].hi;      // the bars use the high value
        return {
            index, number: index + 1, name, names, partner, wild, profileId,
            fought,
            profile, getting,
            hp: partner ? (base ? base.hp : partner.hp) : (encHp.length ? Math.max(...encHp) : null),
            mp: partner ? (base ? base.mp : partner.mp) : null,
            stats,
            resists: partner ? partner.resistances : (wild?.resists ?? {}),
            levels: lv.length ? { min: Math.min(...lv), max: Math.max(...lv) } : null,
            lives,
            drop: drops[0] ?? null,
            drops,
            techniques: techniqueNames(partner, wild, skillById),
            from, into: [...new Set(into)],
        };
    });

    // Each bar is scaled by that stat's real maximum over all species. The scale is never below SCALE_FLOOR: a stat whose real
    // maximum is tiny (CHR is 1 for every partner) would otherwise show a value of 1 as a full bar.
    // Two scales, so a bar compares like with like: `maxima` over the partner profiles, `wildMaxima` over the wild-only records.
    const floor = () => ({ hp: SCALE_FLOOR, mp: SCALE_FLOOR, str: SCALE_FLOOR, def: SCALE_FLOOR, spt: SCALE_FLOOR, wis: SCALE_FLOOR, spd: SCALE_FLOOR, chr: SCALE_FLOOR });
    const maxima = floor(), wildMaxima = floor();
    for (const sp of species) {
        const into = sp.partner ? maxima : wildMaxima;
        for (const [, key] of BARS) {
            if (isForm(sp) && !FORM_KEYS.includes(key)) continue;      // a form's HP, MP and CHR are not shown, and are not like the starters' totals
            const v = key === "hp" ? sp.hp : key === "mp" ? sp.mp : sp.stats?.[key];
            if (Number.isFinite(v) && v > into[key]) into[key] = v;
        }
    }
    return { species, world: { evolutions, profiles, skills }, maxima, wildMaxima };
}

// ---------------------------------------------------------------- what the player knows

export function partnerOf(sp, partners) {
    const names = sp.names ?? [sp.name];
    // a member wearing this form now comes first (its numbers are the ones to show), else the member whose starter it is
    for (const p of partners ?? []) if (p && names.includes(p.form)) return p;
    for (const p of partners ?? []) if (p && names.includes(p.rookie)) return p;
    return null;
}

const namesOf = (sp) => sp.names ?? [sp.name];
const sumOf = (sp, fn) => namesOf(sp).reduce((t, n) => t + (fn(n) || 0), 0);
/** Owned = a form you have worn (the log's `owned` set). */
export const ownedOf = (sp, log) => namesOf(sp).some((n) => log.ownedCount?.(n) > 0);
/** Times met / defeated, added over every name of the row; an owned species counts as met at least once. */
export const metOf = (sp, log) => Math.max(sumOf(sp, (n) => log.metCount(n)), ownedOf(sp, log) ? 1 : 0);
export const beatenOf = (sp, log) => sumOf(sp, (n) => log.beatenCount(n));

/** "unknown" = never met (a ??? shadow), "met" = name and picture only, "known" = defeated once, or your partner. */
export function speciesState(sp, log, partner) {
    if (partner) return "known";
    if (beatenOf(sp, log) > 0 || ownedOf(sp, log)) return "known";
    if (metOf(sp, log) > 0) return "met";
    return "unknown";
}

/**
 * The log as it stands right now, read ONCE: the species log re-reads and parses its storage key on every query, which for 240
 * species a frame is far too slow. A frame takes one snapshot and asks that. A log without a readable state is returned as it is.
 */
export function logSnapshot(log) {
    const s = typeof log?.read === "function" ? log.read() : null;
    if (!s || typeof s.met !== "object" || typeof s.beaten !== "object" || !s.met || !s.beaten) return log;
    const owned = s.owned && typeof s.owned === "object" ? s.owned : {};
    return { metCount: (n) => s.met[n] || 0, beatenCount: (n) => s.beaten[n] || 0, ownedCount: (n) => owned[n] || 0, totals: () => ({ met: Object.keys(s.met).length, beaten: Object.keys(s.beaten).length }) };
}

export function headerCounts(species, log) {
    let met = 0, beaten = 0;
    for (const sp of species) {
        if (metOf(sp, log) > 0) met++;
        if (beatenOf(sp, log) > 0) beaten++;
    }
    return { met, beaten, total: species.length, text: `Met ${met}/${species.length}  Beaten ${beaten}` };
}

export function listRows(species, log, partners) {
    return species.map((sp) => {
        const state = speciesState(sp, log, partnerOf(sp, partners));
        return { index: sp.index, number: sp.number, label: state === "unknown" ? "???" : displayName(sp.name), state };
    });
}

// ---------------------------------------------------------------- page 1

export function pageOne(sp, state, log, partner) {
    if (state === "unknown") return { title: "???", row1: "", record: "", lives: "", drops: "", shadow: true };
    const defeated = beatenOf(sp, log);
    const who = partner ? "Your partner" : ownedOf(sp, log) ? "Your Digimon" : "Met";
    const record = [who, defeated > 0 ? `Defeated x${defeated}` : ""].filter(Boolean).join("  ");
    if (state === "met") return { title: displayName(sp.name), row1: "", record, lives: "", drops: "", shadow: false };
    const found = sp.levels ? (sp.levels.min === sp.levels.max ? String(sp.levels.min) : `${sp.levels.min}-${sp.levels.max}`) : null;
    return {
        title: displayName(sp.name),
        row1: partner ? `Lv ${partner.level}` : found ? `Found at level ${found}` : "",
        record,
        lives: sp.lives.length ? `Lives in: ${sp.lives.join(", ")}` : "",       // only real data: no line when there is none
        drops: sp.drops?.length ? `Drops: ${sp.drops.map((d) => `${d.item} ${d.percent}%`).join(", ")}` : "",
        shadow: false,
    };
}

// ---------------------------------------------------------------- page 2

/** The partner's next form: the one READY now, else the one with the fewest unmet gates (table order breaks ties). */
export function nextForm(rows) {
    if (!rows?.length) return null;
    return rows.find((r) => r.ready) ?? rows.reduce((best, r) => (r.unmet.length < best.unmet.length ? r : best), rows[0]);
}

/**
 * The partner a form's numbers sit on: `lead` (the player's current partner) when its line can reach the form, else the first
 * starter whose line can, else null (no line reaches it: nothing is invented). The partner's own row is its starter's table row;
 * only the live partner adds its trained points (the game's own elementValue, engine/dw3/effective-stats.ts).
 * -> { name, elements: { fire: n, ... } } the partner's own seven element numbers.
 */
export function formPartner(sp, lead, world) {
    const lines = Array.isArray(world?.evolutions?.lines) ? world.evolutions.lines : [];
    const reaches = (line) => (line?.records ?? []).some((r) => r.to === sp.profileId);
    const live = lead && reaches(lines[lead.slot]) ? lines[lead.slot] : null;
    const line = live ?? lines.find(reaches);
    const profile = line ? (world.profiles ?? []).find((p) => p.id === line.digimonId) : null;
    if (!profile) return null;
    const points = live ? lead.live?.stats?.elemBonuses : null;
    return { name: displayName(profile.name), elements: Object.fromEntries(ELEMENTS.map((e) => [e, elementValue(profile, points, e)])) };
}

export function pageTwoLines(sp, state, partner, world, maxima, wildMaxima = maxima, lead = null) {
    if (state !== "known") return [{ kind: "text", label: "Locked", text: state === "met" ? "Defeat it once to see its strength." : "Meet it first." }];
    const out = [];
    const scale = sp.partner ? maxima : wildMaxima;
    // a wild-only record: the numbers as the battle uses them (each encounter's stat_scale), low-high over its encounters;
    // a record with no encounter row keeps its table values, and says so
    if (!sp.partner) out.push({ kind: "head", label: sp.fought ? "In the wild" : "Table values" });
    // a partner form: the player's own numbers when they wear it now, else the base numbers at Lv 1 (the game's own rule)
    const own = sp.partner ? ownNumbers(sp, partner, world?.profiles) : null;
    // a digivolution form's table numbers are add-ons, not totals: only the five stats it adds, headed as such
    const form = isForm(sp);
    if (sp.partner && sp.profile) out.push({ kind: "head", label: own ? `Yours, Lv ${own.level}` : form ? "Adds when digivolved" : "Base, Lv 1" });
    for (const [label, key, icon] of BARS) {
        if (form && !own && !FORM_KEYS.includes(key)) continue;
        const value = own ? own[key] : key === "hp" ? sp.hp : key === "mp" ? sp.mp : sp.stats?.[key];
        if (!Number.isFinite(value)) continue;
        const r = sp.fought?.[key];
        out.push({ kind: "bar", label, icon, value, max: Math.max(scale[key], own ? value : 0), ...(r ? { text: rangeText(r.lo, r.hi) } : {}) });
    }
    // a form's elements are the partner's own number plus the form's (engine/dw3/battle-form-change.ts formChangeValues); with no
    // partner whose line reaches the form there is nothing to add to, so no line
    const base = form ? formPartner(sp, lead, world) : null;
    const total = (e) => (form ? (base?.elements[e] ?? 0) + (sp.resists?.[e] ?? 0) : (sp.resists?.[e] ?? 100));
    if (!form || base) {
        if (form) out.push({ kind: "head", label: `On ${base.name}` });
        const strong = ELEMENTS.filter((e) => total(e) > 100).map(cap);
        const weak = ELEMENTS.filter((e) => total(e) < 100).map(cap);
        out.push({ kind: "text", label: "Resists", text: strong.join(", ") || "-" });
        out.push({ kind: "text", label: "Weak to", text: weak.join(", ") || "-" });
    }
    out.push({ kind: "head", label: "Techniques" });
    if (sp.techniques.length) for (const t of sp.techniques) out.push({ kind: "text", label: "", text: t });
    else out.push({ kind: "text", label: "", text: "-" });
    if (sp.from) out.push({ kind: "text", label: "Grows from", text: sp.from });
    if (sp.into.length) out.push({ kind: "text", label: "Grows into", text: sp.into.join(", ") });
    if (sp.getting?.length) {
        out.push({ kind: "head", label: "How to get it" });
        for (const t of sp.getting) out.push({ kind: "text", label: "", text: t });
    }
    if (partner) {
        out.push({ kind: "text", label: "Your level", text: String(partner.level) });
        const next = nextForm(plannerRows(world.evolutions, partner.slot, world.profiles, world.skills, partner.live));
        out.push({ kind: "text", label: "Next form", text: next ? `${next.name}: ${next.text}`.replace(/ — /g, " - ") : "none left" });   // the font has no long dash
    }
    return out;
}

// ---------------------------------------------------------------- loading

const asJson = (v) => (typeof v?.json === "function" ? v.json() : v);

/** Fetch the tables through the page's own fetch (so web/extra-roster.js's merge has run) and build the species. Never rejects. */
export async function loadGlossaryData(fetchJson = globalThis.fetch) {
    if (typeof fetchJson !== "function") return null;
    try {
        const [digimon, evolutions, enemies, modelMap, stages, screens, maps] = await Promise.all([
            "assets/data/digimon.json", "assets/data/evolutions.json", "assets/data/enemies.json", "assets/battle/model_map.json",
            "assets/data/stage_encounters.json", "assets/data/field_encounters.json", "assets/manifest.json",
        ].map((p) => Promise.resolve(fetchJson(p)).then(asJson)));
        return buildSpecies({ digimon, evolutions, enemies, modelMap, encounters: { stages, screens, maps } });
    } catch {
        return null;
    }
}
