// An empty party (a new game before any partner is granted) must not leave a pause page
// stuck: the pages' state machines index their start/close states by the party count,
// and count 0 mapped to the very state that starts the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pauseItemsTick } from "../engine/dw3/ui/native/pause-items-tick.ts";
import { sortTick } from "../engine/dw3/ui/native/pause-sort.ts";
import { techniquesTick } from "../engine/dw3/ui/native/pause-techniques.ts";
import { statusTick } from "../engine/dw3/ui/native/pause-status.ts";
import { cardFoldersTick } from "../engine/dw3/ui/native/pause-card-folders.ts";

const OBJ = 0x80150000;
const UI = 0x80155000;

function fakeMem(cells) {
    const m = new Map(Object.entries(cells).map(([k, v]) => [Number(k), v]));
    return {
        read32: (a) => (m.get(a >>> 0) ?? 0) | 0,
        read16: (a) => (m.get(a >>> 0) ?? 0) & 0xffff,
        write32: (a, v) => { m.set(a >>> 0, v | 0); },
        cells: m,
    };
}

// A host whose every method does nothing and answers "ready".
const hostWith = (own = {}) => new Proxy(own, {
    get: (t, k) => (k in t ? t[k] : () => 1),
});
const quiet = hostWith();
const pad = hostWith({ padPressed: () => 0, padRepeat: () => 0, padBit: (_p, c) => c });

const state = (mem) => mem.read32(OBJ + 0x10);

test("items page: no partner starts like one partner (state 1, not 0)", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0, [OBJ + 0x5c]: 0 });
    pauseItemsTick(mem, OBJ, UI, quiet);
    assert.equal(state(mem), 1);
});

test("items page: no partner closes through the one-partner close state", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0x32, [OBJ + 0x5c]: 0 });
    pauseItemsTick(mem, OBJ, UI, quiet);
    assert.equal(state(mem), 0x33);
});

test("sort page: no partner starts like one partner and has nothing to pick", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0, [OBJ + 0x5c]: 0 });
    const filled = [];
    const cards = hostWith({ rosterSlot: () => -1, copyStats: () => filled.push("stats") });
    sortTick(mem, OBJ, UI, hostWith({ padPressed: () => 0, padRepeat: () => 0, padBit: (_p, c) => c, cards, scratch: () => 0 }));
    assert.equal(state(mem), 0xf);
    assert.deepEqual(filled, [], "an empty pedestal is hidden, never filled");
});

test("techniques page: no partner starts like one partner (state 1)", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0, [OBJ + 0x5c]: 0 });
    techniquesTick(mem, OBJ, UI, pad);
    assert.equal(state(mem), 1);
});

test("status page: no partner starts like one partner (state 1)", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0, [OBJ + 0x5c]: 0 });
    statusTick(mem, OBJ, UI, pad);
    assert.equal(state(mem), 1);
});

test("card folders page: no partner starts like one partner (state 1)", () => {
    const mem = fakeMem({ [OBJ + 0x10]: 0, [OBJ + 0x5c]: 0 });
    cardFoldersTick(mem, OBJ, UI, pad);
    assert.equal(state(mem), 1);
});
