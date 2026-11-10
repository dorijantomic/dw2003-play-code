// Card id bounds shared by the save tables and the card screens.
//
// No imports, deliberately: the album and folder controllers (ui/native/album-*,
// folder-card-grid) must bundle with no engine/native module at all
// (tests/card-battle-execution-forbidden.test.js), and save-block.ts links
// engine/native/memory.ts. The names live here and save-block re-exports them,
// so web/vendor/engine.js keeps the same exports.

/** EXCLUSIVE upper bound: valid card ids are 1 .. SAVE_CARD_MAX-1 (0x13a = 314).
 *  The disc's album and folder loops bound their card index with
 *  `slti ..., 0x13b` (pro/stcrdabm.s, pro/stcrddek.s), so 314 is the last card a
 *  screen ever shows. CARDPAK carries two more records — 315 Calumon and 316
 *  Impmon — which only the duel's Start Phase lays face down
 *  (systems/card-battle.ts:215); no shop, album or folder ever owns them. */
export const SAVE_CARD_MAX = 0x13b;
