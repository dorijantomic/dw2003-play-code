import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ui } from '../web/vendor/engine.js';

function memory() {
    const bytes = new Map();
    const resident = readFileSync('web/assets/native/screens/resident.bin');
    const manifest = JSON.parse(readFileSync('web/assets/native/screens/manifest.json'));
    const read8 = a => bytes.get(a) ?? resident[a - manifest.resident.base] ?? 0;
    return {
        read8, read16: a => read8(a) | read8(a + 1) << 8,
        read32: a => (read8(a) | read8(a + 1) << 8 | read8(a + 2) << 16 | read8(a + 3) << 24) >>> 0,
        write8: (a,v) => bytes.set(a,v & 255),
        write16(a,v) { this.write8(a,v); this.write8(a+1,v >>> 8); },
        write32(a,v) { this.write16(a,v); this.write16(a+2,v >>> 16); },
    };
}
test('native roster seeds acquired forms, equipped choices and the active form in save IDs', () => {
    const mem = memory(), rec = 0x80049494;
    ui.seedRosterForms(mem, rec, { digimonId: 9, equippedForms: [9], formLedger: [
        { id: 1, formLevel: 5 }, // rookie is not an acquired-form entry
        { id: 9, formLevel: 22, dvexp: 212, techSlots: [0x2069,0x6b] },
    ] });
    assert.equal(mem.read32(rec+4), 386);
    assert.deepEqual([0,1,2].map(i => mem.read16(rec+0x50+i*2)), [386,0xffff,0xffff]);
    assert.equal(mem.read16(rec+0x58), 386);
    assert.equal(mem.read8(rec+0x5a), 22);
    assert.equal(mem.read32(rec+0x5c), 212);
    assert.equal(mem.read16(rec+0x60), 0x2069);
    assert.equal(mem.read16(rec+0x6c), 0);
    assert.equal(ui.nativeFormIds(mem).idByValue.get(386), 9);
});
test('reopening with a rookie and no acquired forms clears stale native choices', () => {
    const mem = memory(), rec = 0x80049494;
    ui.seedRosterForms(mem, rec, { digimonId: 9, equippedForms: [9], formLedger: [{ id:9 }] });
    ui.seedRosterForms(mem, rec, { digimonId: 1 });
    assert.equal(mem.read32(rec+4), 0);
    assert.equal(mem.read16(rec+0x50), 0xffff);
    for (let i=0; i<44*0x14; i++) assert.equal(mem.read8(rec+0x58+i), 0);
});
