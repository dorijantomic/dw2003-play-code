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
  **3D battle scene** (`web/mpbattle.js`): every player's lead Digimon on one side, all the enemies on the other, in waves of at
  most max(2, players). The game's own one-on-one battle is untouched; this is an extension of it.
  - **Picture:** `web/battle3d.js` now takes any number of extra fighters (`addFighter`, `fighterAttack`, `fighterReact`,
    `fighterVictory`, `setMultiCamera`, `getFighterScreen`): each has its own model, texture, skeleton and `ActorAnimator`, stands in
    a lane beside the others, and is posed, shadowed, framed and sequenced by the same renderer code. Attacks go through the
    same `FightCoordinator` (it already takes any two animators), so the real attack clips, hit/death/dodge reactions, op3 sprite
    effects, op6 projectiles and the special-attack element backdrops all play; effects authored for one fighter per side are
    shifted into the attacker's / target's lane. A wide three-quarter camera frames everybody. With no WebGL it falls back to cards.
  - **Numbers:** `battle.mpKit()` hands out the engine's own fighter records, damage / accuracy / critical rolls, tech lists and
    prices, and the EXP and BIT payout, so they match the normal game.
  - Turn order by speed. On your turn: Fight / Tech / Run. Your game rolls your damage; an enemy's attack is rolled by the
    *target's* game against its real defence; the host (the player who started it) keeps the order and sends one small snapshot
    after each action, including who attacked whom, so every screen plays the same attack.
  - Spread techniques (magical, 40+ MP) hit every enemy (or every player) at 65% damage.
  - Boss strength (x1/x2/x3 HP, a little more attack) is the setting at the top of the PLAYERS tab.
  - Each player gets the disc's EXP/BIT payout for the fight and keeps the HP it left; a lost fight costs nothing.
  - The partner who joins a quest challenge is credited for the same open challenge.
  - Not done: items and healing in the fight, more than two players per party, per-fighter eye-blink texture animation, battle music.
- Relay messages: `chat`, `feed`, `card`, `at`, `trade`, `duel`, `coop`, `mpb` (see `server/room-core.mjs`). Tests: `tests/multiplayer-social.test.js`,
  `tools/verify_multiplayer.mjs`, `tools/verify_multiplayer_battle.mjs`, `tools/verify_multiplayer_fight.mjs` (a real 2-vs-2 fight, played through the buttons; `HURT=1` for the enemies-hit-back case).
