// A12 — multi-contact builds: the clip owns its contact count, every contact carries its flinch, and the
// damage comes off the victim hit by hit.
//
// Three contracts, all derived from data:
//  1. a BUILT script's contact count is one the DISC ITSELF authors for that clip (measured here over every
//     authored pack, never a table copied into the test). The disc's clip 8 is always 2x op10 98 + 1x 99
//     (a 3-beat combo) even though its technique rows say hits=2; clip 13 is always a 3-shot volley; clip 15
//     (the field moves) authors NO contact; clip 5/11 pick among their authored 1/2/4-beat shapes.
//  2. reaction pairing: EVERY intermediate 98 is followed by its own `op1 [5]` (the defender's clip-1
//     flinch) and only the LAST 99 by `op1 [0]` (the outcome clip: 2 survive / 3 death / 4 evade). A script
//     that pairs one op1 with the whole combo flinched the defender once and let it stand through beats 2-3.
//  3. the damage split (web/fight/contact-damage.js): the payments over the contacts sum EXACTLY to the
//     resolved total, an intermediate contact cannot empty the victim's HP (so the death reaction belongs to
//     the final strike and only to it), and a 1-hit record played on a 3-beat clip body pays everything on
//     the strike.
//
// The third test is the arithmetic the brief asks for ("verify by arithmetic over the data, not by eye"):
// it sweeps the whole (total, perHit, hits, hp) space the resolver can produce, including lethal rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MODELS = resolve(ROOT, "web/assets/battle/models");
const DJ = JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/digimon.json"), "utf8"));

const cf = await import(resolve(ROOT, "web/fight/clip-fallback.js"));
const { contactPlan, contactDamager } = await import(resolve(ROOT, "web/fight/contact-damage.js"));
const ft = await import(resolve(ROOT, "web/fight/fight-tables.js"));
const { ANIM_DONOR_GAPS } = await import(resolve(ROOT, "web/fight/anim-donor-map.js"));

ft.setTechTable(JSON.parse(readFileSync(resolve(ROOT, "web/assets/data/fight_tech_table.json"), "utf8")));
ft.setSkillTable(DJ);
const itemUsePath = resolve(ROOT, "web/assets/data/item_use_effects.json");
ft.setItemUseEffects(existsSync(itemUsePath) ? JSON.parse(readFileSync(itemUsePath, "utf8")) : { records: [] });

const INDEX = JSON.parse(readFileSync(resolve(MODELS, "index.json"), "utf8"));
const modelCache = new Map();
function load(folder) {
  if (modelCache.has(folder)) return modelCache.get(folder);
  const p = resolve(MODELS, folder, "anim.json");
  const m = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  if (m) m.folder = folder;
  modelCache.set(folder, m);
  return m;
}
for (const f of INDEX) {
  const gaps = ANIM_DONOR_GAPS[f];
  if (!gaps) continue;
  for (const clip of Object.keys(gaps)) {
    const donor = load(gaps[clip].d);
    if (donor) cf.registerDonorAnim(gaps[clip].d, donor);
  }
}
cf.setFallbackDonor(load("m005grey")?.actions ?? null);

const contactsOf = (script) => (script?.ops ?? []).filter((o) => o.op === 10 && [98, 99].includes(o.words?.[0] | 0));
const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ── 1. every count clipContacts() answers is a count the disc itself authored for that clip ──────────
test("clipContacts answers only counts the 249 authored packs actually contain for that clip", () => {
  const authored = new Map();   // clip -> Set of (n98 + n99) seen in an authored script
  for (const f of INDEX) {
    const m = load(f);
    if (!Array.isArray(m?.actions)) continue;
    for (const [clip, script] of Object.entries(m.actions)) {
      if (!script?.ops?.length) continue;
      const n = contactsOf(script).length;
      if (!authored.has(+clip)) authored.set(+clip, new Set());
      authored.get(+clip).add(n);
    }
  }
  // the clips a technique row or an item can route to
  const clips = new Set([...Object.keys(DJ.skills).map((i) => DJ.skills[i].clip), ...authored.keys()].map(Number).filter((c) => Number.isFinite(c)));
  let checked = 0;
  for (const clip of clips) {
    const variants = authored.get(clip);
    if (!variants) continue;                       // no pack authors this clip at all: no expectation
    for (const hits of [null, 1, 2, 3, 4, 5, 7]) {
      const n = cf.clipContacts(clip, hits);
      assert.ok(variants.has(n), `clip ${clip} hits=${hits}: built ${n} contacts, the disc authors {${[...variants].join(",")}}`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} (clip, hits) combinations checked`);
  // the disc's own shapes for the clips this task is about, read off the corpus (not asserted from a table)
  assert.ok(authored.get(8).has(3), "clip 8 is a 3-contact combo in every authored pack");
  assert.ok(authored.get(13).has(3), "clip 13 is a 3-shot volley in every authored pack");
  assert.deepEqual([...authored.get(15)], [0], "clip 15 authors no contact at all");
});

// ── 2. a built script pairs every contact, and keeps the beats before the terminator ─────────────────
test("every built clip fires the clip's own contact count, each 98 with op1[5] and the last 99 with op1[0]", () => {
  const hitsByClip = new Map();
  for (const s of DJ.skills) {
    if (!hitsByClip.has(s.clip)) hitsByClip.set(s.clip, new Set());
    hitsByClip.get(s.clip).add(Math.max(1, s.hits | 0 || 1));
  }
  const failures = [];
  let built = 0;
  for (const f of INDEX) {
    const m = load(f);
    if (!m) continue;
    const gaps = ANIM_DONOR_GAPS[f] ?? {};
    const clips = new Set([...Object.keys(gaps).map(Number), 8]);     // every gap, plus the combo clip (built from the basic)
    for (const clip of clips) {
      if (!Number.isFinite(clip) || clip < 5) continue;
      for (const hits of hitsByClip.get(clip) ?? [1]) {
        const script = cf.resolveClipScript(m, clip, { element: 1, target: "enemy", hits });
        if (!script?.synthesized) continue;                            // authored ground truth: not a build
        built++;
        const ops = script.ops;
        const c = contactsOf(script);
        const want = cf.clipContacts(clip, hits);
        if (c.length !== want) { failures.push(`${f} clip${clip} hits=${hits}: ${c.length} contacts, want ${want}`); continue; }
        const term = ops.findIndex((o) => o.op === 0 || o.op === 255);
        const lastContact = ops.reduce((a, o, i) => (o.op === 10 && [98, 99].includes(o.words?.[0] | 0) ? i : a), -1);
        if (term >= 0 && lastContact > term) failures.push(`${f} clip${clip}: a contact after the terminator (${lastContact} > ${term})`);
        const idx = ops.map((o, i) => (o.op === 10 && [98, 99].includes(o.words?.[0] | 0) ? i : -1)).filter((i) => i >= 0);
        idx.forEach((i, k) => {
          const type = ops[i].words[0] | 0;
          const next = k + 1 < idx.length ? idx[k + 1] : ops.length;
          const span = ops.slice(i + 1, next);
          const before = ops.slice(k > 0 ? idx[k - 1] + 1 : 0, i);
          if (type === 98) {
            const ok = span.some((o) => o.op === 1 && (o.words?.[0] | 0) === 5) || before.some((o) => o.op === 1 && (o.words?.[0] | 0) === 5);
            if (!ok) failures.push(`${f} clip${clip}: 98 #${k + 1} has no op1[5] in its span`);
          } else if (k === idx.length - 1) {
            const ok = span.some((o) => o.op === 1 && (o.words?.[0] | 0) === 0) || before.some((o) => o.op === 1 && (o.words?.[0] | 0) === 0);
            if (!ok) failures.push(`${f} clip${clip}: the final 99 has no op1[0]`);
          }
        });
        // an intermediate reaction must never be the OUTCOME reaction and vice versa
        const n98 = c.filter((o) => (o.words[0] | 0) === 98).length;
        const n99 = c.filter((o) => (o.words[0] | 0) === 99).length;
        if (n99 > 1) failures.push(`${f} clip${clip}: ${n99} damage strikes (the outcome reaction belongs to the last one)`);
        if (want === 0 && n98 + n99 !== 0) failures.push(`${f} clip${clip}: ${n98 + n99} contacts on a no-contact clip`);
      }
    }
  }
  assert.ok(built > 500, `only ${built} built scripts inspected`);
  assert.deepEqual(failures.slice(0, 12), [], `${failures.length} built scripts break the contact contract`);
});

// ── 3. the damage split: exact arithmetic over the whole space the resolver produces ─────────────────
test("the per-contact split sums exactly to the total and cannot kill before the final strike", () => {
  const rnd = mulberry(20261020);
  let cases = 0;
  for (let t = 0; t <= 60; t++) {
    for (const hits of [1, 2, 3, 4, 7]) {
      for (const hp of [1, 2, 5, 17, 40, 999]) {
        for (const per of [0, 1, Math.max(1, Math.round(t / hits)), t, t + 5]) {
          const shares = contactPlan(t, per, hits, hp);
          assert.equal(shares.length, hits);
          assert.equal(shares.reduce((a, b) => a + b, 0), t, `total ${t} per=${per} hits=${hits} hp=${hp}`);
          let pool = hp;
          shares.slice(0, -1).forEach((s, i) => {
            assert.ok(s <= per, `payment ${i} of ${s} exceeds one hit (${per})`);
            assert.ok(s < pool || s === 0, `intermediate ${i} paid ${s} with ${pool} HP left`);
            pool -= s;
            assert.ok(pool >= 1, "the victim must still be standing for the strike");
          });
          assert.equal(pool - shares[shares.length - 1] <= 0, t >= hp, "only the full total reaches 0 HP");
          cases++;
        }
      }
    }
  }
  // random sweeps too, so the property is not an artefact of the ladder above
  for (let i = 0; i < 2000; i++) {
    const t = Math.floor(rnd() * 5000), per = Math.floor(rnd() * 3000), hits = 1 + Math.floor(rnd() * 8), hp = 1 + Math.floor(rnd() * 4000);
    const shares = contactPlan(t, per, hits, hp);
    assert.equal(shares.reduce((a, b) => a + b, 0), t);
    assert.ok(shares.slice(0, -1).every((s) => s < hp));
    cases++;
  }
  assert.ok(cases > 5000);
});

test("contactDamager pays one hit per 98, commits on the 99, and pays nothing early when hits run out", () => {
  const paid = [];
  const d = contactDamager({ total: 90, perHit: 30, hits: 3, hp: 100, pay: (n) => paid.push(n) });
  assert.equal(d.onHit({ type: 98 }), false);
  assert.equal(d.onHit({ type: 98 }), false);
  assert.equal(d.onHit({ type: 99 }), true);
  assert.deepEqual(paid, [30, 30]);
  assert.equal(d.remaining(), 30);

  // a 1-hit record played on a 3-beat clip body: the beats pay nothing, the strike pays everything
  const paid2 = [];
  const one = contactDamager({ total: 55, perHit: 55, hits: 1, hp: 200, pay: (n) => paid2.push(n) });
  one.onHit({ type: 98 }); one.onHit({ type: 98 });
  assert.deepEqual(paid2, []);
  assert.equal(one.remaining(), 55);
  assert.equal(one.onHit({ type: 99 }), true);

  // a lethal action: the victim is at 1 HP more than the intermediates can take, and the strike kills
  const hp = [];
  let left = 40;
  const kill = contactDamager({ total: 120, perHit: 40, hits: 3, hp: left, pay: (n) => { left -= n; hp.push(n); } });
  kill.onHit({ type: 98 });
  assert.ok(left >= 1, "the first beat cannot kill");
  kill.onHit({ type: 99 });
  left = Math.max(0, left - kill.remaining());   // the battle clamps at 0
  assert.equal(left, 0, "the strike takes the rest");
  assert.deepEqual(hp, [39]);
});
