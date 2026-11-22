import { FIELD_LOCATION_KEY, encodeFieldLocation, decodeFieldLocation } from "../stage-locality.js";
import { collectionSnapshot, persistCollection } from "../cardstate.js";
import { mountForceDismount } from "../mount.js";
import { playerPackForClip, FIELD_IDLE_CLIP } from "../vendor/engine.js";
import { canvas, state, storyFlags } from "./vars.js";
import { S } from "./state.js";
import { grantNewPartners, prepareStageAssets, setMap } from "./map-load.js";
import { checkStageCutscene } from "./story-events.js";
import { frame } from "./update.js";
import { playerPackMeta } from "./fishing-tree.js";
import type { GameState } from "./types.js";


export function saveFieldLocation() {
    if (!state.started || !state.manifest) return;
    const entranceReturn = state.scenes[currentMap().id]?.exits?.find(
        (exit) => exit._entranceReturn,
    );
    localStorage.setItem(FIELD_LOCATION_KEY, encodeFieldLocation({
        mapId: currentMap().id,
        x: state.x,
        y: state.y,
        dir: state.dir,
        entranceReturn,
    }));
}

export function sweepCollectionSave() {
    if (++S.collectionSweepTick % 120 !== 0) return; // ~2 s at 60 Hz
    const snap = collectionSnapshot();
    if (snap === S.lastCollectionSnapshot) return;
    S.lastCollectionSnapshot = snap;
    persistCollection();
}

export function scheduleFieldLocationSave() {
    if (S.locationSaveTimer != null) return;
    S.locationSaveTimer = setTimeout(() => {
        S.locationSaveTimer = null;
        saveFieldLocation();
    }, 750);
}

export async function startGame(mapId = null) {
    state.playerName ||= "Junior";
    // EXPERIMENT (mounts): a save load (or a fresh start) begins on foot.
    mountForceDismount();
    const saved = mapId
        ? null
        : decodeFieldLocation(localStorage.getItem(FIELD_LOCATION_KEY), S.knownStageIds);
    const targetId = mapId ?? saved?.mapId ?? S.knownStageIds[0];
    const idx = state.manifest.maps.findIndex((m) => m.id === targetId);
    if (saved?.entranceReturn) {
        const scene = state.scenes[targetId];
        scene.exits = (scene.exits ?? []).filter((exit) => !exit._entranceReturn);
        scene.exits.push(saved.entranceReturn);
    }
    await prepareStageAssets(targetId);
    state.started = true;
    canvas.hidden = false;
    document.getElementById("hud")!.classList.add("visible");
    setMap(idx >= 0 ? idx : 0, saved!);
    grantNewPartners();
    checkStageCutscene(currentMap().id);
    requestAnimationFrame(frame);
}

// The player is Junior in one of two sprite sets. The cast rebuild F0x8008aa10
// builds charId 2 (P002PLAY) unless a charId-1 cast record passes its flag
// list (state.playerCharOne, set on stage entry), which builds P001PLAY.
//
// P002PLAY is also the pack the clip rule names for the standing clip: the
// resolver stores 0x01870070 for clip < 8, and the constructor's own `+0x9c` for
// npc_id 2 is that same constant. So the base pack is read from the rule too.
export function currentChar(): NonNullable<ReturnType<typeof playerPackMeta>> | (typeof state.manifest.characters)[number] {
    if (state.playerCharOne) return state.manifest.characters[0];
    return playerPackMeta(playerPackForClip(FIELD_IDLE_CLIP)) ?? state.manifest.characters[0];
}

// Stage entry: does a charId-1 record of this stage's cast list pass? Records are
// tried in cast-list order; a list passes iff every get_flag(id) == expected
// (F0x80016924). tools/extract_player_cast_one.py. Missing data: null.
export function evaluatePlayerCharOne(stageId) {
    const lists = state.playerCastOne?.[stageId];
    if (state.playerCastOne == null) return null;
    if (!lists) return false;
    return lists.some((list) => list.every((c) => storyFlags.matches(c.id, c.expected)));
}

export function manifestIndexOf(charId: string | null | undefined) {
    return state.manifest.characters.findIndex((c) => c.id === charId);
}

export function currentMap(): GameState["manifest"]["maps"][number] {
    return state.manifest.maps[state.mapIdx];
}
