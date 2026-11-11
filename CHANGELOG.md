# Changelog

Newest first. Player-facing notes for each release are in `packaging/RELEASE_NOTES.md`.
A feature marked "off for players" is not in the installed game: it is hidden and forced off there (`web/ship-list.js`) and shows only on a source checkout under F2.

## Unreleased

Not yet in a release. No `v0.1.4` tag exists; the commits below are in the tree but were left out of the v0.1.4 section.

### Battle
- Digivolve, Blast and de-digivolve follow the original change task: same timeline, camera, flash, wipe, effects and music frames. Blast and manual changes use the original change stages MEFT1028 / MEFT1031.
- The FRONT effect layer is placed as in the original. Effects that belong under the fighters are drawn under them with the original blends (opaque, half, add, subtract, quarter).
- A tag, a KO replacement and the next enemy play the entrance. An enemy can tag itself out, as in the original.
- The HUD draws a square for each member of the enemy team.
- After a KO the next team member comes in (before, the battle was won after the first KO).
- Pages after an entrance (tag, KO replacement, enemy self-tag) appear on frame 301 as in the original, over the camera glide. A Tag turn is timed with the outgoing Digimon's speed; a KO replacement adds no turn.
- Helter Skelter (Persiamon) de-digivolves the partner to its base form with the entrance and "Digidevolved!", as in the original; the base-form check reads the fighter id.
- The change stages turn their parts with the original's whole-number key blend and Rz*Ry*Rx order (model_mesh.c); they are unlit, as on the disc.

### Field
- Firefox speed: grass copied once per frame, the field is not drawn under a battle, the 3D battle has its own layer; field 12 -> 172 fps, battle 10 -> 63 fps in Firefox at 960x720 (c880c2be5).

### Online
- A dropped player keeps their seat for 2 minutes ("away") and can come back to the same id, name and place; Leave frees the seat at once. The relay checks rejoin-aware games every 5 s.
- A multiplayer fight waits for an away player (60 s) and shows "Connection lost. Reconnecting..." on the dropped side.

### Installer and build
- HD Remaster in the setup page (on by default), built in the background while playing; the upscaler runs on ONNX Runtime and a full HD pack takes about 20 min instead of 52+ (1b798fde8).

### Under the hood
- Dev tools: a "Bosses & tamers" list with the 213 scripted battles, each with its full team.

## v0.1.4 (2026-11-10)

256 commits since v0.1.3. Known issue: the macOS build fails on GitHub (runner macos-14 unsupported), so there is no Mac download in this release.

### Battle
- Hit chance (accuracy byte), critical hits and item drop rolls follow the original and are always on, no switch (bf8981386, a68e5ec96). The five stat-rule cards are recomputed and the card ids pinned by a test (5571cc9d8).
- Battle speed x1 / x1.5 / x2 / x3, one scaled battle step (6c9a1eee4). Shown in OPTIONS.
- Multiplayer fights run in the game's own 3D battle scene on the game's own rules (AI, status, items, heals, digivolve); many-vs-many (90f72f497, 116681b3b, 276d414a5). Win screen pays per Digimon like the original; damage and heal banner uses the game's two-line message.
- The 135 enemy-only species can be raised as forms, with a built clip when a technique has no clip of its own (87f5b9175). A fight that teaches such a form says so (a1bc0c1b2, ba75eb682).
- Enemy-authored attack scripts are turned around when the player owns the model (517529c88). Battle camera fits enemy-only models on our side (99455de7a, 1402b0f1c).
- Duplicate-code merges that fix disagreements (85e5fece2):
  - One function gives a partner's own numbers; menu, battle and gym read it.
  - Worn gear adds to element resistance; set bonus is kept after DRI Form/Switch.
  - The battle ailment byte includes the flee and digivolve lock bits.
  - Online battle: the enemy counter stance goes through the one gate.
  - Blast ending and the Blast level table are in one place.
  - Battle stats code is in one place.
  - The battle digivolve panel and confusion text use the partner's own row.

### Field
- Weather, light, grass, water, reflections and sound: the "experiment" effect layers from 2026-10-10 to 10-13 (764c51708, 5e8becb2c, a23fa4003, 009d82dd9, a17ee8aad). Players get the weather, terrain, atmosphere, ground and sound switches; villagers, the HD-2D look and battle sky stay off for players.
- HD Remaster maps load in 1024 px tiles; grass, water and tree sway read the native map picture (dcd74c565).
- Random-fight rate dial ("Fewer / Normal / More") on the game's own step counter (3ef74740a).
- Pixel filters (EPX / MMPX / xBR) from OPTIONS (1b26b377f).

### Menus and screens
- New OPTIONS and GLOSSARY pages on the pause menu (85e5fece2); QUESTS row and page on the pause menu (8b47fd02f, 0b7c84e00, 6ed44e192).
- Fades share one step function; the folder-selection fade can no longer hang (card 07).
- Translated and native screens share one open/close host and adapter; the battle menu adapter is shared; roster record read/write and the name encoder are one each.
- Card limit is one constant (ids 1..314), save keeps the whole table.
- Shop money write is clamped to the money cap.

### Quests
- Quests are on for players. About 240 quests in `web/quests.json`: packs for the Central Park and West (Byakko) areas, the Asuka area, flagship jobs with a choice at hand-in, a wanted board, scripted scenes with walking NPCs (3883a233a, ba878334f, 109060bd0, 412da0b4d, 50591f7dd).
- Quest triggers (walk-in), emote steps, place cards, arrival scenes and the "Second job" picker are on for players (127c7c625, 67e3ed21f, 3920aaa2d, 100e64587, ae4b21bb1).
- New quests: Card 315 (a5e3a6bec), The DDNA Mix-Up (f544af6f6), The Bridge at Golden Hour (5c5aa6638), The Lost and Found (e27eb38bf).
- Quest scenes can set an actor's clip (SETANIM) and draw the player behind the map band (cb64820b6, f5c5a8a2a).
- A red `?` over a character with a job and the game's `!` over one who can pay (c1e7083b0). Leomon hands out the first jobs (ebae0288f).
- Only listed quests ship; Ren, Cipher, Moss, Maintenance Tech and Runner and their quests were removed (000c8f29a, 5c3885cd5).

### Online
- F4 host and join over Hamachi, Radmin, Tailscale or LAN; the launcher starts a small relay; players walk in each other's maps with name tags and emotes (972f9705f).
- Chat, activity feed, player cards, inspect and trading (772da07f1); duels and co-op fights with shared enemy HP (884ea5e25); partner credited for quest challenges (3c9bb7aa0).
- The game's own reaction bubbles over a friend's head, and a co-op win counts for both tamers' quests (950e852de, 596fc7d5a). Both are on for players.
- Not on for players: Server Champ league (39d6f348d), chat queue (812c74602).

### Installer and build
- The release bundle includes jype's dw2_model_converter (MIT, pinned commit) for the optional DW2 extras page; the DW2 battle animations are built on the player's PC from both discs (e12d957f5, c0d73891e).
- The release workflow writes a marker file that tells the installed game from a checkout (`web/installed-build.js`).
- The launcher gets a "Host a game" relay endpoint and the DW2 extras page (`launcher/setup/extras.html`).
- README: Discord invite, keyboard and gamepad controls (c37de70bc).
- `build_all.py` has an extra-species stage (135 enemy-only species, fixed ids from 56).

### Under the hood
- Not on for players (hidden in the installed copy, F2 on a checkout): Mount (ride a quest's Digimon), Fusion bosses (Millenniummon), boss phases, boss music, "the boss grows", Giant mode, Elemental field war, "a feeling before a fight", enemy tells and pattern breaker, painted battle backdrops, toon outline and shade, smooth cut-out edges, 2 vs 2 practice, Server Champ league, villagers.
- Not on for players, developer pages under F2 -> Extras: Digimon Codex (partner, wild, encounter, loadout, drop, battlefield and clip tabs), Blast ladder, Next forms planner, Move theatre, Cut-content gallery, Stage select, Sound test, Soundtrack room, Cinema, Language desk, Damage Lab, Item source book, Gym map, Silence report, Item rulebook, Cursor almanac, Weapon effects, BIT ledger, Save X-ray, Card verify, Replay theatre, Counter redirects, Arrival lab, Angler's almanac. Extras screens open from an F2 button, not on page load; Escape closes them (1c3da04ba).
- Dev tools, no game change: quest editor and paths, State Shelf lab page, Dry Run, Say It Back, Every Ending, NPC dialogue-state explorer, Explorer census, quest DSL helpers for bubble and place card, animation viewer and retarget tools (ab0060cad, e5ba054f7), sprite and partner-from-model tools.
- Card Duel PvP part 1: protocol only, nothing to switch on (fb2aca342). Quartermaster part 1: pure module (fc1be3200). Fused-forms and playability checkers (e6e952085, 0a8dcaa65).
- New partners (DemiDevimon, Betamon / Kunemon, Hagurumon, Goburimon) were built (6d6a04e0b and later) but are parked in `new_starters.json` (000c8f29a). Not in the game.
- Duplicate-code work (cards 01-19) merged copies into shared modules; some copies stay until the engine bundle may be rebuilt. Left open: save-address and helper declarations, 3D/GLTF maths.
- Walker syncs merged: ded816e59, b981cc63d (eb77b2c56, 4b63673ea).
- `web/vendor/engine.js` is generated; adding an engine export needs `tools/build_engine_bundles.mjs`.

## v0.1.3 (2026-10-11)
- Sync with walker master (PR #3).

## v0.1.2 (2026-10-10)
- One-click installer (PR #2).

## v0.1.1 (2026-10-10)
- Sync from walker: the Galacticmon finale, ending movies, critical-hit and accuracy rolls.

## v0.1.0 (2026-10-10)
- First release.
