import { initializeAssetModeUi, assignAssetImage, loadAssetImage as loadImage } from "../assets.js";
import { FIELD_LOCATION_KEY } from "../stage-locality.js";
import {
  syncWornFromEquipment,
  createScreenRouter,
  applyNpcPrograms,
  setTalkLaunchBindings,
  computeDiveNetwork,
  clearBag,
  movieReturnScreen,
  MOVIE_TITLE_SCREEN,
  BATTLE_HANDOFF_SELECTOR,
} from "../vendor/engine.js";
import { loadNewMaps, mergeNewMaps, newMapScene, addNewMapExits } from "../newmaps.js";
import { preloadPartnerPictures } from "../partner-pictures.js";
import { loadFieldcom } from "../fieldcom.js";
import { loadDiveDemo } from "../dive-demo.js";
import { loadPlaceCardTranslated } from "../placecard-translated.js";
import { loadEndCardTranslated } from "../endscreen-translated.js";
import { loadPointSprites } from "../effects.js";
import { loadFallingObjects } from "../stage-objects.js";
import { installShowcase } from "../showcase.js";
import { applyScene } from "../ambience.js";
import { fieldPartySize } from "../party.js";
import { toggleGameFullscreen } from "../fullscreen.js";
import { resetCollection, ensureStarterFolder } from "../cardstate.js";
import {
  createTitleScreen,
  RESULT_START,
  RESULT_CONTINUE,
  RESULT_IDLE,
  drawTitleScreen,
  titleViewTransform,
  titleOptionRects,
} from "../titlescreen.js";
import { createTitleMoviePlayer } from "../title-movie.js";
import { packedIsMusicStart, packedKey } from "../packed-sound.js";
import { asButton } from "../input.js";
import {
  EMOTE_KINDS,
  PACKED_MUSIC,
  battle,
  bgm,
  cntyselNative,
  engineEventDone,
  saveScreen,
  sfx,
  state,
} from "./vars.js";
import { S, screenRouterOptions } from "./state.js";
import { initEngine } from "./engine-init.js";
import { loadAndSetMap, setCharacter } from "./map-load.js";
import { manifestIndexOf, startGame } from "./session.js";
import { openMemoryCard } from "./ui-openers.js";

export async function init() {
    await initializeAssetModeUi();
    const titleBg = document.getElementById("title-bg");
    if (titleBg) assignAssetImage(titleBg, "assets/ui/stdwtitl_bg.png");

    // One-time save reset for the engine cutover: the banked flag store moved from legacy
    // "gf_"-prefixed keys in `flags` to the engine's `engineFlags` blob, so old progress can't
    // carry over cleanly. Wipe the save once (forces a fresh New Game) and stamp the schema.
    if (localStorage.getItem("engineSchema") !== "2") {
        for (const k of [
            "flags",
            "engineFlags",
            "progressOrdinal",
            "charId",
            "playerName",
            "chapter",
            "chapterOverride",
            "party",
            "pendingParty",
            "packId",
            "partnerStats",
            "partyStats",
            "equipment",
            "worn",
            FIELD_LOCATION_KEY,
        ]) {
            localStorage.removeItem(k);
        }
        for (const k in state.flags) delete state.flags[k];
        state.party = null;
        state.pendingParty = null;
        state.rosterOwned = 0;
        state.reserveStats = {};
        state.reserveEquipment = {};
        state.partyStats = null;
        state.partnerStats = { hp: 500, maxHp: 500, mp: 100, maxMp: 100, level: 1 };
        state.equipment = [];
        syncWornFromEquipment(state); // nobody wears anything on a new game
        state.packId = null;
        S.engine?.state.party.load({ members: [] });
        S.engine?.state.vars.set("$party.pack", null); // clear s212 download gate selector
        state.charId = null;
        state.charIdx = 0;
        localStorage.setItem("engineSchema", "2");
    }

    state.manifest = await (await fetch("assets/manifest.json")).json();
    // Maps made after the disc join the manifest like a disc map (web/newmaps.js); none installed = nothing changes.
    state.newMaps = await loadNewMaps(
        (url) => fetch(url).then((r) => (r.ok ? r.json() : null)),
        (url) => fetch(url, { method: "HEAD" }).then((r) => r.ok),
    ).catch(() => ({ records: [], scenes: {}, exits: {} }));
    mergeNewMaps(state.manifest, state.newMaps);
    S.knownStageIds = state.manifest.maps.map((m) => m.id);
    S.manifestSprites = new Map([
        ...state.manifest.characters.map((record) => [record.id, { record, kind: "character" }]),
        ...(state.manifest.npcs ?? []).map((record) => [record.id, { record, kind: "npc" }]),
    ]);
    // Global npc_id→sprite table the engine actually uses (NOT "p"+id). Tolerate 404.
    state.npcSprites = {};
    try {
        const ns = await fetch("assets/npc_sprites.json");
        if (ns.ok) state.npcSprites = await ns.json();
    } catch {
        /* fall back to empty (resolvers degrade gracefully) */
    }
    // New characters the extra quests add (tools/make_quest_sprites.py): their drawn sprites join the game's own tables, and
    // "residents" are where they stand. Optional: without the file the game is exactly as before.
    S.extraResidents = [];
    try {
        const ex = await fetch("extra_npcs.json");
        if (ex.ok) {
            const x = await ex.json();
            for (const rec of x.npcs ?? []) {
                state.manifest.npcs.push(rec);
                S.manifestSprites.set(rec.id, { record: rec, kind: "npc" });
            }
            Object.assign(state.npcSprites, x.npc_sprites ?? {});
            S.extraResidents = x.residents ?? [];
        }
    } catch {
        /* no extra characters */
    }
    // Named walking routes for quest scenes (optional; without the file a { walk, path } step just fails its scene check).
    try {
        const qp = await fetch("quest-paths.json");
        if (qp.ok) S.questPaths = (await qp.json()).paths ?? {};
    } catch {
        /* no named paths */
    }
    // The new partners' field sprites (web/extra_partners.json): they join the character table the
    // starters walk from, so a new partner leading the party is a character like any starter.
    try {
        const ep = await fetch("extra_partners.json");
        if (ep.ok) {
            for (const rec of (await ep.json()).characters ?? []) {
                if (state.manifest.characters.some((c) => c.id === rec.id)) continue;
                state.manifest.characters.push(rec);
                S.manifestSprites.set(rec.id, { record: rec, kind: "character" });
            }
        }
    } catch {
        /* no new partners */
    }
    // ... and their roster slots and starter ids, before the saved party is read back.
    try {
        await window.__extraRoster?.load?.();
        preloadPartnerPictures();
    } catch {
        /* no extra species */
    }
    // Real screen→map table (data/screen_table.json) for HANDOFF routing. Tolerate 404.
    try {
        const st = await fetch("assets/data/screen_table.json");
        if (st.ok) {
            S.fieldScreenTable = await st.json();
            S.screenRouter = createScreenRouter(S.fieldScreenTable, screenRouterOptions);
        }
    } catch {
        /* keep specials-only router */
    }
    // Decoded shop catalog (tools/extract_shops.py — 31 STITSHOP shops). A scene shop
    // zone may carry `shop_id` to draw its real stock; else it falls back to zone.stock.
    try {
        const sj = await fetch("assets/data/shops.json");
        if (sj.ok) {
            const byId = {};
            for (const s of (await sj.json()).shops)
                byId[s.shop_id] = { items: s.items.map((i) => i.id), name: s.name };
            state.shops = byId;
        }
    } catch {
        /* no shop catalog — zones use hand stock */
    }

    // Scene JSON is compact routing metadata and remains resident. Large maps,
    // collision grids and sprite sheets are loaded per-stage below.
    const npcProgramsResponse = await fetch("stage-npc-programs.json");
    if (!npcProgramsResponse.ok) throw new Error("Decoded NPC programs unavailable");
    const npcPrograms = (await npcProgramsResponse.json()).stages;
    const sceneLoads = state.manifest.maps.map(async (m) => {
        try {
            const own = newMapScene(state.newMaps, m.id);
            const res = own ? null : await fetch("assets/scenes/" + m.id + ".json");
            const scene = own
                ? structuredClone(own)
                : res!.ok
                    ? await res!.json()
                    : { npcs: [], exits: [], zones: [] };
            addNewMapExits(state.newMaps, m.id, scene); // doors that lead into the new maps
            scene.npcs = applyNpcPrograms(scene.npcs ?? [], npcPrograms[m.id] ?? []);
            scene.exits = scene.exits ?? [];
            scene.zones = scene.zones ?? [];
            // A places stage re-aims its exits on every arrival from these rows
            // (applyPlacePoints), so keep the build-time rows pristine: the aim
            // writes a fresh array, and an unmatched pair falls back to this one.
            if (scene.placePoints) scene._baseExits = scene.exits.map((e) => ({ ...e }));
            // gen_scenes.py already bakes the disasm-verified default ("down-left" — the
            // FIELDSTG constructor's unconditional entity+0x60 init, see npc-decode.md)
            // for NPCs with no SETANIM ground truth. This is just a safety net for any
            // record that somehow has no dir at all.
            for (const npc of scene.npcs) {
                if (!npc.dir) npc.dir = "down-left";
            }
            for (const r of S.extraResidents) {
                if (r.map === m.id && state.npcSprites![r.npc_id]) {
                    scene.npcs.push({ id: "res_" + r.npc_id, npc_id: r.npc_id, sprite: state.npcSprites![r.npc_id], x: r.x, y: r.y, dir: r.dir || "down", _quest: true });
                }
            }
            state.scenes[m.id] = scene;
        } catch {
            state.scenes[m.id] = { npcs: [], exits: [], zones: [] };
        }
    });
    const dlgLoads = Array.from(
        { length: 10 },
        (_, i) => "estalk" + String(i).padStart(2, "0"),
    ).map(async (f) => {
        try {
            state.dialogues[f] = await (
                await fetch("assets/dialogue/" + f + ".json")
            ).json();
        } catch {
            state.dialogues[f] = {};
        }
    });

    const EVENT_STAGES = [
        "200",
        "260",
        "270",
        "300",
        "305",
        "400",
        "500",
        "600",
        "700",
        "800",
        "900",
    ];
    const eventLoads = EVENT_STAGES.map(async (key) => {
        try {
            const res = await fetch("assets/events/esdmg" + key + ".json");
            if (res.ok) state.events[key] = await res.json();
        } catch {
            /* optional asset */
        }
    });

    const wstag_load = (async () => {
        try {
            const res = await fetch("assets/events/wstag_events.json");
            if (res.ok) state.wstag = await res.json();
        } catch {
            /* optional */
        }
    })();

    // WS4 story-step VM data (position-triggered cutscenes): step programs + type-7 grids.
    const story_load = (async () => {
        try {
            const [ss, sg, sz, cp, po, rp, ft, amb, tel, tlb, fish, trees, dfm, scl, sdsp, pc1, cone] = await Promise.all([
                fetch("assets/data/story_steps.json").then((r) => r.json()),
                fetch("assets/data/story_trigger_grids.json").then((r) =>
                    r.json(),
                ),
                // EXACT per-pixel type-7 zones — the disc's own zonecheck, decimised
                // only by horizontal run. The step byte must come from the player's
                // pixel, not a 32 px cell (web/game.js stepSetupBucketTick / the
                // trigger system's zoneByte). Missing file = fall back to the grid.
                fetch("assets/data/story_trigger_zones.json")
                    .then((r) => (r.ok ? r.json() : { stages: {} }))
                    .catch(() => ({ stages: {} })),
                fetch("assets/data/chapter_progression.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                fetch("assets/data/progress_ordinal.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                fetch("assets/data/roster_predicate_table.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Fire Dungeon floor traps: the step regions of s740/s741 whose
                // event is the native party-explosion controller, plus that
                // controller's extracted timing, sounds and sprite programs.
                fetch("assets/data/fire_traps.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Ambush tiles: the patches of floor that drop you straight into
                // a fight with one of the area's own monsters.
                fetch("assets/data/forced_encounters.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Talk-triggered cutscenes: the bank-0x90 launcher's event-id
                // table (fieldstg 0x800978d8). A dialogue state's on_close write
                // into that bank IS a start_event; the bit indexes this array.
                fetch("assets/data/talk_event_launches.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The same launcher resolved PER STAGE: which NPC dialogue state writes which
                // bit, and which event that bit names here. This is the start site of those
                // scenes — and the authority for what a bit means in the CURRENT stage, since
                // three shipped bindings name an event their own stage does not own and start
                // nothing (tools/extract_talk_launch_bindings.py).
                fetch("assets/data/talk_launch_bindings.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Fishing spots: the op-7 step records that grow at the water's
                // edge once you own the FishingPole, plus the two parties a
                // successful strike can pull out of the stage's own scripted
                // encounter block.
                fetch("assets/data/fishing_spots.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Kickable trees: the stage's FIELDCOM point-sprite records, in
                // the tree manager's own order, plus the two parties its one
                // live tree drops.
                fetch("assets/data/tree_kick.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Post-dive traversal forms: each stage's own cast-list marker
                // (screen -> native sprite id 0x146 Digmon / 0x147 Submarimon).
                // Authoritative over the exit-graph network, which misses the
                // maze-entered screens. See tools/extract_dive_form_markers.py.
                fetch("assets/data/dive_form_markers.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The whole cast list per stage (descriptor +0x4C), decoded once
                // by tools/extract_cast_lists.py. The player build (loop A) and
                // every other actor (loop B) read from THIS, so a dive form, a
                // charId-1 row and the special block actors all come out of one
                // path. The two files above are its derived fallbacks.
                fetch("assets/data/stage_cast_lists.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Per-stage default spawn (descriptor +0x2C/+0x30, 24.8 fixed ->
                // map pixels by >>8): where you stand when a stage loads with no
                // warp spawn. tools/extract_stage_default_spawn.py.
                fetch("assets/data/stage_default_spawn.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // Stages whose cast list builds the player as charId 1 (P001PLAY),
                // so their scripts name the player actor 1, not 2.
                // tools/extract_player_cast_one.py.
                fetch("assets/data/player_cast_one.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
                // The position step's facing-cone enable gate: FIELDSTG.PRO's 8x8
                // byte table at RAM 0x80097624, which step-load reads as
                // cone[grid byte >> 5][player facing]. tools/extract_step_enable_table.py.
                fetch("assets/data/scene/step_enable_table.json")
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null),
            ]);
            // Multi-phase rooms: the second type-7 layout a swap event installs,
            // with its own 24-byte step program. Only s810 (Undersea Base) has one.
            const variants = await fetch("assets/data/stage_layout_variants.json")
                .then((r) => (r.ok ? r.json() : { stages: {} }))
                .catch(() => ({ stages: {} }));
            state.storySteps = ss.stages;
            state.storyGrids = sg.stages;
            state.storyZones = sz?.stages ?? {};
            state.stageLayoutVariants = variants.stages ?? {};
            state.stepEnableTable = cone?.rows ?? null;
            state.fireTraps = ft ?? {};
            state.ambushTiles = amb ?? {};
            state.fishingSpots = fish ?? {};
            // Our own extra-rewards table for the fishing spots; a missing file just means no extras.
            state.gymExtra = await fetch("assets/data/gym_extra.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);   // extra training halls (web/gym-extra.js)
            state.fishingExtras = await fetch("assets/data/fishing_extras.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
            state.treeStages = trees ?? {};
            state.diveFormMarkers = dfm ?? {};
            state.stageCastLists = scl; // null when missing: fall back to the derived files
            state.stageDefaultSpawn = sdsp ?? {};
            state.playerCastOne = pc1; // null when missing: fall back to the scene's own actor-1 use
            state.talkEventIds = tel?.events ?? [];
            setTalkLaunchBindings(tlb);   // null tolerated: playTalkEvent falls back to tel
            state.chapterTable = cp; // null tolerated → deriveChapter falls back to default 1
            // Populate ordinal/roster tables in place (the flag store captured these references).
            state.progressTable = po ?? null;   // kept whole for the replay theatre's ladder
            if (po) {
                const all = new Set<number>();
                for (const b of po.ladder) {
                    state.ordinalByStage[b.stage] = b.ordinals; // full list (revisited stages)
                    for (const o of b.ordinals) all.add(o);
                }
                state.allOrdinals = [...all].sort((a, b) => a - b);
            }
            if (rp)
                for (const r of rp.records) state.rosterPredTable[r.key] = r;
        } catch {
            state.storySteps = {};
            state.storyGrids = {};
            state.storyZones = {};
            state.stageLayoutVariants = {};
            state.stepEnableTable = null;
            state.fireTraps = {};
            state.ambushTiles = {};
            state.fishingSpots = {};
            state.fishingExtras = null;
            state.treeStages = {};
            state.talkEventIds = [];
        }
    })();

    const findings_load = (async () => {
        try {
            state.findings = await (
                await fetch("assets/events/intro_re_findings.json")
            ).json();
            // Populate EMOTE_KINDS (module-level object read by cutscene opts) from loaded findings.
            Object.assign(
                EMOTE_KINDS,
                Object.fromEntries(
                    (Object.entries(state.findings?.emotes ?? {}) as [string, { kind?: any }][]).map(
                        ([k, v]) => [Number(k), v.kind],
                    ),
                ),
            );
        } catch {
            state.findings = null;
        }
    })();

    // Preload battle data (idempotent) so the story engine can resolve scripted-battle
    // triggers/parties before the first fight (talking to a boss must work immediately).
    const battle_load = battle.loadData().catch(() => {});

    // Real FIELDCOM field-UI icons (talk balloon, ladder bubble, door arrow, sparkles).
    // Non-fatal: draw sites fall back to the hand-drawn bubble when unavailable.
    const fieldcom_load = loadFieldcom(loadImage).catch(() => {});

    // The Digi-Egg dive transition packs (SSUBDEMO / SDIGDEMO). Non-fatal: a
    // dive falls back to the plain fade if these are missing.
    const divedemo_load = loadDiveDemo(loadImage).catch(() => {});

    // The stage-entry location title card's name table and bar templates.
    // Non-fatal: without it an arrival simply goes unannounced.
    const placecard_load = loadPlaceCardTranslated().catch(() => {});

    // The END card's language table. Non-fatal: the card falls back to its own overlay
    // table only if the shipped one fails to load, and the session rejects a drift.
    const endcard_load = loadEndCardTranslated().catch(() => {});

    // Ambient point-sprite decorations (windmills/fans/torches — see
    // web/effects.js). Non-fatal: stages simply show no ambient effects.
    const effects_load = loadPointSprites().catch(() => {});

    // The stage overlays' own actors, ported from their record tables
    // (tools/extract_falling_objects.py). This is the route that plays in the
    // shipped game; see web/stage-objects.js. Non-fatal.
    const falling_objects_load = loadFallingObjects().catch(() => {});

    // Foreground map-overlay index (walk-behind pipes/poles/canopies): map tiles
    // are 3-layered on PS1 and layers >= 1 draw OVER sprites; the flat map PNGs
    // lost that, so sNNN_fg.png recomposites them (tools/extract_map_overlays.py).
    // Non-fatal: without it the player just draws over foreground props again.
    const overlays_load = fetch("assets/data/map_overlays.json")
        .then((r) => (r.ok ? r.json() : {}))
        .then((idx) => (state.mapOverlays = idx))
        .catch(() => {});

    // Ground-cover index: which stages ship a layer-2 split (their ground band is
    // rebuilt at load from the base map + the tracked run data), so the renderer
    // asks only for those (tools/build_map_ground_over_props.py). Non-fatal; an
    // empty index just skips the ground band.
    const ground_load = fetch("assets/data/map_ground_index.json")
        .then((r) => (r.ok ? r.json() : {}))
        .then((idx) => (state.mapGroundIndex = idx))
        .catch(() => {});
    const layer2_load = fetch("assets/data/map_layer2_runs.json")
        .then((r) => (r.ok ? r.json() : { stages: {} }))
        .then((d) => (state.mapLayer2 = d.stages ?? {}))
        .catch(() => {});

    // The s260 Cargo Tower auction (assets/data/auction_lots.json, written by
    // tools/extract_s260_auction.py from the disc): the sixteen lots of
    // FIELDSTG_progressEvents / FIELDSTG_choices / FIELDSTG_events and the 50
    // wstag260 scripts. Non-fatal: without it the tower loads exactly as before.
    const auction_load = fetch("assets/data/auction_lots.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (state.auction = d ?? null))
        .catch(() => { state.auction = null; });

    await Promise.all([
        ...sceneLoads,
        ...dlgLoads,
        ...eventLoads,
        wstag_load,
        story_load,
        auction_load,
        findings_load,
        battle_load,
        fieldcom_load,
        divedemo_load,
        placecard_load,
        endcard_load,
        effects_load,
        falling_objects_load,
        overlays_load,
        ground_load,
        layer2_load,
    ]);

    // Digi-Egg traversal sections. Which screens you wear Submarimon/Digmon on
    // is derived once from the loaded exit graph — see engine/systems/dive-form.ts.
    const dive = computeDiveNetwork(state.scenes);
    state.diveNetwork = dive.network;
    if (dive.conflicts.length)
        console.warn("[dive] screen claimed by both dive forms:", dive.conflicts);

    // Bring up the headless engine (flags + ordinal + story decisions) before the loop runs.
    // Story is non-functional without it, so surface a hard error rather than silently degrade.
    try {
        await initEngine();
    } catch (err) {
        console.error("[engine] init FAILED — story will not run", err);
    }

    const charSelectEl = document.getElementById("charSelect") as HTMLSelectElement;
    for (const c of state.manifest.characters) {
        charSelectEl.add(new Option(c.name, c.id));
    }
    charSelectEl.onchange = () => {
        setCharacter(charSelectEl.selectedIndex);
        charSelectEl.blur();
    };

    const mapSelect = document.getElementById("mapSelect") as HTMLSelectElement;
    for (const m of state.manifest.maps) {
        mapSelect.add(new Option(m.name, m.id));
    }
    mapSelect.onchange = () => {
        loadAndSetMap(mapSelect.selectedIndex);
        mapSelect.blur();
    };
    installShowcase({
        select: document.getElementById("showcaseSelect"),
        apply: applyScene,
        goTo: (id) => {
            const i = state.manifest.maps.findIndex((m) => m.id === id);
            if (i < 0) return;
            mapSelect.selectedIndex = i;
            loadAndSetMap(i);
        },
    });

    try {
        const tracks = await (await fetch("assets/music/index.json")).json();
        const musicSelect = document.getElementById("musicSelect") as HTMLSelectElement;
        for (const t of tracks) musicSelect.add(new Option(t, t));
        musicSelect.onchange = () => {
            bgm.play!(musicSelect.value);
            musicSelect.blur();
        };
    } catch {
        const musicSelect = document.getElementById("musicSelect");
        if (musicSelect) musicSelect.parentElement!.hidden = true;
    }

    const chapterSelect = document.getElementById("chapterSelect") as HTMLSelectElement;
    chapterSelect.value = String(state.chapter);
    chapterSelect.onchange = () => {
        state.chapter = Number(chapterSelect.value);
        chapterSelect.blur();
    };

    // Restore persisted charIdx from charId after manifest is loaded.
    if (state.charId) {
        const savedIdx = state.manifest.characters.findIndex(
            (c) => c.id === state.charId,
        );
        if (savedIdx > 0) state.charIdx = savedIdx;
    }
    // Restore the persisted party; keep charIdx in sync with the lead (party[0]).
    if (Array.isArray(state.party) && state.party.length) {
        const leadIdx = manifestIndexOf(state.party[0]);
        if (leadIdx > 0) state.charIdx = leadIdx;
    }
    // Restore an evolved partner form (digimonId persisted in partnerStats) so the partner
    // stays evolved across reloads (getPlayerProfile reads char.digimonId).
    if (fieldPartySize(state.party) > 0 && state.charIdx > 0 && state.partnerStats?.digimonId) {
        state.manifest.characters[state.charIdx].digimonId =
            state.partnerStats.digimonId;
    }
    charSelectEl.selectedIndex = state.charIdx;

    document.getElementById("loading")!.hidden = true;

    // A memory-card load reloads the page into the loaded slot; go straight to
    // the field instead of the language and title screens (set once by
    // web/save-translated.js before the reload).
    let resumeAfterLoad = false;
    try {
        resumeAfterLoad = sessionStorage.getItem("resumeAfterLoad") === "1";
        sessionStorage.removeItem("resumeAfterLoad");
    } catch { /* storage blocked */ }
    // `?skipTitle=1` is a headless shortcut past the boot, not a game rule, and it
    // must not change what a lost fight does: wfightmn's loss exit launches 0xE00
    // (the title screen) from a game that is ALREADY running
    // (web/game.js gameOverToTitle()). So both routes build the title screen below
    // and only differ in whether they open it; the flag is read here and acted on
    // after the screen exists.
    const debugSkipTitle = new URLSearchParams(location.search).get("skipTitle") === "1";
    const debugMap = new URLSearchParams(location.search).get("map");

    const title = document.getElementById("title-screen");
    // Not shown yet: the PAL boot screen (country / language select) runs first
    // — see the boot-language block below. `?skipLanguage=1` skips straight to
    // the title.

    // Show decoded title logo PNG if available; fall back to text heading.
    const logoImg = document.getElementById("title-logo");
    const titleText = document.getElementById("title-text");
    if (logoImg) {
        logoImg.onload = () => {
            logoImg.hidden = false;
            if (titleText) titleText.hidden = true;
        };
        logoImg.onerror = () => {
            logoImg.hidden = true;
            if (titleText) titleText.hidden = false;
        };
        assignAssetImage(logoImg, "assets/title_logo.png");
    }

    // Continue is never dimmed, disabled or skipped. The original's title menu
    // has no test for "is there a file": the lower choice always launches code
    // 0xC00, the memory-card screen in LOAD mode (docs/research/ui/
    // stdwtitl-title-menu-2026-08-14.md, "What the choices actually do"), and
    // an empty card answers with the original's own esmemcrd 24 "No data here."
    const contEl = document.getElementById("title-continue");
    if (!contEl) return; // defensive: element missing

    const closeTitle = (then) => {
        if (title!.classList.contains("fade-out")) return; // already closing
        bgm.unlock!(); sfx.unlock!();
        title!.classList.add("fade-out");
        setTimeout(() => {
            title!.hidden = true;
            then();
        }, 650);
    };

    // What the memory card hands the launcher when the player backs out of it.
    // The screen picks the next screen by the selector its own root wrote
    // (pro/stgmcard.s 0x4dc4-0x4e2c: root+0x14 == 0 means a save was loaded and
    // the SAVED GAME's own screen code answers, root+0x50 != 0 means LOAD mode
    // left without loading and the answer is 0xE00 — the TITLE SCREEN — and
    // otherwise the screen returns to the one it came from; see the translated
    // root's state 3 in engine/dw3/ui/memcard-root.ts). The translated screen
    // keeps those words as `transition()`, which web/save-translated.js records
    // in `diagnostics().summary.transition`.
    //
    // Only the LOAD direction is reachable from this button, and a load restores
    // the slot and reloads the page instead of calling back (web/save-translated.js
    // `_finish`), so backing out of Continue answers 0xE00: the title comes back.
    const MEMCARD_TITLE_SCREEN = 0xe00;
    const memoryCardExitScreen = () => {
        const code = saveScreen.diagnostics?.()?.summary?.transition?.[0];
        return Number.isFinite(code) ? code : MEMCARD_TITLE_SCREEN;
    };
    // A FRESH title, the way the idle reset builds one — not a resumption of the
    // menu the player left, because the launcher builds the screen again. The
    // card is the screen being left, so it is the previous screen the fresh
    // title reads back (a Japanese title times out to 0xE01 from here, not to
    // the movie it happened to watch before).
    const leaveMemoryCardToTitle = () => {
        window.__memcardExitScreen = memoryCardExitScreen();
        previousScreenCode = MEMCARD_SCREEN_CODE;
        startTitle();
    };

    const requestGameFullscreen = () => {
        const stage = document.getElementById("stage");
        if (!document.fullscreenElement && stage?.requestFullscreen) {
            // Fullscreen requires a direct user gesture. New Game/Continue are
            // that gesture; denial is harmless and leaves the responsive canvas.
            toggleGameFullscreen(document, stage);
        }
    };

    document.getElementById("title-newgame")!.onclick = () => {
        requestGameFullscreen();
        for (const k of [
            "flags",
            "engineFlags",
            "charId",
            "playerName",
            "chapter",
            "chapterOverride",
            "progressOrdinal",
            "party",
            "pendingParty",
            "packId",
            "partnerStats",
            "partyStats",
            "equipment",
            "worn",
            // A new game starts with no partners obtained and nobody waiting at the Lab.
            "rosterOwned",
            "reserveStats",
            "reserveEquipment",
            "residentSaveImage",
            // The wallet/bag and the other per-save progress stores: Start resets
            // game state (stdwtitl), so a new game must not inherit the previous
            // save's money, items, nicknames, play time or discovered maps.
            "bits",
            "inventory",
            "digimonNames",
            "playSeconds",
            "visitedMaps",
            "cardCollection",
            "engineEvents",
            FIELD_LOCATION_KEY,
        ])
            localStorage.removeItem(k);
        engineEventDone.clear(); // the story restarts, so once-only events may fire again
        resetCollection();
        ensureStarterFolder(); // F0x80016E6C grants the 40-card starter deck
        state.bits = 500; // fresh-install default (see the state init: bits ?? 500)
        clearBag(state); // the new-game path zeroes the save block's two count arrays
        state.digimonNames = {};
        state.playSeconds = 0;
        state.visitedMaps = new Set();
        for (const k in state.flags) delete state.flags[k]; // clear string markers (evt_/onceFlag/setFlag)
        if (S.engine) S.engine.state.flags.clear(); // wipe the banked store (single source of truth)
        state.charId = null;
        state.progressOrdinal = 0; // fresh story → ordinal back to 0 (drives bank-0x60/0x70 gates)
        state.chapter = null; // clear debug override → chapter derives from (now empty) flags = 1
        state.playerName = "Junior"; // placeholder until in-world registration
        state.charIdx = 0; // no partner until the s212 download scene
        state.party = null;
        state.pendingParty = null;
        state.rosterOwned = 0;
        state.reserveStats = {};
        state.reserveEquipment = {};
        state.partyStats = null;
        state.partnerStats = { hp: 500, maxHp: 500, mp: 100, maxMp: 100, level: 1 };
        state.equipment = [];
        syncWornFromEquipment(state); // nobody wears anything on a new game
        state.packId = null;
        S.engine?.state.vars.set("$party.pack", null); // clear s212 download gate selector
        closeTitle(() => startGame("s780"));
    };
    contEl.onclick = () => {
        requestGameFullscreen();
        // The original's Continue launches code 0xC00 — the memory card in LOAD
        // mode (stdwtitl's choice dispatcher: 0x2D7 = Start, 0xC00 = Continue).
        // There is no save-exists test on this path: with nothing saved the
        // card screen opens anyway and reports "No data here.", so the player
        // can pick another card or back out.
        // Loading a slot restores the walker's snapshot and reloads the page, so
        // the close callback only runs when nothing was loaded — and then the
        // card's own exit selector sends the player back to the title, not into
        // a game they did not load.
        closeTitle(() => {
            // The load screen runs before the game starts, so the sim loop
            // cannot draw it and the field canvas is still hidden. Like the
            // boot language screen, it paints on the title canvas until it
            // closes (padLoop ticks it).
            title!.hidden = false;
            title!.classList.remove("fade-out");
            title!.classList.add("native");
            openMemoryCard("load", leaveMemoryCardToTitle);
            requestAnimationFrame(continueLoadFrame);
        });
    };
    // ── The title screen ────────────────────────────────────────────────
    // Decoded 2026-08-14; see docs/research/ui/stdwtitl-title-menu-2026-08-14.md.
    // The translated controller lives in engine/dw3/ui/title-session.ts;
    // web/titlescreen.js paints its extracted pictures. If the art is missing,
    // the walker's heading and buttons remain available.
    const titleCanvas = document.getElementById("title-canvas") as HTMLCanvasElement;
    const titleCtx = titleCanvas?.getContext("2d") ?? null;
    // The resident launcher's PREVIOUS screen code — the code of the screen a
    // launch replaces. The launcher records it on every screen change, and the
    // title's Japanese idle timeout reads it back to alternate its two opening
    // movies: stdwtitl's choice dispatcher F0x80086834 calls the getter
    // 0x80016B58 through the game context's slot 0x8004B448 (the word at
    // 0x8004B400) and launches 0xE01 unless that word already reads 0xE01
    // (pro/stdwtitl.s .L0x00003CA0-.L0x00003CEC; ledger
    // UI-TITLE-ATTRACT-LOOP-2026-08-14). Every route into the title must
    // therefore record what it left, exactly as the launcher does — a stale
    // value makes the Japanese build watch the wrong opening movie.
    let previousScreenCode = 0;
    // The memory-card overlay's own screen code: the title's Continue choice
    // launches 0xC00 with argument 0 (the LOAD row), and when the card hands
    // back 0xE00 the title is entered with the card as its previous screen.
    const MEMCARD_SCREEN_CODE = 0xc00;
    const newTitle = () => createTitleScreen({ language: state.languageByte ?? 2, previousScreenCode });
    // Recreate the translated title after language selection to use the chosen text clips.
    let ts = createTitleScreen({ language: state.languageByte ?? 2, previousScreenCode });
    // F0x80083cc0 state 1 (stdwtitl.s:1172-1190): once the movie object is
    // gone the movie screen launches its row's destination word with argument
    // 0. Both opening rows carry 0x0e00, the title screen, so the attract loop
    // comes back here -- read from the table, not assumed.
    let movieDestination = 0;
    const movie = createTitleMoviePlayer((code) => {
        // The launcher's previous-screen record: the movie's own code (0xE01 /
        // 0xE02) is what the title it hands back to reads on its next timeout.
        previousScreenCode = code;
        movieDestination = movieReturnScreen(code, false) ?? 0;
        if (movieDestination === MOVIE_TITLE_SCREEN) ts = newTitle();
        // The attract loop's return to the title does NOT start ttlbgm here:
        // the disc rings TITLEBGM only from the title's own reveal cue, which
        // every fresh title entry fires (web/game.js playTitleSounds).
    });
    window.__titleMovie = () => ({
        ...movie.diagnostics(),
        destination: "0x" + movieDestination.toString(16),
    });
    const startMovie = (code: number) => {
        title!.hidden = false;
        titleNative = true;
        title!.classList.add("native");
        bgm.play!(null);
        movie.open(code);
    };
    // The title publishes packed-sound words; a MUSIC-START word is a SEP
    // sequence the sample sink cannot resolve, so it must go to the music
    // player. The sequence's own cue is TITLEBGM 0x611c0000 (see PACKED_MUSIC):
    // routing it here is what makes the reveal audible -- and because the disc
    // starts the theme ON that cue, it is also the only place the title theme
    // starts (web/game.js no longer starts ttlbgm at title open).
    const playTitleSounds = () => {
        for (const id of ts.takeSounds?.() ?? []) {
            if (packedIsMusicStart(id)) {
                const stem = PACKED_MUSIC[packedKey(id)];
                if (stem) { bgm?.play?.(stem); continue; }
            }
            sfx.playPacked!(id);
        }
    };
    // Starts false so the first successful draw flips it: the class toggle only
    // fires on a CHANGE, and pre-setting it left the native canvas display:none
    // (the walker's own HTML title stayed visible over it).
    let titleNative = false;
    // Debug handle: the native title's live state machine (phase/highlight/
    // result), so a headless check can follow the prompt -> menu -> commit
    // sequence without guessing at pixels.
    window.__titleState = () => ts;

    const commitTitle = (result, launchCode = 0) => {
        if (result === RESULT_START) {
            document.getElementById("title-newgame")!.click();
        } else if (result === RESULT_CONTINUE) {
            // The same choice the button makes, and the same unconditional hand
            // off: no "is there a file" test, on either the pad route or the
            // pointer route into the drawn menu.
            contEl.click();
        } else if (result === RESULT_IDLE) {
            // The translated choice dispatcher selected MOVIEOP2 or MOVIEOPN.
            startMovie(launchCode);
        }
    };

    const bgImg = document.getElementById("title-bg");
    // The title is a PAL screen: it is driven by the real elapsed time of each
    // browser frame, not by the browser's frame rate. web/game.js's own frame
    // loop caps the sim at 60fps, and this loop deliberately does not — the
    // display clock turns the elapsed seconds into 50Hz fields (zero, one or
    // more per browser frame), so the title's beat counter counts 60 sixtieths
    // a second on a 60Hz panel and on a 144Hz one, as the disc does.
    let titleLastT = 0;
    const titleFrame = (t) => {
        if (state.started || title!.hidden) return;
        const dt = titleLastT ? Math.min((t - titleLastT) / 1000, 0.1) : 0;
        titleLastT = t;
        if (!movie.isOpen()) ts.tick(dt);
        playTitleSounds();
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            let drew;
            if (movie.isOpen()) {
                drew = movie.draw(titleCtx, w, h, bgm.muted);
            } else {
                drew = drawTitleScreen(titleCtx, ts, w, h, bgImg!);
            }
            if (drew !== titleNative) {
                titleNative = drew;
                title!.classList.toggle("native", drew);
            }
        }
        if (!movie.isOpen() && ts.isDone()) {
            const r = ts.result();
            const code = ts.launchCode?.() ?? 0;
            if (r !== RESULT_IDLE) ts = newTitle();
            commitTitle(r, code);
        }
        // Keep driving the title unless it is actually going away. The idle
        // reset (RESULT_IDLE) installs a FRESH screen inside commitTitle;
        // returning here without a new frame
        // left that screen frozen in its first "slide" frame, so after the
        // ~10-second idle timeout the title never came back and no input
        // advanced it. New Game / Continue close the title synchronously with
        // the fade-out class, so they still stop the loop.
        if (!state.started && !title!.hidden && !title!.classList.contains("fade-out")) {
            requestAnimationFrame(titleFrame);
        }
    };

    // ── The PAL boot screen: country / language select ────────────────────
    // The original's boot main (`f12`, called from `start.s` L51) calls
    // `F0x80016a94` through the pointer at `D0x8004b430`; that function sets the
    // current screen code to **0x1600**, and `f15` resolves library `0x16`
    // through the LBA table at `D0x80055ccc` — entry 0x16 is `0x165` (357) =
    // `CNTY_SEL.PRO`. The developer stage-select table's row for the same code
    // is labelled くにせんたく (country selection). So the language screen runs
    // BEFORE the title; its confirm writes the language byte 0x8005CCA8 and
    // hands 0xE01/0xE02 (the opening movies) to the launcher.
    const languageOpen = () =>
        cntyselNative.isOpen();
    const startTitle = () => {
        ts = newTitle();
        title!.hidden = false;
        // A title opening again starts its real-time clock fresh, so the first
        // browser frame spends no time it did not live through.
        titleLastT = 0;
        // The title theme (ttlbgm, archive 71) is NOT started here: the disc
        // starts TITLEBGM on the sequence tick's reveal cue (0x611c0000), which
        // playTitleSounds now routes to the music player. Starting it at title
        // open made that cue a no-op (the exclusive register already held the
        // same id) and left the reveal silent.
        requestAnimationFrame(titleFrame);
    };
    // Launch 0xE00 — the title screen — from a screen the game is already running.
    // wfightmn's loss exit (pro/wfightmn.s .L0x000021cc-.L0x000021dc) hands 0xE00 to
    // the pending selector through `D0x8004b440` (`F0x80016b88`, two stores), and the
    // resident machinery loads that library OVER the black the fade left behind: it
    // is a screen change, not a process restart. So the launch runs in place — a fresh
    // screen object, the title theme, the title's own input reader — and `state.started`
    // goes back to false because that is the state every pre-game screen reads
    // (`titleFrame`, `titleInput`, the pad loop's save-screen tick, the key handler's
    // memory-card branch). The field under the canvas is never rebuilt, exactly as on
    // the disc: the loss arm has no field-restore branch, so Start on this title opens a
    // new game and Continue opens the card in LOAD mode (code 0xC00).
S.launchTitleScreen = () => {
        // The screen being left is the battle (its own code is 0x600), so that
        // is the previous screen the fresh title reads back — the Japanese
        // timeout launches 0xE01 from here, whatever movie ran earlier.
        previousScreenCode = BATTLE_HANDOFF_SELECTOR;
        ts = newTitle();
        title!.hidden = false;
        title!.classList.remove("fade-out");
        state.started = false;
        // No early title-theme start here: the fresh title runs its reveal and
        // its own TITLEBGM cue starts the theme, as on the disc.
        attachTitleInput();
        // The fade HELD at black (F0x8008a83c's level is 0xFF00 and stays there) while
        // the resident machinery unloaded the battle library and loaded the title's.
        // The field under this canvas is not rebuilt, so paint the black now rather
        // than next frame: the sim loop draws it again in between, and without this
        // one frame of the field would flash between the fade and the title.
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
        }
        requestAnimationFrame(titleFrame);
    };
    // The title runs before the main dispatcher is live, so it owns its own
    // reader. `titleInput` is what the joystick calls into (see `gamepad` at the
    // bottom of this file) — the pad has to work on the title screen too, or the
    // player cannot start the game without reaching for the keyboard.
    //
    // Installed when a title is actually OPENED, not merely because the screen was
    // built: on the `?skipTitle=1` route the game owns the pad from the first frame,
    // and a reader installed there would swallow that first press (the joystick's
    // `if (titleInput) { titleInput(button); return; }` never reaches the game).
    const attachTitleInput = () => {
        S.titleInput = (k) => {
            if (state.started || title!.hidden) {
                S.titleInput = null;
                return false;
            }
            // The boot language screen owns the keys while it is up: it is drawn
            // through this same canvas but is NOT the title, and letting the title
            // state machine see the presses would queue a Start/confirm that fires
            // the moment the title opens.
            if (languageOpen()) return false;
            if (movie.isOpen()) {
                if (k === "start") movie.skip();
                else movie.retry();
                return true;
            }
            if (!titleNative) {
                if (k === "circle") document.getElementById("title-newgame")!.click();
                return true;
            }
            if (k === "start") {
                // The native title's "Press Start Button" wants the pad's START
                // button (logical 3), not Circle: F0x80085594 case 1 substate 2.
                if (ts.start?.()) playTitleSounds();
            } else if (k === "up") {
                if (ts.up()) playTitleSounds();
            } else if (k === "down") {
                if (ts.down()) playTitleSounds();
            } else if (k === "circle") {
                if (ts.confirm()) playTitleSounds();
            } else {
                return false;
            }
            return true;
        };
        window.addEventListener("keydown", function onKey(e) {
            if (!S.titleInput) {
                window.removeEventListener("keydown", onKey);
                return;
            }
            if (S.titleInput(asButton(e.key))) e.preventDefault();
        });
    };
    // The boot language screen draws through the title canvas; `#title-screen`
    // stays visible with the `native` class so the walker's own logo/buttons
    // are hidden and the canvas is displayed.
    const continueLoadFrame = () => {
        if (state.started || !saveScreen.isOpen!()) return;
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
            const t = titleViewTransform(w, h);
            titleCtx.save();
            titleCtx.translate(t.offsetX, t.offsetY);
            titleCtx.scale(t.scale, t.scale);
            saveScreen.draw!(titleCtx, 320, 240, state);
            titleCtx.restore();
        }
        requestAnimationFrame(continueLoadFrame);
    };
    const bootLanguageFrame = () => {
        if (state.started || !languageOpen()) return;
        if (titleCtx) {
            const w = titleCanvas.clientWidth || 320;
            const h = titleCanvas.clientHeight || 240;
            if (titleCanvas.width !== w || titleCanvas.height !== h) {
                titleCanvas.width = w; titleCanvas.height = h;
            }
            titleCtx.fillStyle = "#000";
            titleCtx.fillRect(0, 0, w, h);
            const t = titleViewTransform(w, h);
            titleCtx.save();
            titleCtx.translate(t.offsetX, t.offsetY);
            titleCtx.scale(t.scale, t.scale);
            cntyselNative.draw(titleCtx, 320, 240);
            titleCtx.restore();
        }
        requestAnimationFrame(bootLanguageFrame);
    };
    const skipLanguage =
        new URLSearchParams(location.search).get("skipLanguage") === "1";
    // A memory-card load and the headless shortcut both go straight into the game.
    // The title screen is built either way (see `debugSkipTitle` above): these are
    // the only two routes that never open it. The reader goes on just before the
    // route that does open it.
    if (resumeAfterLoad) {
        startGame();
        return;
    }
    if (debugSkipTitle) {
        startGame(debugMap || null);
        return;
    }
    attachTitleInput();
    if (skipLanguage) {
        // Debug: `&language=N` stands in for the byte the language screen
        // would commit. The PAL screen never opens its side pane, so its pad
        // cannot select JPN (0); this is the only way to reach that title path.
        const debugLanguage = new URLSearchParams(location.search).get("language");
        if (debugLanguage !== null) state.languageByte = Number(debugLanguage) & 0xff;
        startTitle();
    } else {
        title!.hidden = false;
        title!.classList.add("native");
        const onPick = (row, language, launchCode = 0) => {
            // The screen's own commit: the language byte it wrote to the
            // original's global. The walker ships one language, so this is
            // recorded rather than used to swap assets.
            state.languageByte = (language ?? 0) & 0xff;
            window.__bootLanguage = { row, language: state.languageByte };
            startMovie(launchCode || (state.languageByte === 0 ? 0xe01 : 0xe02));
            requestAnimationFrame(titleFrame);
        };
        cntyselNative.open(onPick);
        requestAnimationFrame(bootLanguageFrame);
    }

    if (titleCanvas) {
        titleCanvas.addEventListener("pointerdown", (ev) => {
            if (movie.isOpen()) { movie.retry(); return; }
            if (!titleNative) return;
            const rect = titleCanvas.getBoundingClientRect();
            // Same fit-and-centre transform the draw uses, inverted.
            const t = titleViewTransform(rect.width, rect.height);
            const sx = (ev.clientX - rect.left - t.offsetX) / t.scale;
            const sy = (ev.clientY - rect.top - t.offsetY) / t.scale;
            for (const r of titleOptionRects(ts)) {
                if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) {
                    if (ts.choose(r.index)) playTitleSounds();
                    return;
                }
            }
            if (ts.confirm()) playTitleSounds();
        });
    }
}
