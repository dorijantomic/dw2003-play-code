// SMOOTH BATTLE ANIMATION — the player's switch for the smoother battle pose playback.
//
// THE SWITCH IS THE F2 SETTINGS PANEL: web/ambience.js FX_GROUPS, the "Battle" group, saved in
// localStorage (STORE_KEY "dw.fx.v1") through setFx(). Default OFF: a switch the player has never
// touched must not change a fight by one bit. The fight modules are also imported by the Node tools
// and the tests, where ambience.js (a DOM module) must not be dragged in, so this file reads the same
// store directly — the key, the shape and the default are ambience.js's.
//
// A URL flag is a DEVELOPER override only: `?smooth=1` forces the mode on for the session and never
// touches the player's stored choice. The Node tools use ANIM_SMOOTH=1; setSmoothAnim(v) pins it for
// a test or a lab (setSmoothAnim(null) hands control back to the player's setting).
export const CORE_STORE_KEY = "dw.fx.v1";
export const SMOOTH_SETTING = "smoothanim";

let override = null;                                  // null = follow the player's setting
export function setSmoothAnim(v) { override = v == null ? null : !!v; }

/** Read the developer override out of a query string: `?smooth=1` turns the mode on. */
export function smoothFlagFromUrl(search = "") {
  try {
    const v = new URLSearchParams(search || "").get("smooth");
    return v === "1" || v === "true" || v === "on";
  } catch { return false; }
}

const URL_ON = typeof window !== "undefined" && window?.location?.search
  ? smoothFlagFromUrl(window.location.search) : false;
const ENV_ON = typeof process !== "undefined" && process?.env?.ANIM_SMOOTH === "1";

function storedSetting() {
  if (typeof localStorage !== "undefined") {
    try {
      const all = JSON.parse(localStorage.getItem(CORE_STORE_KEY) || "{}");
      if (all && Object.prototype.hasOwnProperty.call(all, SMOOTH_SETTING)) return !!all[SMOOTH_SETTING];
    } catch { /* a corrupt store falls through to the live panel object */ }
  }
  const live = (typeof window !== "undefined" && window.__fx) || null;
  if (live && Object.prototype.hasOwnProperty.call(live, SMOOTH_SETTING)) return !!live[SMOOTH_SETTING];
  return false;                                       // never touched = OFF
}

// The renderer asks once per actor per drawn frame; the store is a JSON blob, so the answer is
// cached briefly. 250 ms is short enough that flipping the switch in the panel shows up while the
// fight is still on screen.
let cached = null, cachedAt = -1e9;
export function smoothAnimEnabled() {
  if (override != null) return override;
  if (URL_ON || ENV_ON) return true;
  const now = Date.now();
  if (cached == null || now - cachedAt > 250) { cached = storedSetting(); cachedAt = now; }
  return cached;
}
