// THE F2 PANEL'S BATTLE SWITCHES, read where the fight code runs.
//
// The player-facing settings live in web/ambience.js: `FX_GROUPS` (the "Battle" group), `fx` and
// `setFx(key, value)`, saved in localStorage under STORE_KEY = "dw.fx.v1" (the panel is F2). The fight
// modules are ALSO imported by the Node tools and the tests, where none of that exists, and importing
// ambience.js from them would drag a DOM module into a headless build. So this bridge reads the same
// store directly and nothing else:
//
//   battleSetting(key)      true only when the player switched it on (absent = the default, OFF)
//   setBattleSetting(key,v) writes through the panel when it is loaded, else into the same store
//
// A URL flag is a DEVELOPER override only: `?ownclips=1` / `?dw2motion=1` force the rule on for the
// session and never touch the player's stored choice (ambience.js's own URL flags work the same way).
import { shipForced, isInstalledBuild } from "../ship-list.js";
export const CORE_STORE_KEY = "dw.fx.v1";

// Both battle rules are OFF by default: a switch the player has never touched must not change a fight.
// (web/ship-list.js: ownclips and smoothanim are out, dw2motion is auto = on. In the browser the live fx object carries that default;
// these headless defaults stay off so the Node tools and tests keep the disc motion. Without the DW2 extras the swap falls back to the disc motion.)
const DEFAULTS = { ownclips: false, dw2motion: false, smoothanim: false };

export function battleSetting(key) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
  if (isInstalledBuild()) { const f = shipForced(key); if (f !== null) return f; }   // installed copy: a save can not change it
  if (typeof localStorage !== "undefined") {
    try {
      const all = JSON.parse(localStorage.getItem(CORE_STORE_KEY) || "{}");
      if (all && Object.prototype.hasOwnProperty.call(all, key)) return !!all[key];
    } catch { /* a corrupt store falls through to the default */ }
  }
  const live = (typeof window !== "undefined" && window.__fx) || null;
  if (live && Object.prototype.hasOwnProperty.call(live, key)) return !!live[key];
  return !!DEFAULTS[key];
}

export function setBattleSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return false;
  if (typeof window !== "undefined" && typeof window.__setFx === "function") {
    window.__setFx(key, !!value);          // ambience's panel: updates fx, saves, refreshes the panel
    return !!value;
  }
  if (typeof localStorage !== "undefined") {
    try {
      const all = JSON.parse(localStorage.getItem(CORE_STORE_KEY) || "{}") || {};
      all[key] = !!value;
      localStorage.setItem(CORE_STORE_KEY, JSON.stringify(all));
    } catch { /* no store: the setting simply does not persist */ }
  }
  return !!value;
}
