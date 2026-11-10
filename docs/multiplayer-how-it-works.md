---
reach: How multiplayer (Host / Join / relay) works today, read from the code, with file:line for every claim.
status: read from branch integration/all on 2026-11-10. Nothing was run for this doc; where the code did not settle a point it says "not known yet".
---

# Multiplayer: how it works

Plain-English map of the code. It carries code behaviour only (no disc data). The older plan is
`docs/multiplayer-plan.md`; where that plan and the code differ, the code is what is written here (see "Plan versus code" at the end).

Line numbers are for the files as they are on this branch. Files: `web/multiplayer.js` (MP), `web/mpsocial.js` (SOC),
`web/mpbattle.js` (BAT), `server/relay.mjs` (RELAY), `server/room-core.mjs` (ROOM), `launcher/dw2003.py` (LAUNCH), `web/game.js` (GAME).

## 1. Pieces

**Client (runs in each player's browser)**
- `web/multiplayer.js`: the F4 panel, the WebSocket, position sending, smoothing of other players (MP:367-447 panel, MP:86-169 connect).
- `web/mpsocial.js`: chat / feed / players / inspect / trade / duel / team-up / Server Champ box (SOC:11 imports, SOC:711-736 event wiring).
- `web/mpbattle.js` (+ `mpbattle-rules.js`, `mpbattle-menus.js`, `mp-credit.js`): the many-vs-many fight. One player is the referee (BAT:1-20).
- `web/mp-league.js`: pure rules of the Server Champ night; the relay keeps the object (ROOM:28, ROOM:295-332).
- `web/game.js` hooks: `installMultiplayer` GAME:504, `installMpBattle` GAME:506-523, `installSocial` GAME:544-613, fight messages GAME:4986-4991, per-frame tick GAME:11019, other players drawn GAME:10816-10818 and GAME:11017-11018.
- `web/cardduel-net.js` is NOT connected to the relay: only its own test imports it (`tests/cardduel-net.test.js:16`; no `web/` file imports it).

**Server (the relay)**
- `server/relay.mjs`: Node program, HTTP + WebSocket on one port. Uses the `ws` package (RELAY:11).
- `server/room-core.mjs`: all room logic, no network code (the `Hub` class, ROOM:80). Header comment ROOM:1-27 lists the messages.
- `server/worker/` (a Cloudflare version named in RELAY:6) does not exist on this branch: `git ls-files server` lists only the two files above.

**Ports**
- Relay: 20031 (RELAY:33, RELAY:86; LAUNCH:563; MP:26). Env `PORT` changes it (RELAY:86). Listens on `0.0.0.0` (RELAY:33).
- Game page from the launcher: default 20030 (LAUNCH:57), bound to `127.0.0.1` only (LAUNCH:863).
- Other dev ports (8090, 8770) are not in the repo code I read. Not known yet from the repo.

**Relay HTTP side-doors**: `/info` returns this computer's IPv4 addresses and port, tagging Hamachi (25.x), Radmin (26.x), Tailscale (100.64-127.x) (RELAY:14-29, RELAY:36-40). `/health` returns the room count (RELAY:41-45).

**How Host starts**
1. F4 opens the panel (MP:440-443). "Host a game" calls `hostGame()` (MP:424, MP:172).
2. `hostGame` asks the launcher: `fetch("/__mp/host")` (MP:177). The launcher only answers localhost (LAUNCH:637-639) and runs `start_relay` (LAUNCH:575-596): if port 20031 already answers it does nothing (LAUNCH:578); otherwise it starts `node server/relay.mjs` with `PORT=20031`, no window (LAUNCH:589-590), waits up to 3 s for the port (LAUNCH:594-596), and registers `terminate` at exit (LAUNCH:593).
3. The page then connects to `ws://127.0.0.1:20031` with `create=1` (MP:179, MP:188). It also fetches `/info` to show the host's addresses (MP:181-182).
4. The panel shows addresses and the 5-letter room code (MP:341-360).

**The relay link (`?relay=`)**: opening the page as `...index.html?relay=ws://127.0.0.1:20031` skips the launcher. `testRelay()` reads it (MP:72); Host uses it instead of `/__mp/host` (MP:174-176) and Join uses it instead of the typed address (MP:427). Without the launcher and without this parameter, Host fails with "Hosting only works in the installed game..." (MP:184). The relay must then be started by hand: `node server/relay.mjs` (RELAY:3).

**How Join starts**: type the host's address and the code, press Join (MP:425-431). `wsAddress` turns "25.1.2.3" or "25.1.2.3:20031" into `ws://25.1.2.3:20031`, default port 20031 (MP:66-71). The address is saved in localStorage key `dw.mp.addr` (MP:27, MP:428). Join connects with `room=CODE` (MP:93).

## 2. Connection flow

1. Client opens `ws://base/?name=NAME&create=1` (host) or `&room=CODE` (join) (MP:92-95).
2. Relay checks: more than 12 sockets from one address gets `err busy` (RELAY:31, RELAY:55). Then `Hub.open` (ROOM:91-126):
   - create: refuses at 200 rooms (`busy`, ROOM:31, ROOM:94); makes a 5-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (ROOM:34, ROOM:45-49).
   - join: bad code gives `bad`, unknown gives `no_room`, full (50 players, ROOM:30; env `MP_MAX` can change it, RELAY:33) gives `full` (ROOM:103-106).
3. Relay makes the player record (id from a counter, name cut to 12 chars, ROOM:109-112), sends `welcome {id, room, host, roster}` to the new player and `join {id, name}` to everyone else (ROOM:116-118). If a Server Champ night is open it also sends the bracket (ROOM:117).
4. Client on `welcome`: stores id, room, host id, roster, resets retry count, announces its position straight away, goes "online" (MP:101-110).
5. No password, no version check, no other handshake. Not found in the code.

**Who has authority**
- The relay: who is in the room, the room's "host" id (the player who created it; ROOM:115), trades (ROOM:339-384), the Server Champ bracket (ROOM:290-332). It also cleans and limits every message.
- Each client: its own position, name, card, level-up news. The relay trusts them within limits (ROOM:184-189 only checks map id format and number range).
- A many-vs-many fight: the player whose game started the fight is the referee and holds all the fighter records and the rules; guests send choices only (BAT:11-16, BAT:540-545). The relay does not read fight data (ROOM:243-244).
- A duel: each side fights a computer copy of the other's team and each reports its own result (SOC:285-310). No referee.

**Lockstep or state sync?** Neither lockstep nor rollback. Field: each client reports its own position and the relay forwards the latest value (state sync, last value wins). Fight: the referee sends full snapshots; guests replace their whole picture with each one (BAT:814). Nothing is simulated twice from shared inputs.

## 3. Messages

All messages are JSON text. Every message except a card and an `mpb` must be 600 bytes or less (ROOM:33, ROOM:160); the hard cap is 8000 bytes (ROOM:32, RELAY:49). Each player may send 80 messages a second, burst 160; extra ones are silently dropped (ROOM:38, ROOM:162-164). Bad JSON is dropped silently (ROOM:167).

### Relay protocol, field mode (the normal walking game)

| Message | Carries | Sent when | Size | How often |
|---|---|---|---|---|
| `welcome` (relay to new) | id, room, host id, roster of `{id,name,map,card}` | on connect | grows with players and their cards (up to ~2000 bytes per card) | once |
| `join` / `leave` (relay to all) | id, name / id | someone joins / leaves | tiny | on event |
| `host` (relay to all) | new host id | the host left and others remain (ROOM:141-146) | tiny | on event |
| `pos` (client to relay) | map, x, y, dir, moving | timer every 50 ms checks (MP:444, MP:277-284): sends if changed and at least 100 ms since last, at once on a map change, or if 2000 ms passed since last | about 80 bytes (ROOM:32 comment) | up to 10 per second while moving, 1 per 2 s still |
| `pos` (relay to others) | same plus id | only to players in the same map (ROOM:192-200) | about 80 bytes | one copy per player in the same map |
| `at` (relay to others) | id, map | when a player's map changes, to everyone (ROOM:190) | tiny | on event |
| `gone` (relay) | id | to players of the map the player left (ROOM:194) | tiny | on event |
| `pos` extra (relay to mover) | every player already in the new map | when entering a map (ROOM:198) | 80 bytes each | on event |
| `emote` | e (0..7) | button press (MP:228-231) | tiny | on event; only to the same map (ROOM:179-181) |
| `chat` | text up to 100 chars | Enter in the dock (MP:236-246) | up to ~150 bytes | on event; relay drops a line under 600 ms after the last (ROOM:39, ROOM:206); to everyone, bubble only in the same map (ROOM:209) |
| `feed` | kind (level/quest/evolve/info), text up to 90 | level up, evolve, finished quest (SOC:571-573, SOC:596-601) | small | on event |
| `card` | free-form JSON, at most 2000 chars (ROOM:40, ROOM:222): chapter, bits, quest count, party of up to 4 with stats | a 1.5 s timer (SOC:734) sends it only when its JSON changed (SOC:604) | up to ~2000 bytes | on change; goes to everyone else (ROOM:225) |
| `ping` / `pong` | nothing | relay answers a `ping` (ROOM:169). The client never sends one (no `ping` in `web/multiplayer.js`) | tiny | never used by the game |
| `err` | reason: no_room, full, exists, busy, bad | on refused connect (RELAY:55-57) | tiny | once, then the socket closes |

### Relay protocol, social and co-op extras (used from the dock)

| Message | Ops | Notes |
|---|---|---|
| `trade` | ask, yes, no, cancel, offer (up to 12 items, bits), ok; back: ask, open, offer, ok, done, end | The relay keeps both offers and who pressed OK; any change clears both OKs (ROOM:347-384). On `done` each game moves its own items (GAME:595-610). On event only. |
| `duel` | ask, yes, no, cancel, result (hp 0..1, won) | Passed to one named player (ROOM:231-240). On event. |
| `coop` | pask, pyes, pno, pleave (team up); ask (foes up to 6, label, screens), yes, no, cancel | Passed to one named player (ROOM:258-281). A fight invite times out after 14 s on both sides (SOC:378-382, SOC:442). |
| `coop` hit / stat | enemy index + hp; my Digimon name and hp | Accepted by the relay (ROOM:273-279). The client code never sends them (no `op: "hit"` or `op: "stat"` in `web/`). Unused. |
| `lg` | open, next, win, drop | Server Champ night. Only sent when F2 switch "Server Champ league" is on (MP:255). Host-only except `drop` (ROOM:295-332). The relay sends the whole bracket on every change (ROOM:290-293). |

### Battle mode (many-vs-many fight)

Everything rides inside the relay message `mpb {to:[ids], d:{...}}` (MP:253). The relay passes `d` unread to up to 8 listed players and adds `from` (ROOM:245-251). `d` is dropped if its JSON is over 6500 characters (ROOM:246). `mpb` is allowed over 600 bytes (ROOM:160).

| `d.k` | From to | Carries | When | Size / rate |
|---|---|---|---|---|
| `setup` | referee to guests | foes, player ids and names, label, screen id, challenge, map id (BAT:773) | once, when the fight is opened (after the partner said yes) | small |
| `ready` | guest to referee | the guest's lead fighter record (`kit.pack`) (BAT:759) | once, on getting into the fight | relay comment says ~2500 bytes (ROOM:32) |
| `res` | guest to referee | one reserve Digimon record (BAT:758) | once per reserve, up to 2, before `ready` | ~2500 bytes each |
| `decline` | guest to referee | nothing | guest is busy or cannot load (BAT:793-796) | tiny |
| `go` | referee to guests | wave count (BAT:604) | once at fight start | tiny |
| `st` | referee to guests | full snapshot: round, wave, whose turn, last 5 log lines, latest event with damage rows, the lines for the message window, a plate for each enemy and player (BAT:569-579, BAT:583) | after every action and every turn start; also on wave change, forced swap, a drop (BAT:610-646, BAT:669-677, BAT:711-719) | size not measured: not known yet. Turn-based, so a few per second at most (an action takes at least 0.9 s, BAT:33) |
| `cmd` | guest to referee | one choice: fight / tech / item / dv (digivolve) / tag / run, with ids and a target (BAT:540-545, BAT:389-421) | once per own turn | tiny |
| `left` | referee to guest | nothing | that guest ran away successfully (BAT:701) | tiny |
| `end` | referee to guests | won flag, end state (BAT:726) | fight over | tiny |

Fight pacing numbers: a player has 45 s to choose, then a "took too long" run is played for them (BAT:32, BAT:664-667); the referee waits 25 s for guests to get into the fight, then starts without the missing ones (BAT:35, BAT:774); it waits for its own attack animation up to 7 s between actions (BAT:34, BAT:558-567).

## 4. Timing

- **Tick rate**: there is no network tick and no fixed game step shared between players. Position sending is a 50 ms timer (MP:444) with a 100 ms minimum gap (MP:28) and a 2 s idle beat (MP:29). The timer is separate from the render loop so a hidden window still reports (MP:258, MP:444).
- **Input delay**: none for walking (the local player moves at once; others are shown late by network time plus smoothing). Chat: with F2 "keep every line I type" a line waits so at least 650 ms pass between lines (MP:33, MP:208-219). Off by default (MP:60).
- **Prediction / rollback**: none. Other players are drawn gliding toward their last reported point: each frame moves 14 per second of the distance, capped at 1 (MP:270-271). If they are more than 140 pixels away (map change, warp) they jump (MP:31, MP:127-130). A player who has sent nothing for 9 s is hidden (MP:30, MP:291).
- **Desync detection**: none found. No checksum, hash or sequence number in `web/multiplayer.js`, `web/mpsocial.js`, `web/mpbattle.js` or the server (searched for desync / checksum / crc / rollback / lockstep: no hits). A fight cannot desync in the usual sense because guests redraw from each snapshot (BAT:814); a lost `st` is simply replaced by the next one. A lost `cmd` is not resent (BAT:544): the player waits for the 45 s timer.
- **Fight clock**: see the pacing numbers at the end of section 3.

## 5. Disconnects

**How the relay finds a dead player**
- Normal close (tab closed, Leave pressed): the socket's `close` event runs `onClose` at once (RELAY:62-66, ROOM:135).
- Silent loss (crash, network cut, closed laptop): every 30 s the relay pings every socket; a socket that did not answer the previous ping is terminated (RELAY:70-76). So the relay needs between 30 and 60 s to notice. The browser answers WebSocket pings by itself (not in the repo; standard behaviour, not checked here).
- What happens then (ROOM:135-155): the player is removed; any open trade ends for the other player with "left" (ROOM:138, ROOM:339-345); everyone gets `leave`; if the room is empty it is deleted (ROOM:140); if the leaver was the host, the oldest remaining player (first in the room list) becomes host, the Server Champ night is closed, and everyone gets `host` (ROOM:141-146); if the leaver was in a Server Champ night they forfeit that match and cannot re-enter (ROOM:147-153).

**What a player's friends see (client)**: `leave` removes the player, shows a toast and a line (MP:117-120). In the dock: an open trade ends ("The other player left."), an unanswered duel request ends, a team-up partner is cleared, a pending co-op invite is cancelled and, if I was the one asking, I fight alone (SOC:711-720).

**Crash or lost network of a player in a fight**
- A guest drops: the relay sends `leave`. The referee's game calls `mpbPeerGone` (GAME:4990, BAT:821-826) then `hostGone`: that player is marked fled, "X left the fight." is shown, their turn is dropped and the fight goes on (BAT:711-719). If the guest dropped before the fight began, they are taken out of the list and the fight starts when the rest are ready (BAT:824-825).
- The referee drops (or leaves the room): each guest gets `leave` for the referee's id and the fight ends for them at once as a non-win, nothing lost (BAT:823, BAT:828-870, `hostLeft`). A guest never takes over as referee.
- If the relay itself dies, nobody gets `leave` (it is the relay that sends it): see "Own connection drops" below.

**Own connection drops (client side)**
- `ws.onclose` clears the player list (MP:160), drops queued chat lines (MP:161) and, if the connection had once got a welcome, waits `1500 * 2^retry` ms (1.5 s, then 3, 6, 12, 24 s, up to 5 tries) and calls `connect` again with the saved room (MP:162-165, MP:103).
- Detail from reading the code: the flag `gotWelcome` is created fresh inside each `connect()` call (MP:98). A retry that fails before its own `welcome` therefore does not retry again: it sets "Could not reach your friend..." (MP:166). In practice a dead relay gets one retry about 1.5 s later. The longer waits only happen after a retry that succeeded (the counter is reset on `welcome`, MP:102). Not tested; read from the code.
- **Rejoin exists, but only as a new player.** The retry opens a new socket and the relay gives it a new id (ROOM:110, a counter). Nothing links it to the old id: no token, no saved state. If the relay still has the room it joins; if the relay restarted (rooms are in memory only, ROOM:85) the answer is `no_room`, shown as "Connected, but there is no room with that code" (MP:76, MP:111-113). A host that reconnects is a normal member, not the host (host id is set only for the creator, ROOM:115, and the retry does not pass `create`, MP:103).
- Pressing Leave closes the socket and does not retry (MP:195, MP:159, MP:434).

**Host closes the tab versus closes the game**
- Host closes only the tab: the launcher and relay keep running (the relay is started by the launcher, LAUNCH:589, and stops only at launcher exit, LAUNCH:593). The relay removes the host's socket; the room stays; the next player becomes host (ROOM:141-146).
- Host quits the launcher: the relay is terminated by the exit handler (LAUNCH:593), so every player's socket closes. If the launcher is killed hard, whether the relay survives is not known yet (the exit handler may not run; not tested). Players then see "Connection lost" or the retry message above. This case is what the older plan says ("the room ends", `docs/multiplayer-plan.md`); it is true only for this case.

**Timeouts that exist**: relay ping 30 s (RELAY:76); per-address socket cap 12 (RELAY:31); hide a silent player after 9 s (MP:30); client retry waits 1.5 s up to 24 s (MP:163); co-op invite 14 s (SOC:382, SOC:442); fight: choose in 45 s, guests ready in 25 s, animation wait up to 7 s (BAT:32-35). No timeout was found for: a trade left open, a duel request left unanswered (SOC:332 only offers Cancel), a team-up request (SOC:392). Not known yet whether anything else clears them.

**Fight stuck case (read from the code, not run)**: when the guest's OWN connection drops mid-fight, `ws.onclose` emits `roster`, not `leave` (MP:160), and the fight code listens only for `leave` (GAME:4990). No guest-side timer exists in `web/mpbattle.js` (all timers: BAT:292, 549, 624, 666, 774, 863). `send()` (BAT:540-545) goes through `sendRaw`, which returns false and sends nothing when the socket is closed (MP:202). After a reconnect the guest has a new id, which the referee does not know (BAT:800 `F.ids.includes(from)`). So the fight screen on that guest seems to stay on the last snapshot until it ends some other way. What the player can do to leave: not known yet.

## 6. Weak spots (facts only)

Bandwidth and CPU
- Position messages fan out: one `pos` from a player is sent to every other player in the same map (ROOM:192-200). With N players walking in one map that is up to N x (N-1) x 10 messages a second out of the relay.
- Each `pos` is a separate `JSON.stringify` per receiver (ROOM:130, called in the loop at ROOM:195). The message text is the same for all.
- `card` can be ~2000 bytes and goes to everyone in the room, not only the same map (ROOM:219-226). It is re-sent whenever any value in it changes (SOC:604); it includes HP and MP (GAME:528-542 `mpCard`), so it changes after fights and heals.
- `welcome` carries every player's card (ROOM:113, ROOM:116).
- `ready` and `res` are ~2500 bytes each, up to 3 per guest per fight (BAT:758-759, ROOM:32).
- `st` snapshots are rebuilt and sent in full after every action and turn start (BAT:580-584). Size not measured: not known yet.
- The Server Champ bracket is sent whole to everyone on every change (ROOM:290-293, only with the F2 switch on).
- A page-wide 50 ms timer runs forever once multiplayer is installed, even when offline (MP:444, MP:278 returns early when offline). A 1.5 s timer and a 400 ms timer run in the social box (SOC:734-735).
- The relay has no limit on rooms' total players per relay beyond 200 rooms x 50 players (ROOM:30-31). Each message passes JSON.parse (ROOM:167).

Drops and breaks
- Rooms, trades and brackets live in relay memory only (ROOM:85-87). A relay restart ends every room.
- Rejoin is a new id and not the host (see section 5). A fight member who drops cannot come back to that fight (referee marks them fled, BAT:711-719).
- Fight stuck case above (BAT:540-545, MP:160, MP:202).
- Relay death gives no `leave` to anyone, so an in-progress fight has no end signal for the surviving referee or guests except the stuck case above. Not run: read from the code.
- A lost `cmd` is not resent (BAT:544); the turn ends by the 45 s timer (BAT:664-667).
- `trade` "done" is sent to both players once (ROOM:378-381). Each game then applies its own side (GAME:595-610) with no reply to the relay. If the socket of one side fails just after `done` was sent, the other side has applied and this one may not. Not known yet whether this can happen in practice.
- Trades, duels and team-up requests have no timeout (section 5). A duel result is trusted from each client (SOC:302, ROOM:235-238).
- The relay silently drops a message that is too fast, too long, or not valid JSON (ROOM:159-168). The sender is not told.
- Any friend can type any address: no password. Anyone who can reach port 20031 and knows the 5-character code can join (ROOM:91-126; the alphabet has 32 characters, 5 places, ROOM:34-35).
- The relay listens on all network cards (RELAY:33), while the launcher's page server listens only on localhost (LAUNCH:863).

## Plan versus code

`docs/multiplayer-plan.md` differs from the code in these places:
- It says "Rooms of up to 8". The code allows 50 per room (ROOM:30). 8 is the limit for a fight's `to` list and for a Server Champ night (ROOM:247, ROOM:309).
- It says the room ends if the host's game closes. True only if the launcher exits; closing only the tab leaves the relay running and passes host to the next player (section 5).
- It lists `chat feed card at trade duel coop mpb` as relay messages; the code also has `lg`, `host`, `gone`, `emote`, `pos`, `ping` (ROOM:7-26, ROOM:157-182).
- Its header says "built on experiment branch `experiment/multiplayer-relay`". This doc was read from `integration/all`.
- It does not say that a reconnect exists. One exists (MP:162-165) but as a new player.

## Not known yet

- Size in bytes of a fight snapshot `st`.
- Whether the relay survives a hard kill of the launcher.
- What the player can do to leave a fight screen after their own connection dropped.
- Over a real Hamachi/Tailscale link between two computers: the plan says it was only tried on one machine; nothing in the code settles this.
- Whether a `trade done` can be applied on one side only in real use.
- What clears an open trade, duel request or team-up request when the other player simply never answers.
- The dev ports 8090 and 8770 (not in the repo code I read).
