// The memory-card device of the save/load screen: the platform contract the
// translated screen calls where the original called the resident card manager
// (0x80048750, method table 0x80048A80..0x80048AA8), and the one pure routine of
// that table, the block checksum.
//
// The original manager drives the PlayStation card BIOS (events, sector transfers,
// file system calls); the browser has no card, so the walker's save slots are the
// card (web/memcard.js builds the directory block and web/save-translated.js owns
// what a write means). The screen only ever sees this contract.
//
// Contract (measured on the reference interpreter's stubs, engine/native/runtime.ts
// MEMCARD_*, and decoded in .dw3-research/autonomous-team/researcher/results/
// save-screen-service-values/answer.md): every service returns
//   0      still working (the screen calls again next frame),
//   1      done,
//   N >= 2 failed, status N - 1 (the screen prints esmemcrd string
//          0x80088310[N - 1], "MEMORY CARD is not inserted." for 1 and 3).
// The browser card answers at once, so it never returns 0. With no card every
// service returns NO_CARD (2). The slots and the screen states that call them:
//   +0x334 list/open      states 0x21, 0x65, 0x190, 0x1F5      -> status()
//   +0x338 reset/poll     states 0x0A, 0x28                    -> status()
//   +0x344 mode 0 list    state 0x0B                           -> status()
//   +0x348 mode 1        state 0x79                           -> status()
//   +0x34C mode 2 format  state 0x6E                           -> status()
//   +0x33C read           (handle, buffer, length, file)
//       length 0xD4   the directory block of the file (the card-check read passes
//                     file 1, which is not a file: the block then describes the
//                     screen's current slot, shared block +4, file = slot + 2);
//       length 0x26C4 the save image of file = slot + 2.
//   +0x340 write          (handle, buffer, length, file)
//       length 0xD4   the directory block (the block names its slot in byte 1);
//       length 0x26C4 the save image of file = slot + 2.
//   +0x358 checksum       (buffer, length) -> XOR of the bytes (cardChecksum).
// Any other length is the format / file-table path (states 0x78..0x7D), which a
// formatted virtual card never reaches: it throws rather than invent a result.

export const CARD_PENDING = 0;
export const CARD_OK = 1;
export const CARD_NO_CARD = 2;
export const CARD_DIRECTORY_BYTES = 0xd4;
export const CARD_IMAGE_BYTES = 0x26c4;
export const CARD_FILE_BASE = 2;
export const CARD_STAGE_INDEX = 0x8008876c;

export interface CardMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
}

/** What the platform supplies: a card the walker can read and write. */
export interface VirtualCard {
    /** A card is inserted and formatted. */
    present(): boolean;
    /** The 0xD4 directory block for file `file` (slot = file - 2). */
    directory(file: number): Uint8Array;
    /** The 0x26C4 save image of `file`; null when that file holds no save. */
    image(file: number): Uint8Array | null;
    /** The screen wrote the directory block. */
    writeDirectory(bytes: Uint8Array): void;
    /** The screen wrote the save image of `file`. */
    writeImage(file: number, bytes: Uint8Array): void;
}

/** F0x80015564(buffer, length): XOR of `length` bytes; 0 for a non-positive length. */
export function cardChecksum(mem: Pick<CardMemory, "read8">, buffer: number, length: number): number {
    let sum = 0;
    for (let i = 0; i < (length | 0); i++) sum ^= mem.read8((buffer + i) >>> 0);
    return sum & 0xff;
}

/** One card transfer, as the screen asked for it (for diagnostics and proof). */
export interface CardTransfer {
    direction: "read" | "write";
    length: number;
    file: number;
    slot: number;
}

/** The manager's method slots over a virtual card. */
export class MemcardServices {
    readonly transfers: CardTransfer[] = [];
    /** Slots whose save image the screen read and verified (state 0x47 restores it whole). */
    readonly restored: number[] = [];
    /** Slots whose save image the screen wrote. */
    readonly saved: number[] = [];
    private readonly mem: CardMemory;
    private readonly card: VirtualCard;

    constructor(mem: CardMemory, card: VirtualCard) {
        this.mem = mem;
        this.card = card;
    }

    /** +0x334 / +0x338 / +0x344 / +0x348 / +0x34C. */
    status = (_handle: number): number => (this.card.present() ? CARD_OK : CARD_NO_CARD);

    private fileOf(file: number): number {
        if (file >= 2 && file <= 4) return file;
        const stage = this.mem.read32(CARD_STAGE_INDEX) | 0;
        return stage >= 0 && stage <= 2 ? stage + CARD_FILE_BASE : file;
    }

    /** +0x33C: read a block into `buffer`. */
    read = (_handle: number, buffer: number, length: number, file: number): number => {
        if (!this.card.present()) return CARD_NO_CARD;
        let data: Uint8Array | null;
        if (length === CARD_DIRECTORY_BYTES) {
            const at = this.fileOf(file);
            data = this.card.directory(at);
            this.transfers.push({ direction: "read", length, file: at, slot: at - CARD_FILE_BASE });
        } else if (length === CARD_IMAGE_BYTES) {
            const at = this.fileOf(file);
            data = this.card.image(at);
            this.transfers.push({ direction: "read", length, file: at, slot: at - CARD_FILE_BASE });
            if (data && data.length >= CARD_IMAGE_BYTES) {
                const sum = cardChecksumBytes(data, 4, CARD_IMAGE_BYTES);
                const verified = sum === (data[0]! & 0xff) && (data[2]! | (data[3]! << 8)) === 4;
                if (verified) this.restored.push(at - CARD_FILE_BASE);
            }
        } else {
            throw new Error(`Memory card read of ${length} bytes is not part of the virtual card contract`);
        }
        if (!data) return CARD_NO_CARD;
        for (let i = 0; i < Math.min(length, data.length); i++) this.mem.write8((buffer + i) >>> 0, data[i]! & 0xff);
        return CARD_OK;
    };

    /** +0x340: write a block from `buffer`. */
    write = (_handle: number, buffer: number, length: number, file: number): number => {
        if (!this.card.present()) return CARD_NO_CARD;
        if (length !== CARD_DIRECTORY_BYTES && length !== CARD_IMAGE_BYTES) {
            throw new Error(`Memory card write of ${length} bytes is not part of the virtual card contract`);
        }
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) bytes[i] = this.mem.read8((buffer + i) >>> 0) & 0xff;
        if (length === CARD_DIRECTORY_BYTES) {
            this.transfers.push({ direction: "write", length, file, slot: bytes[1]! & 3 });
            this.card.writeDirectory(bytes);
        } else {
            this.transfers.push({ direction: "write", length, file, slot: file - CARD_FILE_BASE });
            this.card.writeImage(file, bytes);
            this.saved.push(file - CARD_FILE_BASE);
        }
        return CARD_OK;
    };
}

function cardChecksumBytes(data: Uint8Array, from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) sum ^= data[i]! & 0xff;
    return sum & 0xff;
}
