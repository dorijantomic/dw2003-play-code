// engine/systems/native-event-families.ts
//
// THE NATIVE-EVENT FAMILIES — the one shared rule per family that decides, for every
// stage event that has no bytecode of its own (`script_offset == 0`, empty disasm),
// which piece of OUR translated code runs it. 69 of the 384 extracted wstag events are
// like this; they are the "native" branch of the field event machine
// (docs/research/scripting/event-machine-synthesis-2026-08-03.md), where the event record
// carries only a compiled-MIPS routine pointer. There is no bytecode to interpret, so
// "running" such an event means running the routine's translated replacement.
//
// The 69 fall into SIX instruction-identical families. This module is the census: it says
// which family an event belongs to and what happens to it on the ordinary field route.
// It is NOT a second implementation of the families — each family's behaviour is a named
// module (see `handler`), and this module is the routing table that must name one.
//
//   family      events  handler                                        disposition
//   helpMenu       5    engine/dw3/ui/native/help-menu-launcher.ts     translated
//   yesNo          8    engine/dw3/ui/native/yesno-launcher.ts         translated
//   fireTrap      32    engine/systems/fire-trap.ts                    translated
//   darkSwitch     6    engine/systems/dungeon-switch.ts               translated
//   ambush        16    engine/systems/ambush-tile.ts                  translated
//   gunslinger     2    web/gunslinger-switch.js                       translated
//
// The census is pinned against web/assets/events/wstag_events.json by
// tests/native-event-families.test.js, so a new native event or a moved one fails loudly
// instead of being silently dropped — which is what a missing decode-table row used to do.

/** The six behaviour families the 69 native events collapse into. */
export type NativeEventFamily =
    | "helpMenu"
    | "yesNo"
    | "fireTrap"
    | "darkSwitch"
    | "ambush"
    | "gunslinger";

export type NativeEventDisposition =
    /** our translated session/system runs it on the ordinary route */
    | "translated"
    /** no translated behaviour exists yet, and why */
    | "blocked";

export interface NativeEventFamilyInfo {
    family: NativeEventFamily;
    /** What the player meets. */
    shows: string;
    /** Every (stage, event id) that belongs to this family, as extracted. */
    members: readonly { stage: string; id: number }[];
    disposition: NativeEventDisposition;
    /** The module that runs it (absent only when blocked). */
    handler?: string;
    /** Why it is blocked, when it is. */
    blockedBy?: string;
}

const range = (stage: string, lo: number, hi: number) =>
    Array.from({ length: hi - lo + 1 }, (_, i) => ({ stage, id: lo + i }));

/** The fourteen reachable ambush stages plus the Fire Dungeon's own sixteenth tile. */
const AMBUSH_STAGES = ["s350", "s351", "s375", "s376", "s380", "s400", "s401",
    "s530", "s531", "s535", "s538", "s550", "s551"];

export const NATIVE_EVENT_FAMILIES: readonly NativeEventFamilyInfo[] = [
    {
        family: "helpMenu",
        shows: "an eight-topic help terminal: pick a topic, read its page, Return closes it",
        members: [
            { stage: "s210", id: 8 },
            { stage: "s924", id: 1602 }, { stage: "s924", id: 1604 },
            { stage: "s935", id: 1616 }, { stage: "s935", id: 1618 },
        ],
        disposition: "translated",
        handler: "engine/dw3/ui/native/help-menu-launcher.ts",
    },
    {
        family: "yesNo",
        shows: "a Yes / No prompt that starts one of two follow-up scenes",
        members: [
            { stage: "s210", id: 9 }, { stage: "s210", id: 1510 },
            { stage: "s220", id: 1512 }, { stage: "s220", id: 1514 }, { stage: "s220", id: 1516 },
            { stage: "s270", id: 1518 }, { stage: "s270", id: 1520 },
            { stage: "s280", id: 1522 },
        ],
        disposition: "translated",
        handler: "engine/dw3/ui/native/yesno-launcher.ts",
    },
    {
        family: "fireTrap",
        shows: "a marked floor patch: a switch clicks, then each walking Digimon is left on 1 HP",
        members: [...range("s740", 9000, 9015), ...range("s741", 9000, 9015)],
        disposition: "translated",
        handler: "engine/systems/fire-trap.ts",
    },
    {
        family: "darkSwitch",
        shows: "a Bug-Maze switch tile: it throws the pad controller to its other layout",
        members: [
            { stage: "s745", id: 8000 }, { stage: "s745", id: 8001 }, { stage: "s745", id: 8002 },
            { stage: "s746", id: 8000 }, { stage: "s746", id: 8001 }, { stage: "s746", id: 8002 },
        ],
        disposition: "translated",
        handler: "engine/systems/dungeon-switch.ts",
    },
    {
        family: "ambush",
        shows: "a marked floor patch that drops you straight into that area's monster",
        members: [
            ...AMBUSH_STAGES.map(stage => ({ stage, id: 9000 })),
            { stage: "s740", id: 9016 },
            { stage: "s949", id: 9000 }, { stage: "s953", id: 9000 },
        ],
        disposition: "translated",
        handler: "engine/systems/ambush-tile.ts",
    },
    {
        family: "gunslinger",
        shows: "the Undersea Base phase switch: it swaps the room's spatial map and its own step program",
        members: [
            { stage: "s810", id: 9000 }, { stage: "s810", id: 9001 },
        ],
        disposition: "translated",
        handler: "web/gunslinger-switch.js",
    },
];

/** The family a native event belongs to, or null when it is not one of the 69. */
export function nativeEventFamily(stage: string, id: number): NativeEventFamily | null {
    for (const f of NATIVE_EVENT_FAMILIES) {
        if (f.members.some(m => m.stage === stage && m.id === id)) return f.family;
    }
    return null;
}

/** The full record for a native event, or null. */
export function nativeEventInfo(stage: string, id: number): NativeEventFamilyInfo | null {
    const family = nativeEventFamily(stage, id);
    return family ? NATIVE_EVENT_FAMILIES.find(f => f.family === family)! : null;
}

/** Flat membership, one row per native event — the shape the census test counts. */
export function nativeEventMembers(): { stage: string; id: number; family: NativeEventFamily }[] {
    const out: { stage: string; id: number; family: NativeEventFamily }[] = [];
    for (const f of NATIVE_EVENT_FAMILIES) {
        for (const m of f.members) out.push({ stage: m.stage, id: m.id, family: f.family });
    }
    return out;
}

/** How many native events each disposition covers. */
export function nativeEventDispositions(): Record<NativeEventDisposition, number> {
    const counts: Record<NativeEventDisposition, number> = { translated: 0, blocked: 0 };
    for (const f of NATIVE_EVENT_FAMILIES) counts[f.disposition] += f.members.length;
    return counts;
}
