// The inventory list builders behind the ITEMS page's tabs, translated from the
// resident F0x800135E8 and the pro/ststatus routines that call it.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-inventory.test.js runs the originals through engine/native.
//
//   F0x800135E8 inventoryCopy       list the items of category `idx` the party
//                                   holds (a negative idx also lists items only
//                                   worn), into a halfword buffer; returns the count.
//   F0x80099F84 inventoryDispatch   tabs 0-4 use the resident list, 6 and 7 a
//                                   single item family, the rest the filtered list.
//   F0x80099FF8 inventoryCopyFiltered  the two special categories (2 and 3)
//                                   narrowed to four wanted families.
//   F0x8009A1BC inventoryCopyFamily the same two categories narrowed to one family.
//
// Overlay data: the two category lists live at 0x8009AF78 and 0x8009B2A4 (their
// counts at 0x8009B1A0 and 0x8009B5CC); the four wanted families at 0x8009B5F8.
import type { PauseMemory } from "./pause-services.ts";
import { PAUSE_CTX } from "./pause-services.ts";
import { itemRecord } from "../../item-record.ts";
import { inventoryDirectoryAdmits } from "../../item-store.ts";

export const INVENTORY_DIRECTORY = 0x80042bc8;
export const PAUSE_LIST_BASE = 0x8009af68;
export const PAUSE_FAMILIES = 0x8009b5f8;

/** F0x800135E8(idx, dst): copy a category's held item ids to `dst`. */
export function inventoryCopy(mem: PauseMemory, idx: number, dst: number): number {
    const category = idx & 0x7fffffff;
    if (category >= 5) return 0;
    const withWorn = (idx | 0) < 0;
    let cur = mem.read32(INVENTORY_DIRECTORY + category * 4) >>> 0;
    if (mem.read16(cur) === 0) return 0;
    let count = 0;
    let out = dst >>> 0;
    do {
        const item = mem.read16(cur);
        const held = (mem.read8(PAUSE_CTX + item + 0x7c) << 24) >> 24;
        const worn = (mem.read8(PAUSE_CTX + item + 0x20f) << 24) >> 24;
        if (inventoryDirectoryAdmits(held, worn, withWorn)) {
            mem.write16(out, item);
            out += 2;
            count += 1;
        }
        cur += 2;
    } while (mem.read16(cur) !== 0);
    return count;
}

const descriptorFamily = (mem: PauseMemory, item: number): number =>
    mem.read8((mem.read32(itemRecord(item)) + 2) >>> 0);

/** F0x8009A1BC(family, dst): the two special categories, one family only. */
export function inventoryCopyFamily(mem: PauseMemory, family: number, dst: number): number {
    const n2 = inventoryCopy(mem, 2, PAUSE_LIST_BASE + 0x10);
    mem.write32(PAUSE_LIST_BASE + 0x338, n2);
    const n3 = inventoryCopy(mem, 3, PAUSE_LIST_BASE + 0x33c);
    mem.write32(PAUSE_LIST_BASE + 0x664, n3);
    let count = 0;
    let out = dst >>> 0;
    for (let i = 0; i < n2; i++) {
        const item = mem.read16(PAUSE_LIST_BASE + 0x10 + i * 2);
        if (descriptorFamily(mem, item) === (family | 0)) { mem.write16(out, item); out += 2; count += 1; }
    }
    for (let i = 0; i < n3; i++) {
        const item = mem.read16(PAUSE_LIST_BASE + 0x33c + i * 2);
        if (descriptorFamily(mem, item) === (family | 0)) { mem.write16(out, item); out += 2; count += 1; }
    }
    return count;
}

/** F0x80099FF8(dst): the two special categories, the four wanted families. */
export function inventoryCopyFiltered(mem: PauseMemory, dst: number): number {
    const n2 = inventoryCopy(mem, 2, PAUSE_LIST_BASE + 0x10);
    mem.write32(PAUSE_LIST_BASE + 0x338, n2);
    const n3 = inventoryCopy(mem, 3, PAUSE_LIST_BASE + 0x33c);
    mem.write32(PAUSE_LIST_BASE + 0x664, n3);
    let count = 0;
    let out = dst >>> 0;
    const scan = (base: number, n: number): void => {
        for (let i = 0; i < n; i++) {
            const item = mem.read16(base + i * 2);
            const family = descriptorFamily(mem, item);
            for (let j = 0; j < 4; j++) {
                if (family === mem.read8(PAUSE_FAMILIES + j)) { mem.write16(out, item); out += 2; count += 1; }
            }
        }
    };
    scan(PAUSE_LIST_BASE + 0x10, n2);
    scan(PAUSE_LIST_BASE + 0x33c, n3);
    return count;
}

/** F0x80099F84(tab, dst): the list for a bag tab. */
export function inventoryDispatch(mem: PauseMemory, tab: number, dst: number): number {
    if (tab < 5) return inventoryCopy(mem, tab, dst);
    if (tab === 6) return inventoryCopyFamily(mem, 4, dst);
    if (tab === 7) return inventoryCopyFamily(mem, 5, dst);
    return inventoryCopyFiltered(mem, dst);
}
