import {
  fieldDirectionIndex,
  startSlope,
  isStageChangePlayback,
  fieldDirectionFromIndex,
  nearestPad,
  startLaunch,
  isLadderPlayback,
  ladderMountFacing,
  ladderClimbPlan,
  ladderClimbPosition,
  ladderDismountEnd,
  selectNpcDialogue,
} from "../vendor/engine.js";
import { launchPads } from "../effects.js";
import { mountForceDismount } from "../mount.js";
import {
  CLIMB_SPEED,
  DISMOUNT_SECS_BOTTOM,
  DISMOUNT_SECS_TOP,
  MOUNT_SECS_BOTTOM,
  MOUNT_SECS_TOP,
  battle,
  cutscene,
  fade,
  followers,
  sfx,
  state,
  storyFlags,
  textbox,
} from "./vars.js";
import { S } from "./state.js";
import { currentMap } from "./session.js";
import { activeFollowerCount } from "./followers.js";
import { gameOverToTitle, presentVictory, startFieldBattle } from "./battle-launch.js";

// The rail the PLAYBACK executor's record names. The op-2/op-3 handler passes
// params[0] (the ladder id) and the endpoint cell params[1]/params[2] straight to
// the player actor (fieldstg.s:5a80/:5ac0), so the record — not a radius test — is
// what says which rail and which end. 213 of the 216 shipped ladder rows carry
// exactly these values (id and both endpoint coordinates); the other three are the
// rows whose bottom cell is armed by an op-8/op-6 tile, which the disc never mounts
// either. Matched by id first, then by the endpoint's own coordinates.
function ladderRowForRecord(scene, effect) {
    const args = effect?.actorCall?.args;
    if (!args) return null;
    const id = effect?.op === 3 ? null : args[3] / 16 + 1; // op 2/3 carry (param0-1)*16
    const x = args[1];
    const y = args[2];
    let byCoord = null;
    for (const L of scene?.ladders ?? []) {
        for (const [pt, isTop] of [[L.bottom, false], [L.top, true]]) {
            if (pt.x !== x || pt.y !== y) continue;
            if (!byCoord) byCoord = { L, pt, isTop };
            if (id !== null && L.id === id) return { L, pt, isTop };
        }
    }
    return byCoord;
}

// PRESS on a step tile. This is the shared reading of "what does this tile do when
// the player presses it": the disc's playback executor `0x800885d4`, with the
// driver's own gates in front of it (fieldstg.s:5bd8-5d84) — the handoff guard
// words, step-load's liveness, and Circle HELD. engine/systems/scene-step-ops.ts
// carries the op table (file 0x1e8) and engine/systems/trigger-system.ts the gates.
// Doors, ladders and the dive all come through here; nothing reads the step program
// on its own any more.
export function stepPlayback(x = state.x, y = state.y, circleHeld = true) {
    const ts = S.engineTriggerSystem;
    if (!ts) return null;
    return ts.playback(currentMap().id, x, y, fieldDirectionIndex(state.dir), circleHeld);
}

// The disc's SETUP arm, one frame — `step-load` then `step-exec`
// (fieldstg.s:5c94-:5cb8) — with no button read anywhere in it. This is what a
// tile that fires on contact asks: a launch pad (setup op 13) is the live case
// today. engine/systems/trigger-system.ts carries the rule and the citations.
export function stepSetup(x = state.x, y = state.y) {
    const ts = S.engineTriggerSystem;
    if (!ts?.setup) return null;
    return ts.setup(currentMap().id, x, y, fieldDirectionIndex(state.dir));
}

// Op 4 — PRESS on a slope tile. The disc's actor slot +0x11c (file 0xc5d0) is not a
// "move here" call: it switches Junior into mode 0x47 and lets the mode block do the
// walking. Which way he steps and how far he drops come out of the record through the
// port, so a stage supplies only its step program — there is no per-place row here.
export function startSlopeStep() {
    const pb = stepPlayback();
    const plan = pb?.effect?.actorAction;
    if (!pb || !pb.live || !plan || plan.kind !== "slope") return false;
    if (state.slope) return false;
    state.slope = startSlope(plan, { x: state.x, y: state.y });
    state.moving = false;
    state.stopping = false;
    return true;
}

// Op 14 — PRESS on a launch-pad handoff tile. The disc's op-14 handler
// (fieldstg.s:5a30-5a7c) is TWO calls in the SAME frame:
//
//   :5a30 lw $a0,0x58($s0) / :5a38 lw $v0,0x158($a0) / :5a40 jalr
//        actor->vt[0x158](actor, &record[0xa])   the pad walk — the SAME method
//        setup op 13 calls, so engine/systems/launch-pad.ts is the port
//   :5a48..:5a74 jal 0x8008b6d4(id, -1, x<<8, y<<8, facing, 0x3c)
//        the stage handoff, with ONE extra argument
//
// and that extra argument is the whole difference from an ordinary door.
// 0x8008b6D4 (file 0x8a24) stores it into the type-7 scene object's `+0x68`
// (:8a78/:8a84) and calls setPhase(2); the phase-2 handler then spends it —
// `+0x68 -= GetTick()` at :89ac, and the destination is loaded only on the frame
// the word has reached 0 (:8984 `bgtz` -> :8994 the load). Op 1 reaches the same
// body through the wrapper 0x8008b770, whose `sw $zr,0x14($sp)` at :8acc passes
// ZERO, so a door changes stage immediately and an op-14 tile does not.
//
// So the handoff does NOT wait for the walk: both start together, the walk gets
// the 60 ticks, and 60 is shorter than the pad's own 106-tick charge
// (PAD_ANIM_FRAMES), so the screen normally changes before the flight would have
// begun. Nothing here is per-place — the destination is the record's own five
// fields, and the screen id resolves through the same screenRouter the story
// handoff uses (engine/dw3/screen-routing.ts over web/assets/data/screen_table.json).
export function startPadHandoff() {
    const pb = stepPlayback();
    if (!pb || !pb.live || !pb.op || !isStageChangePlayback(pb.op)) return false;
    // Only op 14 walks a pad first. Op 1's actor half is vt[0x110] (a turn) and its
    // handoff goes through the ordinary door row in activeExitAt().
    if (pb.effect?.padSlot === undefined) return false;
    const h = pb.effect.handoff;
    if (!h) return false;
    if (state.handoffHold || state.launch || fade.dir !== 0) return false;
    const routed = S.screenRouter.route(h.args[0], currentMap().id);
    if (routed?.kind !== "warp") return false;
    const to = routed.to;
    const exit = {
        to,
        // The handoff hands the spawn cells over already shifted (fieldstg.s:5a68/
        // :5a6c `sll 2`), and the arriving actor's spawn reads those words back with
        // `sra 8` (fieldstg.s:0xe76c/:0xe770), so the cell is the argument's high half.
        spawnX: h.args[2] >>> 8,
        spawnY: h.args[3] >>> 8,
        dir: fieldDirectionFromIndex(h.args[4] & 7),
        stepOp: pb.op,
    };
    const pad = nearestPad(launchPads(currentMap()?.id), { x: state.x, y: state.y });
    state.launch = startLaunch(exit, { x: state.x, y: state.y }, pad);
    state.iceSlide = null;
    state.moving = false;
    state.stopping = false;
    // Native: the actor method sets facing 0 before installing the handler.
    state.dir = "down";
    // The hold the disc seeded scene_obj+0x68 with — the op table's own sixth
    // argument, read through the port so this cannot drift from fieldstg.s:5a60.
    state.handoffHold = { ticks: h.holdTicks, exit };
    return true;
}

export function startLadderClimb(scene) {
    // EXPERIMENT (mounts): you cannot climb a ladder from the saddle — step off first.
    mountForceDismount();
    // Which rail, which end and which side all come from the step record now. The
    // old private reading (a 22px radius over scene.ladders plus its own read of the
    // grid byte's facing group) is gone: it could arm a ladder the tile does not
    // name and could miss one it does.
    const pb = stepPlayback();
    if (!pb || !pb.live || !pb.effect || !isLadderPlayback(pb.op)) return null;
    const hit = ladderRowForRecord(scene, pb.effect);
    if (!hit) return null;
    const { L, pt, isTop } = hit;
    const fromBottom = !isTop;
    // The facing the mount hands the player actor, read out of the port's own
    // actor call — `a1`, which both mount bodies store into `entity+0x60`
    // (pro/fieldstg.s:12601 `sw $s3,0x60($s4)` bottom, :12644 top). Op 2 passes its
    // own group straight through (:5808) and op 3 passes 5 when the group is 1 and
    // 3 otherwise — the `li $a1,0x3` is the `bne`'s DELAY SLOT (:5819/:5820) — so
    // the shipped bottom tiles (group 3/5) mount up-left/up-right and the top
    // tiles (group 1/7) mount up-right/up-left.
    // It is one word doing two jobs: the climb sprite's side (both mounts pick it
    // with `beq $s3,$v0(=5)` at :12605/:12648 into entity+0x8c), and the facing
    // the step gate reads back — so the old two-way guess off the group got 309
    // of the 429 armed rail ends mirrored the wrong way.
    const facing = ladderMountFacing(pb.effect);
    if (facing == null) return null;
    const dirStr = fieldDirectionFromIndex(facing);
    // The climb's own geometry: the rail x (the foot's x from the bottom, the head
    // cell ± 16 by the side word from the top), the rail's foot ground row, the
    // drawn start row, and the climb length = the record's `(params[0]-1)<<4`
    // (actorCall.args[3]) — NOT the endpoint span. The census over all 216 shipped
    // rails has span = height + 24 for 132 of them (+13..+28 for the rest); the
    // last 24 px are the dismount step-off, not climb. engine/systems/
    // scene-step-ops.ts carries the full citations.
    const recordHeight = pb.effect.actorCall?.args?.[3] ?? 0;
    const plan = ladderClimbPlan(L.bottom, L.top, facing, fromBottom, recordHeight);
    state.climb = {
        bottom: L.bottom,
        top: L.top,
        plan,
        x: plan.railX,
        baseY: plan.baseY,
        height: plan.height,
        side: plan.side,
        fromBottom,
        progress: fromBottom ? 0 : plan.height,
        // The mount plays its own step-ONTO-the-rail clip first: the bottom mount
        // hands over mode 0x43 = clip 0x1c (28), the head mount mode 0x44 = clip
        // 0x1e (30). Both then hand over to mode 0x40, the hang (clip 0x20 = 32).
        phase: "mount",
        clip: fromBottom ? 28 : 30,
        animT: 0,
        dirStr,
    };
    // The mount's own drawn row: the bottom mount pins the foot cell; the head
    // mount's step-on moves x onto the rail and its first drawn row is
    // head.y + 24 (mode 0x44's `+0x1800 + +0x94` base, offset seeded to height).
    const at = ladderClimbPosition(plan, state.climb.progress);
    state.x = at.x;
    state.y = at.y;
    // entity+0x60 is that same word, not a generic "up": the disc's mount writes
    // the facing it was handed (pro/fieldstg.s:12601), and the step-load under
    // the player reads it back on the next frame (:5546) to decide whether the
    // tile is still armed.
    state.dir = dirStr;
    return true;
}

// ── Fire Dungeon floor trap helpers (engine/systems/fire-trap.ts) ───────────
//
// The controller walks its party-actor key table and hits ONE walking Digimon
// per step, in order. Party index i is the i'th Digimon trailing the tamer, so
// its field position is followers[i] and its stored stats are the same slot the
// status menu shows: index 0 is the LEAD (state.partnerStats, the block battles
// level), 1.. are the trailing members' own persisted slots.
export function fireTrapPositionOf(partyIndex) {
    if (partyIndex >= activeFollowerCount()) return null;  // slot not walking
    const f = followers[partyIndex];
    return f ? { x: f.x, y: f.y } : null;
}

export function forcePartyMemberToOneHp(partyIndex) {
    const stats = partyIndex === 0
        ? state.partnerStats
        : state.partyStats?.[partyIndex];
    if (!stats) return;
    // The original stores the literal 1 into cur_hp — it is not damage, and it
    // cannot kill: the party comes out of the room alive on 1 HP each.
    stats.hp = 1;
    if (partyIndex === 0)
        localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    else if (state.partyStats)
        localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
}

// Fight the ambush tile's encounter. Its screen id comes out of the stage's own
// scripted encounter block, so this is the ordinary field-battle path with the
// roll replaced by a fixed screen — same 1v1 rule as a wild walk-up encounter
// (every one of the fourteen resolves to a single Digimon).
export function startAmbush(mapId, tile) {
    // EXPERIMENT (mounts): a fight always starts on foot (the field hands over to the battle screen).
    mountForceDismount();
    startFieldBattle(() => battle.startScreen(
        tile.screenId,
        (res) => presentVictory(res),
        null, // flee: the tile has already latched, so it does not re-fire
        gameOverToTitle,
        { mapId },
    ));
}

export async function flushStoryBattle() {
    if (state.pendingStoryBattleIndex == null || S.engineBridge?.isBusy() || battle.isActive()
        || textbox.isOpen() || cutscene.isActive() || fade.dir !== 0) return;
    const index = state.pendingStoryBattleIndex;
    const npc = state.pendingStoryBattleNpc;
    state.pendingStoryBattleIndex = null;
    state.pendingStoryBattleNpc = null;
    const mapId = currentMap().id;
    const screenId = await battle.scriptedScreen(mapId, index);
    if (!screenId) throw new Error(`scripted encounter ${mapId} index ${index} has no decoded screen`);
    const wonFlag = S.engine?.battleResultFlag(screenId);
    // The disc's bank-0x74 launcher (F0x800927a0 -> battle setup F0x8008b798) returns the
    // player to the field on any non-loss outcome, and re-entering the field runs the stage's
    // OWN arrival chain again (that is why the win arm below calls `onStageEnter`). The
    // story's next beat therefore plays whether the fight was won OR fled; only the victory
    // screen and the battle-result flag are win-only. The s480 Zanbamon fight is the case
    // that needs the flee arm: it is a scripted, UNWINNABLE battle (WFIGHTMN mode 2 floors
    // the player's damage at maxHP/11, pro/wfightmn.s 0x4e50-0x4ee4) whose own following
    // scene has the player RUN AWAY (web/assets/events/esdmg400.json entry 9, "What, you're
    // running away in the middle of the battle?"). The original's exit presenter returns to
    // the field for a flee and to the title only for a real loss (WFIGHTMN 0x800a7f54).
    const advanceStory = () => {
        if (S.engineBridge) {
            S.engineBridge.onStageEnter(mapId);
            if (npc != null && !S.engineBridge.isBusy()) S.engineBridge.onTalk(npc);
        }
    };
    startFieldBattle(() => battle.startScreen(screenId, (res) => {
        presentVictory(res);
        if (wonFlag != null) S.engine.state.flags.set(wonFlag, true);
        advanceStory();
    }, advanceStory, gameOverToTitle, { mapId, lead: false }));
}

// The raw type-7 trigger byte at map position (x,y), or null off the grid. Low 5
// bits = step index, top 3 = required approach-facing group (step-load 0x80088288).
export function storyGridCellAt(x, y) {
    const g = state.storyGrids?.[currentMap().id.replace(/^s/, "")];
    if (!g) return null;
    if (g.uniform != null) return g.uniform;
    const cx = Math.floor(x / g.cell);
    const cy = Math.floor(y / g.cell);
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return null;
    return g.grid[cy * g.w + cx] ?? null;
}

// Per-frame climb driver. The disc's own sequence, in order: the mount's
// step-onto-the-rail clip (mode 0x43 bottom = clip 0x1c, mode 0x44 head = clip
// 0x1e), then mode 0x40's hang (clip 0x20) while up/down move the offset along
// the rungs, then the step-off clip (mode 0x45 top = clip 0x1d, mode 0x46
// bottom = clip 0x1f). The step-off's landing shift is applied on ITS
// completion, not at its start — the clip's own art carries the visual move.
// Returns true while mounted.
export function tickClimb(dt) {
    const c = state.climb;
    if (!c) return false;
    state.moving = false;
    const k = state.keys;
    if (c.phase === "mount") {
        // The step-on plays out first; up/down are not read yet (the mount modes
        // hand over to mode 0x40 only when their own clip has run out).
        c.animT += dt;
        if (c.animT >= (c.fromBottom ? MOUNT_SECS_BOTTOM : MOUNT_SECS_TOP)) {
            c.phase = "climb";
            c.clip = 32; // mode 0x40, the hang
            c.animT = 0;
        }
        return true;
    }
    if (c.phase === "dismount") {
        c.animT += dt;
        if (c.animT >= (c.atTop ? DISMOUNT_SECS_TOP : DISMOUNT_SECS_BOTTOM)) {
            // The completion applies the step-off: mode 0x45 moves x 16 px
            // against the side word and drops y by 24 + height, landing on the
            // head cell (fieldstg.s:14017-14030); mode 0x46 moves nothing and
            // only stores 0 into entity+0x60 (:13983), so the player comes off
            // the foot facing down.
            const done = c.atTop ? "top" : "bottom";
            const land = ladderDismountEnd(c.plan, c.atTop);
            state.x = land.x;
            state.y = land.y;
            if (done === "bottom") state.dir = fieldDirectionFromIndex(0);
            state.climb = null;
        }
        return true;
    }
    const up = k.has("up");
    const down = k.has("down");
    let clip = 32;
    let done = null;
    if (up && !down) {
        clip = 26;
        c.progress += CLIMB_SPEED * dt;
        if (c.progress >= c.height) {
            c.progress = c.height;
            done = "top";
        }
    } else if (down && !up) {
        clip = 27;
        c.progress -= CLIMB_SPEED * dt;
        if (c.progress <= 0) {
            c.progress = 0;
            done = "bottom";
        }
    }
    // Climb creak SFX, fieldstg 0x8008fe68 (file 0xd1b8): fires every 16
    // ticks (60fps) while the climb offset is actually moving.
    if (clip === 26 || clip === 27) {
        c.creakT = (c.creakT ?? 0) + dt;
        if (c.creakT >= 16 / 60) {
            c.creakT -= 16 / 60;
            sfx.play("player01");
        }
    } else {
        c.creakT = 0;
    }
    if (clip !== c.clip) {
        c.clip = clip;
        c.animT = 0;
    } else {
        c.animT += dt;
    }
    // Straight up the rails: x pinned at the rail (c.x = plan.railX, the mount's
    // own decoded word entity+0x50), y from the offset (entity+0x54 - entity+0x90
    // at draw, file 0xe3d8-0xe3fc).
    const at = ladderClimbPosition(c.plan, c.progress);
    state.x = c.x;
    state.y = at.y;
    if (done) {
        // The step-off clip plays IN PLACE at the end of the climb; the landing
        // shift happens on its completion (above). Climbing down faces you down
        // when the clip finishes; climbing up keeps the mount's facing, so the
        // head tile is not armed until you turn.
        c.phase = "dismount";
        c.atTop = done === "top";
        c.clip = c.atTop ? 29 : 31;
        c.animT = 0;
    }
    return true;
}

// Bug-maze trap pads: returns the reset point {x,y,dir} if (x,y) is on a bugged
// floor cell, else null. `pads` is the scene's trapPads block (cell-grid mask).
export function hitTrapPad(pads, x, y) {
    if (!pads) return null;
    const c = Math.floor(x / pads.cell),
        r = Math.floor(y / pads.cell);
    if (r < 0 || r >= pads.rows || c < 0 || c >= pads.cols) return null;
    return pads.mask[r][c] === "1" ? pads.reset : null;
}

// Ice Dungeon slippery floor: classify the tile under (x,y) from the scene's
// `iceSlide` block (gen_scenes.ice_slide_regions -- the type-7 trigger cells whose
// step record is op 11 / op 12). Returns {start:dirIndex} on a glide-entry cell,
// {stop:true} on a stop cell, else null. See engine/systems/ice-slide.ts.
export function iceSlideCellAt(slide, x, y) {
    if (!slide) return null;
    const c = Math.floor(x / slide.cell),
        r = Math.floor(y / slide.cell);
    for (const [tx, ty] of slide.stop) if (tx === c && ty === r) return { stop: true };
    for (const [tx, ty, dir] of slide.start) if (tx === c && ty === r) return { start: dir };
    return null;
}

// An NPC's line is the ptrB dialogue STATE machine (talk handler F0x80090afc, §WS5):
// the FIRST `dialogue_state` whose flag `gate` passes against the live banked store, shown
// as estalk00[id]; its `on_close` set_flags are applied when the box closes (advancing the
// NPC's state). Manual/ifFlag NPCs (hand-authored `dialogue`, no states) fall back.
// Returns a state-shaped object { dialogue, on_close? } or null (non-speaking variant).
export function pickDialogueFor(npc, flags) {
    return selectNpcDialogue(npc, storyFlags.get, flags);
}
