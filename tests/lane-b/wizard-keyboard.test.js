// Oracle: the registration wizard carries a copy of the naming keyboard
// (pro/stplnmet F0x80083e70..F0x80085a70) with its object fields four bytes
// lower and its tables elsewhere. The same ports, given the wizard layout, must
// match those bodies. See tests/lane-b/helpers/keyboard-oracle.js.
import { defineKeyboardOracle } from "./helpers/keyboard-oracle.js";
import { WIZARD_KEYBOARD_LAYOUT } from "../../engine/dw3/ui/native/name-keyboard.ts";

defineKeyboardOracle({
    label: "pro/stplnmet",
    overlayFile: "pro_stplnmet.bin",
    layout: WIZARD_KEYBOARD_LAYOUT,
    createTests: false,
    addrs: {
        foldStart: 0x80083d70, foldTick: 0x80083e04, build: 0x80083e70, bind: 0x80084060,
        draw: 0x8008438c, tick: 0x80084d10, entryTick: 0x80085a70,
    },
});
