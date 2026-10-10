// The naming screen's root tick and its character/partner-select sequence,
// translated bit-exactly from the original pro/stdgname bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/name-sequence.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x80086144 partnerSelectCreate  build the 0xE0+0x28 partner-select object.
//   F0x80086184 nameScreenSequenceTick  the sequence: create the partner select,
//                                    build the character model, wait for it, then
//                                    advance / hand back.
//   F0x8008645C nameScreenTick       the screen root tick: state 1 runs the
//                                    sequence then the idle shimmer; state 2
//                                    advances when the sequence hands back; state
//                                    3 releases the shared service; default asks
//                                    for the banks then calls +0x38.
//
// The allocator, the card services, the character model (0x80085364), the widget
// methods, the bank probes, the idle shimmer and the release service are host
// boundaries; the port preserves the exact call order and guards. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts barrel
// and data/translated_functions.json.

/** The partner-select handler and geometry the factory allocates. */
export const PARTNER_SELECT_HANDLER = 0x80085de4;
export const PARTNER_SELECT_SIZE = 0xe0;
export const PARTNER_SELECT_EXTRA = 0x28;
/** The character-model resource descriptor cell. */
export const NAME_SEQUENCE_DESC = 0x80087f3c;
/** The shared card service and the bank request/ready cells. */
export const NAME_SEQUENCE_CARD_SERVICE = 0x80048d34;
export const NAME_SEQUENCE_CARD_INDEX_SLOT = 0x2718;
export const NAME_SEQUENCE_CARD_RECORD_SLOT = 0x2750;
export const NAME_SEQUENCE_RELEASE_SLOT = 0x270c;
export const NAME_SEQUENCE_RELEASE_ARG = 0x34;
export const NAME_SEQUENCE_REQUEST = 0x80087f40;
export const NAME_SEQUENCE_READY = 0x80087f44;
/** The naming screen's idle shimmer. */
export const NAME_SEQUENCE_SHIMMER = 0x80086368;

export interface NameSequenceMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface NameSequenceHost {
    /** F0x80014504(cb, size, extra): allocate the partner-select object. */
    allocatePartnerSelect(): number;
    /** [0x80048D34+0x2718](cardId): the card slot index. */
    cardIndexOf(cardId: number): number;
    /** [0x80048D34+0x2750](index): the card record. */
    cardRecord(index: number): number;
    /** F0x80085364(record, index): build the character model. */
    makeCharacterModel(record: number, index: number): number;
    /** F0x80087F40(1): request the naming text banks. */
    requestBanks(flag: number): void;
    /** F0x80087F44(1): nonzero while the banks load. */
    banksReady(flag: number): number;
    /** F0x80086368(obj): the idle shimmer. */
    idleShimmer(obj: number): void;
    /** [0x80048D34+0x270C](value, 0): release the shared service. */
    releaseService(value: number, arg: number): void;
    /** target+slot(a1, a2): a widget or screen object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80086144(arg0): build the partner-select object. */
export function partnerSelectCreate(
    mem: NameSequenceMemory,
    arg0: number,
    host: NameSequenceHost,
): number {
    const obj = host.allocatePartnerSelect();
    mem.write32(obj + 0x50, arg0);
    mem.write32(obj + 0x54, 0x1000);
    return obj;
}

/** F0x80086184(obj, arg1): the naming character/partner-select sequence. */
export function nameScreenSequenceTick(
    mem: NameSequenceMemory,
    obj: number,
    arg1: number,
    host: NameSequenceHost,
): void {
    const advance = () => mem.write32(obj + 0x10, (mem.read32(obj + 0x10) + 1) | 0);
    switch (mem.read32(obj + 0x10) | 0) {
        case 0x1:
            if ((mem.read32(arg1) | 0) !== 0) return;
            if ((mem.read32(obj + 0x60) | 0) === -1) {
                mem.write32(obj + 0x10, 5);
                return;
            }
            advance();
            return;
        case 0x2:
            if ((mem.read32(arg1 + 0x4) | 0) === 0) {
                const index = host.cardIndexOf(mem.read32(NAME_SEQUENCE_DESC) | 0) | 0;
                mem.write32(arg1 + 0x4, host.makeCharacterModel(host.cardRecord(index), index));
            }
            advance();
            return;
        case 0x3: {
            const model = mem.read32(arg1 + 0x4) | 0;
            if ((mem.read32(model + 0x10) | 0) !== 0x64) return;
            const index = host.cardIndexOf(mem.read32(NAME_SEQUENCE_DESC) | 0) | 0;
            host.callMethod(model, 0xf0, [host.cardRecord(index)]);
            host.callMethod(mem.read32(arg1 + 0x4) | 0, 0xf4, []);
            advance();
            return;
        }
        case 0x4: {
            const model = mem.read32(arg1 + 0x4) | 0;
            if ((mem.read32(model + 0x0c) | 0) === 2) {
                mem.write32(model + 0x0c, 3);
                host.callMethod(obj, 0x2c, [0]);
            }
            return;
        }
        case 0x5: {
            const partner = mem.read32(arg1 + 0x8) | 0;
            if ((mem.read32(partner + 0x0c) | 0) === 2) host.callMethod(obj, 0x28, [3]);
            return;
        }
        default:
            if ((mem.read32(arg1) | 0) === 0) {
                mem.write32(arg1, partnerSelectCreate(mem, obj, host));
            }
            advance();
            return;
    }
}

/** F0x8008645C(obj, arg1): the naming screen root tick. */
export function nameScreenTick(
    mem: NameSequenceMemory,
    obj: number,
    arg1: number,
    host: NameSequenceHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        nameScreenSequenceTick(mem, obj, arg1, host);
        host.idleShimmer(obj);
        return;
    }
    if (state === 2) {
        if ((mem.read32(arg1 + 0x0c) | 0) === 0) host.callMethod(obj, 0x28, [1]);
        host.idleShimmer(obj);
        return;
    }
    if (state === 3) {
        host.releaseService(mem.read32(NAME_SEQUENCE_CARD_SERVICE + NAME_SEQUENCE_RELEASE_ARG) | 0, 0);
        return;
    }
    const sub = mem.read32(obj + 0x10) | 0;
    if (sub !== 1) {
        host.requestBanks(1);
        mem.write32(obj + 0x10, (sub + 1) | 0);
        return;
    }
    if ((host.banksReady(1) | 0) === 0) host.callMethod(obj, 0x38, []);
}
