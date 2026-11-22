import { createCheckerboard } from "../stage-wipe.js";
import { fieldPartySize } from "../party.js";
import { mpbHost } from "../mpbattle.js";
import { myId } from "../multiplayer.js";
import { coopRolling, coopTry, coopReady } from "../mpsocial.js";
import { mountForceDismount } from "../mount.js";
import { PRACTICE_BOT_ID, battle, choice, cutscene, fade, mpIdle, state, textbox } from "./vars.js";
import { currentMap } from "./session.js";
import { S } from "./state.js";
import type { MpLaunchOptions, MpPracticeOptions } from "../mpbattle/types.js";
import type { QuestBattleOptions } from "./types.js";
import type { EnemyRecord } from '../types/battle.js';


// Encounter rate is now governed by the authentic data: stages with no zone pool
// (city interiors, story maps) return no encounter, and a zone's empty slots are the
// real per-step miss chance (e.g. s200 zone 1 = 3/8 non-empty ≈ 37%). So we always roll
// the selector on a step-counter expiry and let the data decide. See web/encounters.js.
// The fight-report overlay already showed EXP / Level / Tech / Digivolve learned.
// A newly unlocked form is in the ledger (and auto-equipped if a slot was free);
// the player turns it on from STATUS, not from a second field prompt.
export function presentVictory(_res, after?: any) {
    after?.();
}

// ── THE SHARED field→battle handoff ─────────────────────────────────────────
// Every field battle in the original enters through ONE battle host, fieldstg
// F0x8008b798: it sets the scene's transition bytes (`scene+0x58/+0x5C = 1`,
// docs/workflow/gameplay-playbook.md:1114-1116), and the field's phase-2
// stage-change dispatch then selects the A28 checkerboard (F0x80089F7C)
// precisely because `descriptor+0x5C != 0` — fieldstg.s file 0x895C:
// `lw $v0,0x5C($v1)` / `beqz` in front of the `jal F0x80089f7c`, else the A27
// iris `jal F0x8008a5e4`. So the wipe IS the shared handoff, not a
// random-encounter special case: the host has exactly three callers in
// fieldstg.s (file 0x92c4, 0xf99c, 0xfb34), reached by the walk-up/ambush
// selector F0x800925a8 and the scripted-encounter launcher F0x800927a0 — and a
// kicked tree and a landed fish both use F0x800927a0 (tree-boots doc:156-160,
// fishing doc:489-495). A walk-up, an ambush patch, a kicked tree, a fishing
// catch and a scripted story fight all play this ONE wipe. `update()` steps the
// shared schedule (web/stage-wipe.js) and runs `pending.run()` when it is spent;
// the old walker cut straight to the battle at every one of these sites.
export function startFieldBattle(run) {
    state.wipe28 = { ...createCheckerboard(), pending: { run } };
}

// EXPERIMENT: lets the optional quest layer launch a custom fight (real boss screens, or a stronger copy of one)
// through the same hand-off a random encounter uses, with the same guards. A LOSS returns to the field with the
// party restored (see below) instead of going to the title screen, because the title route belongs to the
// story's own fights.
export function startQuestBattle(party, { screenId = null, onWin, onFlee, onLose }: QuestBattleOptions = {}) {
    if (
        fieldPartySize(state.party) === 0 ||
        battle.isActive() ||
        cutscene.isActive() ||
        textbox.isOpen!() ||
        choice.isOpen!() ||
        fade.dir !== 0 ||
        !!state.diveDemo ||
        !!state.wipe28
    )
        return false;
    const mapId = currentMap().id;
    // A lost challenge costs nothing: put the party's vitals back as they were before the fight (an optional
    // fight must not leave your lead at 1 HP for the rest of the session). Wins and runs keep the real outcome.
    const before = { lead: JSON.stringify(state.partnerStats), party: JSON.stringify(state.partyStats ?? null) };
    const restoreParty = () => {
        state.partnerStats = JSON.parse(before.lead);
        state.partyStats = JSON.parse(before.party);
    };
    startFieldBattle(() =>
        battle.startParty(party, (res) => presentVictory(res, () => onWin?.(res)), () => onFlee?.(), () => { restoreParty(); onLose?.(); }, { screenId, mapId }));
    return true;
}

// EXPERIMENT (multiplayer): a many-vs-many fight. I am its host: it runs on the same field hand-off as any other fight.
export function mpbLaunch({ foes, withId, label, screenId, challenge, opts }: MpLaunchOptions) {
    if (!mpIdle() || fieldPartySize(state.party) === 0) return false;
    const done = (r) => { if (r.fled) opts?.onFlee?.(); else if (r.won) opts?.onWin?.({ ...r }); else opts?.onLose?.(); };
    startFieldBattle(() => {
        mpbHost({ foes, ids: [myId(), withId], label, screenId, challenge, done }).then((ok) => { if (!ok) done({ fled: true }); });
    });
    return true;
}

export function mpbPractice({ foes, label = "Practice 2 vs 2", screenId = null, opts }: MpPracticeOptions = {}) {
    if (!mpIdle() || fieldPartySize(state.party) === 0 || !foes?.length) return false;
    const done = (r) => { if (r.fled) opts?.onFlee?.(); else if (r.won) opts?.onWin?.({ ...r }); else opts?.onLose?.(); };
    startFieldBattle(async () => {
        const kit = await battle.mpKit();
        const recs = kit.party().map((m) => m.rec);
        const order = recs.length > 1 ? [...recs.slice(1), recs[0]] : recs;
        const bots = [{ id: PRACTICE_BOT_ID, name: "Partner", party: order }];
        mpbHost({ foes, ids: [myId() ?? 1], label, screenId, challenge: null, done, bots }).then((ok) => { if (!ok) done({ fled: true }); });
    });
    return true;
}

async function mpPracticeRandom(mapId, x: number, y: number) {
    const a = await battle.rollEncounter(mapId, x, y);
    if (!a) return;
    const b = await battle.rollEncounter(mapId, x, y);
    mpbPractice({ foes: [a.party[0], (b ?? a).party[0]], label: "Practice 2 vs 2", screenId: a.screen ?? null });
}

// EXPERIMENT (multiplayer co-op): a wild fight while teamed up spawns two Digimon from the same area's pool; the partner is
// invited to the same fight and the enemy's HP is shared. If the roll finds nothing there is no fight, as usual.
async function mpCoopRandom(mapId, x: number, y: number) {
    coopRolling(true);
    try {
        const a = await battle.rollEncounter(mapId, x, y);
        if (!a) return;
        const b = await battle.rollEncounter(mapId, x, y);
        const foes = [a.party[0], ...(b ? [b.party[0]] : [])];
        const go = (f: EnemyRecord[], withId: number | null) => (withId ? mpbLaunch({ foes: f, withId, label: "Wild Digimon", screenId: a.screen ?? null }) : startQuestBattle(f, {}));
        if (!coopTry(foes, "Wild Digimon", go)) go(foes, null);
    } finally { coopRolling(false); }
}

export function triggerRandomEncounter(mapId, x: number, y: number) {
    // EXPERIMENT (mounts): a wild fight always starts on foot.
    mountForceDismount();
    if (
        fieldPartySize(state.party) === 0 ||
        battle.isActive() ||
        cutscene.isActive() ||
        textbox.isOpen!() ||
        choice.isOpen!() ||
        fade.dir !== 0 ||
        !!state.diveDemo ||
        !!state.wipe28
    )
        return;
    if (coopReady()) { mpCoopRandom(mapId, x, y); return; }   // teamed up: two wild Digimon, and your partner can join
    if (window.__fx?.practice2v2) { mpPracticeRandom(mapId, x, y); return; }   // F2 -> Extras -> Practice 2 vs 2 (test, off by default)
    startFieldBattle(() =>
        battle.startRandom(mapId, x, y, (res) => presentVictory(res), null, gameOverToTitle));
}

// The decoded loss route, once for every battle kind. wfightmn's loss branch
// (`pro/wfightmn.s` .L0x00003450-0x800a9230) plays the sound 0x60040008 — the
// `lui $a0, 0x6004` at .L0x00003458 and the delay slot `ori $a0, 0x8` at
// .L0x0000346c are one constant — and esmfight 0x53 "Annihilated...", runs the
// 0xF0-frame defeat effect, then the mode-2
// exit `F0x800a7c00` builds the fade object `F0x8008aaac` and calls `F0x8008a83c(obj, 0, 10)` —
// a full 320x256 grey quad, draw mode 0xE1000245 (ABR 2, B-F subtractive), level 0 -> 0xFF00 in
// 10 ticks, then held, so the screen is black. `F0x800a7328` releases the battle hold on the
// party's records (record +0x1A at `0x800a4470 + group*0x20`, and the two participating Digimon
// words at `0x800a3868 + i*0x1C`) — it writes no card, no money and no flag. Then, for result
// byte 2 only, `[0x8004b440](0xE00, 0)` — the pointer's value, `F0x80016b88`, is the
// canonical document's reading (exe/fns.s:7367-7371 is the routine itself: two stores
// into `D0x80048d34` + 0x26c8 and + 0x26d0, i.e. `0x8004b3fc` and `0x8004b404`, the
// pending selector and its second word). There is no field-restore branch on this arm, so
// the field is never rebuilt and nothing is saved.
//
// Only the loss arm asks for the title screen. The win arm (.L0x000021b4) loads 0xE0B or
// 0x1400 into the same launch slot, and the flee/none arm (result 0, .L0x000021a0) leaves by a
// different tail — so a win still comes back to the field and a loss never does.
//
// So the launch is the ONLY thing left to do, and it is a screen change over the black the
// fade left behind — not a page restart, which is what the walker used to do and which put
// its own loading panel on screen between the fade and the title.
export function gameOverToTitle() {
    if (!S.launchTitleScreen) {
        // Unreachable from a running game: init() installs the launch before any battle
        // can be lost. Logged rather than papered over with a reload.
        console.warn("[battle] loss with no title launch installed");
        return;
    }
    S.launchTitleScreen();
}
