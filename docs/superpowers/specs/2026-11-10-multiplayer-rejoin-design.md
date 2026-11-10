---
reach: Design spec (no code) for "rejoin after a drop" in multiplayer: same id, name, place and fight after a crash, closed tab or lost network.
status: written 2026-11-10 from branch integration/all. 2026-11-10: user made rejoin always on, no option. Nothing was built or run. Where the code did not settle a point it says "not known yet". Read first: docs/multiplayer-how-it-works.md (MP = web/multiplayer.js, RELAY = server/relay.mjs, ROOM = server/room-core.mjs, BAT = web/mpbattle.js, SOC = web/mpsocial.js, GAME = web/game.js, line numbers as on this branch).
---

# Multiplayer: rejoin after a drop (design)

## 1. Goal

A player who crashes, closes the tab or loses the network can come back to the same room with the same id, the same name and the same place, and to the same fight.

Today a return is a new player with a new id (ROOM:110), never the host (ROOM:115, MP:103), and cannot get back into a fight (BAT:711-719, how-it-works section 5).

## 2. Approved design

### 2.1 Seat key

- The relay makes the key (random, 128 bits, hex) when a player connects with `rj=1`, and sends it in `welcome`. A key the client made itself could be chosen by an attacker; one made by the relay cannot.
- The client saves `{ base, room, key }` in **localStorage**, key name `dw.mp.seat` (decision). Why localStorage: the goal is rejoin after a crash or a closed tab, and sessionStorage is lost when a tab closes. The room id is stored with the key, so a saved key for a different room is ignored.
- Two tabs: the relay gives the seat back only if that seat is "away". If the seat is still live (the first tab is still connected), the second tab joins as a new player and does not take the seat. No "Rejoin last room" button is needed now.
- Saved at `welcome` (MP:101-110). Cleared on Leave (MP:191-199, `disconnect(false)`), on `err no_room` and `err gone`. A new player who joined because the seat was still live saves its key only if no saved seat exists for that room (it must not overwrite the first tab's key).
- On a drop the relay keeps the seat for **2 minutes** marked "away" (id, name, map, x, y, dir, card stay). Reconnect with `key=` gives the same id, name and place. The name sent in the URL is ignored on a return.
- "Place": the relay keeps the last map, x, y, dir (ROOM:189) and returns them in `welcome.at`. After a pure network drop the page is still alive and needs nothing. Whether the game can put a player back on that spot after a page reload: not known yet (the save/load code was not read).
- **Host role (decision).** The room "host" matters only for Server Champ nights (ROOM:115, ROOM:141-146, MP:56); the fight referee is a different thing (the player whose game started the fight, BAT:11-16). When a host's seat goes "away", the host role passes at once to the next present player, exactly as today (ROOM:141-146, league closed). When the old host returns he is a normal member; nobody gives the role back. Why: no timer to wait for, no two hosts, no night that flips state; the room keeps running; the only loss is a Server Champ night (F2-only, off by default, MP:57). Seat keeping changes nothing here.

### 2.2 Faster drop detection

- Relay pings every **5 s**; a socket that did not answer the previous ping is terminated, so a silent player is found after 5 to 10 s ("about 10 s"). Today: 30 s, found in 30 to 60 s (RELAY:70-76).
- Only sockets that connected with `rj=1` or `key=` get the 5 s rhythm. This is every current client (it always sends `rj=1`). Older game versions do not send `rj`/`key` and keep the 30 s rhythm (the same interval, checked every 6th tick), so they are judged exactly as today. Reason: 10 s of silence on a bad Wi-Fi link would otherwise drop them for good.
- Whether a browser tab in the background still answers WebSocket pings within 5 s: not known yet (the browser answers by itself; not measured).

### 2.3 Retry bug fix

- Cause (read): `gotWelcome` is declared inside each `connect()` call (MP:98). A retry that fails before its own `welcome` sees `gotWelcome === false` at MP:162, falls to MP:166 and gives up after one retry. `mp.retry` is only reset on `welcome` (MP:102), which is fine.
- Fix: one flag on the shared object (`mp.hadWelcome`) set at `welcome` and cleared by `disconnect(false)` and by any `err`. MP:162 and MP:166 read it instead of `gotWelcome`. The wait formula stays `1500 * 2 ** mp.retry++` (MP:163): 1.5, 3, 6, 12, 24 s, 5 tries, about 46 s of waiting plus connect time. That fits inside the 2 min seat.
- A retry without a saved key (no welcome seen yet, or the key is gone) still joins as a new player, as today; the retries just really happen 5 times.

### 2.4 Fights

Facts used: the fight code hears only `leave` (GAME:4986-4991); a guest's own drop emits `roster`, not `leave` (MP:160); `sendRaw` returns false and sends nothing on a closed socket (MP:202); the referee holds all fight state; guests redraw from each full `st` (BAT:814, BAT:569-585).

**A guest drops (referee sees it)**
1. Relay sends `away {id}` (see 2.5). GAME:4986 handler calls new `mpbPeerAway(id)` instead of `mpbPeerGone`.
2. Referee (new `hostAway`, next to `hostGone` BAT:711): marks the guest `away` (not `fled`), clears that guest's turn timer if it was their turn, adds the id to a pause set `H.away`, starts a 60 s timer for that id, says "X lost connection. Waiting...". Broadcasts a snapshot with new field `pz` (the away ids and seconds left) so everyone's screen shows "Waiting for player" (status text at BAT:337, hint at BAT:381).
3. While `H.away` is not empty the referee does not start the next action: a gate at the top of `nextTurn` (BAT:609) and `foeTurn` (BAT:669) parks the call and remembers it. Other players' pending 45 s timers (BAT:663-667) still run; when they fire they end up at `nextTurn` and park there. One enemy action already scheduled (BAT:642, 700 ms) may still land before the gate is reached: the gate in `foeTurn` stops it.
4. The guest returns in time: relay sends `back {id}`. Guest's game (see below) sends `mpb {k:"back", fid}` to the referee. Referee removes the id from `H.away`, clears its 60 s timer, sends the **current full snapshot** to that guest (and to everyone, to clear the "waiting" text) and, if the set is empty, re-opens the gate (runs the parked `nextTurn`, re-arms the turn timer from the full 45 s, BAT:663). The guest carries on from the snapshot.
5. Not back in 60 s: the referee calls the existing `hostGone(id)` (BAT:711: marked fled, turn dropped, "X left the fight.") and re-opens the gate. A guest who returns later sends `back`; the referee, finding the player fled, answers the existing `left` message (BAT:701), and the guest leaves cleanly (BAT:815).

**A guest's own link drops (guest sees it)**
1. MP:158-167 emits a new event `linklost` (before `roster`). New `mpbLinkLost()` in BAT: keep the fight screen, show "Connection lost. Reconnecting...", disable choices, start a 60 s timer.
2. On `welcome` with `resumed: true` (MP:101-110) MP emits `linkback`; `mpbLinkBack()` sends `back` to the referee and waits up to 10 s for a `st` with the right `fid`. A `st` arrives: carry on (the normal path BAT:814 already replaces the whole picture).
3. If the 60 s timer ends, or `welcome` is not a resume, or the `st`/`left` does not come in 10 s (for example the referee runs an older game version and ignores `back`, BAT:798-811 drops unknown kinds), the guest calls `finish(false, { fled: true, hostLeft: true })` (BAT:828-860): the screen closes at once, nothing lost. There is never a stuck screen: every path ends in a snapshot, `left`, `end` or the guest's own timer.

**The referee drops**
- Referee's own link drops but its page lives: guests get `away` for the referee's id. Guest's `mpbPeerAway` sees `id === F.hostId` and shows "Waiting for referee", with a 60 s timer (`mpbPeerGone` for the referee today ends the fight at once, BAT:823). The referee's own timers stop advancing while its link is down (same gate); on `linkback` it sends `broadcast()` (BAT:580), and guests carry on.
- Not back in 60 s (decision, same wait as for a guest): the fight ends cleanly for everyone through the guests' 60 s timer, as today's non-win. No stuck screens.
- Referee's page reloaded or crashed: its fight memory (the module variable `F`, BAT:740) is gone and cannot be rebuilt (no save of it was found). Same result: guests' 60 s timer ends the fight cleanly, nothing lost.
- No referee hand-over (decision): a guest never takes over as referee (unchanged, how-it-works section 5).

### 2.5 Always on, and older game versions

- There is no setting. No OPTIONS row, no `mprejoin` key, no ship-list entry, no F2 switch, no URL flag (user decision, 2026-11-10).
- What the client always does: connect with `rj=1`, save the key, send `key=` on retries, emit `linklost`/`linkback`, show "away" players.
- **The relay still protects older game versions that do not send `rj`/`key`: they keep today's behaviour**, provided these four rules hold, which this design makes so:
  1. A seat is kept only for a socket that sent `rj=1` or `key=`. No parameter = today's code path, unchanged.
  2. `away` and `back` go only to sockets that are rejoin-aware (sent `rj`/`key`). Everyone else gets `leave` when the seat goes away and `join {id, name}` when it comes back (known messages; the client ignores unknown ones anyway, MP:99-157, so it is also safe if rules fail). So an older client sees a keyed player's drop as today (leave, then join).
  3. The roster in `welcome` sent to a non-rj joiner leaves out away seats (as if they had left, as today).
  4. The 5 s ping only for rejoin-aware sockets (2.2).
  One honest difference: an away seat still counts for the room's size (`maxPeers`, ROOM:106) and keeps an otherwise empty room alive for up to 2 min (ROOM:140). That happens whenever a current client dropped.

## 3. Exact changes per file

### server/room-core.mjs

| Where | Change |
|---|---|
| header comment ROOM:1-27 | document `rj`, `key`, `away`, `back`, `err gone`, `welcome.key/resumed/at` |
| ROOM:80-88 constructor | new option `awayMs = 120000`; state needs no new map (seats stay in `r.peers`) |
| `open()` ROOM:91 | new params `rj`, `key`. With `key`: find the peer in that room with `peer.key === key`. None, or room unknown: room unknown stays `no_room` (ROOM:105); room known but key unknown or expired: `{ error: "gone" }`. Found and away: resume (below). Found and still connected: plain new player (below). With `rj` only: new peer as today, plus `peer.rj = true`, `peer.key = random`. |
| peer record ROOM:109-112 | add `key`, `rj`, `away` (false), `awayAt`, `gen` (0) |
| resume (new) | `peer.send = new send`, `peer.gen++`, `away = false`, reset `tokens`/`last`; `welcome {id, room, host, roster, key, resumed: true, at: {map, x, y, dir}}`; roster here includes away seats with `away: true`; to other rejoin-aware peers `back {id}`; to the others `join {id, name}`; then the same position fan-out as entering a stage (ROOM:190-199) so others see me again |
| same key, seat still live (decision) | no take-over. The seat is not given back: the new socket is treated as a plain `rj=1` join (new id, new key, `resumed` absent). The first tab keeps its seat. No `err taken` exists |
| `session.onClose` ROOM:123 | takes the `gen` it was made with; does nothing if `peer.gen !== gen` (a superseded socket closing must not drop the new one) |
| `#close` ROOM:135-155 | if `peer.rj` and not already away: call new `#away` instead of the removal. `#away`: `peer.away = true; peer.awayAt = now; peer.send = noop`; `#endTrade(r, peer, "away")` (ROOM:339; client text falls back to "ended the trade." through `END_TEXT[...] ?? ...`, SOC:253, SOC:276); to rejoin-aware others `away {id}`, to the others `leave {id}`; host and league handling copied from ROOM:141-153 unchanged (host passes now; a league tamer forfeits and cannot re-enter). The empty-room delete at ROOM:140 counts present peers only while away seats exist, so the room stays |
| new `sweep()` | for every seat with `away` and `now - awayAt >= awayMs`: remove it, `leave {id}` to rejoin-aware others (legacy ones already got theirs), delete the room if no peers are left. Uses `this.now()` so a test can fake the clock |
| messages to an away seat | `#to` goes to the no-op `send`: lost, never queued. `trade`, `duel`, `coop`, `mpb` aimed at an away id fall through ROOM:249, ROOM:232 etc. as today for a missing peer only if the code checks `away`: add `if (to.away) return;` in `#direct`, `#coop`, `#mpb` and the trade ask so the sender is not told "sent" to nobody (what the sender sees is "not known yet"; today a message to a missing peer is also dropped silently, ROOM:233) |
| `#pos`, `#chat`, etc. | a message from a peer cannot come while away (its socket is closed); no change |

### server/relay.mjs

| Where | Change |
|---|---|
| RELAY:56 | pass `rj: q.get("rj") === "1"` and `key: q.get("key")` into `hub.open` |
| RELAY:57 | `err` reason `gone` is a plain string, no change |
| RELAY:59 | `ws.fast = rj or key was given` |
| RELAY:70-76 | interval 5000 ms; sockets with `fast` are checked every tick; the rest every 6th tick (30 s as today); after the loop call `hub.sweep()` |
| RELAY:31 per-IP cap | unchanged (a socket that is away is closed and already uncounted at RELAY:62-66) |

### web/multiplayer.js

| Where | Change |
|---|---|
| MP:42 `mp` object | add `hadWelcome`, `seat` (null or `{base, room, key}`) |
| MP:92-93 query | always add `rj=1`; when `want.key` add `key=` |
| MP:98, MP:162, MP:166 | retry fix (2.3) |
| MP:101-110 `welcome` | read `m.key`, save the seat to localStorage `dw.mp.seat`, `mp.want = { base, room, key }` (MP:103); `mp.hadWelcome = true`; if `m.resumed` keep my id and emit `linkback {resumed: true}` instead of the "You joined" line; roster entries read `away` |
| MP:111-113 `err` | `gone`: clear the saved seat; in-session retry then connects once as a plain join (today's behaviour, new id) and emits `linkback {resumed:false}`; page-start auto-try stops with a message. Add `gone` to `REASONS` (MP:75-81) |
| new `m.t === "away"` / `"back"` (near MP:117-125) | `away`: `p.away = true; p.hidden = true`; emit `away {id}`; `back`: `p.away = false`; emit `back {id}`. `leave` stays as is (MP:117-120) |
| MP:158-167 `onclose` | before the retry logic emit `linklost` if `hadWelcome`. The line `mp.peers.clear()` (MP:160) stays |
| MP:191-199 `disconnect(false)` | remove the saved seat; `hadWelcome = false` |
| MP:62 `peerList` | add `away` |
| MP:367-447 `installMultiplayer` | at page start, with a saved seat whose room id matches (a seat for another room is ignored): one try with `key=`; no fallback to a new player |
| MP:446 `window.__mp` | expose nothing new (tests read `mp`) |

### web/mpbattle.js and web/game.js

| Where | Change |
|---|---|
| GAME:4986-4991 | add branches: `away` -> `mpbPeerAway(d.id)`, `back` -> `mpbPeerBack(d.id)`, `linklost` -> `mpbLinkLost()`, `linkback` -> `mpbLinkBack(d.resumed)`. `leave` stays `mpbPeerGone` |
| BAT:569-576 `snapshot` | add optional `pz: { ids, s }` when `H.away` is not empty |
| BAT:337, BAT:381 | text "Waiting for player" while `S.pz` is set; choices disabled |
| BAT:609, BAT:669 | the pause gate (2.4 step 3) |
| BAT:711 | new `hostAway`, `hostBack` next to `hostGone` |
| BAT:790-818 `mpbMessage` | referee side: `d.k === "back"` -> `hostBack(from)`; guest side: nothing new (`st`, `left`, `end` already handled, BAT:812-816) |
| BAT:821 | new `mpbPeerAway`, `mpbPeerBack`, `mpbLinkLost`, `mpbLinkBack` exported next to `mpbPeerGone` |
| BAT:35 area | new constants `AWAY_MS = 60000`, `BACK_WAIT_MS = 10000` |
| pause rules | put the pure part (who is away, what is parked, which timer ends) in a new file `web/mpbattle-pause.js` with no DOM so node can test it (section 5 e) |

### web/mpsocial.js

| Where | Change |
|---|---|
| SOC:711-720 `roster` branch | the four checks (`trade`, `duel`, `partner`, `partyAsk`, `coop`) test `!peerOf(id) \|\| peerOf(id).away`, because an away peer is kept in `mp.peers` and would otherwise leave them waiting forever (no timeouts, how-it-works section 5) |
| SOC:101-109 players list | show "(away)"; "Team up" and "Trade" buttons off. Exact lines for the name label: not known yet (only the button lines were read) |

### Settings files

No change. No option, no `mprejoin` key, no ship-list entry, no F2 row. `tests/options-model.test.js` is untouched.

## 4. Edge cases

- **Two tabs, same key (decision).** Both tabs read the same localStorage key. The relay gives the seat back only if it is "away". If the seat is still live, the second tab is a new player (the relay answers a key for a live seat as a plain join with a new id and a new key; the first tab keeps its seat). A half-dead socket the relay has not noticed yet (up to 10 s) counts as live, so a return in that window is also a new player. The second tab does not overwrite the saved seat of the first (see 2.1).
- **Room ends while away.** Rooms end only when no seats are left (ROOM:140 plus `sweep`), so a room lives while any seat is away, up to 2 min. If the last away seat expires, the room is gone; a later return gets `no_room` (MP:76) and the client clears its key.
- **Relay restarts.** Rooms and seats are memory only (ROOM:85), so every key is dead: `no_room`; the client clears the key and shows the existing message (MP:111-113). A fight in progress ends through the guests' 60 s timer (the relay never sends `leave` when it dies, how-it-works section 5 and 6). Nothing is lost by the players.
- **Referee drops mid-fight.** See 2.4. Network only: guests wait up to 60 s; if the referee is back they carry on after `broadcast()`, if not the fight ends cleanly for everyone. Page gone: guests leave cleanly after 60 s. No hand-over.
- **Trade pending.** Open trade: the relay ends it with reason "away" (the other player sees "ended the trade."); on return both start again. A `trade done` already sent is the existing one-sided risk (how-it-works section 6): unchanged, not made worse.
- **Duel request pending.** The relay holds none (ROOM:228-240). The other player's dock treats an away peer as gone (SOC change above). A duel already fighting (SOC:296-308) goes on; its `result` to an away id is lost; the existing line SOC:311 ("left before finishing") applies only if the peer is gone; with an away peer it would wait. What the player sees then: not known yet; the builder should treat `away` like gone there too.
- **Team-up / co-op invite pending.** Cancelled by the same SOC change. The 14 s invite timer exists already (SOC:382, SOC:442).
- **Server Champ night.** A tamer who goes away forfeits as today and cannot re-enter (ROOM:147-153); host drop closes the night (ROOM:141-146).
- **A key that is stolen.** The key travels in the URL query of the WebSocket (`key=`). Anyone who can read it can take the seat. The relay is open to anyone who knows the room code today (how-it-works section 6: no password), so this adds no new door; use `wss://` behind a tunnel for more.
- **Rate limit.** A returning peer starts with full tokens (ROOM:111).
- **Away peer's chat bubble, emotes.** Hidden with `hidden = true` (MP:122); the 9 s stale rule (MP:30, MP:291) is not used.

## 5. Tests

All are node scripts in `tests/`, like `tests/multiplayer-relay.test.js`, which already starts the real `startRelay({ port: 0 })` and uses the built-in WebSocket (tests/multiplayer-relay.test.js:1-30). Run them with node from `~/.nvm/versions/node/v24.16.0/bin` (the same node as the running relay): `export PATH=$HOME/.nvm/versions/node/v24.16.0/bin:$PATH`. None was run for this spec.

| | Test | Runs in |
|---|---|---|
| a | A creates with `rj=1`, B joins with `rj=1`. B's socket is killed. B connects with `?room=..&key=..` within 2 min: `welcome.id` equals the old id, `resumed` is true, name and `at` equal. A saw `away` then `back` | node only (real relay + fake clients) |
| b | Same, but the Hub gets `now` from a fake clock and `awayMs`; advance 2 min, call `hub.sweep()`: A gets `leave`; a return with the key gets `err gone`. Also: a second client without `rj` sees `leave`, then `join` on return (older clients unchanged) | node only (a `Hub` with a fake `now`, passed to `startRelay({ hub })`, RELAY:33) |
| c | Client with `rj=1` stops answering pings (a raw `ws` with auto-pong off, `autoPong: false`): the other client gets `away` in under 15 s of real time. Plus: a client without `rj` that stops answering is not dropped before 30 s (check it stays for 15 s) | node only, takes about 15 s of real time |
| d | The retry: run the real `web/multiplayer.js` `connect()` in node with a fake `WebSocket`, `location`, `document`, `window` and fake timers, pointed at a closed port. Count the `new WebSocket` calls: 1 + 5, waits 1500, 3000, 6000, 12000, 24000. Before the fix the count is 2 (the bug) | node with a small fake browser; `multiplayer.js` touches `document`/`window` only in `installMultiplayer`, which the test does not call (MP:367-447). Whether its module-top imports (`fieldcom.js`, `mp-emotes.js`) load in node: not known yet. If not, make a pure `web/mp-retry.js` and test that |
| e | Mid-fight drop pauses and resumes. Part 1 (node only): relay sends `away`/`back` and `mpb` passes between two fake clients, the referee answers `back` with a snapshot that carries `pz`. Part 2 (needs the real game code): the pause gate, the 60 s timer and the guest's 10 s wait. `web/mpbattle.js` has DOM and WebGL parts (`buildUi`, `makeScene`), and no test runs it in node today (the tests that name it read its source text, `tests/mp-credit.test.js:62`); the Arena rules (`web/mpbattle-rules.js`) do load in node (`tests/mp-enemy-counter-gate.test.js:7`). So the pause rules go into `web/mpbattle-pause.js` (pure) and are tested in node with the real `Arena`; the wiring into the DOM screen cannot be proven in node: not known yet | part 1 node only; part 2 needs the real game code (the pure part in node, the screen wiring not provable without a browser, which this repo does not allow to be driven by Claude/Playwright) |
| f | Older client without `rj`: message sequence unchanged; tests/multiplayer-relay.test.js keeps passing | node only |
| g | Two tabs, same key, seat live: second connect gets `welcome` with a new id, a new key and no `resumed`; the first socket stays open and keeps its id; the room shows two seats. Then the first socket dies: the key gives the first id back (`resumed`) | node only |

## 6. Open questions for the user

None left. Decided by the user: localStorage seat key (no "Rejoin last room" button now); referee drop waits 60 s then the fight ends cleanly, no hand-over; a returning host does not get the host role back.

## Not known yet (collected)

- Whether the game can place a player on the saved spot after a page reload (save/load not read).
- Whether a background tab answers pings within 5 s.
- Whether `web/multiplayer.js` loads in node (its imports).
- Whether `mpbattle.js` can run in node at all (no test does).
- What a duel in progress shows when the other side goes away.
- Exact lines in `web/mpsocial.js` that draw the player names in the list.
