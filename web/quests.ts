// Extra quests (new content, not part of the shipped game). On by default; F2 -> "Quests" switches them off.
// Open the log with F3. Quests unlock as you play (see "unlock" below).
//
// Design rules (docs/quests-plan.md):
//   * Never writes the story: no story flags, no master story counter. Quest progress lives under its
//     own localStorage key, so the story and the normal save are valid with this layer on or off.
//   * Hears the game through gameEvents.js (battle won) and one per-frame call (stage entered); it
//     changes no game rule.
//   * Rewards go through the game's own helpers (supplied by game.js), and are paid once: the quest is
//     marked done and saved BEFORE the reward is handed over.
//   * Night / story variants of a map (map-variants.json) count as the same place.
//
// Quest definitions are data (quests.json). Objective types: "defeat" (species, count, optional maps),
// "visit" (one map), "talk" (speak to a real NPC of the game, see questTalk), and the others listed in OBJECTIVES.
// A quest may require another to be done first ({ requires: { done: id } }).
// Quests appear in the log only once they unlock: { unlock: { visited: [maps, any one], done: id, flag: n,
// duelWins: n, level: n, partner: "p008giru", met: [{ npc, map }] } }. Some quests are generated (see generateBounty) and scale with
// the party's level.
import { fx } from "./ambience.js";
import { on } from "./gameEvents.js";
import { fitByWidth, wrapByWidth, wrapToLines, BAND_TEXT_W } from "./text-fit.js";   // measured widths, not character counts
import { textWidth } from "./uifont.js";
import { validateScene } from "./quest-scenes.js";
import { installTriggers } from "./quest-triggers.js";
import { offersAt, offerLabels } from "./quest-offers.js";
import type { QuestProp } from "./types/quest-props.js";
type MapId = string;                                         // a stage id such as "s330"
type NonEmptyMaps = [MapId, ...MapId[]];                     // a giver or a notice board stands in at least one place
/** A scene: the steps in web/quest-scenes.ts's vocabulary. */
// ETS item 42: scene steps come from quests.json; validateScene (and compileScene when it plays) check them before use
type QuestScene = unknown[];
interface QuestPoint { x: number; y: number; r: number; }

interface QuestObjectiveBase {
    scene?: QuestScene;
    label?: string;
    startAt?: MapId[];                                       // a challenge's starting places (canBegin and detailText read it on any objective)
}
interface DefeatObjective extends QuestObjectiveBase { type: "defeat"; species: string[]; count: number; maps?: MapId[]; }
interface VisitObjective extends QuestObjectiveBase { type: "visit"; map: MapId; }
interface ChallengeObjective extends QuestObjectiveBase { type: "challenge"; screen?: number; screens?: number[]; scale?: number; hpMult?: number; }
interface VisitSetObjective extends QuestObjectiveBase { type: "visitSet"; maps: MapId[]; count: number; }
interface DuelWinObjective extends QuestObjectiveBase { type: "duelWin"; count: number; }
interface TalkObjective extends QuestObjectiveBase { type: "talk"; npc: number; maps: MapId[]; lines: string[]; name?: string; retryLines?: string[]; }
interface BringObjective extends QuestObjectiveBase { type: "bring"; item: string; count: number; }
interface LevelObjective extends QuestObjectiveBase { type: "level"; level: number; }
interface OwnFormObjective extends QuestObjectiveBase { type: "ownForm"; species: string; }
interface ReachObjective extends QuestObjectiveBase { type: "reach"; map: MapId; from: QuestPoint; to: QuestPoint; startLabel?: string; }
type QuestObjective = DefeatObjective | VisitObjective | ChallengeObjective | VisitSetObjective | DuelWinObjective | TalkObjective | BringObjective | LevelObjective | OwnFormObjective | ReachObjective;
type ObjectiveType = QuestObjective["type"];
type ObjectiveOf<T extends ObjectiveType> = Extract<QuestObjective, { type: T }>;

/** A character a finished quest is reported to (and the base of the one that hands the quest out). */
interface QuestTurnInRef { name: string; maps: NonEmptyMaps; npc: number; scene?: QuestScene; doneScene?: QuestScene; doneLines?: string[]; }
interface QuestOffer extends QuestTurnInRef { lines?: string[]; ask?: string; acceptLines?: string[]; remindLines?: string[]; }
interface QuestReward { bits?: number; items?: { name: string; count?: number }[]; }
interface QuestVerdict { ask: string; options: string[]; pay?: QuestReward[]; after?: string[][]; }
interface QuestUnlock { visited?: MapId[]; done?: string; flag?: number; duelWins?: number; level?: number; partner?: string; met?: { npc: number; map: MapId }[]; }
interface QuestPropDef { map: MapId; sheet: string; at: number[]; after?: string; clip?: string; layer?: "entity" | "behind" | "front"; solid?: boolean; }

/** One quest as quests.json (or generateBounty) writes it. */
export interface QuestDef {
    id: string;
    title: string;
    short?: string;
    giver?: string;
    text?: string;
    generated?: boolean;
    objectives: QuestObjective[];
    reward?: QuestReward;
    requires?: { done?: string; flag?: number };
    unlock?: QuestUnlock;
    offer?: QuestOffer;
    turnIn?: QuestTurnInRef;
    acceptAt?: NonEmptyMaps;
    acceptScene?: QuestScene;
    doneScene?: QuestScene;
    ordered?: boolean;
    verdict?: QuestVerdict;
    props?: QuestPropDef[];
}
// ETS item 42: the trigger rows come from quests.json; installTriggers checks each one (id and map) before it keeps it
interface QuestsFile { quests?: QuestDef[]; triggers?: unknown; }
interface ManifestMaps { maps?: { id: string; name: string }[]; }

/** Progress of one running quest: count per objective, the places a visitSet has seen, when it was taken. */
interface QuestActive { p: number[]; seen: string[][]; at: number; }
/** The quest layer's own store (the "dw.quests.v1" key). */
interface QuestState {
    v: number;
    active: Record<string, QuestActive>;
    done: Record<string, number>;
    visited: string[];
    met: string[];
    duelWins: number;
    announced: Record<string, number>;
    seen: Record<string, number>;
    triggers: Record<string, number>;
    gen: { n: number; def: QuestDef | null; completed?: number };
}
type QuestStatus = "done" | "ready" | "active" | "available" | "locked";

/** One wild enemy of a field screen (assets/data/field_encounters.json), also the shape a quest fight is started with. */
interface QuestFoe { name: string; level: number; hp: number; mp: number; stat_scale?: number; }
interface FieldEncountersFile { screens: Record<string, QuestFoe[]>; }
interface StageEncountersFile { stages: Record<string, { zones?: { rate_level?: number; slots?: number[] }[] }>; }
interface SpeciesFile { digimon: { id: number; name: string }[]; }
/** A wild single enemy met while walking (a bounty hunts these). */
interface RoamEnemy { name: string; screen: number; level: number; }
type RoamTable = Record<string, RoamEnemy[]>;

interface QuestBattleResult { enemyFled?: boolean; won?: boolean; fled?: boolean; }   // a field fight reports enemyFled, a co-op fight won and fled
interface QuestBattleOpts {
    screenId?: number | undefined;
    challenge?: (number | undefined)[];
    onWin: (res: QuestBattleResult | undefined) => void;
    onFlee: () => void;
    onLose: () => void;
}
interface QuestSceneResult { answer: number | null; failed: boolean; }
/** What game.ts hands the quest layer: the game's own helpers (rewards, battles, speech, choices). */
interface QuestHost {
    giveItem: (name: string, count?: number) => boolean;
    giveBits: (n: number) => void;
    startBattle: (party: QuestFoe[], opts: QuestBattleOpts) => boolean;
    readFlag: (id: number) => number | undefined;
    partyLevel: () => number;
    partnerIds: () => string[];
    npcsHere: () => number[];
    speak: (npcId: number | null, name: string, text: string) => Promise<void>;
    ask: (prompt: string, options: string[]) => Promise<number>;
    idle: () => boolean;
    onDone: (title: string) => void;
    scene: (steps: QuestScene) => Promise<QuestSceneResult | null>;
    ownsForm: (id: number) => boolean;
    countItem: (name: string) => number;
    takeItem: (name: string, n: number) => boolean;
}
interface QuestInstall extends QuestHost { stageEl: HTMLElement | null; }
interface ObjectiveRule { target: (o: RawObjective) => number; valid: (o: RawObjective) => boolean; }
// ETS item 38: an objective in quests.json is untrusted until its valid() has passed, so the rules read it field by field; the any stays in these two rules' parameters, which are never returned.
type RawObjective = Record<string, any>;
interface QuestBattleEvent { enemies?: string[]; mapId: MapId; }
interface QuestDuelEvent { won?: boolean; }
   // the offer loop's filters, written once (F2: pick which job)

const KEY = "dw.quests.v1";
const OBJECTIVES: Record<ObjectiveType, ObjectiveRule> = {
    defeat: { target: (o) => Math.max(1, o.count | 0), valid: (o) => Array.isArray(o.species) && o.species.length > 0 },
    visit: { target: () => 1, valid: (o) => typeof o.map === "string" },
    // a fight the quest layer launches itself: real encounter screens (a boss, or two roaming fights back to back),
    // optionally stronger (scale 16 = normal, hpMult). Only a WIN completes it.
    challenge: { target: () => 1, valid: (o) => (Number.isInteger(o.screen) || (Array.isArray(o.screens) && o.screens.every(Number.isInteger) && o.screens.length > 0)) },
    // visit any N distinct places out of a set; remembers WHICH ones (night/story variants of a place count as one)
    visitSet: { target: (o) => Math.max(1, o.count | 0), valid: (o) => Array.isArray(o.maps) && o.maps.length > 0 && (o.count | 0) >= 1 && (o.count | 0) <= o.maps.length },
    duelWin: { target: (o) => Math.max(1, o.count | 0), valid: (o) => (o.count | 0) > 0 },
    // speak to one of the game's own NPCs (npc_id from the scene files), on one of the listed maps
    talk: { target: () => 1, valid: (o) => Number.isInteger(o.npc) && Array.isArray(o.maps) && o.maps.length > 0 && Array.isArray(o.lines) && o.lines.length > 0 },
    // walk from one gate to another in one go; any fight (or leaving the map) sends you back to the start
    // learn a form of this species (the lead or a party member has it in their ledger; read only)
    // hand over N of an item (the giver keeps them): progress follows what the player carries, and the items are taken
    // when the quest is claimed
    bring: { target: (o) => Math.max(1, o.count | 0), valid: (o) => typeof o.item === "string" && (o.count | 0) >= 1 && (o.count | 0) <= 99 },
    // the party's highest level reaches N (read only)
    level: { target: () => 1, valid: (o) => (o.level | 0) >= 2 },
    // (a scene may also hang off any step: offer.scene, acceptScene, doneScene, or an objective's own scene)
    ownForm: { target: () => 1, valid: (o) => typeof o.species === "string" },
    reach: { target: () => 2, valid: (o) => typeof o.map === "string" && o.from && o.to && [o.from.x, o.from.y, o.from.r, o.to.x, o.to.y, o.to.r].every(Number.isFinite) },
};

let defs: QuestDef[] = [];
let speciesIds: Record<string, number> | null = null;                                       // name -> species id, for "ownForm" (digimon.json, extras included)
let st = loadState();
let api: QuestHost | null = null, fieldEnc: Record<string, QuestFoe[]> | null = null, challengeBusy = false;
let triggerRunner: ReturnType<typeof installTriggers> | null = null;                                    // walk-in quest triggers (web/quest-triggers.js), built from quests.json
let variants: Record<string, string> = {};
let mapNames: Record<string, string> = {};
let lastMap: MapId | null = null, lastX = 0, lastY = 0;
let toastEl: HTMLDivElement | null = null, toastTimer: number | ReturnType<typeof setTimeout> = 0;

function freshState(): QuestState { return { v: 1, active: {}, done: {}, visited: [], met: [], duelWins: 0, announced: {}, seen: {}, triggers: {}, gen: { n: 0, def: null } }; }
function loadState(): QuestState {
    try {
        // ETS item 42: our own saved key; the checks on v, active and done follow, and the newer fields an older save lacks are filled in below
        const j: QuestState | null = JSON.parse(localStorage.getItem(KEY) || "null");
        if (j && j.v === 1 && j.active && j.done) {      // older saves lack the newer fields
            j.visited ??= []; j.met ??= []; j.duelWins ??= 0; j.announced ??= {}; j.seen ??= {}; j.triggers ??= {}; j.gen ??= { n: 0, def: null };
            return j;
        }
    } catch { /* fall through to a fresh state */ }
    return freshState();
}
function saveState() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* private window: progress lasts for the session */ } }

const enabled = () => !fx || fx.quests !== false;
/** Is the quest layer on? (F2 -> Extras -> Quests; the scene layer and the props follow the same switch.) */
export const questsEnabled = enabled;
// ETS item 9: lastMap != null was tested and the callback runs at once (a callback loses the narrowing of a module variable)
const atGiver = (d: QuestDef) => !d.acceptAt || (lastMap != null && d.acceptAt.some((m) => sameMapId(m, lastMap!)));
function sameMapId(a: MapId, b: MapId) { return canon(a) === canon(b); }
const canon = (id: MapId): MapId => variants[id] ?? id;
const sameMap = (a: MapId, b: MapId) => canon(a) === canon(b);
const mapLabel = (id: MapId) => (mapNames[id] ?? mapNames[canon(id)] ?? id).replace(/^.*— /, "");

function validate(d: QuestDef): string | null {
    if (!d || typeof d.id !== "string" || !Array.isArray(d.objectives) || !d.objectives.length) return "needs an id and objectives";
    for (const o of d.objectives) { const t = OBJECTIVES[o.type]; if (!t || !t.valid(o)) return `bad objective ${JSON.stringify(o)}`; }
    // props: our own art a quest leaves on a map once it is accepted or done (docs/quests-fx-brief.md section 6,
    // web/quest-props.js). Only the shape is the quest layer's business; the checker owns the maps and the sheets.
    for (const p of d.props ?? []) {
        if (!p || typeof p.map !== "string" || typeof p.sheet !== "string") return `bad prop ${JSON.stringify(p)}`;
        if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every(Number.isFinite)) return `bad prop place ${JSON.stringify(p)}`;
        if (p.after != null && p.after !== "done" && p.after !== "accepted") return `prop after is "done" or "accepted"`;
    }
    for (const sc of [d.offer?.scene, d.acceptScene, d.doneScene, d.turnIn?.scene, ...d.objectives.map((o) => o.scene)]) {
        if (!sc) continue;
        const bad = validateScene(sc);
        if (bad.length) return `bad scene in "${d.id}": ${bad.join("; ")}`;
    }
    return null;
}

// ------------------------------------------------------------ quest state
// ETS item 9: i is an index into d.objectives that every caller took from d.objectives itself
const targetOf = (d: QuestDef, i: number) => OBJECTIVES[d.objectives[i]!.type].target(d.objectives[i]!);
const allDefs = (): QuestDef[] => (st.gen.def ? [...defs, st.gen.def] : defs);
const defOf = (id: string) => allDefs().find((d) => d.id === id);
function isReady(id: string) {
    const a = st.active[id], d = defOf(id);
    return !!(a && d && d.objectives.every((_, i) => (a.p[i] || 0) >= targetOf(d, i)));
}
const hasVisited = (maps: MapId[]) => maps.some((m) => st.visited.includes(canon(m)));
function unlocked(d: QuestDef) {
    if (d.requires?.done && !st.done[d.requires.done]) return false;
    if (d.requires?.flag != null && api?.readFlag?.(d.requires.flag) !== 1) return false;   // read-only: needs a story beat
    const u = d.unlock;
    if (!u) return true;
    if (u.visited && !hasVisited(u.visited)) return false;
    if (u.done && !st.done[u.done]) return false;
    if (u.flag != null && api?.readFlag?.(u.flag) !== 1) return false;
    if (u.duelWins && st.duelWins < u.duelWins) return false;
    if (u.level && (api?.partyLevel?.() ?? 1) < u.level) return false;
    if (u.partner && !(api?.partnerIds?.() ?? []).includes(u.partner)) return false;
    if (u.met && !u.met.every((r) => st.met.includes(`${r.npc}@${canon(r.map)}`))) return false;      // "you have seen this character there"
    return true;
}
function statusOf(d: QuestDef): QuestStatus {
    if (st.done[d.id]) return "done";
    if (st.active[d.id]) return isReady(d.id) ? "ready" : "active";
    return unlocked(d) ? "available" : "locked";
}
// tell the player once when something new opens up
function announceUnlocks() {
    const fresh: QuestDef[] = [];
    for (const d of allDefs()) {
        if (st.announced[d.id] || statusOf(d) !== "available") continue;
        st.announced[d.id] = 1; fresh.push(d);
    }
    if (!fresh.length) return;
    saveState();
    // one notice per moment, however many givers came into view at once (a busy room can show a dozen)
    // ETS item 9: the ternary tests fresh.length === 1 first
    toast(fresh.length === 1 ? `New quest: ${fresh[0]!.title}` : `${fresh.length} new quests nearby  (look for the red ?, or press F3)`);
}

const placesOf = (maps: MapId[]) => [...new Set(maps.map(mapLabel))].join(" / ");
const turnInRef = (d: QuestDef): QuestTurnInRef | null => d.turnIn ?? d.offer ?? null;      // the NPC a finished quest is reported to, if any
function accept(id: string, viaNpc = false) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "available" || !atGiver(d)) return false;
    if (d.offer && !viaNpc) return false;                    // this one is handed out by a character, not by the log
    st.active[id] = { p: d.objectives.map(() => 0), seen: d.objectives.map(() => []), at: Date.now() };
    saveState(); toast(`Quest accepted: ${d.title}`);
    return true;
}

function claim(id: string, viaNpc = false, pick: number | null = null) {
    const d = defOf(id);
    if (!enabled() || !d || statusOf(d) !== "ready") return false;
    if (turnInRef(d) && !viaNpc) return false;               // report to the character instead
    syncCounts();
    if (statusOf(d) !== "ready") { toast("You no longer have everything this job needs."); return false; }
    // mark done and save FIRST, so a reload can never pay the reward twice
    delete st.active[id]; st.done[id] = Date.now(); saveState();
    // ETS item 9: defs load only after installQuests set api, and claim() returned above unless defOf found one
    for (const o of d.objectives) if (o.type === "bring") api!.takeItem?.(o.item, o.count | 0);   // handed over
    const got: string[] = [];
    const extra = pick != null ? d.verdict?.pay?.[pick] : null;           // what the choice made at the hand-in adds
    const pays = [d.reward ?? {}, extra ?? {}];
    for (const rw of pays) {
        // ETS item 9: api is set (see above)
        if (rw.bits) { api!.giveBits(rw.bits); got.push(`${rw.bits} BIT`); }
        for (const it of rw.items ?? []) {
            // ETS item 9: api is set (see above)
            if (api!.giveItem(it.name, it.count ?? 1)) got.push(`${it.count ?? 1} x ${it.name}`);
            else console.warn(`[quests] reward item "${it.name}" is not in the game's item table; skipped`);
        }
    }
    toast(`Quest complete: ${d.title}${got.length ? "  (" + got.join(", ") + ")" : ""}`);
    // ETS item 9: api is set (see above)
    try { api!.onDone?.(d.title); } catch { /* a listener must never break the reward */ }
    return true;
}

async function enemyParty(o: ChallengeObjective) {
    // ETS item 42: our own shipped data file, typed by the shape it is written in
    if (!fieldEnc) fieldEnc = (await fetch("assets/data/field_encounters.json").then((r): Promise<FieldEncountersFile> => r.json())).screens;
    const party: QuestFoe[] = [];
    for (const scr of o.screens ?? [o.screen]) {
        for (const p of fieldEnc[String(scr)] ?? []) {
            party.push({ name: p.name, level: p.level, hp: Math.round(p.hp * (o.hpMult ?? 1)), mp: p.mp, stat_scale: Math.round((p.stat_scale ?? 16) * ((o.scale ?? 16) / 16)) });
        }
    }
    return party;
}
const challengeIndex = (d: QuestDef) => d.objectives.findIndex((o, i) => o.type === "challenge" && (st.active[d.id]?.p[i] || 0) < 1);
// ETS item 9: the `!...?.startAt ||` test makes the later reads of the same objective safe
const canBegin = (d: QuestDef) => !!api?.startBattle && !challengeBusy && (!d.objectives[challengeIndex(d)]?.startAt || (lastMap != null && d.objectives[challengeIndex(d)]!.startAt!.some((m) => sameMapId(m, lastMap!))));
async function beginChallenge(id: string) {
    const d = defOf(id), i = d ? challengeIndex(d) : -1;
    // ETS item 9: i >= 0 only when defOf found d
    if (!enabled() || i < 0 || statusOf(d!) !== "active" || !canBegin(d!)) return false;
    // ETS item 9: challengeIndex() found a "challenge" objective at i
    const o = d!.objectives[i] as ChallengeObjective;
    const party = await enemyParty(o);
    if (!party.length) { console.warn(`[quests] challenge for "${id}" has no enemies`); return false; }
    challengeBusy = true;
    // ETS item 9: defs load only after installQuests set api, and canBegin() needed api.startBattle
    const started = api!.startBattle(party, {
        screenId: (o.screens ?? [o.screen])[0],
        challenge: o.screens ?? [o.screen],     // lets a co-op partner be credited for the same challenge
        onWin: (res: QuestBattleResult | undefined) => { challengeBusy = false; if (res?.enemyFled) toast("They got away. Try again."); else { bump("challenge", (x) => x === o); } },
        onFlee: () => { challengeBusy = false; toast("You ran away. The challenge is still open."); },
        onLose: () => { challengeBusy = false; toast("You were beaten. The challenge is still open."); },
    });
    if (!started) { challengeBusy = false; toast("Not now - finish what you are doing first."); }
    return started;
}

function markVisited(mapId: MapId) {
    if (!enabled()) return;
    let changed = false;
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        const wasReady = isReady(id);
        d.objectives.forEach((o, i) => {
            if (o.type !== "visitSet" || !o.maps.some((m) => sameMap(m, mapId))) return;
            a.seen = a.seen ?? d.objectives.map(() => []);
            const key = canon(mapId);
            // ETS item 9: a.seen has one list per objective (accept() and the line above make them)
            if (a.seen[i]!.includes(key)) return;
            a.seen[i]!.push(key);
            a.p[i] = Math.min(targetOf(d, i), a.seen[i]!.length);
            changed = true;
        });
        if (!wasReady && isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
    }
    if (changed) saveState();
}

function bump<T extends ObjectiveType>(type: T, match: (o: ObjectiveOf<T>) => boolean): void;
function bump(type: ObjectiveType, match: (o: QuestObjective) => boolean) {
    if (!enabled()) return;
    let changed = false;
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        const wasReady = isReady(id);
        d.objectives.forEach((o, i) => {
            if (o.type !== type || !match(o)) return;
            const t = targetOf(d, i);
            if ((a.p[i] || 0) < t) { a.p[i] = (a.p[i] || 0) + 1; changed = true; }
        });
        if (!wasReady && isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
    }
    if (changed) saveState();
}

// ------------------------------------------------------------ what the game tells us
on("cardDuelEnded", (e: QuestDuelEvent) => { if (e.won) { st.duelWins += 1; saveState(); bump("duelWin", () => true); announceUnlocks(); } });
on("battleWon", (e: QuestBattleEvent) => {
    for (const sp of e.enemies ?? []) bump("defeat", (o) => o.species.includes(sp) && (!o.maps || o.maps.some((m) => sameMap(m, e.mapId))));
});
const near = (p: QuestPoint, r: number) => Math.hypot(lastX - p.x, lastY - p.y) <= p.r;
function resetRoutes(why: string, onlyMap: MapId | null) {
    let changed = false;
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            if (o.type === "reach" && (a.p[i] || 0) === 1 && (!onlyMap || !sameMap(o.map, onlyMap))) { a.p[i] = 0; changed = true; toast(why); }
        });
    }
    if (changed) saveState();
}
on("battleStarted", (e: QuestBattleEvent) => { if (enabled()) resetRoutes("A fight broke out. Start the route again.", null); });
// A quest about a character unlocks once you have actually seen that character where the quest says (story-gated
// characters only appear at certain points of the story, so the quest waits for you to meet them).
let metTick = 0, lastFormScan = 0;
function scanMet(mapId: MapId | null) {
    if (!api?.npcsHere || !mapId) return;
    const here = api.npcsHere();
    if (!here.length) return;
    let changed = false;
    for (const d of allDefs()) {
        for (const r of d.unlock?.met ?? []) {
            const key = `${r.npc}@${canon(r.map)}`;
            if (sameMap(r.map, mapId) && here.includes(r.npc) && !st.met.includes(key)) { st.met.push(key); changed = true; }
        }
    }
    if (changed) { saveState(); announceUnlocks(); }
}
// "bring" and "level" follow the game's own state, so they are re-read whenever something may have changed
function syncCounts() {
    let changed = false;
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        const wasReady = isReady(id);
        d.objectives.forEach((o, i) => {
            let now = null;
            if (o.type === "bring" && api?.countItem) now = Math.min(targetOf(d, i), api.countItem(o.item));
            else if (o.type === "level" && api?.partyLevel) now = api.partyLevel() >= o.level ? 1 : 0;
            if (now == null || (a.p[i] || 0) === now) return;
            a.p[i] = now; changed = true;
        });
        if (!wasReady && isReady(id)) toast(`Quest ready: ${d.title}${turnInRef(d) ? "" : "  (F3)"}`);
    }
    if (changed) saveState();
}
// "ownForm": checked about twice a second, only while such a quest is running
async function scanForms() {
    syncCounts();
    if (!api?.ownsForm || !Object.keys(st.active).some((id) => defOf(id)?.objectives.some((o) => o.type === "ownForm"))) return;
    if (!speciesIds) {
        // ETS item 42: our own shipped data file, typed by the shape it is written in
        try { speciesIds = Object.fromEntries((await fetch("assets/data/digimon.json").then((r): Promise<SpeciesFile> => r.json())).digimon.map((d) => [d.name, d.id])); }
        catch { speciesIds = {}; return; }
    }
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            // ETS item 9: speciesIds was filled above, api was tested at the top, and the == null test comes first
            if (o.type !== "ownForm" || (a.p[i] || 0) >= 1 || speciesIds![o.species] == null || !api!.ownsForm(speciesIds![o.species]!)) return;
            const was = isReady(id);
            a.p[i] = 1; saveState();
            toast(`You learned the ${o.species} form!`);
            if (!was && isReady(id)) toast(`Quest ready: ${d.title}${turnInRef(d) ? "" : "  (F3)"}`);
        });
    }
}
export function questsTick(mapId: MapId | null, x: number, y: number) {
    const prevX = lastX, prevY = lastY, prevMap = lastMap;   // walk-in triggers need the previous tick's place
    lastX = x ?? lastX; lastY = y ?? lastY;
    if (++metTick % 45 === 0) scanMet(mapId);
    const now = performance.now();
    if (now - lastFormScan > 500) { lastFormScan = now; scanForms(); }
    if (mapId !== lastMap) {
        lastMap = mapId;
        if (enabled()) resetRoutes("You left the route. Start it again.", mapId);   // leaving the route's map abandons it
        if (mapId) {
            const key = canon(mapId);
            if (!st.visited.includes(key)) { st.visited.push(key); saveState(); }
            bump("visit", (o) => sameMap(o.map, mapId)); markVisited(mapId);
            ensureGenerated(); announceUnlocks();
            const posted = allDefs().find((d): boolean | undefined => !d.offer && d.acceptAt && statusOf(d) === "available" && d.acceptAt.some((m) => sameMap(m, mapId)));
            if (posted) toast(`A job is posted here: ${posted.title}  (press F3)`);
        }
    }
    if (!enabled() || !mapId) return;
    // Quest triggers (web/quest-triggers.js): walk-in rectangles are enter-only, so the two places are passed on; the
    // first tick on a map has no previous place here, which is exactly the arrival rows' condition ("on": "enter" — a
    // scene that fires because the player walked into a place, once per load, after the game's own arrival chain). A
    // warp still does not count as walking into a patch.
    triggerRunner?.tick(mapId, prevMap === mapId ? prevX : null, prevMap === mapId ? prevY : null, lastX, lastY);
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            if (o.type !== "reach" || !sameMap(o.map, mapId)) return;
            const p = a.p[i] || 0;
            if (p === 0 && near(o.from, o.from.r)) { a.p[i] = 1; saveState(); toast(`Route started: ${o.startLabel ?? "go to the far gate"} - no fights!`); }
            else if (p === 1 && near(o.to, o.to.r)) {
                a.p[i] = 2; saveState();
                if (isReady(id)) toast(`Quest ready to claim: ${d.title}  (F3)`);
            }
        });
    }
}

// ------------------------------------------------------------ talking to the game's own characters
// game.js calls questTalk() when you press confirm on an NPC, AFTER the game's own story check, so a quest can never
// replace a story scene: if the story or a scripted battle takes the conversation, this is never reached.
let dialogBusy = false, logOpen = false;
const declined = new Set<string>();                                  // offers you said "not now" to, until you reload
// Speech goes through the game's own conversation box (web/dialogue-pack.js builds the line, game.js shows it), so it
// looks and sounds like any other NPC; a blank line in the text starts a new page.
const say = (name: string, lines: string | (string | undefined)[], npcId: number | null = null) => (api?.speak ? api.speak(npcId, name, Array.isArray(lines) ? lines.join("\n\n") : lines) : Promise.resolve());
const ask = (prompt: string, options: string[]) => (api?.ask ? api.ask(prompt, options) : Promise.resolve(options.length - 1));
// A step of a quest may carry a scripted scene (web/quest-scenes.js): characters walk and talk on the game's own cutscene
// engine. Without one, or when it cannot run here (a character is not on this map), the plain lines are spoken instead.
// Returns { ran, answer }: whether the scene ran, and the choice made inside it (null when it had none).
async function perform(scene: QuestScene | undefined, name: string, lines: string[] | undefined, npcId: number | null) {
    const r: QuestSceneResult | null = scene && api?.scene ? await api.scene(scene) : null;
    // `failed`: the scene ended on a lost fight (the title screen), so the quest step it was is not done and nothing it
    // would have paid out may be paid (web/game.js playQuestScene).
    if (r) return { ran: true, answer: r.answer, failed: !!r.failed };
    if (lines?.length) await say(name, lines, npcId);
    return { ran: false, answer: null, failed: false };
}
async function busy(fn: () => Promise<void>) { dialogBusy = true; try { await fn(); } finally { dialogBusy = false; } }
const atNpc = (ref: { npc: number; maps: MapId[] } | null | undefined, npcId: number, mapId: MapId): ref is { npc: number; maps: MapId[] } => ref && ref.npc === npcId && ref.maps.some((m) => sameMap(m, mapId));
const talksDone = (d: QuestDef, a: QuestActive, upTo: number) => d.objectives.slice(0, upTo).every((_, j) => (a.p[j] || 0) >= targetOf(d, j));
// A scene that carries a `chase` step answers 1 when the player lost the target (web/quest-scenes.js). A lost chase never
// fails a quest, so it must not complete the step it sits in either: the step stays open and the player can talk again and
// retake it. No quest had a chase before this rule, so nothing that shipped changes.
const chaseLost = (o: QuestObjective, r: QuestSceneResult) => r?.answer === 1 && Array.isArray(o?.scene) && o.scene.some((s) => s && typeof s === "object" && "chase" in s);

/** Returns true when a quest took this conversation (the game then skips the character's normal line). */
const chatted = new Set<number>();   // characters whose ordinary words you have already heard this session
// The quest lab's own focus (lab.prepare): a test panel picks ONE quest to try, but several quests can share a giver (the
// demo packs all put Cipher on the Bridge), and the offer loop would otherwise always hand out the first one in file order.
// A real player never sets this; with it set, only that quest may be offered, and only at its own giver.
let labFocus: string | null = null;
export function questTalk(npcId: number, mapId: MapId | null, hasChat = false) {
    if (!enabled() || dialogBusy || logOpen || !mapId) return false;
    syncCounts();                                            // what the player carries and their level right now
    // 1. a "talk" step of a running quest
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        for (let i = 0; i < d.objectives.length; i++) {
            // ETS item 9: i < d.objectives.length is the loop test
            const o = d.objectives[i]!;
            if (o.type !== "talk" || (a.p[i] || 0) >= 1 || !atNpc(o, npcId, mapId)) continue;
            if (d.ordered && !talksDone(d, a, i)) continue;
            busy(async () => {
                const r = await perform(o.scene, o.name ?? "", o.lines, npcId);
                // Lost the chase this step is built around: the words after it never played, and the step waits for another go.
                if (chaseLost(o, r)) { if (o.retryLines?.length) await say(o.name ?? "", o.retryLines, npcId); return; }
                if (r.failed) return;                            // ended on the title screen: the step stays open
                const was = isReady(id);
                a.p[i] = 1; saveState();
                if (!was && isReady(id)) toast(`Quest ready: ${d.title}${turnInRef(d) ? "" : "  (F3)"}`);
            });
            return true;
        }
    }
    // 2. reporting a finished quest
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), ref = d && turnInRef(d);
        if (!d || !isReady(id) || !atNpc(ref, npcId, mapId)) continue;
        busy(async () => {
            const r = await perform(d.doneScene ?? ref.doneScene, ref.name, ref.doneLines ?? ["Well done. Here is your reward."], npcId);
            if (r.failed) return;                                    // the hand-in scene was lost as a fight: pay nothing
            let pick: number | null = null;
            if (d.verdict) pick = r.answer ?? await ask(d.verdict.ask, d.verdict.options);
            claim(id, true, pick);
            // ETS item 9: a pick exists only when d.verdict does, and the ?.length test makes after[pick] a real list
            if (pick != null && d.verdict!.after?.[pick]?.length) await say(ref.name, d.verdict!.after[pick]!, npcId);
        });
        return true;
    }
    // Offers and reminders never replace what a character normally says (it may be a hint the player needs): the first
    // talk is always the ordinary chat; the quest business comes on the next one (the marker over their head says it waits).
    if (hasChat && !chatted.has(npcId)) { chatted.add(npcId); return false; }
    // 3. an offer. Every job this character could hand out here, in file order (web/quest-offers.js keeps the loop's
    // filters in one place). One job is exactly the old behaviour. With F2 -> Extras -> "Quests: pick which job to take"
    // on, and more than one waiting, the character asks which one; "Back" declines nothing and marks nothing, so the
    // whole list is still waiting on the next talk.
    const offers = offersAt(allDefs(), npcId, mapId, { statusOf, declined, labFocus, canon });
    if (offers.length) {
        busy(async () => {
            let d = offers[0];
            if (offers.length > 1 && fx.questsecondjob === true) {
                const pick = await pagedPick("Which job?", offerLabels(offers, 28));
                if (pick < 0) return;                            // "Back": no job taken, nothing declined
                d = offers[pick];
            }
            const r = await perform(d.offer.scene, d.offer.name, d.offer.lines, npcId);
            if (r.failed) return;                                    // the offer scene ended on the title screen: no quest
            const pick = r.answer ?? await ask(d.offer.ask ?? "Take the job?", ["I will do it", "Not now"]);
            if (pick === 0) {
                accept(d.id, true);
                if (d.acceptScene) await perform(d.acceptScene, d.offer.name, d.offer.acceptLines ?? [], npcId);
            } else declined.add(d.id);
        });
        return true;
    }
    // 4. a job you took from this character and have not finished: they talk about it, not about the weather. The words are
    // the quest's own (offer.remindLines); without them, the quest text and what is still to do.
    for (const id of Object.keys(st.active)) {
        const d = defOf(id), ref = d?.offer;
        if (!d || isReady(id) || !atNpc(ref, npcId, mapId)) continue;
        busy(async () => { await say(ref.name, ref.remindLines ?? [`About the job: ${d.title}.`, d.text], npcId); });
        return true;
    }
    return false;
}

// ------------------------------------------------------------ generated bounties (they scale with the party)
let roam: RoamTable | null = null;                                             // stage id -> [{ name, screen, level }] wild single enemies met while walking
async function loadRoam() {
    try {
        // ETS item 42: our own shipped data files, typed by the shapes they are written in
        if (!fieldEnc) fieldEnc = (await fetch("assets/data/field_encounters.json").then((r): Promise<FieldEncountersFile> => r.json())).screens;
        const se = (await fetch("assets/data/stage_encounters.json").then((r): Promise<StageEncountersFile> => r.json())).stages;
        roam = {};
        for (const [stage, v] of Object.entries(se)) {
            for (const z of v.zones ?? []) {
                if (!((z.rate_level ?? 0) > 0)) continue;
                for (const scr of z.slots ?? []) {
                    const party = scr ? fieldEnc[String(scr)] : null;
                    if (!party || party.length !== 1) continue;
                    const list = (roam["s" + stage] ??= []);
                    // ETS item 9: party.length === 1 was tested above
                    if (!list.some((e) => e.name === party[0]!.name)) list.push({ name: party[0]!.name, screen: scr, level: party[0]!.level });
                }
            }
        }
    } catch (e) { console.warn("[quests] bounty tables unavailable:", e); roam = null; }
}
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round10 = (v: number) => Math.round(v / 10) * 10;
/** Pure: builds the next wanted-board job from where you have been and how strong your party is. */
export function generateBounty(visited: MapId[], level: number, n: number, table: RoamTable): QuestDef | null {
    const places = visited.filter((m) => table[m] && table[m].length);
    if (places.length < 2) return null;                       // there must be somewhere to hunt
    const rand = rng(Math.imul(n + 1, 2654435761) ^ Math.imul(visited.length, 40503) ^ 0x9e3779b1);
    // ETS item 9: places holds at least two stages, each filtered to have a non-empty list in table
    const map = places[Math.floor(rand() * places.length)]!;
    const e = table[map]![Math.floor(rand() * table[map]!.length)]!;
    const L = Math.max(1, level | 0), elite = (n + 1) % 3 === 0;      // every third job is an elite hunt: one real, stronger fight
    const count = clamp(2 + Math.floor(L / 7) + Math.floor(rand() * 2), 2, 9);
    const tier = L >= 35 ? ["Super Charge"] : L >= 20 ? ["Life Disk", "Power Charge"] : L >= 9 ? ["Energy Disk", "Revive Disk", "Sober Disk"] : ["Antidote Disk", "Energy Disk"];
    // ETS item 9: every tier has two or more items and rand() is below 1
    const item = tier[Math.floor(rand() * tier.length)]!;
    const where = mapLabel(map);
    if (elite) {
        return {
            id: "", title: `Elite hunt: ${e.name}`, short: `Elite ${e.name}`, giver: "Wanted board", generated: true, text: `A ${e.name} near ${where} has grown far stronger than the rest. Take it on.`,
            objectives: [{ type: "challenge", screen: e.screen, scale: 16 + clamp(Math.floor(L / 5), 1, 10), hpMult: Math.round((1 + clamp(L / 50, 0, 1)) * 100) / 100, startAt: [map], label: `Beat the stronger ${e.name}` }],
            reward: { bits: clamp(round10((90 + 16 * L) * 4), 300, 6000), items: [{ name: item, count: 1 }] },
        };
    }
    return {
        id: "", title: `Wanted: ${e.name}`, short: `Wanted ${e.name}`, giver: "Wanted board", generated: true, text: `${e.name} keep turning up around ${where}. Thin them out.`,
        objectives: [{ type: "defeat", species: [e.name], count, maps: [map] }],
        reward: { bits: clamp(round10((60 + 12 * L) * count), 120, 5000), items: L >= 6 ? [{ name: item, count: 1 }] : [] },
    };
}
function ensureGenerated() {
    if (!roam || !enabled()) return;
    const cur = st.gen.def;
    if (cur && !st.done[cur.id]) return;                      // the current job is still open
    if (cur) { st.gen.completed = (st.gen.completed || 0) + 1; delete st.done[cur.id]; }
    const d = generateBounty(st.visited, api?.partyLevel?.() ?? 1, st.gen.n, roam);
    if (!d) { st.gen.def = null; return; }
    st.gen.n += 1; d.id = `gen_${st.gen.n}`; st.gen.def = d;
    const bad = validate(d); if (bad) { console.warn("[quests] generated job rejected:", bad); st.gen.def = null; return; }
    saveState();
}

// ------------------------------------------------------------ UI
// Nothing here draws its own windows. Speech is the game's conversation box, the list and the yes/no questions are the
// game's choice widget, and the log is a list of those plus system-window pages. Only the small notice (toast) is ours.
function toast(msg: string) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.opacity = "1";
    // ETS item 9: toast() returned early unless toastEl was set, and nothing clears it
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl!.style.opacity = "0"; }, 4200);
}
function objectiveText(d: QuestDef, i: number) {
    // ETS item 9: i is an index into d.objectives that every caller took from d.objectives itself
    const o = d.objectives[i]!, a = st.active[d.id], p = a ? (a.p[i] || 0) : 0, t = targetOf(d, i);
    if (o.type === "defeat") return `Defeat ${o.species.join(" / ")}${o.maps ? " in " + [...new Set(o.maps.map(mapLabel))].join(" / ") : ""}  ${a ? `${p}/${t}` : `x${t}`}`;
    if (o.type === "challenge") return `${o.label ?? "Win the challenge fight"}${a ? (p >= 1 ? "  (done)" : "") : ""}`;
    if (o.type === "talk") return `${o.label ?? `Talk to ${o.name ?? "someone"} in ${placesOf(o.maps)}`}${a ? (p >= 1 ? "  (done)" : "") : ""}`;
    if (o.type === "visitSet") return `${o.label ?? `Visit ${t} different places`}  ${a ? `${p}/${t}` : `(${t} of ${o.maps.length})`}`;
    if (o.type === "duelWin") return `Win ${t} card duel${t > 1 ? "s" : ""}  ${a ? `${p}/${t}` : `x${t}`}`;
    if (o.type === "visit") return `Visit ${mapLabel(o.map)}${a ? (p >= 1 ? "  (done)" : "") : ""}`;
    if (o.type === "ownForm") return `${o.label ?? `Learn the ${o.species} form`}${a ? (p >= 1 ? "  (done)" : "") : ""}`;
    if (o.type === "bring") return `${o.label ?? `Bring ${t} ${o.item}`}  ${a ? `${p}/${t}` : `x${t}`}`;
    if (o.type === "level") return `${o.label ?? `Reach level ${o.level}`}${a ? (p >= 1 ? "  (done)" : "") : ""}`;
    if (o.type === "reach") return `${o.label ?? `Cross ${mapLabel(o.map)} without a fight`}${a ? (p >= 2 ? "  (done)" : p === 1 ? "  (on the route - no fights!)" : "  (go to the start)") : ""}`;
    return "?";
}
const MARK: Record<string, string> = { ready: "!", active: ">", available: "*", done: "x" };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "." : s);
const logEntries = () => ["ready", "active", "available", "done"].flatMap((s) => allDefs().filter((d) => statusOf(d) === s).map((d) => ({ d, s })));

function detailText(d: QuestDef, s: string) {
    const ref = turnInRef(d);
    const rw = [d.reward?.bits ? `${d.reward.bits} BIT` : "", ...(d.reward?.items ?? []).map((it) => `${it.count ?? 1} x ${it.name}`)].filter(Boolean).join(", ");
    const goals = d.objectives.map((_, i) => "- " + objectiveText(d, i)).join("\n");
    // ETS item 9: challengeIndex(d) >= 0 was tested in the same condition, and the startAt test comes right before its use
    const where = s === "available" ? (d.offer ? `Talk to ${d.offer.name} in ${placesOf(d.offer.maps)}.` : d.acceptAt && !atGiver(d) ? `Accept it at: ${placesOf(d.acceptAt)}.` : "")
        : s === "ready" && ref ? `Report to ${ref.name} in ${placesOf(ref.maps)}.`
        : s === "active" && challengeIndex(d) >= 0 && !canBegin(d) && d.objectives[challengeIndex(d)]!.startAt ? `Begin it at: ${placesOf(d.objectives[challengeIndex(d)]!.startAt!)}.` : "";
    return [`${d.title}${s === "done" ? " (done)" : ""}\n${d.giver ? d.giver + ": " : ""}${d.text ?? ""}`, goals, rw ? `Reward: ${rw}` : "", where].filter(Boolean).join("\n\n");
}
async function showQuest(d: QuestDef): Promise<"leave" | boolean | null> {
    const s = statusOf(d);
    await say("Quest", detailText(d, s));
    const acts: [string, () => boolean | "leave"][] = [];
    if (s === "available" && !d.offer && atGiver(d)) acts.push(["Accept", () => accept(d.id)]);
    if (s === "ready" && !turnInRef(d)) acts.push(["Claim reward", () => claim(d.id)]);
    if (s === "active" && challengeIndex(d) >= 0 && canBegin(d)) acts.push(["Begin the fight", () => { beginChallenge(d.id); return "leave"; }]);
    if (!acts.length) return null;
    const pick = await ask(clip(d.title, 28), [...acts.map((a) => a[0]), "Back"]);
    return pick < acts.length ? acts[pick]![1]!() : null;
}
/** The quest log: a choice list of quests (4 to a page), each opening its details in the conversation box. */
// a quest whose giver (or notice board) is in the place the player is standing in
// ETS item 9: !!lastMap was tested and the callback runs at once
const isHere = (d: QuestDef) => !!lastMap && (d.offer ? d.offer.maps : d.acceptAt ?? []).some((m) => sameMapId(m, lastMap!));
const placeOf = (d: QuestDef) => (d.offer ? mapLabel(d.offer.maps[0]) : d.acceptAt ? mapLabel(d.acceptAt[0]) : "Wanted board");

/** The game's choice list over any number of labels, four at a time. Returns the index picked, or -1 for Back. */
async function pagedPick(prompt: string, labels: string[]) {
    const PER = 4, pages = Math.max(1, Math.ceil(labels.length / PER));
    let page = 0;
    for (;;) {
        const slice = labels.slice(page * PER, page * PER + PER);
        const pick = await ask(prompt, [...slice, ...(pages > 1 ? [`More (${page + 1}/${pages})`] : []), "Back"]);
        if (pick < slice.length) return page * PER + pick;
        if (pages > 1 && pick === slice.length) { page = (page + 1) % pages; continue; }
        return -1;
    }
}
/** A list of quests; "leave" when one of them starts a fight (the log closes). */
async function listQuests(prompt: string, ds: QuestDef[]) {
    const i = await pagedPick(prompt, ds.map((d) => `${MARK[statusOf(d)]} ${clip(d.title, 34)}`));
    if (i < 0) return null;
    // ETS item 9: i < 0 returned above
    return (await showQuest(ds[i]!)) === "leave" ? "leave" : null;     // afterwards the menu is rebuilt: the quest may have changed bucket
}

export async function openLog() {
    if (!enabled() || logOpen || dialogBusy || (api?.idle && !api.idle())) return false;
    logOpen = true;
    try {
        for (;;) {
            const all = logEntries();
            if (!all.length) { await say("Quests", "No quests yet.\n\nExplore, fight and talk to people: quests unlock as you play."); return true; }
            const by = (k: string) => all.filter((e) => e.s === k).map((e) => e.d);
            const avail = by("available");
            const buckets = [["Ready to claim", by("ready")], ["Open quests", by("active")], ["New here", avail.filter(isHere)], ["Elsewhere", avail.filter((d) => !isHere(d))], ["Finished", by("done")]].filter(([, l]) => l!.length);
            const options = [...buckets.map(([n, l]) => `${n} (${l!.length})`), "Reset quests", "Close"];
            const pick = await ask("Quests", options);
            if (pick < buckets.length) {
                // ETS item 9: pick < buckets.length was checked on the line above
                const [name, list] = buckets[pick] as [string, QuestDef[]];
                if (name === "Elsewhere") {                                  // by place, so the player can see where jobs are waiting
                    const places = [...new Set(list.map(placeOf))].sort();
                    for (;;) {
                        const i = await pagedPick("Where?", places.map((p) => `${p} (${list.filter((d) => placeOf(d) === p).length})`));
                        if (i < 0) break;
                        // ETS item 9: i < 0 broke out above
                        if ((await listQuests(places[i]!, list.filter((d) => placeOf(d) === places[i]))) === "leave") return true;
                    }
                } else if ((await listQuests(name, list)) === "leave") return true;
            } else if (options[pick] === "Reset quests") {
                if ((await ask("Reset ALL quest progress?", ["Reset", "Cancel"])) === 0) { st = { ...freshState(), visited: st.visited, duelWins: st.duelWins }; saveState(); toast("Quest progress reset"); ensureGenerated(); announceUnlocks(); }
            } else return true;
        }
    } finally { logOpen = false; }
}

/**
 * The game's own characters a running quest needs on this map right now: the next "talk" step (in order when the quest is
 * ordered) and the person to report to once it is ready. game.js uses it to put a stand-in at the character's usual post
 * when the story has them away from this map at the player's point in the story (the quest would otherwise be stuck).
 */
export function questNeededNpcs(mapId: MapId | null): number[] {
    if (!enabled() || !mapId) return [];
    const out = new Set<number>();
    for (const id of Object.keys(st.active)) {
        // ETS item 9: id comes from Object.keys(st.active), so the entry exists
        const d = defOf(id), a = st.active[id]!;
        if (!d) continue;
        d.objectives.forEach((o, i) => {
            if (o.type !== "talk" || (a.p[i] || 0) >= 1 || !o.maps?.some((m) => sameMap(m, mapId))) return;
            if (d.ordered && !talksDone(d, a, i)) return;
            out.add(o.npc);
        });
        const ref = turnInRef(d);
        if (ref && isReady(id) && ref.maps?.some((m) => sameMap(m, mapId))) out.add(ref.npc);
    }
    return [...out];
}

/** What mark a character wears for the extra quests: "turnin" (a finished job to hand in: red "!"), "offer" (a job to give: red "?") or null. */
export function questNpcMark(npcId: number, mapId: MapId | null): "turnin" | "offer" | null {
    if (!enabled() || dialogBusy || logOpen || !mapId) return null;
    let mark: "offer" | null = null;
    for (const d of allDefs()) {
        const s = statusOf(d);
        if (s === "ready" && atNpc(turnInRef(d), npcId, mapId)) return "turnin";
        if (s === "available" && d.offer && !declined.has(d.id) && atNpc(d.offer, npcId, mapId)) mark = "offer";
    }
    return mark;
}

/**
 * Our own art a quest has left on a map (the quest data's "props", docs/quests-fx-brief.md section 6, drawn and kept by
 * web/quest-props.js): a little thing that stays in the world because of what the player did. "after": "done" (the
 * default) holds once the quest is handed in, "accepted" from the moment it is taken. Read every frame by game.js, which
 * hands the list to web/quest-props.js; off with the Quests switch, like the rest of this layer.
 */
export function questPropsOn(mapId: MapId | null): QuestProp[] {
    if (!enabled() || !mapId) return [];
    const out: QuestProp[] = [];
    for (const d of allDefs()) {
        const list = d.props;
        if (!Array.isArray(list)) continue;
        list.forEach((p, i) => {
            if (!p || !p.sheet || !sameMap(p.map, mapId)) return;
            const after = p.after === "accepted" ? "accepted" : "done";
            const holds = after === "accepted" ? !!(st.active[d.id] || st.done[d.id]) : !!st.done[d.id];
            if (!holds) return;
            out.push({
                key: `${d.id}#${i}`, sheet: p.sheet,
                x: p.at?.[0] ?? 0, y: p.at?.[1] ?? 0,
                clip: p.clip, layer: p.layer, solid: p.solid === true,
            });
        });
    }
    return out;
}

/** Text for the game's own character set (the pause page): its fonts have no slash, brackets or stars. */
const forGameText = (s: string) => String(s).replace(/(\d+)\/(\d+)/g, "$1 of $2").replace(/\s+\/\s+/g, " or ").replace(/[^A-Za-z0-9 .,'\-:!?"]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The extra row on the pause home list (one of PauseSeed.extraRows in engine/dw3/ui/pause-root-session.ts, opens "quests"; web/pause-extra-rows.js lists it). The label carries the
 * number of quests that want attention (ready to claim, or new and not yet taken), e.g. "QUESTS 2". Null when quests are off.
 */
export function questsPauseRow() {
    if (!enabled() || !defs.length) return null;
    const all = logEntries();
    const n = all.filter(({ d, s }) => s === "ready" || (s === "available" && isHere(d))).length;     // what wants attention in THIS place
    return { label: n ? `QUESTS ${n}` : "QUESTS" };
}

/** A co-op partner won the challenge fight with these screens: credit any open challenge of mine that is the same fight. */
export function questsCreditChallenge(screens: number[]) {
    const key = JSON.stringify(screens);
    bump("challenge", (o) => JSON.stringify(o.screens ?? [o.screen]) === key);
}

/** How many extra quests this player has finished (shared on the multiplayer player card). */
export function questsDoneCount() { return Object.keys(st?.done ?? {}).length; }
/** Is that quest handed in? (Read-only: the mount layer unlocks a mount from it.) */
export function questDone(id: string) { return !!st?.done?.[id]; }

/** What the QUESTS page lists: ready, open and new quests, each with the three lines shown under the list. */
const EMPTY_SENTENCE = "Explore and talk to people. Quests appear as you play.";
export function questsPausePage() {
    if (!enabled() || !defs.length) return null;
    const MARK: Record<string, string> = { ready: "! ", active: "- ", available: "? " };
    const W = (s: string) => textWidth(s);                                       // the game font's own advance widths
    const TITLE_W = 126;                                                 // the list window's text area (x 189 to the window edge)
    const entries = logEntries().filter(({ d, s }) => s === "ready" || s === "active" || (s === "available" && isHere(d))).map(({ d, s }) => {
        const a = st.active[d.id];
        const k = d.objectives.findIndex((_, j) => ((a?.p[j]) || 0) < targetOf(d, j));
        const ref = turnInRef(d);
        const goal = s === "ready" ? (ref ? `Report to ${ref.name} in ${placesOf(ref.maps.slice(0, 1))}` : "Done. Claim it with F3")
            : s === "available" ? (d.offer ? `Talk to ${d.offer.name} in ${placesOf(d.offer.maps.slice(0, 1))}` : d.acceptAt ? `Accept it at ${placesOf(d.acceptAt.slice(0, 1))}` : "Open it with F3")
            : (k >= 0 ? objectiveText(d, k) : "");
        const rw = [d.reward?.bits ? `${d.reward.bits} BIT` : "", ...(d.reward?.items ?? []).map((it) => `${it.count ?? 1} ${it.name}`)].filter(Boolean).join(", ");
        const line = (t: string) => fitByWidth(forGameText(t), W, BAND_TEXT_W);     // the page has no room for an ellipsis
        // the full text, for reading: description, every objective with its progress, the reward and where to go
        const full = [d.text ?? "", ...d.objectives.map((_, j) => "- " + objectiveText(d, j)), rw ? `Reward: ${rw}` : "", goal]
            .filter(Boolean).flatMap((t) => wrapByWidth(forGameText(t), W, BAND_TEXT_W));
        const pages: string[][] = [];
        for (let i = 0; i < full.length; i += 3) pages.push([full[i] ?? "", full[i + 1] ?? "", full[i + 2] ?? ""]);
        return { title: fitByWidth(MARK[s] + forGameText(d.short ?? d.title), W, TITLE_W), lines: [line(d.title), line(goal), line(rw ? `Reward: ${rw}` : "")], pages: pages.length ? pages : [["", "", ""]] };
    });
    return { prompt: "QUESTS   Enter: Read", readPrompt: "QUESTS   Enter: Next", emptyLines: wrapToLines(EMPTY_SENTENCE, W, BAND_TEXT_W), entries };
}

function installUi(stageEl: HTMLElement) {
    const css = document.createElement("style");
    css.textContent = `
      #quest-toast { position:absolute; left:50%; transform:translateX(-50%); top:14px; z-index:51; max-width:80%; padding:5px 12px; background:rgb(0,0,32); border:1px solid rgb(104,104,208);
        color:#fff; font:14px monospace; pointer-events:none; opacity:0; transition:opacity .3s; }`;
    document.head.appendChild(css);
    toastEl = document.createElement("div"); toastEl.id = "quest-toast";
    stageEl.append(toastEl);
    window.addEventListener("keydown", (e) => {
        if (e.key !== "F3") return;
        e.preventDefault();
        if (!enabled()) { if (e.isTrusted) toast("Quests are switched off. Press F2 and tick \"Quests\" (under Extras)."); return; }
        openLog();
    });
}

// ------------------------------------------------------------ install
export async function installQuests({ stageEl, giveItem, giveBits, startBattle, readFlag, partyLevel, partnerIds, npcsHere, speak, ask, idle, onDone, scene, ownsForm, countItem, takeItem }: QuestInstall) {
    if (!stageEl || api) return;
    api = { giveItem, giveBits, startBattle, readFlag, partyLevel, partnerIds, npcsHere, speak, ask, idle, onDone, scene, ownsForm, countItem, takeItem };
    installUi(stageEl);
    // ETS item 42: triggers are raw rows; installTriggers checks every one (id and map) before it keeps it
    let triggerDefs: unknown[] = [];
    try {
        // ETS item 42: our own shipped files; every quest goes through validate() below, the others are read with ?? fallbacks
        const [q, v, m]: [QuestsFile, Record<string, string>, ManifestMaps] = await Promise.all([
            fetch("quests.json").then((r) => r.json()),
            fetch("map-variants.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
            fetch("assets/manifest.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        ]);
        variants = v || {};
        mapNames = Object.fromEntries((m.maps ?? []).map((x) => [x.id, x.name]));
        const seen = new Set<string>();
        for (const d of q.quests ?? []) {
            const bad = validate(d);
            if (bad || seen.has(d.id)) { console.warn(`[quests] skipped "${d.id}": ${bad || "duplicate id"}`); continue; }
            seen.add(d.id); defs.push(d);
        }
        triggerDefs = Array.isArray(q.triggers) ? q.triggers : [];
    } catch (e) { console.warn("[quests] could not load quests.json:", e); }
    // Quest triggers (web/quest-triggers.js): authored rectangles that start a scene when the player steps into them,
    // and `on: "enter"` rows that start one because the map was loaded (the disc's own gate-object shape). Off unless
    // F2 -> Extras -> Quest triggers is ticked (and the Quests layer itself is on); a scene runs only when the game is idle.
    triggerRunner = installTriggers(triggerDefs, {
        enabled: () => enabled() && fx.questtriggers === true,
        statusOf: (id) => { const d = defOf(id); return d ? statusOf(d) : null; },
        idle: () => !!(api?.idle && api.idle()),
        get dialogBusy() { return dialogBusy; },
        get battle() { return challengeBusy; },
        state: () => st,
        playScene: (scene) => (api?.scene ? api.scene(scene) : null),
        save: saveState,
        warn: (m) => console.warn(m),
    });
    await loadRoam();
    ensureGenerated(); announceUnlocks();
    window.__quests = {   // debug / test hooks; nothing in the game reads these
        // ETS item 9: the ternaries on status and detail ask defOf(id) first
        get state() { return st; }, get defs() { return defs; }, accept, claim, status: (id: string) => (defOf(id) ? statusOf(defOf(id)!) : null),
        openLog, npcMark: questNpcMark, isLogOpen: () => logOpen, entries: () => logEntries().map(({ d, s }) => ({ id: d.id, title: d.title, status: s })), detail: (id: string) => (defOf(id) ? detailText(defOf(id)!, statusOf(defOf(id)!)) : null), bump, beginChallenge, questTalk, save: saveState, generateBounty, ensureGenerated, announceUnlocks, get roam() { return roam; },
        where: () => ({ lastMap, lastX, lastY, enabled: enabled() }),
        // test panel hooks (web/quest-lab.js, ?questlab=1): bend the quest state so a quest can be tried at once.
        // They only touch the quest layer's own store, never the story.
        lab: {
            /** Make a quest startable: its prerequisites done, and it is neither active nor done. This is also the lab's
             *  focus: while it holds, only this quest may be offered at its giver (several demos share one character). */
            prepare(id: string): { level: number; status: string } {
                labFocus = id;
                const seen = new Set<string>();
                const markDone = (q: string): void => {
                    const d = defOf(q);
                    if (!d || seen.has(q)) return;
                    seen.add(q);
                    for (const p of [d.requires?.done, d.unlock?.done]) if (p) { markDone(p); st.done[p] ??= Date.now(); delete st.active[p]; }
                };
                markDone(id);
                delete st.active[id]; delete st.done[id]; delete st.announced[id];
                const d = defOf(id);
                for (const r of d?.unlock?.met ?? []) { const key = `${r.npc}@${canon(r.map)}`; if (!st.met.includes(key)) st.met.push(key); }
                for (const m of d?.unlock?.visited ?? []) { const key = canon(m); if (!st.visited.includes(key)) st.visited.push(key); }
                declined.clear(); saveState();
                return { level: d?.unlock?.level ?? 1, status: statusOf(d) };
            },
            /** Meet every objective at once (taking the quest first if needed). */
            finishGoals(id: string) {
                const d = defOf(id);
                if (!d) return false;
                if (!st.active[id]) { if (st.done[id]) return false; st.active[id] = { p: d.objectives.map(() => 0), seen: d.objectives.map(() => []), at: Date.now() }; }
                // ETS item 9: the line above made st.active[id]
                d.objectives.forEach((_, i) => { st.active[id]!.p[i] = targetOf(d, i); });
                saveState(); toast(`Goals met: ${d.title}`);
                return true;
            },
            reset() { st = freshState(); declined.clear(); labFocus = null; saveState(); },
            /** Focus one quest for the next offer (null clears it); prepare() does this on its own. */
            focus(id: string | null | undefined) { labFocus = id ?? null; },
        },
    };
}
