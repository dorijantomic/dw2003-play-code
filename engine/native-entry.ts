// RESEARCH-ONLY entry point: the PlayStation instruction interpreter and the
// mixed-mode translation bridge.
//
// This is deliberately NOT part of engine/index.ts (the production barrel the
// browser bundle web/vendor/engine.js is built from). The standing requirement
// (AGENTS.md "Production translation requirement") is that the ordinary page
// carries no PlayStation CPU interpreter and no hidden machine-code fallback,
// so the interpreter's code must not be statically linked into anything the
// ordinary page loads.
//
// It is bundled separately to web/vendor/engine-native.js, which the page
// fetches ONLY through a dynamic import, and only when a route legitimately
// asks for the original overlay:
//   - the three card screens (album, folder editor, duel) still RUN the shipped
//     overlay in ordinary play, so opening one loads this bundle;
//   - every ?native* research switch (web/native-runtime.js) loads it on demand;
//   - the field's ?nativeStages research route loads it on demand.
//
// Anything the ordinary translated route needs lives in engine/index.ts. If a
// translated module ever needs a symbol from here, that is a bug: it would put
// the interpreter back on the ordinary route.
export { NativeStageRuntime, OVERLAY_BASE } from "./native/runtime.ts";
export type { StageManifestEntry } from "./native/runtime.ts";
export type { NativeHost, DrawCall } from "./native/stubs.ts";
// Mixed-mode bridge: oracle-proven engine/dw3 ports run in place of the
// original MIPS bodies at their addresses (engine/native/bridge.ts).
export {
  BRIDGE_BLOCKERS,
  BRIDGE_ENTRIES,
  bridgeEntriesFor,
  bridgeInvocations,
  installTranslationBridge,
  isBridged,
} from "./native/bridge.ts";
export type { BridgeEntry } from "./native/bridge.ts";
