---
reach: Optional multiplayer for the browser port - how friends meet over Hamachi/Tailscale, what is shared, and what is not done.
status: built on experiment branch `experiment/multiplayer-relay` (nothing here is original-game behaviour).
---

# Multiplayer

Written 2026-10-14. **New, optional layer on the shipped game.** It does not change the story or the battle rules and
it never writes a story flag. No accounts, no cloud service, nothing to deploy.

## What the player does

**Host** (one player in the group):
1. Press **F4**, click **Host a game**. The game starts a small server on this computer (the launcher does it).
2. The panel shows this computer's address (Hamachi / Radmin VPN / Tailscale / local network, named) and a five-letter code.
   Tell your friends both.

**Friends:** press **F4**, type the host's address and the code, click **Join**.

You then see each other walking around the same places, with name tags, and can send small emotes (8 buttons).
Players in different places are not shown to each other; walking into a place shows who is already there.

Everyone runs their own game from their own disc, with their own story, saves, party and battles. Only names and
positions travel. There is no shared inventory, money or quest state yet.

## How friends reach the host

Like any LAN-style game: all players on one network. For friends in different homes that means **Hamachi, Radmin VPN
or Tailscale** (each player installs one and joins the same network once), or the same Wi-Fi. The host's panel lists the
address on that network and says which program it belongs to. The game page is served over plain http from this
computer, so the browser allows the `ws://` connection to the host.

The first time a host starts the server, Windows asks whether `node` may use the network: say yes (private networks).

## How it works

- `web/multiplayer.js` (client): the F4 panel, the connection, sending where you are (about 10 times a second while
  moving, once every two seconds standing still), gliding other players smoothly, drawing them. Hooks in `web/game.js`:
  `installMultiplayer`, `multiplayerTick` (in `render()`), and the ghosts are pushed into the field's depth-sorted
  `drawables` list and drawn with the same sprite call as the player (`drawEntitySprite`), the name tag at the game's
  own balloon anchor. Other players currently look like the player character, standing or walking only.
- `server/room-core.mjs`: the room logic, no I/O. Rooms of up to 8, codes without look-alike letters, positions only
  forwarded to players in the same stage, input checked, 80 messages a second per player.
- `server/relay.mjs`: the relay as a Node program, port 20031. `/info` lists this computer's addresses (it recognises
  Hamachi 25.x, Radmin 26.x, Tailscale 100.64-127.x). Run by hand with `node server/relay.mjs` if you like.
- `launcher/dw2003.py`: `/__mp/host` (this computer only) starts the relay with the bundled Node when the Host button
  asks. It stops when the launcher closes.

The relay sees only: the display name, the stage id, x/y, the facing and emote numbers. It never sees game data.

## Checked

- `tests/multiplayer-room.test.js` (room logic, 9 tests) and `tests/multiplayer-relay.test.js` (real sockets).
- `tools/verify_multiplayer.mjs`: two separate browsers, real clicks and typing: host, the address list, join by typed
  address and code, typing in the panel does not walk the character, the ghost appears at the right place facing the
  right way, emotes, leaving, a wrong code. 12 checks.
- The launcher's `start_relay` was run for real: starts the bundled-style Node relay, is idempotent, `/info` answers.

## Not done

- Not tried over a real Hamachi/Tailscale link between two computers (only on one machine), nor on macOS/Windows.
- Other players as their own Digimon or character instead of the player sprite; ladders, fishing and other poses.
- Saves and quest progress on the server (they stay in each player's browser).
- Co-op credit for the partner's quest *challenge* objectives (their kill objectives do count; challenges only credit the one who started it).
- A public room list, accounts.
- If the host's game closes, the room ends; friends see "Connection lost".

## Social layer, duels and co-op (added 2026-10-14)

- **Dock** (bottom left, once in a room): ALL / CHAT / EVENTS / PLAYERS. Chat lines show in the game's own speech balloon over the
  speaker (one balloon per player). Events: level ups, digivolutions, finished extra quests, joins. Names are the character names as typed.
- **Players**: level, lead Digimon, where they are; Inspect (the player card: party, HP/MP, stats, BIT, quests), Trade, Duel, Team up, Go there.
- **Trade**: both press Confirm on the same offers; the relay then says "done" and each game moves its own items (item store only).
- **Duel**: each side fights a computer-played copy of the other's team (from their card); EXP/drops/BIT are taken back; the better result wins.
- **Co-op** (side quests and wild fights only; the main story stays solo): after **Team up**, a quest challenge fight or a wild
  encounter is offered to the partner (wild = two Digimon). If they Join, it runs as a **many-vs-many fight** in the game's own
  **3D battle scene**. The game's own one-on-one battle is untouched; this is an extension that reuses the engine:
  - **Picture** (`web/battle3d.js`): the renderer takes any number of extra fighters (`addFighter`, `fighterAttack`, `fighterReact`,
    `fighterTech`, `fighterAction`, `fighterVictory`, `setMultiCamera`, `getFighterScreen`), each with its own model, texture, skeleton,
    eyes and `ActorAnimator`, standing in a lane. Attacks go through the same `FightCoordinator`, so the real attack clips,
    reactions, op3 effects, op6 projectiles and special-attack backdrops play, shifted into the right lane. A wide camera frames everyone.
  - **Rules** (`web/mpbattle-rules.js`): the game's decoded battle routines, run for any number of fighters on each side:
    the action timeline (`actionTimelineDelay`), the enemy AI (`pickEnemyAiMove` over the species' own move rows, with the real list
    of enemies standing, and its flee action), the damage / accuracy / critical resolver (multi-hit, drain), ailments from techniques
    and weapons, instant death, counter stance, start-of-turn sleep / frozen / confusion, the shared status-event pool (poison ticks,
    recoveries, buffs wearing off), gradual HP recovery, heal and buff techniques (category 4 and 5 plans), items (`useBattleItem`
    and the plain charges, a revive item can target a downed friend), the run roll, manual digivolve (`setLiveBattleForm`), the
    game's own battle strings (esmfight bank) and the EXP / BIT payout (`battle.mpKit()`). Not the game's: enemies weigh up
    targets (the wounded, the helpless; a counter stance is avoided), and a spread technique (magical, 40+ MP) hits everyone on the
    other side at 65%.
  - **Who runs it** (`web/mpbattle.js`): the player who started the fight is the referee. Every player sends their fighter record
    when they get in; the referee holds them all, runs the rules, and sends everyone one small snapshot after each action (with
    "who attacked whom" so every screen plays the same animation). Guests send only their choices (Fight / Tech / Item / Digivolve /
    Run and a target). If the referee runs away they stay on as the referee, watching.
  - Boss strength (x1/x2/x3 HP, a little more attack) is the setting at the top of the PLAYERS tab.
  - Each player gets the disc's EXP/BIT payout and keeps the HP the fight left; a lost fight costs nothing. The battle track plays.
  - The partner who joins a quest challenge is credited for the same open challenge.
  - **Party and Tag** (`#tag` in the rules): each player brings their whole party (up to three Digimon; the reserves are sent to the
    referee as `res` messages before `ready`). The Tag command swaps the Digimon in the fight (the game's Tag: the outgoing one's Blast
    is forfeited, its timers do not follow it). A Digimon that falls is replaced from the reserves at once, the player is asked which
    (the forced Tag; it costs no turn); with none left standing the player is out.
  - **DV gauge and Blast**: every Digimon has its own gauge (`hitGaugeGain`: it fills from the hits it takes, not on a KO, not in a
    Blast). A full gauge is the automatic Blast: the Digimon takes its Blast form (`blastTargetId` from its rookie's `blasts` by level
    tier), is fully healed, fights MP-free for six of its own turns, then returns ("Blasted!" / "Back to normal!" from the game's
    strings) and the gauge is spent. The gauge is written back with the Digimon's HP after the fight. Plates show it as a thin bar.
  - **Stealing**: a steal technique that lands runs the disc's steal roll (`stealProc`) for the enemy's drop item; the item goes into
    the thief's own bag through the game's item store (the referee's snapshot says who stole what).
  - **The game's own menus and message window** (`web/mpbattle-menus.js`): the command list, TECH, ITEM, Digivolve form list and TAG
    list are the same translated pro/fightstg screens the one-on-one battle opens, opened over the 3D scene on a 320x240 overlay and
    driven by pad buttons (keyboard, an on-screen pad, or a gamepad). What happens is told in the game's own message window, one
    line a page ("Name" above the text). Choosing a target (which enemy, which friend) is the one thing the game has no screen for:
    a marker moves over the plates (arrows, circle, cross, or a click). Without WebGL the plain buttons and cards come back.
  - Not done: boss "special modes" (the finale), the DNA pane that follows Tag in the one-on-one battle, the Blast transformation
    cinematic, enemy AI conditions the engine does not support.
- Relay messages: `chat`, `feed`, `card`, `at`, `trade`, `duel`, `coop`, `mpb` (see `server/room-core.mjs`). Tests: `tests/multiplayer-social.test.js`, `tools/verify_multiplayer_rules.mjs` (the many-fighter rules, one by one, plus 40 random whole fights),
  `tools/verify_multiplayer.mjs`, `tools/verify_multiplayer_battle.mjs`, `tools/verify_multiplayer_fight.mjs` (a real 2-vs-2 fight, played through the buttons; `HURT=1` for the enemies-hit-back case).
