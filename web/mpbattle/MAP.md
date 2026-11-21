# web/mpbattle
The 2v2 link battle: command panel, host referee, network messages and the battle screen with its 3D scene.
Entry: web/mpbattle.ts re-exports command and net (mpbKey, mpbHost, mpbActive...) and owns installMpBattle.

| file | lines | job | main exports |
|---|---|---|---|
| command.ts | 215 | turn/timer constants, key and pick handling, command panel render | mpbKey, renderCmd, driveNative, mpbActive, TURN_MS |
| host.ts | 257 | the referee: runs the round rules and broadcasts the action log | hostBegin, hostCommand, hostGone, hostAway, people |
| net.ts | 210 | start/join a link fight, peer presence events, finish and payout | mpbHost, mpbMessage, finish, mpbPeerGone, mpbLinkLost |
| state.ts | 4 | the two-slot MB context (api + current fight) | MB |
| ui-scene.ts | 320 | the DOM screen, its CSS and the 3D fight scene behind it | buildUi, makeScene, endScene, render, mk |
| types.ts | 63 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- how long a player may think / what a button does -> command.ts
- turn resolution and what everyone is told -> host.ts
- joining, dropping, finishing a link fight -> net.ts
- the screen's markup and 3D setup -> ui-scene.ts
