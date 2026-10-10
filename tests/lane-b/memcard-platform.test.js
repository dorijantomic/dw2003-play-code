// Oracle: the card manager's checksum slot (+0x358, resident F0x80015564) against
// cardChecksum, and the virtual-card service contract (0 pending / 1 done / N error,
// reads and writes by length, unknown lengths refused).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarness } from "./helpers/screen-harness.js";
import {
    CARD_NO_CARD, MemcardServices, cardChecksum,
} from "../../engine/dw3/ui/memcard-platform.ts";

const h = createHarness({ overlayFile: "pro_stgmcard.bin" });
const mem = h.rt.mem;
const BUF = 0x80150000;

test("cardChecksum matches F0x80015564 over lengths and contents", () => {
    let s = 7;
    const next = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16;
    for (const len of [-4, 0, 1, 2, 3, 0xd0, 0x26c0]) {
        for (let i = 0; i < 0x26c8; i++) mem.write8(BUF + i, next() & 0xff);
        const original = h.rt.cpu.call(0x80015564, [BUF + 4, len], 400000) & 0xff;
        assert.equal(cardChecksum(mem, BUF + 4, len), original, `len ${len}`);
    }
});

const fakeCard = (present = true) => {
    const log = [];
    const image = new Uint8Array(0x26c4).fill(3);
    return {
        log,
        present: () => present,
        directory: (file) => { log.push(["dir", file]); return new Uint8Array(0xd4).fill(file); },
        image: (file) => { log.push(["img", file]); return file === 2 ? image : null; },
        writeDirectory: (b) => log.push(["wdir", b[1]]),
        writeImage: (file, b) => log.push(["wimg", file, b.length]),
    };
};

test("reads and writes follow the contract and refuse unknown lengths", () => {
    const card = fakeCard();
    const svc = new MemcardServices(mem, card);
    mem.write32(0x8008876c, 1); // the screen's current slot
    assert.equal(svc.status(0), 1);
    assert.equal(svc.read(0, BUF, 0xd4, 1), 1, "the card-check read falls back to the current slot's file");
    assert.deepEqual(card.log.pop(), ["dir", 3]);
    assert.equal(mem.read8(BUF), 3);
    assert.equal(svc.read(0, BUF, 0xd4, 4), 1);
    assert.deepEqual(card.log.pop(), ["dir", 4]);
    assert.equal(svc.read(0, BUF, 0x26c4, 3), CARD_NO_CARD, "an empty file has no image");
    assert.equal(svc.write(0, BUF, 0xd4, 1), 1);
    assert.equal(svc.write(0, BUF, 0x26c4, 3), 1);
    assert.deepEqual(svc.saved, [1]);
    assert.throws(() => svc.read(0, BUF, 0x80, 0), /not part of the virtual card contract/);
    assert.throws(() => svc.write(0, BUF, 0x80, 0), /not part of the virtual card contract/);
});

test("with no card every service answers 'not inserted'", () => {
    const svc = new MemcardServices(mem, fakeCard(false));
    assert.equal(svc.status(0), CARD_NO_CARD);
    assert.equal(svc.read(0, BUF, 0xd4, 2), CARD_NO_CARD);
    assert.equal(svc.write(0, BUF, 0xd4, 1), CARD_NO_CARD);
});

test("a verified image read is recorded as a restore", () => {
    const card = fakeCard();
    const img = new Uint8Array(0x26c4).fill(0);
    img[2] = 4;
    for (let i = 4; i < 0x26c4; i++) img[i] = (i * 7) & 0xff;
    img[0] = cardChecksum({ read8: (a) => img[a] }, 4, 0x26c0) ^ 0; // over +4..+0x26C4 as the screen does
    let x = 0; for (let i = 4; i < 0x26c4; i++) x ^= img[i]; img[0] = x;
    card.image = () => img;
    const svc = new MemcardServices(mem, card);
    assert.equal(svc.read(0, BUF, 0x26c4, 2), 1);
    assert.deepEqual(svc.restored, [0]);
    img[5] ^= 1;
    svc.read(0, BUF, 0x26c4, 3);
    assert.deepEqual(svc.restored, [0], "a corrupt image is not counted");
});
