// EXPERIMENT: the rules of a many-vs-many fight (not original game content).
//
// The game's own battle code is built for one Digimon against one enemy, from its menus to its message boxes. Its RULES,
// though, are decoded as separate routines that work on plain fighter records, and this module runs those same routines
// for any number of fighters on each side. Nothing here invents a rule that the game has:
//   who acts next      the game's action timeline (actionTimelineDelay): faster fighters act more often, the same code
//   what an enemy does the game's enemy AI (pickEnemyAiMove over the species' own four move rows), including its flee action,
//                      with the real list of enemies standing there for the "how many of us are left" conditions
//   a blow             the game's resolver: accuracy, the critical roll, STR/DEF or SPT, element, armour; multi-hit; drain
//   what comes with it ailments from techniques and signature weapons, instant death, counter stance
//   status             start-of-turn sleep / frozen / confused; the shared status-event pool for poison ticks, recoveries and
//                      buffs wearing off; gradual HP recovery
//   heals and buffs    the category-4 restore plans and the category-5 plans (Double Power, Soul Charge, locks...)
//   items              the game's own item effects (useBattleItem), and the plain HP / MP charges
//   running away       the game's run roll, and the enemy's flee roll
//   the words          the game's own battle strings (esmfight bank): "Evade!", "{1} damage!", "Poisoned: {1}"...
//   Tag                a player brings up to three Digimon and swaps the one in the fight (the game's Tag: the outgoing one's
//                      Blast is forfeited); a knocked-out one is replaced at once from the reserves, as the game forces it
//   the DV gauge       every Digimon has its own: it fills from the hits it takes (hitGaugeGain), and a full gauge is the
//                      automatic Blast: the Digimon takes its Blast form, is fully healed, fights MP-free for 6 of its turns
//   stealing           a steal technique that lands rolls the game's steal roll (stealProc) for the enemy's drop item
// What is NOT the game's: choosing a target among several (enemies weigh up wounded, helpless and counter-ready players;
// players pick), and spread techniques (a strong magic attack hits everyone on the other side at 65% damage).
//
// One game (the "referee", the player who started the fight) holds every fighter's record and runs all of this, so every number
// is decided in one place; the other players send their choices and see the result.
import {
    RAND_U16, pickEnemyAiMove, techniqueMpCost, actionTimelineDelay, statusEventActionDelay, advanceStatusEvents,
    emptyStatusEventPool, poisonTimelineDamage, advanceAilmentTimeline, useBattleItem, isBattleEffectItem, fleeChance,
    enemyFleeProc, elementId, enemyActionSkillId, basicAttackHitCount, resolveAttack, resolveMultiHit, statusEventLockHeld,
    ITEM_BY_ID, effStats, hitGaugeGain,
} from "./vendor/engine.js";
import {
    tryInflict, applyWeaponSecondary, triggerCounter, setCounterStance, battleRestorePlanFor, battleScriptedPlanFor,
    restoreWalkerSentence, scriptedWalkerSentence, processTurnStart, ailmentWord,
    normalizeDvGauge, DV_GAUGE_MAX, blastLandingHeal, setLiveBattleForm,
} from "./battle.js";
import { battleAilmentByte } from "./battlecmd-translated.js";
import { battleMsgText } from "./battlemsg-translated.js";

export const SPREAD_FACTOR = 0.65;
export const SPREAD_MP = 40;                 // a magical technique that costs at least this much hits everyone
/** A technique that hits everyone on the other side. */
export const isSpread = (skill) => !!skill && skill.attack_category === "magical" && (skill.mp_cost ?? 0) >= SPREAD_MP;

/** One of the game's own battle strings, with {1} {2}... filled in. */
export function T(index, ...slots) {
    let s = battleMsgText(0x7f, index) || "";
    slots.forEach((v, i) => { s = s.replace(`{${i + 1}}`, String(v)); });
    // an invisible tag ( index , numbers ) lets the fight screen open the game's own message page for this line
    if (s && slots.every((v) => Number.isFinite(Number(v)) && typeof v !== "boolean")) s += `${index}${slots.map((v) => "," + (Number(v) | 0)).join("")}`;
    return s;
}
/** A line without the tags. */
export const plainLine = (l) => String(l ?? "").replace(/[^]*/g, "");
const MSG = { ATTACK: 0x08, DAMAGE: 0x0b, EVADE: 0x1d, HEALED: 0x22, NO_EFFECT: 0x2f, RUN: 0x41, COULDNT_RUN: 0x42, RUN_AWAY: 0x43, POISON_TICK: 0x55, DEFEATED: 0x51, KO: 0x50, FLEEING: 0x5f, DID_NOT_FLEE: 0x60 };
// the item-menu "actor page" ids the engine's items speak through (kind 2): the words live in the same bank
const itemWord = (page, name) => {
    const idx = page?.payload?.[0];
    const word = Number.isInteger(idx) ? battleMsgText(0x7f, idx) : "";
    return word ? `${name}: ${word.replace("{1}", page.slots?.[0] ?? page.payload?.[1] ?? "")}`.trim() : "";
};

const SIDE_PLAYER = 0, SIDE_FOE = 0x10;

export class Arena {
    /**
     * players: [{ id, name, rec }]   foes: [{ name, rec }]   (rec = a fighter record, the engine's own shape)
     * waveSize: how many enemies stand at once
     */
    constructor({ kit, players, foes, screenId = null, waveSize = 2, rng = RAND_U16 }) {
        this.kit = kit; this.screenId = screenId; this.rng = rng;
        this.pool = emptyStatusEventPool();
        this.field = null;
        this.waveSize = Math.max(1, waveSize);
        this.wave = 0;
        this.P = players.map((p, i) => {
            const party = (p.party?.length ? p.party : [p.rec]).slice(0, 3);
            party.forEach((r) => { r.ailments ??= {}; });
            return { key: "p" + p.id, id: p.id, name: p.name, rec: this.#seat(p.rec, SIDE_PLAYER, i), fled: false, party, act: Math.max(0, party.indexOf(p.rec)), needTag: false };
        });
        for (const p of this.P) if (!p.party.includes(p.rec)) { p.party[0] = p.rec; p.act = 0; }
        this.E = foes.map((f, i) => ({ key: "e" + i, i, name: f.name, rec: this.#seat(f.rec, SIDE_FOE, i), fled: false }));
        this.time = new Map();                    // actor key -> when it next acts (the shared timeline)
        this.lastTarget = new Map();              // foe key -> the player it hit last (to spread the hits around)
        this.#seatWave();
    }

    #seat(rec, sideByte, slot) {
        rec.sideByte = sideByte; rec.slot = slot; rec.statusEvents = this.pool; rec.ailments ??= {};
        return rec;
    }
    skillDB() { return this.kit.skillDB(); }

    // ---------------------------------------------------------- who is standing
    get players() { return this.P; }
    alivePlayers() { return this.P.filter((p) => p.rec.hp > 0 && !p.fled); }
    #reserve(p) { return p.party.some((r, i) => i !== p.act && r.hp > 0); }
    /** Players still in the fight: the Digimon out is up, or a reserve can take its place. */
    standing() { return this.P.filter((p) => !p.fled && (p.rec.hp > 0 || this.#reserve(p))); }
    /** A player whose Digimon fell and who must pick the next one before anything else happens. */
    forcedTag() { return this.P.find((p) => p.needTag && !p.fled && this.#reserve(p)) ?? null; }
    waveFoes() { return this.E.filter((e) => e.i >= this.wave * this.waveSize && e.i < (this.wave + 1) * this.waveSize); }
    aliveFoes() { return this.waveFoes().filter((e) => e.rec.hp > 0 && !e.fled); }
    byKey(key) { return this.P.find((p) => p.key === key) ?? this.E.find((e) => e.key === key) ?? null; }
    recAt(side, slot) { return ((side | 0) < 1 ? this.P[slot | 0] : this.E[slot | 0])?.rec ?? null; }
    waves() { return Math.ceil(this.E.length / this.waveSize); }
    /** "play" | "won" | "lost" | "fled" */
    state() {
        if (!this.standing().length) return this.P.some((p) => p.rec.hp <= 0 && !p.fled) ? "lost" : "fled";
        const cleared = this.aliveFoes().length === 0;
        if (cleared && (this.wave + 1) * this.waveSize >= this.E.length) return "won";
        return "play";
    }

    // ---------------------------------------------------------- the action timeline
    #effSpd(rec) { return Math.max(1, (effStats(rec)?.spd ?? rec.spd) | 0); }
    #avgSpd(list) { return list.length ? list.reduce((s, a) => s + this.#effSpd(a.rec), 0) / list.length : 100; }
    #seatWave() {
        const foes = this.waveFoes(), ps = this.alivePlayers();
        for (const p of ps) if (!this.time.has(p.key)) this.time.set(p.key, 0);
        for (const e of foes) if (!this.time.has(e.key)) this.time.set(e.key, Math.trunc(actionTimelineDelay(this.#effSpd(e.rec), this.#avgSpd(ps)) / 2));
    }
    /** The next fighter to act: { key } | { wave: n } (a new wave has come on) | null (the fight is over). */
    next() {
        const st = this.state();
        if (st !== "play") return null;
        if (!this.aliveFoes().length) { this.wave++; this.#seatWave(); return { wave: this.wave }; }
        const forced = this.forcedTag();
        if (forced) return { key: forced.key, forced: true };
        const actors = [...this.alivePlayers(), ...this.aliveFoes()];
        let best = null;
        for (const a of actors) {
            const t = this.time.get(a.key) ?? 0;
            // an exact tie goes to the enemy, as in the game's own queue; then the faster one
            const better = !best || t < best.t || (t === best.t && ((a.key[0] === "e" && best.a.key[0] !== "e") || (a.key[0] === best.a.key[0] && this.#effSpd(a.rec) > this.#effSpd(best.a.rec))));
            if (better) best = { a, t };
        }
        if (!best) return null;
        for (const a of actors) this.time.set(a.key, Math.max(0, (this.time.get(a.key) ?? 0) - best.t));
        return { key: best.a.key };
    }

    // ---------------------------------------------------------- a turn
    /** Sleep, frozen and confusion take a turn away; poison etc. are ticks on the timeline instead. */
    turnStart(key) {
        const a = this.byKey(key);
        const ts = processTurnStart(a.rec, a.name, true, true);
        return ts.skipped ? { skipped: true, lines: [ts.prefix || `${a.name} can't move!`] } : { skipped: false, lines: [] };
    }

    /** After an action: put the actor back on the timeline and let the status-event pool tick once. */
    finish(key, res, target = null) {
        const a = this.byKey(key);
        if (a && !a.fled) {
            const foes = a.key[0] === "p" ? this.aliveFoes() : this.alivePlayers();
            const opp = target?.rec ? this.#effSpd(target.rec) : this.#avgSpd(foes);
            this.time.set(a.key, (this.time.get(a.key) ?? 0) + actionTimelineDelay(this.#effSpd(a.rec), Math.max(1, opp)));
        }
        res.lines.push(...this.#tick());
        this.#afterAction(a, res);
        return res;
    }

    /** A swap that costs no turn (the forced replacement of a fallen Digimon): only the Blast / fallen checks. */
    afterFree(res) { this.#afterAction(null, res); return res; }

    // the automatic Blast (a full DV gauge), its countdown, and the fallen Digimon that must be replaced
    #afterAction(actor, res) {
        if (actor && actor.key[0] === "p" && actor.rec.blast?.active && actor.rec.hp > 0) {
            if (--actor.rec.blast.turns <= 0) {                           // the Blast runs out: the form goes back, the gauge is spent
                const r = actor.rec;
                setLiveBattleForm(r, r.blast.saved); r.blast = null; r.gauge = 0;
                res.lines.push(`${actor.rec.profile?.name ?? actor.name}: ${T(0x62)}`);   // "Back to normal!"
                res.rows.push(this.#row(actor, 0, true));
            }
        }
        for (const p of this.P) {
            if (p.fled) continue;
            const r = p.rec;
            if (r.hp <= 0) {
                if (r.blast?.active) { r.blast = null; r.gauge = 0; }      // a Blast does not outlive its Digimon
                if (this.#reserve(p)) p.needTag = true;
                continue;
            }
            if (!r.blast?.active && (r.gauge | 0) >= DV_GAUGE_MAX) {
                const to = this.kit.blastForm(r);
                if (!to) continue;
                r.blast = { active: true, saved: r.profile, turns: 6 };
                setLiveBattleForm(r, to); blastLandingHeal(r);
                res.lines.push(`${to.name}: ${T(0x61)}`);                  // "Blasted!"
                res.rows.push(this.#row(p, 0, true));
                res.blasted = (res.blasted ?? []).concat(p.key);
            }
        }
    }

    // the pool: poison ticks, recoveries, buffs wearing off, locks releasing
    #tick() {
        const lines = [];
        const ps = this.alivePlayers(), fs = this.aliveFoes();
        const delay = statusEventActionDelay(ps[0] ? this.#effSpd(ps[0].rec) : 100, fs[0] ? this.#effSpd(fs[0].rec) : 100);
        for (const exp of advanceStatusEvents(this.pool, delay)) {
            const rec = this.recAt(exp.side, exp.slot);
            if (!rec) continue;
            const who = this.#nameOf(rec);
            if (exp.kind === "stat" || exp.kind === "lock") {
                if (exp.kind === "stat") {
                    const key = ["str", "def", "spd"][exp.stat ?? 0];
                    const mods = rec.statMods ?? { str: 0, def: 0, spd: 0 };
                    mods[key] = 0; rec.statMods = mods;
                }
                if (exp.lock === 0) rec.cantFlee = false;
                if (exp.lock === 1) rec.cantDigivolve = false;
                continue;
            }
            if (exp.kind === "poison") {
                if (rec.hp <= 0) continue;
                const amount = poisonTimelineDamage(rec.maxHp, rec.ailments.poison?.power ?? 0,
                    rec.statusResists?.water ?? rec.eStats?.status_resist?.water ?? 0, rec.statusResists?.poison ?? rec.eStats?.status_resist?.poison ?? 0);
                rec.hp = Math.max(0, rec.hp - amount);
                const entry = this.pool.find((e) => e.code === 0x09 && (e.side | 0) === (exp.side | 0) && (e.slot | 0) === (exp.slot | 0));
                if (entry) entry.time = 1000;
                lines.push(`${who}: ${T(MSG.POISON_TICK, amount)}`);
                continue;
            }
            if (exp.kind === "ailment" && rec.ailments?.[exp.ailment]) {
                delete rec.ailments[exp.ailment];
                lines.push(`${who} recovered from ${exp.ailment}!`);
            }
        }
        for (const ev of advanceAilmentTimeline([...ps, ...fs].map((x) => x.rec), 0)) {
            if (ev.kind === "regen") lines.push(`${this.#nameOf(ev.combatant)}: ${T(0x27)}`);
        }
        return lines;
    }
    #nameOf(rec) { return (this.P.find((p) => p.rec === rec) ?? this.E.find((e) => e.rec === rec))?.name ?? "?"; }

    // ---------------------------------------------------------- one blow, either direction
    /** Resolve one attack of `skill` from att to def with the game's own rolls, and everything that rides on a hit. */
    #strike(att, attName, def, defName, skill, spread = false) {
        const lines = [];
        const hits = skill.basic_attack ? basicAttackHitCount(att.multiAttack, skill) : Math.max(1, skill.hits ?? 1);
        const r = hits > 1 ? resolveMultiHit(att, def, skill, hits, this.rng, this.field) : resolveAttack(att, def, skill, this.rng, this.field);
        const landed = !!r.hit;
        let dmg = landed ? Math.max(0, r.dmg | 0) : 0;
        if (landed && spread) dmg = Math.floor(dmg * SPREAD_FACTOR);
        if (!landed) { lines.push(`${defName}: ${T(MSG.EVADE)}`); return { hit: false, dmg: 0, lines }; }
        def.hp = Math.max(0, def.hp - dmg);
        lines.push(`${defName}: ${T(MSG.DAMAGE, dmg)}${hits > 1 && r.landed ? ` (${r.landed}/${hits})` : ""}`);
        if ((def.sideByte | 0) === SIDE_PLAYER) {                  // a hit taken fills this Digimon's own DV gauge (not on a KO, not in a Blast)
            const gain = hitGaugeGain(dmg, def.maxHp, def.hp, { blastActive: !!def.blast?.active, accessories: def.gaugeAccessories });
            if (gain !== null) def.gauge = normalizeDvGauge((def.gauge | 0) + gain);
        }
        if (r.heal > 0) {                                           // a draining technique feeds the attacker
            const before = att.hp;
            att.hp = Math.min(att.maxHp, att.hp + r.heal);
            if (att.hp > before) lines.push(`${attName}: ${T(MSG.HEALED, att.hp - before)}`);
        }
        const inflicted = tryInflict(skill, def, defName, att);   // ailments and instant death from a technique
        if (inflicted.text) lines.push(inflicted.text.trim());
        if (inflicted.ail) lines.push(`${defName}: ${ailmentWord(inflicted.ail)}`);
        if (skill.basic_attack) {                                  // a signature weapon's secondary effect and drain
            const w = applyWeaponSecondary(att, def, defName, dmg, attName);
            if (w.text) lines.push(w.text.trim());
            if (w.ail) lines.push(`${defName}: ${ailmentWord(w.ail)}`);
        }
        let stolen = null;
        if (skill.effect === "steal" && (att.sideByte | 0) === SIDE_PLAYER) {   // the disc's steal roll, for the enemy's drop
            const st = this.kit.stealRoll?.(skill, att, def);
            if (st?.ok) { stolen = st.item; lines.push(`${attName}: ${T(0x26)} ${T(0x09, st.name)}`); }          // "Stole {item}!"
            else if (st?.nothing) lines.push(`${attName}: ...but there was nothing to steal!`);
        }
        const counter = triggerCounter(att, def, dmg, attName);   // a counter stance sends half of it back
        if (counter) lines.push(counter.trim());
        return { hit: true, dmg, lines, instantDeath: !!inflicted.text, stolen };
    }

    #row(entry, dmg, hit) { return [entry.key, dmg | 0, hit ? 1 : 0, entry.rec.hp <= 0 ? 1 : 0]; }
    #koLine(entry) { return `${entry.name}: ${T(entry.key[0] === "e" ? MSG.DEFEATED : MSG.KO)}`; }

    /** A pseudo battle object holding exactly what the game's party-wide helpers read (they were written for one pair). */
    #bLike({ caster, allies = [], enemy = null, side = 0 }) {
        const recs = allies.map((a) => a.rec);
        return {
            player: side < 1 ? caster.rec : (allies[0]?.rec ?? null), enemy: side < 1 ? (enemy?.rec ?? null) : caster.rec,
            playerRecords: recs.slice(0, 3), activePlayerIndex: 0, statusEvents: this.pool, field: this.field,
            specialMode: 0, effectGates: {}, encounterGateBytes: null, screenId: this.screenId,
        };
    }

    /** The common middle of an attack: the caster uses `skill` on `targets`; works for both sides. */
    #damageAction(caster, skill, targets, defenders) {
        const res = { lines: [], rows: [], a: caster.key, sk: skill.id | 0, kind: "atk" };
        const spread = targets.length > 1;
        for (const t of targets) {
            const out = this.#strike(caster.rec, caster.name, t.rec, t.name, skill, spread);
            res.lines.push(...out.lines);
            if (out.stolen != null) res.st = out.stolen;
            res.rows.push(this.#row(t, out.dmg, out.hit));
            if (t.rec.hp <= 0) res.lines.push(this.#koLine(t));
        }
        if (caster.rec.hp <= 0) res.lines.push(this.#koLine(caster));      // a counter can fell the attacker
        void defenders;
        return res;
    }

    #usableTarget(list, idx) {
        const wanted = Array.isArray(idx) ? idx : [idx];
        const picked = list.filter((x) => wanted.includes(x.i ?? x.id));
        return picked.length ? picked : list.slice(0, 1);
    }

    // ---------------------------------------------------------- a player's turn
    /**
     * cmd: { k: "fight", t: foeIndex } | { k: "tech", sk, tw, t: foeIndex | allyKey } | { k: "item", item, to: key } | { k: "run" }
     * Returns { lines, rows, a, sk, kind } (kind "atk" | "self" | "item" | "run"); `fled` when the player left.
     */
    playerAction(key, cmd) {
        const me = this.byKey(key);
        const A = me.rec, foes = this.aliveFoes();
        if (me.needTag) return this.#tag(me, cmd);
        if (!foes.length) return { lines: [], rows: [], a: key, sk: 0, kind: "self" };
        if (cmd.k === "run") return this.#run(me);
        if (cmd.k === "item") return this.#item(me, cmd);
        if (cmd.k === "dv") return this.#digivolve(me, cmd);
        if (cmd.k === "tag") return this.#tag(me, cmd);
        let skill;
        let cost = 0;
        if (cmd.k === "tech") {
            skill = this.skillDB()[cmd.sk | 0];
            if (!skill) return { lines: [`${me.name}: ${T(MSG.NO_EFFECT)}`], rows: [], a: key, sk: 0, kind: "self" };
            cost = A.blast?.active ? 0 : techniqueMpCost(skill.mp_cost ?? 20, cmd.tw | 0, { mpCostDown: A.mpCostDown ?? 0 });   // (techniques are free in a Blast)
            if (A.mp < cost) return { lines: [`${me.name}: ${T(0x54)}`], rows: [], a: key, sk: 0, kind: "self" };   // "No MP."
            A.mp -= cost;
        } else {
            skill = this.kit.basic(A);
        }
        const record = this.kit.techRecord(skill.id);
        const cat = record?.category | 0;
        if (cat === 4 || cat === 5) return this.#support(me, skill, record, cmd);
        const lines = [`${me.name}: ${cmd.k === "tech" ? T(0x09, skill.name) : T(MSG.ATTACK)}`];
        setCounterStance(skill, A);
        const targets = isSpread(skill) ? foes : this.#usableTarget(foes, cmd.t);
        const res = this.#damageAction(me, skill, targets);
        res.lines.unshift(...lines);
        return res;
    }

    // heals, cures and buffs: the game's category-4 and category-5 plans, on whoever the player picked
    #support(me, skill, record, cmd) {
        const allies = this.alivePlayers();
        const wanted = allies.find((p) => p.key === cmd.t) ?? me;
        const ordered = [wanted, ...allies.filter((p) => p !== wanted)].slice(0, 3);
        const foe = this.#usableTarget(this.aliveFoes(), typeof cmd.t === "number" ? cmd.t : undefined)[0] ?? null;
        const b = this.#bLike({ caster: me, allies: ordered, enemy: foe, side: 0 });
        b.player = wanted.rec;
        const res = { lines: [`${me.name}: ${T(0x09, skill.name)}`], rows: [], a: me.key, sk: skill.id | 0, kind: "self" };
        if ((record.category | 0) === 4) {
            const plan = battleRestorePlanFor(b, 0, record, skill.id, { name: me.name, wisdom: me.rec.wis });
            if (plan) res.lines.push(restoreWalkerSentence(plan, skill, me.name).replace(/^.*?uses [^!]*!\s*/, `${wanted.name}: `));
        } else {
            b.player = me.rec;
            const plan = battleScriptedPlanFor(b, 0, record, skill.id, { name: me.name });
            if (plan) res.lines.push(scriptedWalkerSentence(plan, skill, me.name).replace(/^.*?uses [^!]*!\s*/, ""));
        }
        for (const p of ordered) if (p.rec.hp > 0) res.rows.push(this.#row(p, 0, true));
        return res;
    }

    // items: the game's own effects
    #item(me, cmd) {
        const item = ITEM_BY_ID[cmd.item | 0];
        const res = { lines: [], rows: [], a: me.key, sk: 0, kind: "item" };
        if (!item) { res.lines.push(`${me.name}: ${T(MSG.NO_EFFECT)}`); return res; }
        const to = this.P.find((p) => p.key === cmd.to && !p.fled) ?? me;     // (a downed ally may be picked: a revive item)
        const rec = to.rec;
        const foe = this.#usableTarget(this.aliveFoes(), typeof cmd.t === "number" ? cmd.t : undefined)[0] ?? null;
        res.lines.push(`${me.name} used ${item.name}!`);
        if (item.effect === "full_hp" && !isBattleEffectItem(item.id)) {
            const healed = rec.maxHp - rec.hp; rec.hp = rec.maxHp;
            res.lines.push(healed > 0 ? `${to.name}: ${T(MSG.HEALED, healed)}` : `${to.name}: ${T(MSG.NO_EFFECT)}`);
        } else if (item.effect === "hp" && !isBattleEffectItem(item.id)) {
            const healed = Math.min(item.value, rec.maxHp - rec.hp); rec.hp += healed;
            res.lines.push(healed > 0 ? `${to.name}: ${T(MSG.HEALED, healed)}` : `${to.name}: ${T(MSG.NO_EFFECT)}`);
        } else if (item.effect === "mp" && !isBattleEffectItem(item.id)) {
            const restored = Math.min(item.value, rec.maxMp - rec.mp); rec.mp += restored;
            res.lines.push(`${to.name}: ${restored} MP restored!`);
        } else if (isBattleEffectItem(item.id) || item.effect === "battle") {
            const offensive = item.id >= 85 && item.id !== 84;
            const user = offensive ? me.rec : rec;
            const r = useBattleItem(item.id, user, foe?.rec ?? me.rec, {
                userName: offensive ? me.name : to.name, enemyName: foe?.name ?? "Enemy", party: this.P.filter((p) => !p.fled).map((p) => p.rec),
                userIndex: this.P.indexOf(offensive ? me : to), effectGates: {}, specialMode: 0,
                setField: (element, power) => { this.field = { element, power }; },
            });
            for (const page of r.pages ?? []) { const t = itemWord(page, page.name ?? to.name); if (t) res.lines.push(t); }
            if (!r.ok && !r.pages?.length) res.lines.push(`${to.name}: ${T(MSG.NO_EFFECT)}`);
        }
        for (const p of this.P) if (p.rec.hp > 0 || p === to) res.rows.push(this.#row(p, 0, true));
        for (const e of this.waveFoes()) if (e.rec.hp <= 0) res.rows.push(this.#row(e, 0, true));
        return res;
    }

    // Tag: another of the player's Digimon takes the fight; the one that was out goes to the reserves
    #tag(me, cmd) {
        const res = { lines: [], rows: [], a: me.key, sk: 0, kind: "tag" };
        const forced = me.needTag;
        const slot = cmd.k === "tag" ? cmd.slot | 0 : -1;
        const inc = me.party[slot];
        if (!inc || slot === me.act || inc.hp <= 0) { res.lines.push(`${me.name}: ${T(0x8e)}`); res.kind = "run"; res.refused = true; return res; }
        const out = me.rec;
        if (out.blast?.active) { setLiveBattleForm(out, out.blast.saved); out.blast = null; out.gauge = 0; }   // a Tag forfeits the Blast
        for (let i = this.pool.length - 1; i >= 0; i--) {                     // the outgoing Digimon's timers do not follow it
            const e = this.pool[i];
            if ((e.side | 0) === SIDE_PLAYER && (e.slot | 0) === (out.slot | 0)) this.pool.splice(i, 1);
        }
        const seat = out.slot | 0;
        this.#seat(inc, SIDE_PLAYER, seat);
        me.rec = inc; me.act = slot; me.needTag = false;
        res.lines.push(`${inc.profile?.name ?? me.name}: ${T(0x39)}`);       // "Go for it!"
        res.rows.push(this.#row(me, 0, true));
        res.forced = forced;
        return res;
    }

    // a manual digivolve takes the turn: the Digimon takes the form, and fights with that form's numbers from now on
    #digivolve(me, cmd) {
        const res = { lines: [], rows: [], a: me.key, sk: 0, kind: "dv" };
        const form = this.kit.forms(me.rec).find((f) => f.id === (cmd.form | 0));
        if (!form || me.rec.cantDigivolve) { res.lines.push(`${me.name}: ${T(me.rec.cantDigivolve ? 0x45 : MSG.NO_EFFECT)}`); res.kind = "run"; return res; }
        this.kit.digivolve(me.rec, form.id);
        res.lines.push(`${me.name}: ${T(0x37, form.name)}`);                 // "Digivolved! {1}!"
        res.rows.push(this.#row(me, 0, true));
        return res;
    }

    #run(me) {
        const res = { lines: [`${me.name}: ${T(MSG.RUN)}`], rows: [], a: me.key, sk: 0, kind: "run" };
        const foes = this.aliveFoes();
        const lvl = foes.length ? foes.reduce((s, f) => s + (f.rec.level | 0), 0) / foes.length : 1;
        const spd = this.#avgSpd(foes);
        const blocked = statusEventLockHeld(this.pool, 0, SIDE_PLAYER, me.rec.slot | 0);
        if (!blocked && fleeChance({ selfLevel: me.rec.level | 0, otherLevel: lvl | 0, selfSpd: me.rec.spd | 0, otherSpd: spd | 0,
            escapeBonus: me.rec.escapeBonus | 0, selfAilment: battleAilmentByte(me.rec), escapeBlocked: false }, this.rng)) {
            me.fled = true;
            res.lines.push(`${me.name}: ${T(MSG.RUN_AWAY)}`);
            res.fled = true;
        }
        return res;
    }

    // ---------------------------------------------------------- an enemy's turn
    /** Weigh up the players: the wounded and the helpless draw fire; a counter stance is avoided; the last victim is slightly spared. */
    #pickTarget(foe) {
        const alive = this.alivePlayers();
        if (alive.length < 2) return alive[0] ?? null;
        const weights = alive.map((p) => {
            const r = p.rec, pct = r.hp / Math.max(1, r.maxHp);
            let w = 1 + 2.2 * (1 - pct);
            if (pct < 0.25) w += 1.5;
            if (r.ailments?.sleep || r.ailments?.frozen) w += 0.7;
            if (r.counterStance?.uses > 0) w *= 0.45;
            if (this.lastTarget.get(foe.key) === p.key) w *= 0.8;
            return w;
        });
        let roll = Math.random() * weights.reduce((s, w) => s + w, 0);   // (my own choice, not a game rule: so not the game's fixed random table)
        for (let i = 0; i < alive.length; i++) { roll -= weights[i]; if (roll <= 0) return alive[i]; }
        return alive[alive.length - 1];
    }

    foeAction(key) {
        const foe = this.byKey(key), en = foe.rec;
        const alive = this.aliveFoes();
        const target = this.#pickTarget(foe);
        if (!target) return { lines: [], rows: [], a: key, sk: 0, kind: "atk" };
        const moves = en.eStats?.ai_moves;
        const context = {
            partyProfileId: target.rec.profile?.id ?? null, partyAilmentByte: battleAilmentByte(target.rec),
            fieldElementId: this.field ? elementId(this.field.element) : 0, battleId: this.screenId ?? null, encounterGateByte: null,
            enemySlots: alive.map((f) => ({ speciesId: Number(f.rec.profile?.id) || 0, hp: f.rec.hp })),
            activeEnemyIndex: Math.max(0, alive.indexOf(foe)),
        };
        const move = (moves?.length ? pickEnemyAiMove(moves, en, this.rng, target.rec, context) : null) ?? { action: 1 };
        const res = { lines: [], rows: [], a: key, sk: 0, kind: "atk" };
        if (move.action === 4) {                                    // the flee action
            if (enemyFleeProc(target.rec.spd, en.spd, target.rec.binderCrest, this.rng, battleAilmentByte(en))) {
                foe.fled = true; en.hp = 0;
                res.lines.push(`${foe.name}: ${T(MSG.RUN_AWAY)}`);
                res.rows.push([key, 0, 1, 1]);
                res.fled = true;
            } else res.lines.push(`${foe.name}: ${T(MSG.DID_NOT_FLEE)}`);
            return res;
        }
        const data = this.skillDB();
        const wantedId = enemyActionSkillId(move.action || 1, en.eStats ?? {});
        let skill = wantedId ? data[wantedId] : null;
        const usesTech = (move.action === 2 || move.action === 3) && !!skill;
        if (usesTech) {
            const cost = techniqueMpCost(skill.mp_cost ?? 0, 0, { enemySide: true });
            if (en.mp < cost) skill = null; else en.mp -= cost;
        }
        let tech = usesTech && !!skill;
        if (!skill) { skill = en.fightSkill ? { ...en.fightSkill } : null; tech = false; }
        if (!skill) { res.lines.push(`${foe.name}: ...`); return res; }
        if (!tech) { skill = { ...skill, attack_category: "physical", basic_attack: true }; }
        res.sk = skill.id | 0;
        setCounterStance(skill, en);
        const record = this.kit.techRecord(skill.id);
        const cat = record?.category | 0;
        if (tech && (cat === 4 || cat === 5)) {                      // an enemy healing or buffing
            const ordered = [target, ...this.alivePlayers().filter((p) => p !== target)].slice(0, 3);
            const b = this.#bLike({ caster: foe, allies: ordered, enemy: foe, side: 1 });
            b.player = target.rec;
            res.kind = "self";
            res.lines.push(`${foe.name}: ${T(0x09, skill.name)}`);
            const plan = cat === 4 ? battleRestorePlanFor(b, 1, record, skill.id, { name: foe.name, wisdom: en.wis })
                : battleScriptedPlanFor(b, 1, record, skill.id, { name: foe.name });
            if (plan) res.lines.push((cat === 4 ? restoreWalkerSentence(plan, skill, foe.name) : scriptedWalkerSentence(plan, skill, foe.name)).replace(/^.*?uses [^!]*!\s*/, ""));
            for (const p of this.P) if (p.rec.hp > 0) res.rows.push(this.#row(p, 0, true));
            res.rows.push(this.#row(foe, 0, true));
            return res;
        }
        const targets = tech && isSpread(skill) ? this.alivePlayers() : [target];
        res.lines.push(`${foe.name}: ${tech ? T(0x09, skill.name) : T(MSG.ATTACK)}`);
        const out = this.#damageAction(foe, skill, targets);
        res.lines.push(...out.lines); res.rows = out.rows;
        this.lastTarget.set(key, target.key);
        return res;
    }

    // ---------------------------------------------------------- what everyone sees
    /** Plain data for one fighter's plate and the shared snapshot. */
    plate(entry) {
        const r = entry.rec;
        const ail = Object.keys(r.ailments ?? {}).filter((k) => r.ailments[k]).map((k) => k.slice(0, 3).toUpperCase());
        return { hp: Math.max(0, r.hp | 0), mhp: r.maxHp | 0, mp: Math.max(0, r.mp | 0), mmp: r.maxMp | 0, ko: r.hp <= 0 || entry.fled ? 1 : 0, ail,
            dv: r.gauge | 0, bl: r.blast?.active ? 1 : 0 };
    }
    /** A player's whole party for the Tag list: the Digimon in the fight and the reserves. */
    partyPlate(entry) {
        return entry.party.map((r) => ({ n: r.profile?.name ?? "?", hp: Math.max(0, r.hp | 0), mhp: r.maxHp | 0, mp: Math.max(0, r.mp | 0), mmp: r.maxMp | 0, dv: r.gauge | 0 }));
    }
}
