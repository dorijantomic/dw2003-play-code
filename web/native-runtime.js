// The single door to the research-only interpreter bundle.
//
// web/vendor/engine-native.js carries the PlayStation instruction interpreter
// (engine/native/mips.ts, runtime.ts, stubs.ts) and the mixed-mode bridge.
// Nothing on the ordinary page STATICALLY imports it: a static import would put
// the interpreter code back into the page graph, which the standing requirement
// forbids. This module is the only importer, and it uses a dynamic import, so the
// bundle is fetched only when a route actually asks for the original overlay:
//
//   - the three card screens (album, folder editor, duel) run the shipped
//     overlay in ordinary play, so the first time one opens it calls
//     loadNativeRuntime();
//   - the field's ?nativeStages research route calls it through
//     web/native-stage.js;
//   - every ?native* research adapter calls it through web/native-screen.js.
//
// The module namespace is cached, so a second call is free and callers that can
// only run synchronously once the screen is booted (bootNativeScreen,
// enterNativeStage) can read it through nativeRuntime() after awaiting load.
// See tests/bundle-split-no-interpreter.test.js: the built production bundle
// must contain no interpreter, and this dynamic import is what keeps it out.

let namespace = null;
let promise = null;

/** Load (once) the interpreter bundle. Resolves to the module namespace. */
export function loadNativeRuntime() {
    if (!promise) {
        promise = import("./vendor/engine-native.js").then((m) => {
            namespace = m;
            return m;
        });
    }
    return promise;
}

/** The loaded interpreter namespace, or null before loadNativeRuntime resolves. */
export function nativeRuntime() {
    return namespace;
}

/** True once the interpreter bundle has been fetched and evaluated. */
export function nativeRuntimeLoaded() {
    return namespace !== null;
}
