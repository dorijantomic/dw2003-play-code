# engine/systems/card-battle
The card duel engine (the in-game card battle, not 3D fights): duel state, phase machine, program-card effects, AI, summon/load-compile turns, set transfer, collection.
engine/systems/card-battle.ts is a pure re-export barrel — start there, everything is public.

| file | lines | job | main exports |
|---|---|---|---|
| ceremony-ops.ts | 271 | runs a phase's ceremony opcode stream, carrying state between ops; ends the duel | applyCeremonyOp, finishDuel, CeremonyRun |
| collection.ts | 287 | the card collection: owned/seen counts, packs, folders, save form, folder legality | createCollection, grantPack, ownedCount, folderIsLegal, sortFolder |
| combo-damage.ts | 617 | combo runs, damage and queued stat ramps, the battle walk and per-set transfer | resolveBattle, settleStats, battleAward, comboRunScore, applyBattleDamage |
| duel-ai.ts | 395 | duel agents by AI class: hand sorting, board evaluation, greedy picks | agentFor, sortDuelHands, aiWorthPlaying, evaluateBoard, simpleAgent |
| duel-phase.ts | 278 | advances one phase and runs the button-gated beat queue | tickDuel, stepPhase, duelBeatBusy, dismissBeat |
| duel-state.ts | 760 | duel state: sides, field slots, energy, deck/hand/trash ops, totals, summoning | createDuel, recomputeTotals, canSummon, summonFromHand, phase |
| effects.ts | 669 | Program-card targeting/effect tables, legality, hand-discard and choice prompts | canPlayProgram, indexEffects, applyProgramEffect, playProgram, fieldTargets |
| program-turns.ts | 315 | the Load/Compile turn, an exchange rather than a single action | beginProgramTurns, playProgramTurn, pumpProgramTurns, tickProgramTurns |
| set-end.ts | 171 | between sets: field to trash, hand to deck, reshuffle, retire the opened tier | endSet, openDeckForSet, firstUnavailableSlot |
| summon-turns.ts | 230 | the Summon Phase's turn exchange and committing marked summons | beginSummonTurns, takeSummonTurn, commitSummons, canSummonAny |
| types.ts | 214 | card/duel constants and shared record types | ENERGY_COLOURS, DUEL_PHASES, HAND_LIMIT, SETS_TO_WIN, FOLDER_SIZE |

Where to look for:
- turn/phase order or a phase that stalls -> duel-phase.ts (tickDuel, stepPhase, duelBeatBusy)
- a Program card that does nothing or hits the wrong thing -> effects.ts (indexEffects, applyProgramEffect)
- damage numbers, combo scoring, a card that will not die -> combo-damage.ts (+ duel-state.ts queued stats)
- deck/hand/field/energy rules -> duel-state.ts
- what resets between sets / deck not reshuffling -> set-end.ts
