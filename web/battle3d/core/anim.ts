import { itemUseEffect, throwItemEffect } from "../../fight/fight-tables.js";
import { RAND_U16 } from "../../vendor/engine.js";
import type { AttackOptions, Battle3DContext, PlayScriptOptions, ThrowItemOptions } from "../../types/battle3d.js";
import type { ActorAnimator } from "../../fight/actor-animator.js";

import type { AnimHooks } from "../../types/battle3d.js";
import type { DnaScriptOp } from "../../battle/core/types.js";
import type { FightTimelineRow } from "../../fight/types.js";
// moved by tools/rewrite/split-closure.mjs
export function makeAnim(B$: Battle3DContext) {
function _applyNamed(anim8r: ActorAnimator | null | undefined, name: string | null, hooks: AnimHooks) {
    if (!anim8r) return;
    if (name === "idle" || name == null) anim8r.setIdle();
    else anim8r.setAction(B$.NAMED_CLIP[name] ?? null, hooks || {});
  }
function setPlayerAnim(anim: string | null) {
    B$.screenOverlay = null;   // safety: a persistent op7 type-0 white-out never outlives the presentation
    B$.dnaOrbs = null;         // same safety for the DNA orb overlay
    _applyNamed(B$.playerAnim8r, anim, B$._playerHooks(B$._fxHooks("player")));
  }
function setEnemyAnim(anim: string)  { B$.enemyAnim = anim;  _applyNamed(B$.enemyAnim8r, anim, B$._fxHooks("enemy")); }
// entrance.c / model_mesh.c: control->motion m plays timeline table m - 1; motion 1 / 2 are the two
  // idle tables (idleMotion 0 / 1), which the animator holds as baseTable.
  function playPlayerMotion(motion: number) {
    if (!B$.playerAnim8r) return false;
    if (motion === 1 || motion === 2) {
      B$.playerAnim8r.baseTable = motion === 2 ? 1 : 0;
      B$.playerAnim8r.setIdle();
      return true;
    }
    const t = B$.playerModel?.timeline?.[motion - 1]?.table;
    if (!t || !t.length) return false;
    B$.playerAnim8r.playTimelineTable(t);
    return true;
  }
// The enemy side of playPlayerMotion (entrance.c sets the ENTERING fighter's motion, either side).
  function playEnemyMotion(motion: number) {
    if (!B$.enemyAnim8r) return false;
    if (motion === 1 || motion === 2) {
      B$.enemyAnim8r.baseTable = motion === 2 ? 1 : 0;
      B$.enemyAnim8r.setIdle();
      return true;
    }
    const t = B$.enemyModel?.timeline?.[motion - 1]?.table;
    if (!t || !t.length) return false;
    B$.enemyAnim8r.playTimelineTable(t);
    return true;
  }
function playPlayerVictory() {
    const table = victoryTable(B$.playerModel);
    if (!B$.playerAnim8r || !table || !table.length) return false;
    B$.playerAnim = "win";
    B$.playerAnim8r.playTimelineTable(table);
    return true;
  }
function playPlayerActionClip(clip: number | null, hooks: AnimHooks = {}) {
    B$.playerAnim = `clip:${clip}`;
    return B$.playerAnim8r
      ? B$.playerAnim8r.setAction(clip, B$._playerHooks(B$._fxHooks("player", hooks)))
      : false;
  }
// The item machine's own entry (FIGHTSTG_F0x8008d3b4's default arm, fightstg.s:11008-11030):
  // clip 10 plus the used item's record fields from the 0x800a336c table — effect -> actor+0x6c
  // (clip 10's op3 9999 spawn resolves it) and sound -> actor+0x70 (the item's op10 99 strike
  // reads it; the attack path's own writer .L0x8008f21c-.L0x8008f234 is what contactSoundTypeFor
  // ports). An item with no table record writes neither field, exactly as the disc's scan falls
  // through — so contactSoundType is cleared rather than left holding the previous attack's.
  function playPlayerItemUse(itemId: number, hooks: AnimHooks = {}) {
    const rec = itemUseEffect(itemId);
    B$.playerAnim = `item:${itemId}`;
    B$.contactSoundType!.player = rec ? rec.sound : null;
    B$.contactEvade!.player = false;   // no accuracy roll on the item path
    return B$.playerAnim8r
      ? B$.playerAnim8r.setAnimByItem(itemId, B$._playerHooks(B$._fxHooks("player", hooks)))
      : false;
  }
// The item machine's THROW entry (FIGHTSTG_F0x8008d3b4's state-0 typed arms, ids 77-90): the
  // item's record names the clip and the fresh action actor's motion (+0x68), effect (+0x6c) and
  // sound (+0x70) — tools/extract_throw_item_effects.py. The clip plays with the record's effect
  // as its current effect (op3's 9999 sentinel) and its motion as the actor's current motion
  // (op4's 0x38 sentinel); the record's sound is the op10 99 strike's contact-sound type. The
  // clip-15 items (77-84) are the element fields: their motion is the element's sig, so the pack
  // MEFT10<motion> is armed for the clip's own op4 to switch in and out — exactly the tech
  // backdrop's rule (armDataField above). `branch` picks item 88's STR/DEF effect/sound pair;
  // `elementIndex` supplies item 84's rolled element (the draw the engine's handler already made)
  // so the motion, the pack and the field all agree on one roll.
  function playPlayerThrowItem(itemId: number, { branch = null, elementIndex = null, hooks = {} }: ThrowItemOptions = {}) {
    const rec = throwItemEffect(itemId);
    if (!rec) return false;   // table not loaded -> the caller keeps the default clip-10 entry
    B$.playerAnim = `throw:${itemId}`;
    B$.contactSoundType!.player = (branch != null && rec.sound_branch && rec.sound_branch[branch] != null)
      ? rec.sound_branch[branch]
      : rec.sound;
    B$.contactEvade!.player = false;   // no accuracy roll on the item path
    let motion = rec.motion;
    if (rec.motion_random) {
      const count = rec.motion_random.count | 0;
      const k = (elementIndex != null ? elementIndex | 0 : (RAND_U16()! % count)) % count;
      motion = rec.motion_random.base + rec.motion_random.step * k;
    }
    B$.armThrowBackdrop(motion);      // the clip's op4 switches the element pack in and out
    const h = { ...hooks, onMotion: (m: number) => { B$.dataFieldMotion(m); hooks.onMotion?.(m); } };
    return B$.playerAnim8r
      ? B$.playerAnim8r.setAnimByThrowItem(itemId, B$._playerHooks(B$._fxHooks("player", h)), { branch, motion })
      : false;
  }
// A presentation plays as several successive scripts — the DNA cut-in is split at its op0
  // barriers — and NOTHING here touches the camera record. The record outlives the script that
  // installed it (there is no expiry anywhere in the original), so a segment's op5 carries into
  // the next segment on its own and this needs no per-presentation flag.
  function playPlayerScript(script: { ops: DnaScriptOp[]; }, {
    initialTable = null, motionTables = {}, rotationBase = 0, ...hooks
  }: PlayScriptOptions = {}) {
    B$.playerAnim = "external-script";
    const overlayHooks = {
      ...hooks,
      onOverlay: (rec) => {
        B$.screenOverlay = { type: rec.type, duration: Math.max(1, rec.duration), t: 0 };
        hooks.onOverlay?.(rec);
      },
      onMotion: (motion) => { hooks.onMotion?.(motion); },
    };
    if (!B$.playerAnim8r) return false;
    B$.playerAnim8r.rotationBase = rotationBase;
    return B$.playerAnim8r.setScript(script, B$._playerHooks(B$._fxHooks("player", overlayHooks)), {
      initialTable, motionTables,
    });
  }
// Real, confirmed path (technique id -> clip via techToClip). hooks = { onHit, onCamera, setLunge }.
  // The player's action drives the script camera (op5); the enemy's does not.
  function setPlayerAnimByTech(techId: number, hooks: { onMotion: (arg0: number) => void; }) {
    B$.playerAnim = `tech:${techId}`;
    B$.contactSoundType!.player = B$.contactSoundTypeFor(techId);
    B$.contactEvade!.player = false;   // no accuracy roll on this path
    // The backdrop follows the clip's own op4 (see armDataField above), not a timer.
    B$.armDataField(techId);
    const h = { ...(hooks || {}), onMotion: (m: number) => { B$.dataFieldMotion(m); hooks?.onMotion?.(m); } };
    return B$.playerAnim8r ? B$.playerAnim8r.setAnimByTech(techId, B$._playerHooks(B$._fxHooks("player", h))) : false;
  }
function setEnemyAnimByTech(techId: number, hooks: { onMotion: (arg0: number) => void; }) {
    B$.enemyAnim = `tech:${techId}`;
    B$.contactSoundType!.enemy = B$.contactSoundTypeFor(techId);
    B$.contactEvade!.enemy = false;
    B$.armDataField(techId);
    const h = { ...(hooks || {}), onMotion: (m: number) => { B$.dataFieldMotion(m); hooks?.onMotion?.(m); } };
    return B$.enemyAnim8r ? B$.enemyAnim8r.setAnimByTech(techId, B$._enemyHooks(B$._fxHooks("enemy", h))) : false;
  }
// Coordinated attacks (Phase E entry points for battle.js): the attacker plays techId's clip;
  // on its type-99 strike the defender plays its hit-reaction. The PLAYER attacker also drives the
  // op5 script camera (_playerHooks). hooks = optional extra (e.g. a hit-spark/sound onHit).
  function playerAttack(techId: number, opts: AttackOptions = {}) {
    if (!B$.playerAnim8r || !B$.enemyAnim8r) return false;
    B$.playerAnim = `tech:${techId}`; B$.enemyAnim = `hit`;
    if (B$.sfx) { B$.sfx.stopBattle!("player"); B$.sfx.stopBattle!("enemy"); }   // clear any sustained voice from the last attack
    B$.contactSoundType!.player = B$.contactSoundTypeFor(techId);
    B$.armDataField(techId);   // the backdrop follows the clip's own op4, not a timer
    const { lethal = false, miss = false, ...hooks } = opts;   // lethal -> death reaction (clip 3); miss -> no recoil
    B$.contactEvade!.player = miss;   // an evaded contact cues COMEX102, not the weapon's id
    return B$.coordinator!.attack(B$.playerAnim8r, B$.enemyAnim8r, techId,
      B$._playerHooks(B$._fxHooks("player", B$._impactContact({ ...hooks, onMotion: B$.dataFieldMotion }))),
      { lethal, miss, defenderHooks: B$._enemyHooks(B$._fxHooks("enemy")) });
  }
function enemyAttack(techId: number, opts: AttackOptions = {}) {
    if (!B$.playerAnim8r || !B$.enemyAnim8r) return false;
    B$.enemyAnim = `tech:${techId}`; B$.playerAnim = "hit";
    if (B$.sfx) { B$.sfx.stopBattle!("player"); B$.sfx.stopBattle!("enemy"); }   // clear any sustained voice from the last attack
    B$.contactSoundType!.enemy = B$.contactSoundTypeFor(techId);
    B$.armDataField(techId);
    const { lethal = false, miss = false, ...hooks } = opts;
    B$.contactEvade!.enemy = miss;
    return B$.coordinator!.attack(B$.enemyAnim8r, B$.playerAnim8r, techId,
      B$._enemyHooks(B$._fxHooks("enemy", B$._impactContact({ ...hooks, onMotion: B$.dataFieldMotion }))),
      { lethal, miss, defenderHooks: B$._playerHooks(B$._fxHooks("player")) });
  }
// The victory gesture: the model's own table 44, else (DW2 motion on, ?dw2motion=1) the DW2 victory clip I merged by
  // dw2-motion.js (DW2 plays I only when a battle is won: ~/dw3-knowledge/dw2-clips.md). model.dw2Motion exists only when it is on.
  function victoryTable(model: { timeline?: ({ table?: FightTimelineRow[] } | undefined)[]; dw2Motion?: { I?: { table: number } | null } | null }): FightTimelineRow[] | null {
    const own = model?.timeline?.[44]?.table;
    if (own?.length) return own;
    const m = model?.dw2Motion?.I;
    return m ? model.timeline?.[m.table]?.table ?? null : null;
  }
  return { _applyNamed, setPlayerAnim, setEnemyAnim, playPlayerMotion, playEnemyMotion, playPlayerVictory, playPlayerActionClip, playPlayerItemUse, playPlayerThrowItem, playPlayerScript, setPlayerAnimByTech, setEnemyAnimByTech, playerAttack, enemyAttack, victoryTable };
}
