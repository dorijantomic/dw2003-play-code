// web/native-screen-pad.js — the pad-input service for a native screen booted
// through web/native-screen.js.
//
// WHY THIS EXISTS. A native screen is the ORIGINAL overlay running its own MIPS:
// it does not read a key name, it reads the controller-input record the resident
// service fills (D0x8004B7D0, `engine/systems/pad-block.ts`). Production already
// bridges the two: `web/game.js` keeps the held set in `state.keys` and each
// screen adapter republishes it once per frame (web/shop-native.js:171,
// web/dri-native.js:242, web/gym-native.js, web/save-native.js:243, ...). The
// native screen LAB had no such bridge at all — web/native-screen-lab.js
// installed no key listener, so a player could open
// `native-screen-lab.html`, watch the merchant draw its BUY/SELL menu, and not
// be able to press anything. Only a test could move it, by calling
// `window.__nativeScreenPad` with a raw word.
//
// This module is that bridge, once, for every screen the lab boots.
//
// WHICH WORD, AND WHICH EDGE. The screens read the PRESSED word (the edge), not
// the held word, through the service cell at object offset +0x3f4
// (F0x80018854, `lhu 0x48($v0)`, `exe/fns.s:9343`), and they test a LOGICAL
// button id, not a bit: they call the cell at +0x408 (F0x80018980) to turn the
// id into a bit index and then `srav`/`andi 0x1` the pressed word by it. The
// merchant's own arm is the reference (`pro/stitshop.s`):
//
//   .L0x00008ed4: lw $v0, 0x3f4($s1)   stitshop.s:9148  the pressed-word getter
//   .L0x00008edc: jalr $v0             stitshop.s:9150
//   .L0x00008ee0: move_ $a0, $zr       stitshop.s:9151  port 0
//   .L0x00008ee8: li $a1, 0x4          stitshop.s:9153  logical button 4 = Up
//   .L0x00008eec: lw $v1, 0x408($s1)   stitshop.s:9154  the map accessor
//   .L0x00008ef4: jalr $v1             stitshop.s:9156
//   .L0x00008ef8: move_ $s0, $v0       stitshop.s:9157  DELAY SLOT: the pressed
//                                                             word is captured
//                                                             BEFORE the map call
//                                                             overwrites $v0
//   .L0x00008efc: srav $s0, $s0, $v0   stitshop.s:9158
//   .L0x00008f00: andi $s0, 0x1         stitshop.s:9159
//
// The delay slot is why that arm reads correctly at all, and it is the reason
// this service only has to publish the HELD word once per tick: the runtime's
// own `applyPad` (engine/native/runtime.ts) derives the edge exactly as the
// console's poll does — `held & ~previous` — so a press that is held for one
// frame is one edge, and a key the player holds keeps the auto-repeat word
// pulsing on the service's 16/6/4 ladder. Nothing here re-implements that.
//
// A PRESS IS A NUMBER OF FRAMES, NOT A NUMBER OF MILLISECONDS. The merchant's
// item list steps one row on the pressed edge AND on every auto-repeat
// (`pro/stitshop.s:5547` Down, `beqz` -> the repeat arm at `:5561`, then
// `addiu $v0, 0x2` at `:5577`), and the console's own poll counts the auto-repeat
// in FRAMES of its VBLANK: `(now - lastTick + credit) / D` with D the halfword at
// D0x8004B7D0+0x3D4 (`exe/fns.s:9784` `lh $v1, 0x3d4($s7)`, `:9786` `div $zr`),
// which the block initialiser sets to `(arg & 0x7F)` and to 0x10 = 16 when the
// caller passes 0 (`fns.s:9036`, `:9042`-`:9043`). So the first repeat is 16
// frames into a hold, then 6, then 4.
//
// A caller that presses a key by holding it for a wall-clock time therefore does
// not press it: it holds it for as many frames as the browser managed to draw in
// that time. The lab's driver held Down for 90 ms, and the lab ran 52 fps on an
// idle box but 124 fps with the frame clock pumped, where 90 ms is 11 frames and
// the second press crossed the 16-frame repeat and moved the cursor two rows
// (Dagger -> Long Bow -> Ribbon). `releaseAfter` is the fix: the caller says how
// many published frames the key stays down, so a press is a press at any frame
// rate. It is also what a player gets — a player who lets go of the key does not
// wait 16 frames, and a player who holds it down gets the auto-repeat.
//
// Those published frames are now the CONSOLE'S, not the browser's: both owners
// of a shipped overlay publish the pad word once per vertical blank
// (engine/systems/native-vblank-clock.ts), so a "frame" in this file is 1/50 s of
// the disc's own time whether the monitor is at 30 Hz or 240.
//
// LOGICAL IDS THE MERCHANT ASKS FOR, with the bit each reaches (the shipped map
// at D0x8004BBF4 is the identity 0x00..0x0f, CORE-PAD-KEYMAP-REMAP-001):
//
//   4  = 0x0010 Up      stitshop.s:9153   (root) / :1690 (the list's repeat arm)
//   6  = 0x0040 Down    stitshop.s:9169   (root) / :1710
//   0xC = 0x1000 the effects card, "[circle] Button: Effects"  stitshop.s:1494
//   0xD = 0x2000 CONFIRM, sound 0x8004503C                    stitshop.s:9205
//   0xE = 0x4000 Back, sound 0x800450BD, "[triangle] Button: Back" stitshop.s:9229
//
// The word a key reaches is `buttonForKey`'s business, not this module's: the
// English disc swaps three face buttons in the poll
// (`pad-poll-swaps-face-buttons-when-language-is-not-zero-2026-10-03`), so the
// player's Cross is the confirm bit 0x2000 and the player's Triangle is the back
// bit 0x4000. The keyboard bindings live in one table
// (`engine/systems/input-map.ts` KEYBOARD_BINDINGS), which this module and the
// game both read, so the lab cannot confirm on a different bit than the game.

import { buttonForKey, maskFromButtons } from "./vendor/engine.js";

/**
 * One pad for a native screen. `publish(heldWord, port)` is called once per
 * frame before the screen ticks; it defaults to the driver's own setter so a
 * caller that only wants the key handling gets it for free.
 */
export function createNativeScreenPadInput({ publish = null, port = 0 } = {}) {
    const held = new Set();
    let send = publish;
    /** A test's explicit held word, or null when the keyboard decides. Kept so
     *  the debug hook `window.__nativeScreenPad(word)` and the keyboard share
     *  ONE publication per frame instead of fighting over the same record. */
    let override = null;
    /** Buttons `releaseAfter` has promised to let go of, and the publications each
     *  has left. A player holding a key is in none of these. */
    const dueOut = new Map();

    function word() {
        return override === null ? maskFromButtons(held) : override & 0xffff;
    }

    /** One key-down. Returns the button it stood for, or null for a key that is
     *  not a pad button (a browser shortcut, a name-entry letter). */
    function keyDown(key) {
        const button = buttonForKey(key);
        if (!button) return null;
        held.add(button);
        return button;
    }

    /** One key-up. */
    function keyUp(key) {
        const button = buttonForKey(key);
        if (button) {
            held.delete(button);
            dueOut.delete(button);
        }
        return button;
    }

    /** Drop every held button, as a window blur does on the console's side. */
    function releaseAll() {
        held.clear();
        override = null;
        dueOut.clear();
    }

    /** Let go of every button now down after `publications` more publications of
     *  the held word. A press is counted in frames because that is what the
     *  original counts (see the header): one publication is one edge and one
     *  frame of auto-repeat debt, whatever the browser's frame rate is. Returns
     *  how many buttons it armed, so a caller whose key never arrived hears so
     *  instead of waiting for a release that cannot come. */
    function releaseAfter(publications) {
        const frames = Math.max(1, (publications | 0) || 1);
        dueOut.clear();
        let armed = 0;
        for (const button of held) {
            dueOut.set(button, frames);
            armed++;
        }
        return armed;
    }

    /** True while a `releaseAfter` promise is still waiting for its frames. */
    function releasePending() {
        return dueOut.size > 0;
    }

    /** Hand the held word over to a caller that has one (the lab's
     *  `window.__nativeScreenPad`). Pass null to give it back to the keyboard. */
    function setHeldWord(value) {
        override = value === null || value === undefined ? null : Number(value) & 0xffff;
    }

    /** Publish the held word. Call once per tick, before the screen reads it. */
    function publishNow() {
        const w = word();
        if (send) send(w, port);
        // The frame this word carried is now spent: count it against whatever
        // `releaseAfter` promised, and let the button go when its last frame is
        // published. The button stays down for the publication that carried the
        // edge and no longer, which is what a quick tap looks like to the poll.
        for (const [button, left] of dueOut) {
            if (left <= 1) {
                held.delete(button);
                dueOut.delete(button);
            } else {
                dueOut.set(button, left - 1);
            }
        }
        return w;
    }

    /**
     * Install the keyboard listeners on a window-like object. The held set is
     * cleared on blur so a key released while the page was not focused cannot
     * leave a direction stuck down.
     */
    function attach(target = typeof window !== "undefined" ? window : null) {
        if (!target || !target.addEventListener) return () => {};
        const down = (e) => {
            if (e.repeat) return; // the OS autorepeat is not a second press
            if (keyDown(e.key) && e.preventDefault) e.preventDefault();
        };
        const up = (e) => {
            if (keyUp(e.key) && e.preventDefault) e.preventDefault();
        };
        const blur = () => releaseAll();
        target.addEventListener("keydown", down);
        target.addEventListener("keyup", up);
        target.addEventListener("blur", blur);
        return () => {
            target.removeEventListener("keydown", down);
            target.removeEventListener("keyup", up);
            target.removeEventListener("blur", blur);
        };
    }

    return {
        attach,
        held: () => [...held],
        keyDown,
        keyUp,
        port,
        publishNow,
        releaseAfter,
        releaseAll,
        releasePending,
        send: (fn) => { send = fn; },
        setHeldWord,
        word,
    };
}