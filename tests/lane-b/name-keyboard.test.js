// Oracle: engine/dw3/ui/native/name-keyboard.ts must match the original
// pro/stdgname keyboard bodies. See tests/lane-b/helpers/keyboard-oracle.js.
import { defineKeyboardOracle } from "./helpers/keyboard-oracle.js";
import { NAME_SCREEN_LAYOUT } from "../../engine/dw3/ui/native/name-keyboard.ts";

defineKeyboardOracle({
    label: "pro/stdgname",
    overlayFile: "pro_stdgname.bin",
    layout: NAME_SCREEN_LAYOUT,
    createTests: true,
    addrs: {
        foldStart: 0x80083378, foldTick: 0x8008340c, build: 0x80083478, bind: 0x80083668,
        draw: 0x80083994, tick: 0x80084318, entryTick: 0x80085078,
    },
});
