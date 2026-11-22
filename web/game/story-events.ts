import type { NameEntryOptions } from "./types.js";
import {
  cardDuelCloseWrites,
  talkLaunchEventForBit,
  resolveTalkLaunchRecord,
  ui as engineUi,
  dungeonSwitchCommand,
  newPadSwitchObject,
  applyDungeonSwitchCommand,
  rosterMaskForParty,
  savePointBySlot,
  movieRow,
  resetFieldChar,
} from "../vendor/engine.js";
import { gunslingerSwitchCommand, applyGunslingerSwitch } from "../gunslinger-switch.js";
import { PACKS } from "../packs.js";
import { grantPack } from "../party.js";
import { clearStageObjects } from "../stage-objects.js";
import { resetFieldBlanks } from "../native-stage.js";
import {
  AUCTION_STAGE,
  DIR8_CS,
  battle,
  cardShop,
  cutscene,
  driMenu,
  helpMenuBox,
  isSavePointHandoffId,
  itemLog,
  nameEntryNative,
  sfx,
  shop,
  state,
  storyFlags,
  yesNoBox,
} from "./vars.js";
import { openCardShopFolder, openMemoryCard, openPackSelect, playMovieChain } from "./ui-openers.js";
import { currentMap, manifestIndexOf } from "./session.js";
import { S } from "./state.js";
import { gameOverToTitle, startFieldBattle } from "./battle-launch.js";
import { grantNewPartners, refreshPartyCharisma, setCharacter } from "./map-load.js";
import { parkGatheredFollowers, resetFollowers } from "./followers.js";
import { startTransition } from "./transitions.js";
import { questSceneFxReset } from "./quest-scenes.js";

/** Browser presentation of the shared engine command router. */
export function applyStoryCommand(command: { kind: string; index: number; parameter?: number }) {
    if (command.kind === "battle") {
        state.pendingStoryBattleIndex = command.index;
        return;
    }
    {
        if (command.kind === "item_shop" || command.kind === "card_shop" || command.kind === "inn") {
            const index = command.index;
            const rec = state.shops?.[index];
            if (command.kind === "item_shop") { itemLog.noteSeen(rec?.items ?? []); shop.open!(rec?.items ?? [], null, { name: rec?.name, state, shopId: index }); }
            // CARD SHOP — CORRECTED 2026-08-08. The card shop is 0x31..0x43 and
            // 0x46..0x4A, not 0x1e..0x30: set_flag routes those to
            // launch_ui(0x1300, index), 0x1300 is STCRDSHP, and `index` is the
            // launch parameter the shop keys its STOCK on. Passing it through is
            // what makes each shop sell its own six cards, and what makes a
            // shop's stock advance with the story — the shopkeeper's dialogue
            // state carries a different index per story stage, so the gate the
            // engine already evaluates for dialogue picks the stock list too.
            // The walker used to open the shop for 0x1e..0x30 with no id, which
            // was the wrong range AND lost the stock selection.
            else if (command.kind === "card_shop") {
                cardShop.open!(state, null, openCardShopFolder, index);
            }
            // THE INN — DECODED 2026-08-13. Everything that is not `< 0x1e` and
            // not a card-shop index falls through to `jal D0x8008c000`, which
            // builds the rest screen with F0x80011dac(0x1002). That screen class
            // (F0x800119a8) does NOT use the flag index: it calls the screen-id
            // getter D0x8004b438 and scans the resident 8-byte table D0x8003edcc
            // for the current screen, so the MAP picks the inn and its price.
            // That is why s650 and s651 both carry flag index 0x2d and still
            // charge 48 and 80 BIT.
            //
            // Remembered, not opened, so the innkeeper finishes speaking first —
            // the same shape as the gym greeter and the card duel above.
            else if (command.kind === "inn") {
                state.pendingInn = true;
            }

        } else if (command.kind === "gym") {
            // Bank 0x94 = the STGTRAIN launcher: set_flag routes it to
            // launch_ui(0xa00, index), where index is the 0-based rank-menu
            // group (GYM-Q001, decoded 2026-07-26 — gym-entry-and-rank-chain
            // -2026-07-08.md). The greeter's dialogue states pick the index by
            // ID card owned, so nothing here needs to know which gym it is.
            // Remembered until the greeter's dialogue closes.
            state.pendingGymGroup = command.index;
        } else if (command.kind === "talk_event") {
            // Bank 0x90 = the TALK-CUTSCENE launcher, and it is how most of this
            // game's optional content actually starts. F0x800165ac routes the
            // write to fieldstg F0x8008bfa4, which reads the event id out of the
            // u16 array at RAM 0x800978d8 (talk_event_launches.json) indexed by
            // the flag's low 9 bits, then calls the SAME start_event
            // (0x800853f8) the step-VM's op-8 handler calls. So the bit is a
            // table index, not an event id and not a per-stage slot.
            //
            // Deliberately NOT one-shot-guarded, unlike the OnStep trigger path:
            // the original re-enters on every write, and what prevents a replay
            // is the NPC's own dialogue-state machine — the on_close that fires
            // this is the same one that advances the NPC past the state carrying
            // it. Adding a guard here would double-gate it.
            //
            // The VALUE is not consulted either: the dispatcher body for bank
            // 0x90 is `D0x8008bfa4(temps0)` — `arg1` is never read
            // (exe-decomp/c/F0x800165ac.c L100-103). That matters for the save
            // point: the Guardromon's second dialogue state writes 0x9001 = 0
            // (web/assets/scenes/s235.json npc 21), and the value-0 write is
            // what opens the memory-card screen in the original. Guarding on
            // `expected` silently dropped that trigger.
            playTalkEvent(command.index);
        } else if (command.kind === "card_duel") {
            // Banks 0x76/0x78 = the CARD-DUEL launcher. set_flag F0x800165ac
            // routes both to F0x80016378(index, mode) with mode 0 for 0x76 and
            // 1 for 0x78, which calls the screen-pack dispatcher
            // D0x8008b770(0x700, index * 2 + mode + 1, 0, 0, 0). So the packed
            // argument selects WHICH duel, and kind 0x700 is the duel itself.
            //
            // Decoded 2026-08-05 from a controlled runtime capture: talking to
            // the Tamer Mitch NPC at s335 (estalk02 index 113, "All right, I'm
            // going to Card Battle with you!"), whose duel dialogue state has
            // on_close flag 0x7606 = bank 0x76 index 6, loads the pro/cardgame
            // overlay and starts a duel. See
            // docs/research/card/captures/cardduel-full-duel-s482-state5-2026-08-05.md
            //
            // This replaces the old DUEL_ISLAND_STAGES walker rule, which
            // guessed at s385/s386 because the launcher was untraced.
            //
            // Remembered here, opened by the talk handler once the box closes,
            // so the challenger's name is available. Launched with NO
            // confirmation prompt: in the capture the dialogue closes, the
            // screen fades and the duel loads (frames 210 -> 294 -> 296). The
            // original never asks "do you want to".
            //
            // The card screen consumes the shared router's packed duel id.
            state.pendingDuelId = command.parameter;
        } else if (command.kind === "digimon_lab" || command.kind === "name") {
            const index = command.index;
            if (index === 0) {
                // The DRI desk owns the complete stgdglab flow: root,
                // Switch, Digivolve and the four-page Digivolve Chart.
                driMenu.open!(state, null);
            } else if (index === 1 && state.party?.length) {
                state.nameEntry = openNameEntry({});
                state.nameEntryDone = () => {
                    // The translated screen can confirm several partners in one visit.
                    const results = state.nameEntry.results?.() ?? [state.nameEntry.result?.()];
                    let changed = false;
                    for (const result of results) {
                        if (result?.accepted && result.memberId) {
                            state.digimonNames[result.memberId] = result.value;
                            changed = true;
                        }
                    }
                    if (changed) {
                        localStorage.setItem(
                            "digimonNames",
                            JSON.stringify(state.digimonNames),
                        );
                    }
                    state.nameEntry = null;
                };
            }
        }
        return;
    }
}

// The field's screen-close housekeeping for a card duel — F0x800169e0, the resident
// export slot 0x80048ad4 (engine/systems/scene-completion.ts cardDuelCloseWrites has
// the full read). The field runs it on (re)entry; when the previous screen code
// (D0x8004b400) is 0x700 — the card duel — it sets story flags 17 (a duel was
// played) and 18, sets flag 16 from the duel's own result latch (1 = the player
// won), and clears the latch. Every tamer's post-duel dialogue states gate on
// 17/16 and their close lists clear the pair, which is what makes a challenge
// one-shot: without these writes the challenge state stays the only reachable
// one and the NPC re-challenges forever (the walker's pre-fix behaviour).
export function applyCardDuelCloseHousekeeping(won: boolean) {
    for (const write of cardDuelCloseWrites(won === true)) storyFlags.set(write.id, write.value);
}

/** Open the naming screen (pro/stdgname). The screen reads the pad
 *  from `state.keys` each frame, so the returned object needs no per-key calls. */
export function openNameEntry(opts: NameEntryOptions = {}) {
    nameEntryNative.open!({ initial: opts.initial ?? "", state });
    return nameEntryNative;
}

// Bank-0x70 op-0x18 case 8: set_flag(0x7053,1) dispatches the original's active-party
// full heal (cur_hp=max_hp, cur_mp=max_mp; roster_predicate_table record key 83). HP/MP
// live here, not in the headless engine, so the engine's HealParty command forwards to
// this through its constructor hook. Same fields the battle writes back.
export function healActiveParty() {
    const full = (ps) => {
        if (!ps) return;
        if (ps.maxHp != null) ps.hp = ps.maxHp;
        if (ps.maxMp != null) ps.mp = ps.maxMp;
    };
    full(state.partnerStats);
    for (const ps of state.partyStats ?? []) full(ps);
    if (state.partnerStats)
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
}

// Play one story event's cutscene (esdmg text + opcode stream), restore static NPC
// positions afterward, then report the resulting handoff (or null) to the engine.
// ── Story-flow debug trace (on by default; silence with window.__storyDebug=false) ──
// Prints every map ENTER, EVENT fired (auto vs talk), and WARP so the opening flow can be
// captured from the console. An EVENT line appearing right after ENTER with no TALK in
// between = an event auto-firing on entry (the auto-teleport bug).
export function storyDbg(...a) {
    if (window.__storyDebug !== false)
        console.log("%c[STORY]", "color:#0a0;font-weight:bold", ...a);
}

// Index the engine-content scripted battles by their PRE event's flag_key, so a
// POSITION-triggered PRE (the walk-up + chat cutscene) can chain straight into the battle and
// then the POST chat — the authentic "scripted walk → talk → battle → post-talk" as ONE flow.
// (The talk path already chains via engine-bridge re-raise; this covers the position path.)
export function buildScriptedBattleIndex(content) {
    const fk = content.flagKeys || {};
    const idx = {};
    for (const st of content.stages || []) {
        const mid = st.mapId;
        const eventOf = (id: string) => (st.events || []).find((e) => e.id === id);
        const scriptOf = (id) => (st.scripts || []).find((s) => s.id === id);
        for (const be of st.events || []) {
            if (!/\.sb\.battle(\.|$)/.test(be.id)) continue;
            const tag = be.id.slice((mid + ".sb.battle").length); // "" or ".<actor>"
            const sbop = (scriptOf(be.do)?.program || []).find(
                (o) => o.op === "StartBattle",
            );
            if (!sbop) continue;
            const pre = eventOf(`${mid}.sb.pre${tag}`);
            const post = eventOf(`${mid}.sb.post${tag}`);
            const preId = Number(pre?.do.match(/event\.(\d+)\./)?.[1]);
            const postId = Number(post?.do.match(/event\.(\d+)\./)?.[1]);
            const preKey = fk[mid]?.[preId];
            if (!preKey) continue;
            (idx[mid] ||= []).push({
                preKey,
                postKey: fk[mid]?.[postId] ?? null,
                screenId: sbop.args[0].v,
                wonFlag: sbop.args[1].v,
                actor: be.match?.npc,
            });
        }
    }
    return idx;
}

// If `ev` is a stage's scripted-battle PRE (matched by flag_key), drive the fight right after
// the walk-up/chat cutscene ends, then play POST on victory. No-op if already won or no party.
export function chainScriptedBattleFromPre(ev) {
    const mid = currentMap().id;
    const sb = (state.sbIndex?.[mid] || []).find((b) => b.preKey === ev.flag_key);
    if (!sb) return false;
    if (S.engine && S.engine.state.flags.get(sb.wonFlag, 1)) return false; // already won
    const party = battle.partyForScreen(sb.screenId);
    if (!party || !party.length) return false;
    startFieldBattle(() => battle.startParty(
        party,
        () => {
            // win → mark won (gates the talk-path battle row out) and resume POST chat,
            // then despawn the defeated boss so he leaves and can't be re-talked.
            if (S.engine) S.engine.state.flags.set(sb.wonFlag, true);
            const finish = () => despawnDefeatedBoss(sb.actor);
            const postEv =
                sb.postKey &&
                (state.wstag[mid] || []).find((e) => e.flag_key === sb.postKey);
            if (postEv)
                playStoryEvent(postEv, (h) => {
                    if (h) doStoryHandoff(postEv, h);
                    finish();
                });
            else finish();
        },
        () => {}, // flee → replayable (talk to re-engage)
        gameOverToTitle, // lose → title (the loss branch has no battle-kind test)
        { screenId: sb.screenId, mapId: mid },
    ));
    return true;
}

// After a boss is beaten, set its "defeated" spawn-gate flag so it despawns (and is no longer
// talkable). A boss spawn-gate carries a {flag, expected:0} STORED guard meaning "absent once
// this is set" (e.g. Keith s205 = ordinal==6 & 0x4016==0; the overlay sets 0x4016 on defeat).
// Ordinal (bank 0x60) and virtual banks are skipped — only real stored guards are flipped.
function despawnDefeatedBoss(actor) {
    const sc = state.scenes[currentMap().id];
    if (!sc) return;
    for (const npc of sc.npcs || []) {
        if (npc.npc_id !== actor) continue;
        for (const f of npc.spawn_flags || []) {
            if (f.expected === 0 && ((f.id >> 8) & 0xfe) <= 0x40) storyFlags.set(f.id, 1);
        }
    }
}

// Bank-0x90 talk launcher (see applyStoryFlag) — the shared system, ported once in
// engine/systems/talk-launch.ts. `bit` indexes the fieldstg event-id array; the id it names
// is then resolved against the CURRENT stage's event table, exactly like the op-8 step
// handler. start_event has no cross-stage lookup, so a bit whose event belongs to another
// stage simply finds nothing; the three shipped bindings in that state (s550 bit 17,
// s551 bit 18, s537 bit 54) are carried as `in_stage: false` in the bindings data rather
// than redirected to a guessed stage.
//
// Both halves of that resolution live in the shared module, because both were once guessed
// here and got it wrong. ID FIRST: flag_key is not unique inside a stage — the Master Room's
// records at wstag305.s file 0x39ac / 0x39c0, event 965 ("walk down and leave to s310") and
// event 1450 ("walk back to the middle of the room"), share flag_key 012e000a, so a
// flag_key-first lookup hands bit 97 the wrong record and sends the player downstairs.
// flag_key stays the fallback, for a stage whose wstag ids disagree with the step table's.
function playTalkEvent(bit) {
    const mapId = currentMap().id;
    // The shipped binding table is the authority on what this bit means HERE; the resident
    // event-id array (state.talkEventIds) is the fallback for a stage the bindings file does
    // not carry, so a missing file degrades to the old behaviour instead of losing every
    // conversation-started scene.
    const eventId = talkLaunchEventForBit(mapId, bit) ?? state.talkEventIds?.[bit] ?? null;
    const prog = state.storySteps?.[mapId.replace(/^s/, "")];
    const erec = prog?.events?.find((e) => e.event_id === eventId);
    const ev = erec
        ? resolveTalkLaunchRecord({ byId: prog.events, byWstag: state.wstag[mapId] || [] }, eventId)
        : null;
    if (!ev) {
        storyDbg("TALK EVENT", bit, "→ id", eventId, "unresolved on", mapId);
        return;
    }
    storyDbg("TALK EVENT", bit, "→ id", eventId, erec.flag_key, "on", mapId);
    playStoryEvent(ev, (handoff) => {
        // The event's OWN on_complete, through the engine — the same call the OnStep route
        // makes (web/game.js playEvent wrapper above). It runs
        // `<stage>.event.<id>.oncomplete` (the flag writes read out of that event's
        // routine) and, from ordinal.byStageOwner (tools/extract_ordinal_owner.py), stores
        // the story step that event's routine stores — and only that event's. The old
        // advanceOrdinal() here moved the story on ANY completed event of the stage, which
        // is how a walker's mid-scene could jump the step.
        S.engine!.completeEvent(eventId);
        // The event's own completion writes (same list the OnStep path applies).
        for (const [fid, val] of erec.sets || []) storyFlags.set(fid, val ? 1 : 0);
        // HANDOFF IS A SCREEN TRANSITION, wherever in the script it sits: op 3.4 is
        // `0x8008b770(id,-1,x<<8,y<<8,p)` then the runner's own `vt+0x28(2)`
        // (docs/research/scripting/field-script-engine-verified.md §3.4, file 0x25d0).
        // The two other launch routes already hand their HANDOFF to doStoryHandoff
        // through the bridge (web/engine-bridge.js:92 `if (handoff != null) doHandoff`),
        // and the launcher calls the SAME start_event the bridge's rows come from
        // (engine/systems/talk-launch.ts), so this route warps too. Until 2026-10-05 it
        // routed only the save-point family, which is why the East/South Station gondola
        // had to be hand-wired as an OnExit row in tools/engine-convert/decode-table.json:
        // the walk only happened because a person invented an exit trigger the disc does
        // not have. Measured over the 228 shipped bindings, 18 of the 52 that carry a
        // HANDOFF name a screen the field screen table resolves (s410 142/143, s440 144,
        // s305 895, s320 290, s325 560, s380 205, s395 1299, s400 1304, s435 950,
        // s520 695, s685 690, s750 820, s926 1606, s237 300, plus the two same-stage
        // repositions s305 1450 and s385 1431); the other 26 name screens outside
        // 512..750, which doStoryHandoff already leaves alone exactly as before.
        if (handoff?.yesNoChild) {
            // The Yes/No branch the player picked ends in its own HANDOFF
            // (s210 Yes -> event 13 -> s212): follow it as that child's handoff.
            doStoryHandoff(handoff.yesNoChild, handoff);
        } else if (handoff) {
            // The save-point NPC's event ends in `HANDOFF 0xC00|slot` — the decoded
            // memory-card trigger (engine/dw3/save-points.ts), which doStoryHandoff
            // opens as a native screen rather than routing as a stage warp.
            doStoryHandoff(ev, handoff);
        } else {
            chainScriptedBattleFromPre(ev);
        }
    });
}

// A native Yes/No launcher event (event-machine-synthesis-2026-08-03.md "Family B"): its
// controller shows the question, then start_event's the Yes or No child event of the same
// stage and finishes when that child ends. Returns false when `ev` is not one of the 8.
function playYesNoEvent(ev, onDone) {
    const mapId = currentMap().id;
    const row = engineUi?.yesNoLauncherFor?.(Number(mapId.replace(/^s/, "")), ev.id);
    if (!row) return false;
    S.yesNoAwaitingChild = false;
    let childHandoff = null;
    yesNoBox.open!(row, null, {
        onStartEvent: (id) => {
            S.yesNoAwaitingChild = true;
            const child = (state.wstag[mapId] || []).find((e) => e.id === id);
            if (!child) {
                storyDbg("YESNO child", id, "missing on", mapId);
                yesNoBox.childDone!();
                return;
            }
            // The child's own HANDOFF (e.g. s210 Yes -> event 13 -> s212) is the
            // parent's result: the caller handles it as it would the child's.
            playStoryEvent(child, (handoff) => {
                childHandoff = handoff ? { ...handoff, yesNoChild: child } : null;
                yesNoBox.childDone!();
            });
        },
        onClose: () => {
            S.yesNoAwaitingChild = false;
            onDone?.(childHandoff);
        },
    });
    return true;
}

// A native eight-topic help menu event (the "Family A" five of
// event-machine-synthesis-2026-08-03.md): the controller shows eight titles, opens the chosen
// topic's page and closes on "Return" or Cancel, starting nothing. Tried before the Yes/No boxes,
// which are the other native family. Returns false when `ev` is not one of the five.
function playHelpMenuEvent(ev, onDone) {
    const mapId = currentMap().id;
    const row = engineUi?.helpMenuFor?.(Number(mapId.replace(/^s/, "")), ev.id);
    if (!row) return false;
    storyDbg("HELP MENU", row.module, "event", ev.id, "text", "0x" + row.textHandle.toString(16));
    helpMenuBox.open!(row, null, { onClose: () => onDone?.() });
    return true;
}

// The Bug-Maze switch tiles (s745/s746, the "darkSwitch" native-event family): three
// step-tile events that throw the stage's pad controller between its two layouts. The
// command body is a faithful port (engine/systems/dungeon-switch.ts) — it plays SWITCH02
// only on a real state change and writes the arm word, exactly as wstag745 0x244/0x2c4/0x344
// do. The pad's second-layout tile GEOMETRY is not decoded, so this arms the maze latch
// rather than drawing a second mask; that gap is named in the module header, not filled.
function playDungeonSwitchEvent(ev, onDone: () => void) {
    const mapId = currentMap().id;
    const cmd = dungeonSwitchCommand(mapId, ev.id);
    if (!cmd) return false;
    const object = state.padSwitch ?? (state.padSwitch = newPadSwitchObject());
    const res = applyDungeonSwitchCommand(object, cmd);
    state.padSwitch = res!.object;
    // The object's own tick leaves the maze's live-layout latch (obj stays in the state the
    // command set until its pending sub-state flips it; the latch is written by the tick).
    state.padLayoutLatch = cmd.state === 2 ? 1 : 0;
    if (res!.playSwitch) sfx.play!("switch02");
    storyDbg("DUNGEON SWITCH", mapId, "event", ev.id, "→ state", cmd.state, "arm", cmd.arm);
    onDone?.();
    return true;
}

// The Undersea Base room-phase switch (s810, the "gunslinger" native-event family):
// the two step-tile events that swap the room's active type-7 trigger map and its
// own 24-byte step program. The transaction is a faithful port
// (web/gunslinger-switch.js) of wstag810.s file 0xc4c / 0xcb0, and the data it
// swaps to is web/assets/data/stage_layout_variants.json
// (tools/extract_stage_layout_variants.py). The rooms are reachable because each
// layout's grid carries a cell whose step index is the layout's own op-8
// start_event — layout 0 byte 0x1f -> 9001, layout 1 byte 0xb5 -> 9000.
function playGunslingerEvent(ev, onDone: () => void) {
    const mapId = currentMap().id;
    const cmd = gunslingerSwitchCommand(mapId, ev.id);
    if (!cmd) return false;
    const s = mapId.replace(/^s/, "");
    const latch = state.gunslingerLatch?.[s] ?? 0;
    const res = applyGunslingerSwitch(latch, cmd);
    (state.gunslingerLatch ??= {})[s] = res.latch;
    if (res.fires) {
        // Point the room at the new phase: both the type-7 grid the step VM samples
        // and the step program it indexes (scene+0x14). The OnStep rows are keyed by
        // event id and already exist for BOTH layouts (layout 0's program carries
        // start_event(9001) and start_event(9000); layout 1's carries 9000).
        const layout = (state.stageLayoutVariants?.[mapId]?.layouts ?? [])[res.layout];
        if (layout) {
            if (state.storySteps?.[s]) state.storySteps[s].steps = layout.steps;
            if (layout.grid) state.storyGrids[s] = layout.grid;
        }
        storyDbg("GUNSLINGER SWITCH", mapId, "event", ev.id, "→ program",
            layout ? layout.program : "(no data)", "latch", res.latch);
    }
    onDone?.();
    return true;
}

export function playStoryEvent(ev, onDone) {
    if (!ev.disasm?.length && playHelpMenuEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playYesNoEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playDungeonSwitchEvent(ev, onDone)) return;
    if (!ev.disasm?.length && playGunslingerEvent(ev, onDone)) return;
    storyDbg(
        "EVENT FIRED",
        ev.flag_key,
        "esdmg" + ev.esdmg_entry,
        "on",
        currentMap().id,
        "→ handoff_to:",
        ev.handoff_to || "(screen-route)",
        "| firstSAY:",
        (ev.disasm || []).find((l) => l.startsWith("SAY")) || "(none)",
    );
    let strings = null;
    if (ev.esdmg_entry !== null && ev.esdmg_stage != null) {
        const esdmgData = state.events[ev.esdmg_stage];
        const entry = esdmgData?.[String(ev.esdmg_entry)];
        strings = entry?.strings ?? null;
    }

    let hooks = null;

    // Save original positions of static NPCs so we can restore them after the cutscene
    // (cutscene SETPOS/WALKTO moves them in-place; they must return to spawn positions).
    const mapId = currentMap().id;
    const preCutsceneScene = state.scenes[mapId];
    if (preCutsceneScene) {
        for (const npc of preCutsceneScene.npcs) {
            if (!npc._ephemeral) {
                npc._origX = npc.x;
                npc._origY = npc.y;
            }
        }
    }

    S.cutsceneEsdmgRef = strings ? { file: "esdmg" + ev.esdmg_stage, entry: Number(ev.esdmg_entry) } : null;
    cutscene.start(
        ev.disasm,
        strings,
        () => {
            // s212 events 10/11/12 are the pack-specific Tamer Service
            // downloads (flags 01120003/4/5). This is the acquisition boundary:
            // before it there is no active partner or field party.
            if (["01120003", "01120004", "01120005"].includes(ev.flag_key)
                && Array.isArray(state.pendingParty) && state.pendingParty.length) {
                state.party = [...state.pendingParty];
                state.pendingParty = null;
                localStorage.setItem("party", JSON.stringify(state.party));
                localStorage.removeItem("pendingParty");
                setCharacter(manifestIndexOf(state.party[0]));
                battle.initializePartyStats(state);
                const engineParty = state.party.map((_, i) => i + 1);
                S.engine?.state.party.load({ members: engineParty, lead: engineParty[0] });
                // The download is the ownership boundary for the roster too: the pack's
                // three partners are obtained, which is what the bank-0x70 "do you own
                // slot N" dialogue gates read back and what keeps the Digimon Lab from
                // offering you a partner you are already walking around with.
                state.rosterOwned = rosterMaskForParty(state.rosterOwned, state.party);
                grantNewPartners();
                refreshPartyCharisma();   // the party just came into existence
            }
            // Restore static NPC positions, clear cutscene state, remove ephemerals.
            const scene = state.scenes[currentMap().id];
            if (scene) {
                for (const npc of scene.npcs) {
                    if (npc._origX !== undefined) {
                        npc.x = npc._origX;
                        npc.y = npc._origY;
                    }
                    delete npc._origX;
                    delete npc._origY;
                    delete npc._inCutscene;
                    delete npc.activeClip;
                }
                scene.npcs = scene.npcs.filter((n) => !n._ephemeral);
            }
            // Reset the player's cutscene state, then restore the party trail.
            delete state._inCutscene;
            delete state._cutTarget;
            delete state.activeClip;
            state._animTime = 0;
            if (cutscene.partyGatherAt != null) parkGatheredFollowers();
            else resetFollowers();

            // Ordinal advance is owned by the caller: engine.completeEvent for talk/stage-enter
            // events (bridge), and the trigger-system playEvent wrapper for OnStep cutscenes.
            onDone(cutscene.handoff || null);
        },
        hooks,
    );
}

export function doStoryHandoff(ev, handoff) {
    // The decoded save-point handoff: every inn/tower/city save event ends in
    // `HANDOFF 0xC00|slot`, which the resident launcher loads as pro/stgmcard in
    // SAVE mode with that save point (engine/dw3/save-points.ts, and the
    // chain in its header). The walker opens the same native screen instead of
    // routing the id as a stage warp — 0xC01..0xC19 are not stage ids.
    const spSlot = isSavePointHandoffId(handoff?.screenId)
        ? handoff.screenId & 0xff
        : null;
    if (spSlot != null) {
        const sp = savePointBySlot(spSlot);
        openMemoryCard("save", null, sp!);
        return;
    }

    // A HANDOFF that names a movie row (launch codes 0xE01..0xE0C) is not a
    // field screen: the disc's resident launcher hands it to the title
    // overlay's movie player, which plays the row on the console's blank
    // cadence and only then launches the row's own return selector. The walker
    // plays the same rows through the one field movie adapter, then routes the
    // selector the chain ended on. This is the s780 reunion's own handoff:
    // event 1500's `HANDOFF 0xE03` = STTITL mode 3 = movie row 2 = MOVIED01_STR
    // (pro/stdwtitl.s .L0x00005000), whose return 0x207 is re-pointed to 0x276
    // (the alias s925) at master ordinal 0x2d — the post-game world's own
    // entry movie. The chain host is playMovieChain, the same rows' mechanism
    // the finale's ending hand-off runs.
    if (handoff?.screenId != null && movieRow(handoff.screenId) != null) {
        playMovieChain(handoff.screenId)
            .then((selector) => routeStoryHandoff(ev, handoff, selector))
            .catch((error) => {
                // The adapter already ends an unloadable stream through its
                // browser-safety abort (logged, not thrown); this is only so a
                // broken chain can never strand the warp — route the id itself.
                console.error("[handoff] movie chain", error);
                routeStoryHandoff(ev, handoff, handoff.screenId);
            });
        return;
    }
    routeStoryHandoff(ev, handoff, handoff.screenId);
}

// The routing tail of doStoryHandoff over `screenId` — the event's own handoff
// id, or the selector a movie chain ended on (playMovieChain).
function routeStoryHandoff(ev, handoff, screenId) {
    const routed =
        screenId != null
            ? S.screenRouter.route(screenId, currentMap().id)
            : null;
    if (ev.handoff_to) {
        // A cutscene handoff to a mapped stage. The DESTINATION now comes from the
        // router when it resolves (so the alias rule applies); the op's own spawn
        // point still governs where the player stands, exactly as before — routing
        // decides which overlay of the screen loads, not the spawn.
        const to = routed?.kind === "warp" ? routed.to : ev.handoff_to;
        const idx = state.manifest.maps.findIndex((mm) => mm.id === to);
        if (idx >= 0) {
            storyDbg(
                "WARP (event handoff_to)",
                currentMap().id,
                "→",
                to,
                to === ev.handoff_to ? "" : `(alias of ${ev.handoff_to})`,
            );
            startTransition({
                to,
                spawnX: handoff.x,
                spawnY: handoff.y,
                dir: DIR8_CS[handoff.dir & 7],
                scripted: true, // cutscene handoff — bypass the OnExit player-exit gate
            });
        }
    } else {
        // No mapped stage on the event: the opening flow's native screens. Behaviour
        // here is unchanged — these warp with the stage's default spawn, not the op's.
        const r = routed;
        if (!r)
            console.warn(
                "[handoff] unresolved screen id",
                screenId,
                "on",
                currentMap().id,
            );
        if (r?.kind === "warp") {
            storyDbg(
                "WARP (screen",
                screenId + ")",
                currentMap().id,
                "→",
                r.to,
            );
            startTransition({
                to: r.to,
                spawnX: null,
                spawnY: null,
                dir: "down",
                scripted: true, // cutscene handoff — bypass the OnExit player-exit gate
            });
        } else if (r?.kind === "nameentry") {
            state.packSelect = openPackSelect();
            state.packSelectDone = () => {
                const packIdx = state.packSelect.sel();
                state.playerName = state.packSelect.accountName();
                const memberIds = PACKS[packIdx]!.members.map((m) => m.charId);
                state.pendingParty = grantPack(memberIds, 0).party;
                state.packId = "ABC"[packIdx];
                S.engine?.state.vars.set("$party.pack", packIdx);
                localStorage.setItem("playerName", state.playerName);
                localStorage.setItem("pendingParty", JSON.stringify(state.pendingParty));
                localStorage.setItem("packId", state.packId);
                state.packSelect = null;
                checkStageCutscene(currentMap().id);
            };
        }
    }
}

export function checkStageCutscene(mapId) {
    storyDbg(
        "ENTER",
        mapId,
        "at",
        Math.round(state.x) + "," + Math.round(state.y),
        "— onStageEnter (any EVENT printed next = AUTO-fired on entry)",
    );
    state.gondolaAutoFired = false; // re-arm the no-card gondola auto-board each visit
    // A returning visit must not inherit last visit's falling rocks: the stage's
    // own actor list is rebuilt from the script's SETANIMs on this entry.
    clearStageObjects(mapId);
    // ... nor a quest scene's effect art: a warp, a load and an ordinary walk into a stage all arrive here, and nothing
    // an effect placed may be drawn on a map it does not belong to (web/quest-fx.js). A scene's own weather and time of
    // day go back to the map's at the same moment (web/ambience.js scene override).
    questSceneFxReset();
    // The original's field character is destroyed with its stage and the next
    // constructor re-reads the map origin into +0x50/+0x54 (fieldstg file
    // 0xe744-0xe760), so the accumulated displacement starts again at zero here.
    resetFieldChar();
    resetFieldBlanks();
    // The stage's ambience is OUR translated code: the point-record
    // actors, the rocks, the street corner and every other stage-object member
    // are built and ticked by web/stage-objects.js over engine/systems/** (the
    // boot happens in web/effects.js prepareEffects and the tick in
    // paceStageObjects).
    if (S.engineBridge) S.engineBridge.onStageEnter(mapId);
    // The s260 auction's arrival gate: FIELDSTG_runStoryEvents runs on the field
    // load, so arm it here; the per-frame tick below fires the lot once the field
    // is free (it retries, like the disc's own tick, instead of missing the beat).
    state.auctionPending = mapId === AUCTION_STAGE;
}
