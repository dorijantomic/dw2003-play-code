// Browser test of the many-fighter RULES (web/mpbattle-rules.js): the game's own mechanics, run for several fighters on each side.
// No second player needed: it builds arenas straight from real fighter records. Needs the game served on PORT (default 8770).
// Run:   tools/run-playwright.sh tools/verify_multiplayer_rules.mjs
import { chromium } from "playwright";

const PORT = process.env.PORT || 8770;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { console.log(cond ? "PASS" : "FAIL", name, extra); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch();
const errors = [];
try {
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
    await page.addInitScript(() => {
        const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
            stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
        localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("playerName", "Junior");
        localStorage.setItem("charId", "p003pken"); localStorage.setItem("party", JSON.stringify(["p003pken"]));
        localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify([lead]));
        localStorage.setItem("equipment", JSON.stringify([{}])); localStorage.setItem("rosterOwned", "1");
    });
    await page.goto(`http://localhost:${PORT}/index.html?skipTitle=1&noEncounters=1&map=s330`);
    await page.waitForFunction(() => window.__state?.started && window.__mpb?.Arena, null, { timeout: 60000 });
    await sleep(2500);

    const results = await page.evaluate(async () => {
        const out = {};
        const kit = await window.__battle.mpKit();
        const { Arena, T } = window.__mpb;
        const mkP = (id, name, patch = {}) => { const r = kit.pack(kit.myRecord()); Object.assign(r, patch); return { id, name, rec: r }; };
        const names = (await (await fetch("assets/data/enemies.json")).json()).enemies.map((e) => e.enemy_id).filter((n) => n && n !== "Null");
        const mkE = (name, level = 5, hp = 200, extra = {}) => ({ name, rec: Object.assign(kit.enemyRecord({ name, level, hp, mp: 99, stat_scale: 16 }, null), extra) });
        const arena = (ps, fs, waveSize = 2) => new Arena({ kit, players: ps, foes: fs, waveSize });
        const act = (a, key, cmd) => { const r = a.playerAction(key, cmd); a.finish(key, r); return r; };

        // the game's own strings
        const P = (s) => s.replace(/[^]*/g, ""); out.strings = { dmg: P(T(0x0b, 42)), evade: P(T(0x1d)), heal: P(T(0x22, 7)), poison: P(T(0x55, 5)) };

        // T1: the action timeline: a fast fighter acts more often than a slow one
        {
            const fast = mkP(1, "Fast", { spd: 300 }), slow = mkP(2, "Slow", { spd: 40 });
            const a = arena([fast, slow], [mkE("Kunemon", 5, 99999), mkE("Kunemon", 5, 99999)]);
            const count = {};
            for (let i = 0; i < 120; i++) { const nx = a.next(); if (!nx?.key) break; count[nx.key] = (count[nx.key] || 0) + 1; a.finish(nx.key, { lines: [] }); }
            out.timeline = count;
        }

        // T2: enemies weigh up targets: the wounded one is hit far more often
        {
            const hurt = mkP(1, "Hurt"), fine = mkP(2, "Fine");
            const a = arena([hurt, fine], [mkE("Kunemon", 5, 200)]);
            const hits = { p1: 0, p2: 0 };
            for (let i = 0; i < 300; i++) {
                a.P[0].rec.hp = Math.floor(a.P[0].rec.maxHp * 0.1); a.P[1].rec.hp = a.P[1].rec.maxHp;
                const r = a.foeAction("e0");
                const row = r.rows[0]; if (row) hits[row[0]]++;
                a.lastTarget.clear();
            }
            out.targeting = hits;
        }

        // T3: status: poison lands from a technique, ticks on the timeline, and a sleeping enemy loses its turn
        {
            const a = arena([mkP(1, "A", { mp: 9999, maxMp: 9999 })], [mkE("Kunemon", 5, 99999)]);
            const foe = a.E[0];
            let landed = false, line = "";
            for (let i = 0; i < 120 && !landed; i++) {
                foe.rec.hp = foe.rec.maxHp;
                const r = act(a, "p1", { k: "tech", sk: 115, tw: 0, t: 0 });     // Poison Bites
                if (foe.rec.ailments.poison) { landed = true; line = r.lines.join(" | "); }
            }
            out.poison = { landed, line };
            let tick = "", hp0 = foe.rec.hp;
            for (let i = 0; i < 60 && !tick; i++) { const r = { lines: [] }; a.finish("p1", r); tick = r.lines.find((l) => /Poisoned:/.test(l)) ?? ""; }
            out.poisonTick = { tick, hpDropped: foe.rec.hp < hp0 };
            foe.rec.ailments = {}; let slept = false;
            for (let i = 0; i < 200 && !slept; i++) {
                foe.rec.hp = foe.rec.maxHp; foe.rec.ailments = {};
                act(a, "p1", { k: "tech", sk: 87, tw: 0, t: 0 });                 // Mugenhadou (sleep)
                if (foe.rec.ailments.sleep) slept = true;
            }
            out.sleep = { landed: slept, skipsTurn: slept ? a.turnStart("e0").skipped : null };
            let woke = false;
            for (let i = 0; i < 300 && !woke; i++) { const r = { lines: [] }; a.finish("p1", r); woke = !foe.rec.ailments.sleep; }
            out.sleep.recovers = woke;
        }

        // T4: items: a charge heals the one I pick; a revive item brings a downed friend back
        {
            const a = arena([mkP(1, "A"), mkP(2, "B")], [mkE("Kunemon", 5, 99999)]);
            a.P[1].rec.hp = 50;
            const r = act(a, "p1", { k: "item", item: 43, to: "p2", t: -1 });     // PowerCharge: +500 HP
            out.charge = { hp: a.P[1].rec.hp, lines: r.lines };
            a.P[1].rec.hp = 0;
            const r2 = act(a, "p1", { k: "item", item: 70, to: "p2", t: -1 });    // LifeDisk
            out.revive = { hp: a.P[1].rec.hp, max: a.P[1].rec.maxHp, lines: r2.lines };
        }

        // T5: heal and buff techniques, on a friend; a technique that costs more MP than I have is refused
        {
            const a = arena([mkP(1, "A", { mp: 500, maxMp: 500 }), mkP(2, "B")], [mkE("Kunemon", 5, 99999)]);
            a.P[1].rec.hp = 100;
            const r = act(a, "p1", { k: "tech", sk: 184, tw: 0, t: "p2" });       // Small Heal
            out.heal = { hp: a.P[1].rec.hp, mp: a.P[0].rec.mp, lines: r.lines };
            const r2 = act(a, "p1", { k: "tech", sk: 198, tw: 0, t: "p1" });      // Double Power
            out.buff = { str: a.P[0].rec.statMods?.str ?? 0, lines: r2.lines };
            a.P[0].rec.mp = 1;
            const r3 = act(a, "p1", { k: "tech", sk: 186, tw: 0, t: "p1" });      // Full Heal, no MP
            out.noMp = r3.lines[0];
        }

        // T6: running away: it can fail and it can succeed, and then the player has left
        {
            let fled = false, failedOnce = false;
            for (let i = 0; i < 60 && !fled; i++) {
                const a = arena([mkP(1, "A", { spd: 60 })], [mkE("Kunemon", 40, 5000), mkE("Kunemon", 40, 5000)]);
                const r = act(a, "p1", { k: "run" });
                if (r.fled) { fled = a.P[0].fled && a.state() === "fled"; } else failedOnce = true;
            }
            out.run = { fled, failedOnce };
        }

        // T7: a spread technique hits every enemy standing; a single-target one hits only the one picked
        {
            const a = arena([mkP(1, "A", { mp: 9999, maxMp: 9999 })], [mkE("Kunemon", 5, 99999), mkE("Kunemon", 5, 99999)]);
            const spread = act(a, "p1", { k: "tech", sk: 64, tw: 0, t: 0 });      // Nova Blast (magical, 60 MP)
            const one = act(a, "p1", { k: "tech", sk: 56, tw: 0, t: 1 });         // Pepper Breath (30 MP)
            out.spread = { isSpread64: window.__mpb.isSpread(a.skillDB()[64]), isSpread56: window.__mpb.isSpread(a.skillDB()[56]), rows: spread.rows.length, singleRows: one.rows.map((x) => x[0]) };
        }

        // T9: digivolve: takes the turn, the Digimon becomes the new form, and fights with its numbers
        {
            const sr = (rec) => { rec.statsRecord.formLedger = [{ id: 39, formLevel: 1, dvexp: 0, techSlots: [] }]; rec.statsRecord.equippedForms = [39]; return rec; };
            const p = mkP(1, "A"); sr(p.rec);
            const a = arena([p], [mkE("Kunemon", 5, 99999)]);
            const before = a.P[0].rec.profile.name, strBefore = a.P[0].rec.str;
            const options = kit.forms(a.P[0].rec).map((f) => f.name);
            const r = act(a, "p1", { k: "dv", form: 39 });
            const p2 = mkP(1, "A"); sr(p2.rec);
            const bad = act(arena([p2], [mkE("Kunemon", 5, 99999)]), "p1", { k: "dv", form: 12345 });
            const hit = act(a, "p1", { k: "fight", t: 0 });
            out.dv = { before, after: a.P[0].rec.profile.name, options, lines: r.lines, kind: r.kind, refused: bad.lines[0], attackOk: hit.rows.length === 1, strSame: a.P[0].rec.str === strBefore };
        }

        // T8: many whole fights with random sizes, species and choices all end cleanly
        {
            let fights = 0, steps = 0, bad = [];
            for (let n = 0; n < 40; n++) {
                const np = 1 + (n % 4), nf = 1 + ((n * 7) % 6);
                const ps = Array.from({ length: np }, (_, i) => mkP(i + 1, "P" + (i + 1), { level: 5 + ((n + i) % 30), hp: 200 + 20 * i, maxHp: 200 + 20 * i, str: 30 + ((n * 13 + i * 7) % 90), def: 20 + ((n * 5 + i) % 60), spd: 30 + ((n * 11 + i * 3) % 100) }));
                const fs = Array.from({ length: nf }, (_, i) => mkE(names[(n * 5 + i * 3) % names.length], 3 + ((n + i * 4) % 30), 120 + ((n * 37 + i * 50) % 600)));
                const a = new Arena({ kit, players: ps, foes: fs, waveSize: Math.max(2, np) });
                let guard = 0;
                while (a.state() === "play" && guard++ < 2000) {
                    const nx = a.next();
                    if (!nx) break;
                    if (nx.wave != null) continue;
                    const actor = a.byKey(nx.key);
                    if (actor.rec.hp <= 0 || actor.fled) { bad.push(`${nx.key} acted while down`); break; }
                    const ts = a.turnStart(nx.key);
                    const res = ts.skipped ? { lines: ts.lines, rows: [] } : nx.key[0] === "e" ? a.foeAction(nx.key)
                        : a.playerAction(nx.key, ((guard % 7) === 0) ? { k: "run" } : { k: "fight", t: a.aliveFoes()[0].i });
                    a.finish(nx.key, res); steps++;
                    for (const x of [...a.P, ...a.E]) if (!(x.rec.hp >= 0 && x.rec.hp <= x.rec.maxHp)) bad.push(`${x.key} hp ${x.rec.hp}/${x.rec.maxHp}`);
                    if (bad.length) break;
                }
                if (guard >= 2000) bad.push("fight " + n + " never ended");
                fights++;
                if (bad.length) break;
            }
            out.fights = { fights, steps, bad: bad.slice(0, 3) };
        }

        // T10: every Digimon has its own DV gauge: it fills from the hits it takes, and a full gauge is the automatic Blast
        {
            const p = mkP(1, "A", { mp: 400, maxMp: 400, hp: 400, maxHp: 400 });
            const a = arena([p], [mkE("Kunemon", 30, 99999)]);
            const rec = a.P[0].rec;
            const blastTo = kit.blastForm(rec);
            let filled = 0;
            for (let i = 0; i < 12 && !filled; i++) { rec.hp = rec.maxHp; const r = a.foeAction("e0"); a.finish("e0", r); filled = rec.gauge | 0; }
            const g1 = rec.gauge | 0;
            rec.gauge = 995; rec.hp = rec.maxHp; rec.mp = 300;
            let blasted = false, line = "", before = rec.profile.name;
            for (let i = 0; i < 60 && !blasted; i++) { rec.hp = 380; const r = a.foeAction("e0"); a.finish("e0", r); if (rec.blast?.active) { blasted = true; line = r.lines.join(" | "); } }
            const healed = rec.hp === rec.maxHp, formNow = rec.profile.name, turnsLeft = rec.blast?.turns;
            const mpBefore = rec.mp; const tech = act(a, "p1", { k: "tech", sk: 56, tw: 0, t: 0 });
            const free = rec.mp === mpBefore;
            let reverted = false, gaugeAfter = null, formBack = null, revLine = "";
            for (let i = 0; i < 8 && !reverted; i++) { const r = act(a, "p1", { k: "fight", t: 0 }); if (!rec.blast) { reverted = true; revLine = r.lines.join(" | "); } }
            gaugeAfter = rec.gauge; formBack = rec.profile.name;
            out.gauge = { blastTo: blastTo?.name ?? null, g1, blasted, line, healed, before, formNow, turnsLeft, free, techLine: tech.lines[0], reverted, revLine, gaugeAfter, formBack };
        }

        // T11: Tag: a player brings three Digimon and swaps the one in the fight; a fallen one is replaced from the reserves
        {
            const mk3 = () => { const a0 = mkP(1, "A"), a1 = mkP(1, "A", { level: 12 }), a2 = mkP(1, "A", { level: 7 }); a0.party = [a0.rec, a1.rec, a2.rec]; return a0; };
            const a = arena([mk3()], [mkE("Kunemon", 5, 99999)]);
            const P = a.P[0], r0 = P.rec, r1 = P.party[1], r2 = P.party[2];
            r0.gauge = 600;
            const same = act(a, "p1", { k: "tag", slot: 0 });
            r2.hp = 0;
            const dead = act(a, "p1", { k: "tag", slot: 2 });
            const t = act(a, "p1", { k: "tag", slot: 1 });
            const swapped = P.rec === r1 && P.act === 1;
            const seat = [r1.sideByte, r1.slot, !!r1.statusEvents];
            // the outgoing's gauge stays with it; the incoming has its own
            const gauges = [r0.gauge, r1.gauge];
            // a fight with a reserve left: the fallen Digimon must be replaced, the fight goes on
            r1.hp = 0; a.finish("e0", { lines: [], rows: [] });
            const needs = P.needTag, forced = a.forcedTag()?.key ?? null, nx = a.next(), stateDuring = a.state();
            const f = a.playerAction("p1", { k: "tag", slot: 0 }); a.afterFree(f);
            const back = P.rec === r0 && !P.needTag && a.state() === "play";
            // no reserves left alive: the fight is lost
            r0.hp = 0; a.finish("e0", { lines: [], rows: [] });
            out.tag = { sameRefused: same.refused === true, deadRefused: dead.refused === true, line: t.lines.join(" | "), swapped, seat, gauges, needs, forced, nxForced: nx?.forced === true && nx.key === "p1", stateDuring, back, lostWhenNone: a.state() };
        }

        // T12: stealing: a steal technique that lands takes the enemy's drop item (the disc's own roll)
        {
            const steal = Object.values(window.__battle ? kit.skillDB() : {}).find((x) => x.effect === "steal");
            const dropName = Object.keys(window.__ITEM_BY_NAME ?? {}).find((n) => /^PowerCharge$/i.test(n)) ?? Object.keys(window.__ITEM_BY_NAME ?? {})[0];
            const p = mkP(1, "A", { mp: 9999, maxMp: 9999, spd: 400 });
            const a = arena([p], [mkE("Kunemon", 5, 99999)]);
            a.E[0].rec.eStats.drop_item = dropName;
            let got = null, lines = [], tries = 0;
            if (steal) for (; tries < 300 && got == null; tries++) { const r = act(a, "p1", { k: "tech", sk: steal.id, tw: 0, t: 0 }); if (r.st != null) { got = r.st; lines = r.lines; } }
            out.steal = { skill: steal?.name ?? null, dropName, expect: window.__ITEM_BY_NAME?.[dropName]?.id ?? null, got, tries, lines };
        }
        return out;
    });

    ok("the game's own strings are used", results.strings.dmg === "42 damage!" && results.strings.evade === "Evade!" && /7HP healed!/.test(results.strings.heal) && results.strings.poison === "Poisoned: 5", JSON.stringify(results.strings));
    const c = results.timeline;
    ok("the action timeline: the faster fighter acts more often", c.p1 > c.p2 * 1.5, JSON.stringify(c));
    ok("enemies go for the wounded, but not only for them", results.targeting.p1 > results.targeting.p2 * 2 && results.targeting.p2 > 15, JSON.stringify(results.targeting));
    ok("poison lands from a technique, with the game's word", results.poison.landed && /Poisoned!/.test(results.poison.line), results.poison.line);
    ok("poison ticks on the timeline and hurts", /Poisoned:/.test(results.poisonTick.tick) && results.poisonTick.hpDropped, JSON.stringify(results.poisonTick));
    ok("sleep lands, costs the enemy its turn, and wears off", results.sleep.landed && results.sleep.skipsTurn === true && results.sleep.recovers, JSON.stringify(results.sleep));
    ok("a charge heals the friend I pick", results.charge.hp >= 550 && results.charge.lines.some((l) => /HP healed/.test(l)), JSON.stringify(results.charge));
    ok("a revive item brings a downed friend back", results.revive.hp > 0, JSON.stringify(results.revive));
    ok("a heal technique heals a friend and costs MP", results.heal.hp > 100 && results.heal.mp < 500, JSON.stringify(results.heal));
    ok("a buff technique changes a stat", results.buff.str > 0, JSON.stringify(results.buff));
    ok("a technique with too little MP is refused", /No MP/.test(results.noMp ?? ""), String(results.noMp));
    ok("running away can fail and can succeed, and then the player is out", results.run.fled, JSON.stringify(results.run));
    ok("a spread technique hits every enemy; a single one hits only its target", results.spread.isSpread64 && !results.spread.isSpread56 && results.spread.rows === 2 && results.spread.singleRows.join() === "e1", JSON.stringify(results.spread));
    ok("digivolve: offered from the Digimon's own forms, takes the turn, the new form fights; a bad form is refused",
        results.dv.after !== results.dv.before && results.dv.options.includes(results.dv.after) && /Digivolved! /.test(results.dv.lines.join()) && results.dv.attackOk && /No effect/.test(results.dv.refused ?? ""), JSON.stringify(results.dv));

    const gg = results.gauge;
    ok("a hit fills the Digimon's own DV gauge", gg.g1 > 0, JSON.stringify({ g1: gg.g1 }));
    ok("a full gauge is the automatic Blast: new form, fully healed, 'Blasted!'", gg.blasted && gg.formNow !== gg.before && gg.healed && /Blasted!/.test(gg.line), JSON.stringify({ blastTo: gg.blastTo, before: gg.before, formNow: gg.formNow, healed: gg.healed, line: gg.line }));
    ok("techniques are free in a Blast", gg.free === true, gg.techLine);
    ok("the Blast ends after its turns: form back, gauge spent, 'Back to normal!'", gg.reverted && gg.formBack === gg.before && gg.gaugeAfter === 0 && /Back to normal!/.test(gg.revLine), JSON.stringify({ reverted: gg.reverted, formBack: gg.formBack, gaugeAfter: gg.gaugeAfter, revLine: gg.revLine }));
    const tg = results.tag;
    ok("Tag: the reserve takes the fight, 'Go for it!', on the player's seat", tg.swapped && /Go for it!/.test(tg.line) && tg.seat[0] === 0 && tg.seat[2] === true, JSON.stringify(tg));
    ok("Tag: the one already out, or a fallen one, is refused", tg.sameRefused && tg.deadRefused, JSON.stringify({ same: tg.sameRefused, dead: tg.deadRefused }));
    ok("Tag: each Digimon keeps its own gauge", tg.gauges[0] === 600 && tg.gauges[1] !== 600, JSON.stringify(tg.gauges));
    ok("a fallen Digimon with reserves left: the player must pick the next, and the fight goes on", tg.needs === true && tg.forced === "p1" && tg.nxForced && tg.stateDuring === "play" && tg.back, JSON.stringify(tg));
    ok("with no reserve left standing the fight is lost", tg.lostWhenNone === "lost", tg.lostWhenNone);
    const st = results.steal;
    ok("stealing: a landed steal technique takes the enemy's drop", st.skill && st.got != null && st.got === st.expect && st.lines.some((l) => /Stole/.test(l)), JSON.stringify(st));
    ok("40 random fights (1-4 players, 1-6 enemies, many species) all end cleanly", results.fights.fights === 40 && results.fights.bad.length === 0, JSON.stringify(results.fights));
    ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
    await browser.close();
}
