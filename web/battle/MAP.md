# web/battle/
Battle rules split out of web/battle.ts: damage, rewards, messages, HUD geometry, menu lists, reports, status/restore plans.
web/battle.ts imports these; it re-exports most names (`export { ... } from "./battle/*.js"`), so old `battle.js` imports still resolve.

| file | lines | job | main exports |
|---|---|---|---|
| core/ (folder) | — | the battle object's own methods, one factory per file | see core/MAP.md |
| form-blast.ts | 414 | Blast/DV form rules: gauge, form change, learn pass, giant scaling, vitals write-back | applyFormLearnPass, setLiveBattleForm, battleKindOf, persistPlayerGauge, writeBackBattleVitals |
| gym.ts | 136 | Gym drills by rank, stat ids, training/ultra rolls and results | gymDrillsForRank, gymStatForId, gymSessionResult, applyGymEffects, ultraChanceRoll |
| hit-results.ts | 238 | one attack resolved: hit/crit/evade, multi-hit, ailment, result pages | effStats, resolveAttack, resolveMultiHit, tryInflict, processTurnStart |
| hud.ts | 244 | HUD rules: party pips, enemy message names, HP bar and DV gauge geometry | enemyMsgName, hpPlateShown, hpBarFillRect, partyPipCels, battleHudPlateLabelsFor |
| layout.ts | 174 | battle UI constants: atlas rects, command list, TECH words, DV gauge, tag presentation | normalizeDvGauge, currentMenuItems, DV_GAUGE_MAX, battleTechWords, TAG_PRESENTATION |
| messages.ts | 302 | the message line's words and ids (esmfight bank 0x7f), kind codes, DNA sentences | MSG, ST, MSG_KIND, scriptedWalkerSentence, dnaFusedForm |
| plans.ts | 320 | category-5 and affinity plans, encounter gate bytes, effective SPD, stat modifiers | effectiveSpd, activeSlotOf, battleScriptedPlanFor, statValue, setStatModifier |
| progress.ts | 372 | reward split and EXP/Bits/DVEXP, level-up gains, stored stats, form DV bank | paidParticipants, levelForExp, winBattleRewards, dvexpGain, treeCandidatesFor |
| report.ts | 231 | the persistent three-row fight report: rows, EXP pages, digivolve bars, portrait | buildFightReportRows, buildFightReportPages, expCountDisplayed, fightReportGroupGeom |
| restore.ts | 267 | category-4 restore plans: cures, regen, stat down, field techniques | battleRestorePlanFor, applyStatDebuffDispatch, castFieldTechnique, battleRestoreParty |
| state.ts | 17 | module-level look-only state: last hit note, enemy stat record tables | S |
| status.ts | 332 | status-event pool advance and expiry, category-5 apply, post-hit dispatch | battleStatusEventAdvance, applyPostHitDispatch, applyCategory5Plan |

Where to look for:
- damage/crit/evade numbers -> hit-results.ts
- EXP, Bits, level-up after a win -> progress.ts
- a message line's text or message id -> messages.ts
- Digivolve (Blast) rules and form changes -> form-blast.ts
- UI constants (DV gauge, command list, atlas rects) -> layout.ts
