import { pzText } from "../mpbattle-pause.js";
import { isSpread } from "../mpbattle-rules.js";
import { ITEM_BY_ID } from "../vendor/engine.js";
import { battleAilmentByte } from "../battlecmd-translated.js";
import { MB } from "./state.js";
import { mk } from "./ui-scene.js";
import { hostCommand } from "./host.js";
import type { MpNativeResult, MpPartyMember, MpPlayerEntry, MpTargetSpec, MpWireCommand } from "../types/mp-match.js";

export const TURN_MS = 45000;              // how long a player may think

export const MIN_ANIM_MS = 900;            // the shortest pause after an action

export const MAX_ANIM_MS = 7000;           // the longest the referee waits for the attack animation to finish

export const READY_MS = 25000;             // how long the referee waits for the others to get into the fight (the battle-start transition plays first)

export const LANE = 1900;                  // sideways distance between two fighters of one side, in the game's own arena units

export const LOG_LINES = 5;

export const mpbActive = () => !!MB.F;

/** True while the fight screen is up (also during its result page). */
export const mpbVisible = () => !!MB.F || (!!MB.A?.ui && MB.A.ui.root.style.display === "flex");

// ------------------------------------------------------------ my turn: the command menu
const itemTargets = (item: { effect: string; id: number; }) => {
    if (!item) return { allies: true, foes: false };
    if (["hp", "mp", "full_hp"].includes(item.effect) && !(item.id >= 66 && item.id <= 90)) return { allies: true, foes: false };
    return item.id >= 85 && item.id !== 84 ? { allies: false, foes: true } : { allies: true, foes: false };
};

export function renderCmd() {
    const U = MB.F?.ui; if (!U) return;
    const S = MB.F.S, bar = U.bar;
    bar.replaceChildren();
    for (const c of [...U.cards.values(), ...U.plateMap.values()]) c.root.classList.remove("pick", "cur");
    if (MB.F.nat) {                                                  // the game's own screens draw the menus; here only the target marks
        const cmd = MB.F.cmd;
        if (cmd?.stage === "target") {
            cmd.options.forEach((key: string, i: number) => { const r = (U.plateMap.get(key) ?? U.cards.get(key))?.root; if (r) { r.classList.add("pick"); if (i === cmd.cur) r.classList.add("cur"); } });
        }
        return;
    }
    const myKey = "p" + MB.A.myId();
    const mineTurn = S && S.ph === "play" && S.t === myKey && MB.F.me.hp > 0 && !MB.F.iFled && !MB.F.link.active;
    if (!mineTurn) {
        MB.F.cmd = null;
        bar.append(mk("span", "hint", MB.F.iFled ? "You ran away. Watching the rest of the fight." : S?.ph === "play" ? (S.pz ? pzText(S.pz, S.P) : "Waiting...") : ""));
        return;
    }
    const btn = (label: string, fn: () => void, disabled?: boolean) => { const b = mk("button", "", label); b.type = "button"; b.disabled = !!disabled; b.onclick = fn; bar.append(b); return b; };
    if (!MB.F.cmd) MB.F.cmd = { stage: "menu" };
    const cmd = MB.F.cmd;
    const back = () => btn("Back", () => { MB.F.cmd = { stage: "menu" }; renderCmd(); });
    if (cmd.stage === "menu") {
        btn("Fight", () => askTarget({ foes: true }, (t: string) => send({ k: "fight", t: Number(t.slice(1)) }), "Pick a target"));
        btn("Tech", () => { MB.F.cmd = { stage: "tech" }; renderCmd(); }, !MB.F.techs.length);
        btn("Item", () => { MB.F.items = MB.F.kit.items(); MB.F.cmd = { stage: "item" }; renderCmd(); }, !MB.F.kit.items().length);
        const forms = MB.F.kit.forms(MB.F.me);
        if (forms.length) btn("Digivolve", () => { MB.F.cmd = { stage: "dv" }; renderCmd(); }, !!MB.F.me.cantDigivolve);
        if (MB.F.party.length > 1) btn("Tag", () => { MB.F.cmd = { stage: "tag" }; renderCmd(); }, !MB.F.party.some((m: { rec: { hp: number; }; }, i: number) => i !== MB.F.act && m.rec.hp > 0));
        btn("Run", () => { MB.F.cmd = { stage: "run" }; renderCmd(); });
        bar.append(mk("span", "hint", `HP ${MB.F.me.hp}/${MB.F.me.maxHp}   MP ${MB.F.me.mp}/${MB.F.me.maxMp}`));
    } else if (cmd.stage === "run") {
        bar.append(mk("span", "hint", "Try to run away?"));
        btn("Yes, run", () => send({ k: "run" }));
        btn("No", () => { MB.F.cmd = { stage: "menu" }; renderCmd(); });
    } else if (cmd.stage === "tech") {
        for (const t of MB.F.techs) {
            const spread = t.type === "attack" && isSpread(t.skill), ok = MB.F.me.mp >= t.cost;
            btn(`${t.name}  (${t.cost} MP)${spread ? "  [all]" : t.type !== "attack" ? "  [support]" : ""}`, () => {
                if (spread) send({ k: "tech", sk: t.id, tw: t.tw, t: -1 });
                else if (t.type === "attack") askTarget({ foes: true }, (k: string) => send({ k: "tech", sk: t.id, tw: t.tw, t: Number(k.slice(1)) }), `Pick a target for ${t.name}`);
                else askTarget({ allies: true, foes: true }, (k: string) => send({ k: "tech", sk: t.id, tw: t.tw, t: k[0] === "e" ? Number(k.slice(1)) : k }), `Pick a target for ${t.name}`);
            }, !ok);
        }
        back();
    } else if (cmd.stage === "dv") {
        for (const f of MB.F.kit.forms(MB.F.me)) btn(f.name, () => send({ k: "dv", form: f.id }));
        back();
    } else if (cmd.stage === "tag") {
        MB.F.party.forEach((m: MpPartyMember, i: number) => { if (i !== MB.F.act) btn(`${m.rec.profile?.name ?? "?"}  HP ${Math.max(0, m.rec.hp | 0)}/${m.rec.maxHp | 0}`, () => send({ k: "tag", slot: i }), m.rec.hp <= 0); });
        if (!MB.F.S?.ft) back();
    } else if (cmd.stage === "item") {
        for (const it of MB.F.items) {
            btn(`${it.name}  x${it.qty}`, () => {
                const tg = itemTargets(ITEM_BY_ID[it.id] ?? it);
                askTarget({ ...tg, revive: it.id === 70 || it.id === 67 }, (k: string) => { send({ k: "item", item: it.id, to: k[0] === "p" ? k : myKey, t: k[0] === "e" ? Number(k.slice(1)) : -1 }); MB.F.kit.spendItem(it.id); }, `Use ${it.name} on...`);
            });
        }
        back();
    } else if (cmd.stage === "target") {
        bar.append(mk("span", "hint", cmd.label));
        for (const key of cmd.options) (U.plateMap.get(key) ?? U.cards.get(key))?.root.classList.add("pick");
        back();
    }
}

/** Ask for a target on the screen: { foes, allies } say which plates may be picked. Only one choice? it is taken for me. */
function askTarget(spec: MpTargetSpec, done: (k: string) => void, label: string) {
    const options = [];
    if (spec.allies) for (const p of MB.F.S.P) if (!p.ko || spec.revive) options.push("p" + p.id);
    if (spec.foes) for (const e of MB.F.S.E) if (!e.ko) options.push("e" + e.i);
    if (!options.length) return;
    if (options.length === 1) return done(options[0]);
    MB.F.cmd = { stage: "target", options, done, label, cur: Math.max(0, options.findIndex((k) => k[0] === "e")) };
    if (MB.F.nat) { MB.F.nat.close(); MB.F.nat.say([label ?? "Choose a target."], { hold: true }); }
    renderCmd();
}

export function onPick(key: string) {
    if (!MB.F || MB.F.cmd?.stage !== "target" || !MB.F.cmd.options.includes(key)) return;
    const done = MB.F.cmd.done;
    MB.F.cmd = null;
    if (MB.F.nat) MB.F.nat.clearSay();
    done(key);
}

/** A pad button (keyboard, the on-screen pad, a gamepad): it drives the game's menu, or moves the target mark. */
export function mpbKey(btn: string | undefined) {
    if (!MB.F?.nat || !btn) return;
    const cmd = MB.F.cmd;
    if (cmd?.stage === "target") {
        const n = cmd.options.length;
        if (btn === "left" || btn === "up") { cmd.cur = (cmd.cur + n - 1) % n; MB.A.sfx?.play?.("system07"); }
        else if (btn === "right" || btn === "down") { cmd.cur = (cmd.cur + 1) % n; MB.A.sfx?.play?.("system07"); }
        else if (btn === "circle") { MB.A.sfx?.play?.("system08"); const done = cmd.done, k = cmd.options[cmd.cur]; MB.F.cmd = null; MB.F.nat.clearSay(); done(k); }
        else if (btn === "cross" || btn === "triangle") { MB.A.sfx?.play?.("system02"); MB.F.cmd = null; MB.F.nat.clearSay(); }
        renderCmd();
        return;
    }
    MB.F.nat.press(btn);
}

/** My turn, through the game's own screens: the command list, then TECH / ITEM / Digivolve / TAG, then a target. */
export function driveNative(dt: number) {
    const N = MB.F.nat, S = MB.F.S;
    const myId = MB.A.myId(), myKey = "p" + myId;
    const mine = S?.P.find((p: MpPlayerEntry) => p.id === myId);
    const forced = !!(S && S.ft && S.t === myKey);
    const mineTurn = !!(S && S.ph === "play" && S.t === myKey && !MB.F.iFled && !MB.F.link.active && mine && (forced || !mine.ko));
    MB.F.ui.pad.classList.toggle("on", mineTurn);
    if (!mineTurn) { if (N.mode) N.close(); if (MB.F.cmd) { MB.F.cmd = null; renderCmd(); } N.update(dt); return; }
    if (N.busy() && !MB.F.cmd) { N.update(dt); return; }                // let the last action's lines finish in the window first
    if (!MB.F.cmd) { MB.F.cmd = { stage: forced ? "tag" : "menu" }; renderCmd(); }
    const stage = MB.F.cmd.stage;
    if (stage === "target") { N.update(dt); return; }
    if (stage === "notice") { N.update(dt); if (!N.busy()) MB.F.cmd = { stage: "menu" }; return; }
    const wm = { menu: "cmd", tech: "tech", item: "item", dv: "form", tag: "tag" }[stage];
    if (!wm) return;
    if (N.mode !== wm) {
        if (stage === "menu") N.open("cmd", { row: MB.F.cmdRow | 0, activeIndex: 0, ailmentBits: battleAilmentByte(MB.F.me) });
        else if (stage === "tech") N.open("tech", MB.F.kit.techSeed(MB.F.me, !!mine.bl));
        else if (stage === "item") N.open("item", MB.F.kit.itemSeed());
        else if (stage === "dv") N.open("form", MB.F.kit.formSeed(MB.F.me, MB.F.party[MB.F.act].member));
        else if (stage === "tag") {
            const seed = MB.F.kit.tagSeed(MB.F.party.map((m: MpPartyMember) => m.member), MB.F.party.map((m: MpPartyMember) => m.rec), MB.F.act);
            seed.interactive = forced ? 0 : 1;
            if (forced) seed.cursorRow = Math.max(0, MB.F.party.findIndex((m: { rec: { hp: number; }; }, i: number) => i !== MB.F.act && m.rec.hp > 0));
            N.open("tag", seed);
        }
    }
    const res = N.update(dt);
    if (res) onNativeResult(res, forced, mine);
}

function notice(text: string) { MB.F.nat.say([text], { ms: 1100 }); MB.F.cmd = { stage: "notice" }; }

function onNativeResult(res: MpNativeResult, forced: boolean, mine: MpPlayerEntry) {
    if (res.failed) { console.warn("[mpbattle] a native screen failed; using buttons"); MB.F.ui.nat = null; MB.F.nat = null; MB.F.ui.root.classList.remove("nat"); MB.F.cmd = null; renderCmd(); return; }
    const v = res.value;
    if (res.mode === "cmd") {
        MB.F.cmdRow = v | 0;
        if (v === 0) askTarget({ foes: true }, (k: string) => send({ k: "fight", t: Number(k.slice(1)) }), "Choose a target.");
        else if (v === 1) { if (MB.F.techs.length) MB.F.cmd = { stage: "tech" }; else notice("No techs!"); }
        else if (v === 2) { if (MB.F.kit.forms(MB.F.me).length && !MB.F.me.cantDigivolve) MB.F.cmd = { stage: "dv" }; else notice("Cannot digivolve."); }
        else if (v === 3) { if (MB.F.party.some((m: { rec: { hp: number; }; }, i: number) => i !== MB.F.act && m.rec.hp > 0)) MB.F.cmd = { stage: "tag" }; else notice("Cannot tag."); }
        else if (v === 4) { if (MB.F.kit.items().length) MB.F.cmd = { stage: "item" }; else notice("No items!"); }
        else if (v === 5) send({ k: "run" });
        else MB.F.cmd = { stage: "menu" };
    } else if (res.mode === "tech") {
        if (v === -2) { MB.F.cmd = { stage: "menu" }; return; }
        const t = MB.F.techs.find((x: { id: number; }) => (x.id | 0) === (v | 0));
        if (!t) { MB.F.cmd = { stage: "menu" }; return; }
        const spread = t.type === "attack" && isSpread(t.skill);
        if (spread) send({ k: "tech", sk: t.id, tw: t.tw, t: -1 });
        else if (t.type === "attack") askTarget({ foes: true }, (k: string) => send({ k: "tech", sk: t.id, tw: t.tw, t: Number(k.slice(1)) }), `Choose a target for ${t.name}.`);
        else askTarget({ allies: true, foes: true }, (k: string) => send({ k: "tech", sk: t.id, tw: t.tw, t: k[0] === "e" ? Number(k.slice(1)) : k }), `Choose a target for ${t.name}.`);
    } else if (res.mode === "item") {
        if (v === -2) { MB.F.cmd = { stage: "menu" }; return; }
        const it = MB.F.kit.items().find((x: { id: number; }) => (x.id | 0) === (v | 0));
        if (!it) { MB.F.cmd = { stage: "menu" }; return; }
        const tg = itemTargets(ITEM_BY_ID[it.id] ?? it);
        askTarget({ ...tg, revive: it.id === 70 || it.id === 67 }, (k: string) => {
            send({ k: "item", item: it.id, to: k[0] === "p" ? k : "p" + MB.A.myId(), t: k[0] === "e" ? Number(k.slice(1)) : -1 }); MB.F.kit.spendItem(it.id);
        }, `Use ${it.name} on...`);
    } else if (res.mode === "form") {
        if (v === -2) { MB.F.cmd = { stage: "menu" }; return; }
        send({ k: "dv", form: v });
    } else if (res.mode === "tag") {
        if (v === -2) { if (!forced) MB.F.cmd = { stage: "menu" }; else MB.F.cmd = { stage: "tag" }; return; }
        send({ k: "tag", slot: v | 0 });
    }
    void mine;
}

/** My choice for this turn goes to the referee (or is taken straight in when it is me). */
function send(c: MpWireCommand) {
    MB.F.cmd = null;
    if (MB.F.nat) { MB.F.nat.close(); MB.F.nat.clearSay(); MB.F.cmdRow = 0; }
    const d = { k: "cmd", fid: MB.F.fid, c };
    if (MB.F.isHost) hostCommand(MB.A.myId(), d); else MB.A.send([MB.F.hostId], d);
    renderCmd();
}
