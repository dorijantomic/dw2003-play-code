import { plainLine, Arena } from "../mpbattle-rules.js";
import { endBlast } from "../battle.js";
import { SELF } from "../mpbattle-pause.js";
import { MB } from "./state.js";
import { LOG_LINES, MAX_ANIM_MS, MIN_ANIM_MS, TURN_MS } from "./command.js";
import { render } from "./ui-scene.js";
import { finish } from "./net.js";

// ------------------------------------------------------------ the referee: runs the rules, tells everyone
const later = (ms, fn) => { const id = setTimeout(() => { if (MB.F) fn(); }, ms); (MB.F.timers ??= new Set()).add(id); return id; };

const say = (lines) => {
    const list = [].concat(lines).filter(Boolean).map((l) => String(l).slice(0, 120));
    for (const l of list) MB.F.H.log.push(plainLine(l).slice(0, 72));
    while (MB.F.H.log.length > LOG_LINES) MB.F.H.log.shift();
    MB.F.H.ln = list.slice(0, 10); MB.F.H.lq = (MB.F.H.lq | 0) + 1;          // the latest action's lines, for the message window
};

/** Run `fn` once the attack animation on the referee's own screen is over (and at least a moment has passed). */
function afterAnim(fn) {
    const t0 = performance.now();
    const poll = () => {
        if (!MB.F) return;
        const waited = performance.now() - t0;
        if (waited >= MAX_ANIM_MS || (waited >= MIN_ANIM_MS && !(MB.F.r3d && MB.F.r3d.fightersBusy?.()))) { fn(); return; }
        later(120, poll);
    };
    later(MIN_ANIM_MS / 3, poll);
}

function snapshot(ph = "play") {
    const H = MB.F.H, ar = H.arena;
    const pz = H.pause?.view();                                // who is away and for how long, only while someone is
    return {
        r: H.round, w: ar.wave, t: H.turn, ph, g: H.log.slice(), ev: H.ev ?? null, ft: H.forced ? 1 : 0, ln: H.ln ?? [], lq: H.lq | 0,
        E: ar.waveFoes().map((e) => ({ i: e.i, n: e.name, lv: e.rec.level | 0, ...ar.plate(e) })),
        P: ar.P.map((p) => ({ id: p.id, pn: p.name, n: p.rec.profile?.name ?? "?", lv: p.rec.level | 0, ...ar.plate(p), ko: p.rec.hp <= 0 || p.fled ? 1 : 0, pt: ar.partyPlate(p), ac: p.act })),
        ...(pz ? { pz } : {}),
    };
}

/** The other PEOPLE in the fight (not me, not a computer-played practice partner). `fight` defaults to the fight I am in;
 *  `finish` passes the fight it has just ended (the module's own F is already null by then). */
export const people = (ids, fight = MB.F) => ids.filter((id) => id !== MB.A.myId() && !fight?.bots?.has(id));

function broadcast(ph = "play") {
    const S = snapshot(ph);
    const others = people(MB.F.ids).filter((id) => !MB.F.H.arena.byKey("p" + id)?.fled);
    if (others.length) MB.A.send(others, { k: "st", fid: MB.F.fid, S });
    MB.F.S = S; render();
}

function setEvent(res) {
    const H = MB.F.H;
    if (!res.rows?.length && res.kind !== "self" && res.kind !== "item" && res.kind !== "dv") return;
    H.ev = { q: (H.evq = (H.evq | 0) + 1), a: res.a, sk: res.sk | 0, kind: res.kind, d: res.rows ?? [], st: res.st ?? null };
}

export function hostBegin() {
    const H = MB.F.H;
    clearTimeout(H.readyTimer);
    if (H.started) return; H.started = true;
    MB.F.ids = MB.F.ids.filter((id) => H.P.has(id));                // never got ready: not in the fight
    if (!H.P.size) { finish(false, { fled: true }); return; }
    const players = [...H.P.values()].map((p) => ({ id: p.id, name: p.pn, rec: p.rec, party: p.party }));
    const waveSize = Math.max(2, players.length);
    H.arena = new Arena({ kit: MB.F.kit, players, foes: MB.F.erec.map((rec, i) => ({ name: H.names[i], rec })), screenId: MB.F.screenId, waveSize });
    MB.F.waves = H.arena.waves();
    say("The fight begins!");
    const peers = people(MB.F.ids);
    if (peers.length) MB.A.send(peers, { k: "go", fid: MB.F.fid, waves: MB.F.waves });
    broadcast();                                               // everyone sees the arena and the lineup straight away
    later(1800, nextTurn);
}

function nextTurn() {
    const H = MB.F.H, ar = H.arena;
    if (H.pause.gate("next", nextTurn)) return;                // a player is away: wait here, nothing is lost (web/mpbattle-pause.js)
    clearTimeout(H.turnTimer);
    H.turn = null;
    const st = ar.state();
    if (st !== "play") { hostEnd(st); return; }
    const nx = ar.next();
    if (!nx) { hostEnd(ar.state()); return; }
    if (nx.wave != null) { say(`Next wave! (${nx.wave + 1}/${MB.F.waves})`); broadcast(); later(1800, nextTurn); return; }
    const key = nx.key, actor = ar.byKey(key);
    if (nx.forced) {                                           // a Digimon fell and the player has others: they pick who comes in
        H.turn = key; H.forced = true;
        say(`${actor.name}: Choose the next Digimon.`);
        broadcast();
        if (MB.F.bots.has(actor.id)) { botTurn(key); return; }
        armForcedTimer(key, actor);
        return;
    }
    H.turns = (H.turns | 0) + 1;                               // "round" = everyone standing has had about one action
    H.round = Math.floor((H.turns - 1) / Math.max(1, ar.alivePlayers().length + ar.aliveFoes().length)) + 1;
    const ts = ar.turnStart(key);
    H.turn = key;
    if (ts.skipped) {                                          // asleep, frozen or confused: the turn is lost
        const res = { lines: ts.lines, rows: [], a: key, sk: 0, kind: "run" };
        ar.finish(key, res);
        say(res.lines); broadcast(); afterAnim(nextTurn); return;
    }
    broadcast();
    if (key[0] === "p" && MB.F.bots.has(actor.id)) botTurn(key);
    else if (key[0] === "p") armTurnTimer(key, actor);
    else later(700, () => foeTurn(key));
}

/** PRACTICE (F2 -> Extras -> "Practice 2 vs 2"): the computer plays the partner's turn the plainest way: a forced
 *  replacement takes the first reserve still standing, otherwise Fight on the standing enemy with the least HP.
 *  (No technique or item choice: it is a stand-in for a second player, not a rule of the game.) */
function botTurn(key) {
    later(1100, () => {
        const H = MB.F.H, ar = H.arena, actor = ar.byKey(key);
        if (!actor || H.turn !== key) return;
        const id = actor.id;
        if (H.forced) {
            const slot = actor.party.findIndex((r, i) => i !== actor.act && r.hp > 0);
            hostCommand(id, { fid: MB.F.fid, c: { k: "tag", slot: Math.max(0, slot) } });
            return;
        }
        const foe = ar.aliveFoes().sort((a, b) => a.rec.hp - b.rec.hp)[0];
        hostCommand(id, { fid: MB.F.fid, c: foe ? { k: "fight", t: foe.i } : { k: "run" } });
    });
}

function armTurnTimer(key, actor) {
    const H = MB.F.H, ar = H.arena;
    clearTimeout(H.turnTimer);
    H.turnTimer = later(TURN_MS, () => { say(`${actor.name} took too long.`); const res = { lines: [], rows: [], a: key, sk: 0, kind: "run" }; ar.finish(key, res); say(res.lines); H.turn = null; broadcast(); later(400, nextTurn); });
}

function armForcedTimer(key, actor) {                          // the forced swap's own timer (it was inline in nextTurn)
    const H = MB.F.H;
    clearTimeout(H.turnTimer);
    H.turnTimer = later(TURN_MS, () => {
        const slot = actor.party.findIndex((r, i) => i !== actor.act && r.hp > 0);
        if (H.forced && H.turn === key && slot >= 0) hostCommand(Number(key.slice(1)), { fid: MB.F.fid, c: { k: "tag", slot } });
    });
}

function foeTurn(key) {
    const H = MB.F.H, ar = H.arena;
    if (H.pause.gate("foe", () => foeTurn(key))) return;       // the enemy's action (already due) waits until nobody is away
    const res = ar.foeAction(key);
    ar.finish(key, res);
    say(res.lines); setEvent(res);
    broadcast();
    afterAnim(nextTurn);
}

/** A player's choice reached the referee. */
export function hostCommand(from, d) {
    const H = MB.F.H; if (!H?.arena) return;
    const ar = H.arena, key = "p" + from;
    if (d.fid !== MB.F.fid || H.turn !== key) return;
    const c = d.c && typeof d.c === "object" ? d.c : {};
    const cmd = { k: String(c.k), sk: c.sk | 0, tw: c.tw | 0, item: c.item | 0, form: c.form | 0, slot: c.slot | 0, to: String(c.to ?? ""), t: typeof c.t === "string" ? c.t : (Number.isInteger(c.t) ? c.t : -1) };
    if (H.forced && cmd.k !== "tag") { armTurnTimer(key, ar.byKey(key)); return; }      // only the replacement is asked for
    clearTimeout(H.turnTimer);
    const res = ar.playerAction(key, cmd);
    if (res.refused) { say(res.lines); broadcast(); armTurnTimer(key, ar.byKey(key)); return; }   // a swap that cannot be done: ask again
    if (H.forced) {                                            // the fallen Digimon's replacement costs no turn
        ar.afterFree(res); H.forced = false; H.turn = null;
        say(res.lines); setEvent(res);
        broadcast();
        afterAnim(nextTurn);
        return;
    }
    ar.finish(key, res);
    H.turn = null;
    say(res.lines); setEvent(res);
    broadcast();
    if (res.fled) {                                            // the player got away: they leave the fight (the host keeps refereeing)
        if (from === MB.A.myId()) MB.F.iFled = true; else if (!MB.F.bots?.has(from)) MB.A.send([from], { k: "left", fid: MB.F.fid });
    }
    afterAnim(nextTurn);
}

function releaseBlasts() {                                    // a Blast does not outlive the fight: its gauge is spent
    const ar = MB.F.H.arena;
    for (const p of ar.P) for (const r of p.party) if (r.blast?.active) endBlast(r);
}

export function hostGone(from) {                                     // a player's connection dropped mid-fight
    const H = MB.F.H; if (!H?.arena) return false;
    const p = H.arena.byKey("p" + from); if (!p || p.fled) return false;
    p.fled = true; say(`${p.name} left the fight.`);
    const wasTurn = H.turn === p.key;
    if (wasTurn) { clearTimeout(H.turnTimer); H.turn = null; }
    broadcast();
    if (wasTurn || H.arena.state() !== "play") { later(MIN_ANIM_MS, nextTurn); return true; }   // true: nextTurn is already on its way
    return false;
}

/** A guest's link dropped (the relay said `away`): wait for them up to AWAY_MS. They are NOT marked fled; their turn, if it is theirs, stays theirs. */
export function hostAway(from) {
    const H = MB.F.H; if (!H?.arena) return;
    const p = H.arena.byKey("p" + from);
    if (!p || p.fled || MB.F.bots?.has(from) || H.pause.has(from)) return;
    if (H.turn === p.key) clearTimeout(H.turnTimer);           // their 45 s must not run while they cannot answer
    H.pause.add(from, (id) => { if (!MB.F?.H) return; releasePause(hostGone(id) ? ["next"] : []); });   // not back in time: they have left, as before
    say(`${p.name} lost connection. Waiting...`);
    broadcast();                                               // everyone's screen shows "Waiting for ..."
}

/** The guest's own game says it is back (mpb `back`). A guest who already left gets `left`; otherwise everyone gets the full picture. */
export function hostBack(from) {
    const H = MB.F.H; if (!H?.arena) return;
    const p = H.arena.byKey("p" + from); if (!p) return;
    if (p.fled) { MB.A.send([from], { k: "left", fid: MB.F.fid }); return; }
    const was = H.pause.remove(from);
    if (was) say(`${p.name} is back.`);
    broadcast();                                               // the current full snapshot: clears "Waiting" and gives the returner the fight (also when never marked away)
    if (!was) return;
    if (!H.pause.size) rearmTurn();
    releasePause();
}

function rearmTurn() {                                         // the turn that was waiting gets its full 45 s again
    const H = MB.F.H, key = H.turn;
    if (!key || key[0] !== "p") return;
    const actor = H.arena.byKey(key);
    if (!actor || actor.fled || MB.F.bots.has(actor.id)) return;
    if (H.forced) armForcedTimer(key, actor); else armTurnTimer(key, actor);
}

/** Run what the gate held back, once nobody is away. `covered` = calls another path already schedules (hostGone's nextTurn). */
function releasePause(covered = []) {
    const run = MB.F.H.pause.release({ covered });
    if (!run) return;                                          // someone is still away: stay parked
    for (const f of run) later(0, f);
}

function hostEnd(state) {
    const won = state === "won";
    releaseBlasts();
    const others = people(MB.F.ids);
    broadcast(won ? "won" : "lost");
    if (others.length) MB.A.send(others, { k: "end", fid: MB.F.fid, won: won ? 1 : 0, st: state });
    finish(won, { fled: state === "fled" || MB.F.iFled });
}

export function hostLinkLost() {
    const H = MB.F.H; if (!H?.arena) return;
    clearTimeout(H.turnTimer);                                 // a guest's 45 s must not run while its answer cannot reach me
    H.pause.add(SELF, null);
}

export function hostLinkBack() {
    const H = MB.F.H; if (!H?.arena) return;
    H.pause.remove(SELF);
    broadcast();                                               // everyone carries on from the current picture
    if (!H.pause.size) rearmTurn();
    releasePause();
}
