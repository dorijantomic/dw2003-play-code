// Oracle: engine/dw3/ui/native/folder-name-keyboard.ts must match the original
// pro/stcrddek keyboard bodies. The bodies are the shared NAMEDT keyboard with
// the folder's layout, so the same layout-parameterized oracle the naming screen
// and the wizard use (tests/lane-b/helpers/keyboard-oracle.js) drives them:
//
//   F0x800884E8 entryTick   F0x80086AD8 bind    F0x80086E04 draw
//   F0x80087788 tick        F0x800868E8 build
//
// The folder's create/reseed/commit pair (F0x800887D4 / F0x800886C8 /
// F0x800887C8) is oracled by folder-selection-oracle.test.js (create) and is the
// shared nameEntryReseed / nameEntryCommit bodies; createTests is off here
// because the helper's create block calls the stdgname addresses.
import { defineKeyboardOracle } from "./helpers/keyboard-oracle.js";
import { FOLDER_KEYBOARD_LAYOUT } from "../../engine/dw3/ui/native/folder-name-keyboard.ts";

defineKeyboardOracle({
    label: "pro/stcrddek",
    overlayFile: "pro_stcrddek.bin",
    layout: FOLDER_KEYBOARD_LAYOUT,
    createTests: false,
    addrs: {
        foldStart: 0x800867e8, foldTick: 0x8008687c, build: 0x800868e8, bind: 0x80086ad8,
        draw: 0x80086e04, tick: 0x80087788, entryTick: 0x800884e8,
    },
});
