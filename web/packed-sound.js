/** The one packed-sound lookup every screen plays through.
 *
 * The original: 51 overlays hand a single packed word to the resident routine
 * F0x8002006C through the function-pointer cell [0x80055C48], and that routine
 * splits the word before it sounds anything -- bits 18-24 name the sound
 * archive the id belongs to, bits 8-15 and 0-7 pick the sample inside it, and
 * bits 31 and 30 choose the panned or the plain voice and the single
 * exclusive-track register (docs/research/audio/sound-system.md, §"Packed-id
 * bit layout"; the port is engine/systems/packed-sound.ts).
 *
 * Which SAMPLE a word means is therefore not a per-screen decision, and this
 * file used to be a hand table of eight ids that twenty-five screens each
 * imported and answered with themselves -- so a screen could only ever sound
 * what its author remembered to put in its own copy. The walker already has
 * both halves of the table the disc holds: every sample it built carries its
 * own packed id, the common bank in web/assets/sfx/manifest.json and the 71
 * per-map banks in web/assets/sfx/area_manifest.json, so the lookup is one
 * question asked of those two files (see player.playPacked in web/audio.js).
 */

/** The archive the common bank occupies: bits 18-24 of every common id is 1. */
export const COMMON_SOUND_ARCHIVE = 1;

/** Bits 18-24 of a packed word: which sound archive it addresses (F0x80020030). */
export function packedArchive(packed) {
    return (packed >>> 18) & 0x7f;
}

/** "0x8004503c" — the key the extracted manifests file their ids under. */
export function packedKey(packed) {
    return "0x" + (packed >>> 0).toString(16).padStart(8, "0");
}

/**
 * A packed word with bits 30+29 set and bit 31 clear is a music START -- a SEP
 * SEQUENCE, not a sample (docs/research/audio/sound-system.md, "SEP = up to 16
 * SEQUENCES"). The play routine F0x8002006C's bit-30 arm registers it as the one
 * music track; nothing in the sample manifests answers it, because it names a
 * score in a bank, not a tone. This is the same form build_sfx.py's
 * `area_record_kind` calls `music-start`. It is NOT "bit 30 set": a bit-30
 * jingle that the disc did build a sample for (W_JINGLE) must stay on the
 * sample path, so callers pair this predicate with a music-stem table and fall
 * through to the sample sink when no stem is named.
 */
export function packedIsMusicStart(packed) {
    return ((packed >>> 29) & 0x7) === 0x3;
}

/**
 * The one lookup: given the two extracted lists, the sample a packed word
 * means, as `{name, bank}` (bank null = the common bank). Every screen asks
 * this instead of answering for itself. Null when nothing is built for it.
 *
 * The archive decides which list answers, exactly as F0x80020030 does:
 *
 *  - bits 18-24 == 1 is the common bank, always resident, so manifest.json
 *    answers every word in it;
 *  - any other archive is one of the 71 swappable banks the map (or the overlay
 *    that loaded it) put in a hardware channel. On the 2D path (bit 31 clear)
 *    the word's low byte is a flat load-ordinal IN THAT BANK, so the sample is
 *    a property of one bank and the extracted bank carrying the id is the
 *    archive the word addressed (verified over the whole list: all 21 flat-slot
 *    area ids sit in exactly one bank);
 *  - a positional word (bit 31 set) in another archive addresses a row/tone/note
 *    of whatever bank is loaded, so it is not a bank-specific sample: those
 *    keep resolving through the loaded bank in web/audio.js (playArea), as
 *    they always have.
 */
export function packedSampleResolver(commonManifest, areaManifest = null) {
    const index = (rows) => {
        const out = new Map();
        for (const [stem, meta] of Object.entries(rows ?? {}))
            if (meta?.id) out.set(String(meta.id).toLowerCase(), [stem, meta]);
        return out;
    };
    const common = index(commonManifest);
    const banks = Object.entries(areaManifest ?? {}).map(([bank, rows]) => [bank, index(rows)]);

    return (id) => {
        const word = id >>> 0;
        const key = packedKey(word);
        const archive = packedArchive(word);
        if (archive === COMMON_SOUND_ARCHIVE) {
            const hit = common.get(key);
            if (hit) return { name: hit[0], bank: null };
        } else if ((word >>> 31 & 1) === 0) {
            for (const [bank, byId] of banks) {
                const hit = byId.get(key);
                // The bank must be the archive the word names: positional rows
                // are copied into every bank that has the program, so the id
                // alone would match the wrong archive.
                if (hit && packedArchive(hit[1].id) === archive) return { name: hit[0], bank };
            }
        }
        return null;
    };
}