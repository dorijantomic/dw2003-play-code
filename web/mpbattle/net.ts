import { createLink, createPause, LINK_TEXT } from "../mpbattle-pause.js";
import { emit } from "../gameEvents.js";
import { winEvent } from "../mp-credit.js";
import { MB } from "./state.js";
import { buildUi, endScene, makeScene, mk, render } from "./ui-scene.js";
import {
  hostAway,
  hostBack,
  hostBegin,
  hostCommand,
  hostGone,
  hostLinkBack,
  hostLinkLost,
  people,
} from "./host.js";
import { READY_MS } from "./command.js";
import type { MpNetFighter, MpNetHost } from "./types.js";
import type { MpFightResult, MpLaunchOptions } from './types.js';
import type { DigimonRecord } from '../types/battle.js';
interface MpHostBot {
    id: number;
    name: string;
    party: DigimonRecord[];
}


interface MpHostOptions extends MpLaunchOptions {
    ids: (number | null | undefined)[];
    done: (r: MpFightResult) => void;
    bots?: MpHostBot[];
}


// ------------------------------------------------------------ starting, joining, finishing
async function begin(setup, isHost: boolean, hostId, done) {
    if (MB.F) return false;
    const kit = await MB.A.getKit();
    const party = kit.party();
    const me = party[0]?.rec;
    if (!me) return false;
    const erec = isHost ? setup.foes.map((e) => kit.enemyRecord(e, setup.screenId ?? null)) : [];
    if (erec.some((r) => !r)) return false;
    if (MB.F) return false;
    MB.F = {
        fid: setup.fid, isHost, hostId, ids: setup.ids.slice(), names: setup.names ?? {}, foes: setup.foes, label: setup.label || "Fight",
        screenId: setup.screenId ?? null, mapId: setup.mapId ?? MB.A.mapId?.() ?? null, challenge: setup.ch ?? null, kit, me, party, act: 0, erec, techs: kit.myTechs(me), items: [], done, S: null, cmd: null, waves: 1, nat: null,
        bots: new Set((setup.bots ?? []).map((b) => b.id)), snap: MB.A.snapshot(), timers: new Set(), ui: null, H: null, r3d: null, placed: new Set(), modelName: new Map(), waveKey: null, lastEv: null, cheered: false, iFled: false,
        link: createLink({ onEnd: () => { if (MB.F) finish(false, { fled: true, hostLeft: true }); } } as LinkOptions),
    } as MpNetFighter;
    emit("fightSeen", winEvent(MB.F.foes));            // only the species log listens (web/species-log.js): quests hear battleWon alone
    const U = MB.F.ui = MB.A.ui ?? (MB.A.ui = buildUi());
    U.cards.clear(); U.foes.replaceChildren(); U.mine.replaceChildren(); U.foeKeys = ""; U.bar.replaceChildren(); U.log.replaceChildren(); U.plateMap.clear(); U.plates.replaceChildren();
    if (U.endEl) { U.endEl.remove(); U.endEl = null; }
    U.root.style.display = "flex";
    MB.A.releaseKeys();
    try {                                                      // the battle track (and the field's back afterwards)
        MB.F.prevTrack = MB.A.bgm?.current;
        const track = kit.musicFor(MB.F.screenId, MB.A.mapId?.() ?? null);
        if (track && MB.A.bgm) MB.A.bgm.play(track);
    } catch { /* silence is fine */ }
    const mePublic = { id: MB.A.myId(), pn: MB.A.myName(), n: me.profile?.name ?? "?", lv: me.level | 0 };
    if (!isHost) {                                           // the referee needs my fighter records before anything else: the scene can load after
        for (let i = 1; i < party.length; i++) MB.A.send([hostId], { k: "res", fid: MB.F.fid, i, rec: kit.pack(party[i].rec) });   // my reserves first (in order)
        MB.A.send([hostId], { k: "ready", fid: MB.F.fid, p: { ...mePublic, rec: kit.pack(me) } });
    }
    await makeScene();                                       // (falls back to plain cards without WebGL)
    if (!MB.F) return true;
    if (isHost) {
        MB.F.H = {
            P: new Map([[mePublic.id, { ...mePublic, rec: me, party: party.map((m) => m.rec) }]]), names: erec.map((r) => r.eStats?.digimon_id ?? r.profile?.name ?? "?"),
            arena: null, round: 0, turn: null, log: ["Waiting for everyone..."], started: false, res: new Map(), pause: createPause(),
        } as MpNetHost;
        for (const b of setup.bots ?? []) {                    // a computer-played practice partner is ready at once
            const recs = b.party.map((r) => kit.pack(r));
            MB.F.H.P.set(b.id, { id: b.id, pn: String(b.name).slice(0, 12), n: recs[0].profile?.name ?? "?", lv: recs[0].level | 0, rec: recs[0], party: recs });
        }
        const peers = people(MB.F.ids);
        if (peers.length) MB.A.send(peers, { k: "setup", fid: MB.F.fid, foes: MB.F.foes, ids: MB.F.ids, names: MB.F.names, label: MB.F.label, screenId: MB.F.screenId, ch: MB.F.challenge, mapId: MB.F.mapId });
        MB.F.H.readyTimer = setTimeout(() => { if (MB.F) hostBegin(); }, READY_MS);
        if (MB.F.H.P.size >= MB.F.ids.length) hostBegin();
    }
    render();
    return true;
}

/** Start a fight as the referee. ids = everyone in it (me first). done({won, fled, reward}) runs when it is over.
 *  bots = computer-played practice partners [{ id (negative), name, party: [records] }] (F2 -> Extras -> Practice 2 vs 2). */
export function mpbHost({ foes, ids, label, screenId, challenge, done, bots = [] }: MpHostOptions) {
    const all = [...ids, ...bots.map((b) => b.id)];
    const names = Object.fromEntries(all.map((id) => [id, bots.find((b) => b.id === id)?.name ?? MB.A.nameOf(id)]));
    return begin({ fid: (Date.now() % 1000000000) + Math.floor(Math.random() * 1000), foes, ids: all, names, label, screenId, ch: challenge, bots, mapId: MB.A.mapId?.() }, true, MB.A.myId(), done);
}

/** Messages of a fight from the relay. */
export function mpbMessage(from: string, d) {
    if (!d || typeof d !== "object") return;
    if (d.k === "setup") {
        if (MB.F || !MB.A.canJoin()) { MB.A.send([from], { k: "decline", fid: d.fid }); return; }
        begin({ fid: d.fid, foes: d.foes, ids: d.ids, names: d.names, label: d.label, screenId: d.screenId, ch: d.ch, mapId: d.mapId }, false, from, MB.A.joinDone(d))
            .then((ok) => { if (!ok) MB.A.send([from], { k: "decline", fid: d.fid }); });
        return;
    }
    if (!MB.F || d.fid !== MB.F.fid) return;
    if (MB.F.isHost) {
        if (!MB.F.ids.includes(from)) return;
        if (d.k === "ready" && d.p && !MB.F.H.started && d.p.rec && typeof d.p.rec === "object") {
            const p = d.p;
            const reserves = MB.F.H.res.get(from) ?? [];
            MB.F.H.P.set(from, { id: from, pn: String(p.pn ?? "?").slice(0, 12), n: String(p.n ?? "?").slice(0, 14), lv: Math.max(1, Math.min(99, p.lv | 0)), rec: p.rec, party: [p.rec, ...reserves.filter(Boolean)] });
            if (MB.F.H.P.size >= MB.F.ids.length) hostBegin();
        } else if (d.k === "res" && d.rec && typeof d.rec === "object" && !MB.F.H.started) {
            const list = MB.F.H.res.get(from) ?? [];
            const i = Math.max(1, Math.min(2, d.i | 0));
            list[i - 1] = d.rec; MB.F.H.res.set(from, list);
        } else if (d.k === "decline") { MB.F.ids = MB.F.ids.filter((x: string) => x !== from); if (MB.F.H.P.size >= MB.F.ids.length) hostBegin(); }
        else if (d.k === "cmd") hostCommand(from, d);
        else if (d.k === "back") hostBack(from);
    } else if (from === MB.F.hostId) {
        if (d.k === "go") MB.F.waves = Math.max(1, Math.min(20, d.waves | 0));
        else if (d.k === "st") { MB.F.S = d.S; MB.F.link.clear(); render(); }
        else if (d.k === "left") finish(false, { fled: true });
        else if (d.k === "end") finish(!!d.won, { fled: d.st === "fled" });
    }
}

/** The relay says someone's link dropped but their seat is kept. Referee: wait for that guest. Guest: if it is the referee, wait for it. */
export function mpbPeerAway(id: string) {
    if (!MB.F) return;
    if (!MB.F.isHost) { if (id === MB.F.hostId) { MB.F.link.refWait(); render(); } return; }
    if (MB.F.H?.arena) hostAway(id); else mpbPeerGone(id);        // before the fight starts there is nothing to wait for: as a left player
}

/** The relay says a seat is back. Guest: the referee is back, stop waiting for it (it sends a snapshot on its own link back).
 *  Referee: nothing, it waits for that guest's own `back` message (a reloaded page has no fight to come back to). */
export function mpbPeerBack(id) {
    if (!MB.F || MB.F.isHost) return;
    if (id === MB.F.hostId && MB.F.link.text === LINK_TEXT.ref) { MB.F.link.clear(); render(); }
}

/** MY link dropped (multiplayer.js `linklost`): keep the screen, say so, disable choices, give up after AWAY_MS. */
export function mpbLinkLost() {
    if (!MB.F) return;
    MB.F.cmd = null; if (MB.F.nat) { MB.F.nat.close(); MB.F.nat.clearSay(); }
    MB.F.link.lost();
    if (MB.F.isHost) hostLinkLost();                              // nothing may run on while nobody can hear me
    render();
}

/** MY link is back (`linkback`). resumed = the relay gave me my old id. A new id cannot rejoin the fight: leave cleanly. */
export function mpbLinkBack(resumed) {
    if (!MB.F) return;
    if (!resumed) { finish(false, { fled: true, hostLeft: true }); return; }
    if (MB.F.isHost) { MB.F.link.clear(); hostLinkBack(); render(); return; }
    MB.F.link.reconnected();                                      // 10 s for the referee's snapshot, left or end; an older referee ignores `back`
    MB.A.send([MB.F.hostId], { k: "back", fid: MB.F.fid });
    render();
}

/** Someone left the room mid-fight. */
export function mpbPeerGone(id: string) {
    if (!MB.F) return;
    if (!MB.F.isHost && id === MB.F.hostId) { finish(false, { fled: true, hostLeft: true }); return; }
    if (MB.F.isHost && MB.F.H?.arena) hostGone(id);
    if (MB.F.isHost && MB.F.H && !MB.F.H.started) { MB.F.ids = MB.F.ids.filter((x: string) => x !== id); if (MB.F.H.P.size >= MB.F.ids.length) hostBegin(); }
}

export function finish(won: boolean, { fled = false, hostLeft = false } = {}) {
    const f = MB.F; if (!f) return;
    for (const t of f.timers ?? []) clearTimeout(t);
    clearTimeout(f.H?.readyTimer); clearTimeout(f.H?.turnTimer);
    f.H?.pause?.clear();
    f.link?.clear();
    MB.F = null;                                   // from here on the fight is over; the screen stays up for the result
    fled = fled || f.iFled;
    let reward = null, report = null, committed = false;
    if (won && !fled) {
        for (const m of f.party) f.kit.commit(m.rec);          // everyone in my party, as the fight left them (HP, MP, DV gauge)
        committed = true;
        const took = [...(f.took ?? [0])].filter((i) => f.party[i]);
        report = f.kit.winReport?.({ screenId: f.screenId, party: f.party, took }) ?? null;   // the disc's payout for each Digimon that fought
        reward = report?.reward ?? f.kit.applyWin({ screenId: f.screenId, participants: f.ids.length });
        // F2 -> Extras -> Co-op wins count for quests: both tamers were there, so both of their quests tick for this win
        // (the same event the one-on-one battle sends). Only a real second human counts — a practice 2v2 with a computer
        // partner is no co-op win — and the fight's own map is the host's, which rode the setup packet.
        emit("fightBeaten", winEvent(f.foes));          // every 2 vs 2 win counts for the glossary, bots or not (quests: the gate below)
        if (window.__fx?.mpcredit && people(f.ids, f).length > 0) {
            const ev = winEvent(f.foes, { mapId: f.mapId, screenId: f.screenId });
            if (ev) emit("battleWon", ev);
        }
    }
    if (!won && !fled) MB.A.restore(f.snap);       // a lost optional fight costs nothing
    else if (!committed) for (const m of f.party) f.kit.commit(m.rec);
    try { if (f.prevTrack && MB.A.bgm) MB.A.bgm.play(f.prevTrack); } catch { /* ignore */ }
    const U = f.ui;
    const close = () => {
        endScene(U);
        U.root.style.display = "none"; if (U.endEl) { U.endEl.remove(); U.endEl = null; }
        MB.A.releaseKeys();
        try { f.done?.({ won, fled, reward }); } catch (e) { console.warn("[mpbattle] done failed", e); }
    };
    if (hostLeft || (fled && !f.isHost)) { close(); return; }
    if (fled && f.iFled && f.isHost) { close(); return; }
    // let the last hit and the victory (or defeat) pose play before the result page covers the scene
    setTimeout(() => {
        if (!U.root || U.root.style.display !== "flex") return;
        if (won && report && MB.A.openReport) {      // the game's own post-battle screen, full frame, for each player
            U.root.style.display = "none";
            let opened = false;
            try { opened = MB.A.openReport(report.b, () => { report.save?.(); close(); }) === true; } catch (e) { console.warn("[mpbattle] report", e); }
            if (opened) return;
            U.root.style.display = "flex";
        }
        const end = mk("div", "end");
        const h2 = mk("h2", "", won ? "VICTORY!" : fled ? "FIGHT OVER" : "DEFEATED");
        h2.style.color = won ? "#ffd34d" : "#ff7a7a";
        end.append(h2);
        if (won && reward) {
            end.append(mk("div", "sm", `+${reward.xp} EXP   +${reward.bits} BIT`));
            if (reward.to > reward.from) end.append(mk("div", "sm", `Your ${f.me.profile?.name ?? "Digimon"} reached Lv ${reward.to}!`));
        } else if (!won) end.append(mk("div", "sm", "Nothing was lost."));
        const b = mk("button", "", "Continue"); b.type = "button";
        b.style.cssText = "background:#2f3d9a;color:#fff;border:2px solid #8a98ff;border-radius:6px;padding:8px 24px;font:bold 15px monospace;cursor:pointer";
        b.onclick = close; end.append(b);
        U.root.append(end); U.endEl = end;
    }, won ? 2800 : 1600);
}

// The hooks createLink (web/mpbattle-pause.ts) takes: the host-left callback and the timer pair
// it replaced.
interface LinkOptions {
  onEnd?: any;
  setT?: any;
  clearT?: any;
}
