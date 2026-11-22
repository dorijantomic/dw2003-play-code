import { Arena, isSpread, T } from "./mpbattle-rules.js";
import { asButton } from "./input.js";
import { MB } from "./mpbattle/state.js";
import { mpbKey } from "./mpbattle/command.js";
import { mpbHost } from "./mpbattle/net.js";
import type { MpPracticeOptions } from "./mpbattle/types.js";
import type { MpBattleApi } from "./types/mp-match.js";
// moved by tools/rewrite/split.mjs: still exported from here
export { mpbActive, mpbKey, mpbVisible } from "./mpbattle/command.js";
export {
  mpbHost,
  mpbLinkBack,
  mpbLinkLost,
  mpbMessage,
  mpbPeerAway,
  mpbPeerBack,
  mpbPeerGone,
} from "./mpbattle/net.js";
// ------------------------------------------------------------ install
/**
 * api: { stageEl, getKit(), myId(), myName(), nameOf(id), send(ids, d), releaseKeys(), snapshot(), restore(snap),
 *        canJoin(), joinDone(setup) -> done fn, sfx, bgm, mapId() }
 */
export function installMpBattle(api: MpBattleApi) {
    MB.A = api;
    // while a fight is up, no key reaches the game (the character must not walk off)
    window.addEventListener("keydown", (e) => {
        if (!MB.F && !(MB.A.ui && MB.A.ui.root.style.display === "flex")) return;
        if (/^F\d+$/.test(e.key)) return;
        MB.A.releaseKeys(); e.stopImmediatePropagation();
        if (MB.F?.nat) { const b = asButton(e.key); if (b) { e.preventDefault(); mpbKey(b); } }      // the game's own menus take the pad buttons
    }, true);
    window.addEventListener("keyup", (e) => { if (MB.F || (MB.A.ui && MB.A.ui.root.style.display === "flex")) e.stopImmediatePropagation(); }, true);
    window.__mpb = { get fight() { return MB.F; }, isSpread, host: mpbHost, T, Arena, key: mpbKey, practice: (o: MpPracticeOptions) => MB.A.practice?.(o) };   // (for tests and the console)
}
