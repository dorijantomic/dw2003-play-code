import { partyRosterView } from "../party.js";
import { questsDoneCount } from "../quests.js";
import { pickSpotNear } from "../mp-goto.js";
import { rectBlocked, FIELD_TICK_SECONDS } from "../vendor/engine.js";
import { buildChatPack } from "../chat.js";
import { createDialogueTranslated } from "../dialogue-translated.js";
import { myId, multiplayerGhosts, isOnline } from "../multiplayer.js";
import {
  DIGMON_SPRITE_ID,
  VIEW_H,
  VIEW_W,
  ZOOM,
  chatActor,
  chatBox,
  lastCam,
  menu,
  mpBalloons,
  sfx,
  state,
} from "./vars.js";
import { loadCollisionForStage } from "./map-load.js";
import { runStageHandoff } from "./transitions.js";
import { S } from "./state.js";
import { currentMap } from "./session.js";

// EXPERIMENT (multiplayer): the chat / feed / players / inspect / trade box. It reads the game's state and moves items only
// through the game's own item store; it never writes a story flag.
export function mpCard() {
    if (!state.started || !state.manifest) return null;
    const roster = partyRosterView(state.party ?? [], state.partnerStats, state.partyStats, menu.digimonDB ?? {}, state.digimonNames);
    const party = roster.slice(0, 4).map((r) => {
        const st = {};
        for (const [k, v] of Object.entries(r.stats ?? {})) {
            if (typeof v === "number" && k.length <= 6 && !/^(hp|mp|maxhp|maxmp)$/i.test(k) && Object.keys(st).length < 8) st[k] = v + (r.bonuses?.[k] ?? 0);
        }
        return {
            n: String(r.name ?? "").slice(0, 14), f: String(r.formName ?? "").slice(0, 14), id: r.digimonId | 0, lv: r.level | 0, xp: r.xp | 0,
            hp: r.hp | 0, mhp: r.maxHp | 0, mp: r.mp | 0, mmp: r.maxMp | 0, st,
        };
    });
    return { v: 1, chapter: state.chapter ?? 1, bits: state.bits | 0, quests: questsDoneCount(), party };
}

// The ordinary map change to a spot beside (x, y) on `mapId` (runStageHandoff scripted:true: the same wipe and load as an exit; setMap
// then gathers my followers on me). Used by the online "Go to" (warpNear) and by FLY (flyTo). `idle()` is asked before and after the
// collision loads. The spot comes from pickSpotNear on that map's own collision grid, so never a wall. Resolves "ok", "busy", "nomap" or "noroom".
export async function warpToMap(mapId, x, y, idle, dir = null) {
    const idx = state.manifest?.maps?.findIndex((m) => m.id === mapId) ?? -1;
    if (idx < 0) return "nomap";
    if (!idle()) return "busy";
    const grid = await loadCollisionForStage(mapId);
    if (!idle()) return "busy";            // the game moved on while the map's collision loaded
    const m = state.manifest.maps[idx];
    const spot = pickSpotNear((px, py) => !grid || !rectBlocked(grid, px - 6, py - 8, px + 6, py), x, y, { w: m.width, h: m.height });
    if (!spot) return "noroom";
    const dx = x - spot.x, dy = y - spot.y;
    runStageHandoff({ to: mapId, spawnX: spot.x, spawnY: spot.y, scripted: true, dir: dir ?? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up")) });
    return "ok";
}

export function chatSay(text) {
    chatBox.close();
    S.chatShownAt = performance.now() / 1000;
    S.chatPresses = 0;
    chatActor.x = Math.round(state.x); chatActor.y = Math.round(state.y);
    const pack = buildChatPack(text, String(state.playerName || ""));
    S.chatPages = pack.pages;
    chatBox.open({ pack, index: 0 }, { kind: "say", plain: false, balloonMode: 0, actor: chatActor }, null,
        (x, y) => ({ sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W), sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H) }));
}

export function mpBalloonSay(id, name, text) {
    let b = mpBalloons.get(id);
    if (!b) { b = { box: createDialogueTranslated(sfx), actor: { x: 0, y: 0, actorId: 0 }, at: 0 }; mpBalloons.set(id, b); }
    b.box.close();
    b.at = performance.now() / 1000;
    const at = id === myId() ? state : multiplayerGhosts(currentMap().id).find((g) => g.id === id);
    if (at) { b.actor.x = Math.round(at.x); b.actor.y = Math.round(at.y); }   // open over the speaker, not at the map corner
    const pack = buildChatPack(text, String(name || ""));
    b.pages = pack.pages; b.presses = 0;
    b.box.open({ pack, index: 0 }, { kind: "say", plain: false, balloonMode: 0, actor: b.actor }, null,
        (x, y) => ({ sx: (x - lastCam.x) * ZOOM * (320 / VIEW_W), sy: (y - lastCam.y) * ZOOM * (240 / VIEW_H) }));
}

function mpBalloonTick(dt) {
    if (!mpBalloons.size) return;
    const ghosts = new Map(multiplayerGhosts(currentMap().id).map((g) => [g.id, g]));
    for (const [id, b] of mpBalloons) {
        const at = id === myId() ? state : ghosts.get(id);
        if (!at || !isOnline() || !b.box.isOpen()) { b.box.close(); mpBalloons.delete(id); continue; }   // left the stage, or finished
        b.actor.x = Math.round(at.x); b.actor.y = Math.round(at.y);
        // the balloon reads its speaker from the game memory record (as chatTick does): keep it on them
        const cs = b.box._session;
        if (cs && cs.controller) {
            const rec = cs.mem.read32(cs.controller + 0x50) >>> 0;
            if (rec) { cs.mem.write32(rec + 0x58, b.actor.x >>> 0); cs.mem.write32(rec + 0x5c, b.actor.y >>> 0); }
        }
        b.box.update(dt, null);
        // same timing as the solo bubble: 4.5 s per page, the last page stays 10 s
        if (performance.now() / 1000 - b.at > (b.presses < b.pages - 1 ? 4.5 : 10) && Math.floor(performance.now() / 300) % 2) {
            b.box.pressConfirm(); b.at = performance.now() / 1000; b.presses++;
        }
    }
}

export function chatTick(dt) {
    mpBalloonTick(dt);
    if (!chatBox.isOpen()) return;
    chatActor.x = Math.round(state.x); chatActor.y = Math.round(state.y);
    // The balloon re-reads its speaker's position from the game's own memory record every tick, so
    // write the player's position there and the bubble follows when they walk.
    const cs = chatBox._session;
    if (cs && cs.controller) {
        const rec = cs.mem.read32(cs.controller + 0x50) >>> 0;
        if (rec) { cs.mem.write32(rec + 0x58, chatActor.x >>> 0); cs.mem.write32(rec + 0x5c, chatActor.y >>> 0); }
    }
    chatBox.update(dt, null);
    // close it by itself a few seconds after the text has shown (the box wants a confirm press)
    if (performance.now() / 1000 - S.chatShownAt > (S.chatPresses < S.chatPages - 1 ? 4.5 : 10) && Math.floor(performance.now() / 300) % 2) {
        chatBox.pressConfirm(); S.chatShownAt = performance.now() / 1000; S.chatPresses++;
    }
}

export function tickFootstep(holder, dt) {
    const form = state.diveForm;
    const isDigmon = form?.spriteId === DIGMON_SPRITE_ID;
    const interval = (isDigmon ? 32 : 8) * FIELD_TICK_SECONDS;
    holder._footstepT = (holder._footstepT ?? interval) + dt;
    if (holder._footstepT < interval) return;
    holder._footstepT -= interval;
    if (isDigmon) { sfx.play("dig_move"); S.footstepCount++; }
    else if (!form) { sfx.play("player00"); S.footstepCount++; }
    // else: 327 Submarimon plays no sample at all — see above.
}
