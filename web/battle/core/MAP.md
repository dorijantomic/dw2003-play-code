# web/battle/core/
The battle object's methods, one factory per file: `makeX(B)` returns methods and web/battle.ts:465 Object.assigns all 21 onto B.
Nothing re-exports these; each file's only export is its makeX factory.

| file | lines | job | main exports |
|---|---|---|---|
| counter.ts | 281 | a technique's result at action end: pending impact, contact damage, counters, Frozen gate | makeCounter |
| dna.ts | 402 | DNA/Jogress: table reader, fused form, choice, script chunks, restore and impact | makeDna |
| draw.ts | 287 | the battle frame's draw(): backdrop blends, effects, HUD compose, scripted screens | makeDraw |
| end.ts | 436 | battle outcome: win/lose, next boss-party entrance, drops/steal, encounter roll | makeEnd |
| enemy-action.ts | 512 | the enemy turn: AI move pick, technique run, flee, participant progress | makeEnemyAction |
| finale.ts | 142 | Galacticmon finale beats: tail defeat, then body and head, copied technique | makeFinale |
| flow.ts | 512 | after-action queue, result pages, damage specs, boss phase, display frames | makeFlow |
| forms.ts | 235 | Digivolve form list seed, form panels, DNA answer panes | makeForms |
| fusion.ts | 195 | new Fusion-boss content: two halves fuse into one boss; Tag/DV actions | makeFusion |
| hud.ts | 438 | HUD painting: menu notice, list chrome, plates, pips, item/tech rows | makeHud |
| input.ts | 306 | handleKey: pad through result pages, command menus, message close | makeInput |
| load.ts | 156 | battle data load: encounter pick, enemy profile/HP, steal, rewards | makeLoad |
| menus.ts | 320 | the six commands' list seeds and confirms: Fight, Tech, DV, Tag, Item, Run | makeMenus |
| message.ts | 396 | the message line and HP-plate clock: say, opening steps, loss session | makeMessage |
| native.ts | 142 | native overlay chrome: fight panes, text, HP bars, pips | makeNative |
| opening.ts | 468 | entry, fullscreen/3D init, Blast cinematic, entrance, forced dedigivolve | makeOpening |
| player-action.ts | 529 | the player's chosen action: attack, technique, item, tag, DNA | makePlayerAction |
| records.ts | 410 | combat records: enemy/player record build, stats, evolutions, party form state | makeRecords |
| report.ts | 164 | draws the STFGTREP fight-report screen | makeReport |
| start.ts | 296 | battle start: screen to party, music, model swaps, startRandom/Screen/Party | makeStart |
| update.ts | 527 | the frame: dt speed-up, 3D scene, message clock, report build | makeUpdate |
| types.ts | 45 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- the per-frame battle loop -> update.ts
- a key press becoming a menu action -> input.ts
- what happens after a result page -> flow.ts
- the enemy picking its move -> enemy-action.ts
- starting a battle from an encounter -> start.ts
