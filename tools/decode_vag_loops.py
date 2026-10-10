"""Byte-exact parse of the common VAB (mpcommon/mvcommon): writes
docs/research/audio/common-tones-full.json (slot -> vag + loop points), which
build_sfx.py and tools/gen_soundtst_ids.py read. Moved here from
docs/research/audio/ so the build can run it; output location unchanged."""
import os
import struct, json, sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
VH = str(DDW3 / "pack/dw2003/sound/common/mpcommon/0.vh")
VB = str(DDW3 / "pack/dw2003/sound/common/mvcommon/0.vb")

OUT_DIR = Path(__file__).resolve().parent.parent / "docs/research/audio"
OUT_DIR.mkdir(parents=True, exist_ok=True)
TONES_FULL_JSON = OUT_DIR / "common-tones-full.json"
RECOVERED_DIR = OUT_DIR / "recovered"
INST_DIR = DDW3 / "sound/dw2003/common/inst"

# ---------------------------------------------------------------------------
# 198-vs-202 diagnosis (Task 1, docs/superpowers/plans/2026-07-02-authentic-sfx-wiring.md)
#
# ddw3-unvab-sep (~/ddw3/tools/ddw3-vab-sep/src/vab.rs) warned "Found wrong
# number of total tones in vab: 198 (Expected 202)" while building
# common.toml. Parsed the raw VAB header byte-exactly (mpcommon/0.vh) to find
# out why, independent of common.toml:
#
#   - header.programs_len = 48, header.tones_len = 202 (this is the DECLARED
#     total; vab.rs never checks it against the sum it actually reads).
#   - vab.rs (and this script, matching it) only reads program_headers[0..48]
#     for iteration, but the *fixed* on-disk program_headers array is always
#     128 entries (2048 bytes) regardless of programs_len. Reading entries
#     48-51 anyway (this script does, for diagnosis only) shows plausible-
#     looking data: tones_len=1, volume={95,85,90,70}, but priority=255,
#     mode=255, reserved0=255 (0xFF-filled placeholder pattern) -- i.e. a
#     PARTIALLY-real-looking record, not obviously garbage at a glance.
#   - Summing tones_len over real programs 0..47 gives exactly 198 -- matches
#     ddw3-unvab-sep's parsed count exactly. Summing the 4 "phantom" programs
#     (48-51, tones_len=1 each) gives the missing 4: 198 + 4 = 202, matching
#     the header's declared tones_len exactly. This is highly suggestive the
#     4 missing tones "belong" to programs 48-51.
#   - BUT: the file has no storage for them. The tone_headers section's size
#     is `programs_len * 16 * 32` bytes (16 ToneHeader slots/program, fixed
#     32B ToneHeader) = 48*16*32 = 24576 bytes; encoded_vag_lens[256] (512
#     bytes) starts immediately after and its end lands EXACTLY at the file's
#     length (27168 bytes) -- verified byte-exact, no slack. If programs
#     48-51 had real backing tone data, the tone_headers section would need
#     to be 4*16*32 = 2048 bytes LARGER, which would blow past EOF (or
#     misalign encoded_vag_lens into the wrong bytes entirely). There is
#     therefore no ToneHeader/vag byte range in this file that could belong
#     to slots 198-201 (or 202-203, further still) under ANY consistent
#     re-reading of the layout.
#   - Conclusion (Step 2 finding): the 4 missing tones are NOT a program
#     header off-by-N that a smarter parser could recover -- the sequential
#     tone-load loop (F0x8003086c, sound-system.md "Sample-load mechanism")
#     walks `programs_len` (48) programs and can never reach programs 48-51
#     even if their headers "look" populated, because there is no sample
#     data backing them to load. The header's tones_len=202 field and the
#     4 leftover program_headers entries are most likely a stale build
#     artifact from an earlier/larger version of this bank (Square's own
#     tool never re-zeroed the fixed 128-entry array or the tones_len field
#     when the bank was trimmed to 48 programs) -- not a parser bug.
#   - Per the plan's honest-failure clause: slots 198-203 (the full range
#     referenced by soundtst-common-ids.json's 10 orphan names) are recorded
#     in common-tones-full.json with status="unresolvable" and vag=null,
#     NOT a fabricated mapping. See emit_tones() below.
# ---------------------------------------------------------------------------


def read_header(path):
    data = open(path, "rb").read()
    off = 0
    magic = data[0:4]; assert magic == b"pBAV", magic
    version, id_, waveform_size, sys_res0, programs_len, tones_len, vags_len, master_vol, master_pan = \
        struct.unpack_from("<IIIHHHHBB", data, 4)
    off = 4 + 4+4+4+2+2+2+2+1+1
    bank_attr = data[off:off+2]; off += 2
    sys_res1 = struct.unpack_from("<I", data, off)[0]; off += 4
    assert off == 32, off

    program_headers = []
    for _ in range(128):
        tones_len_p, volume, priority, mode, pan, reserved0, attributes, reserved1, reserved2 = \
            struct.unpack_from("<BBBBBBHII", data, off)
        program_headers.append({
            "tones_len": tones_len_p, "volume": volume, "priority": priority,
            "mode": mode, "pan": pan, "reserved0": reserved0,
            "attributes": attributes, "reserved1": reserved1, "reserved2": reserved2,
        })
        off += 16

    tone_off = off
    # Real, storage-backed tone headers: only the first `programs_len`
    # programs have a 16-slot*32B block in the file (see diagnosis above).
    programs = []
    for p in range(programs_len):
        base = tone_off + p * 16 * 32
        ph = program_headers[p]
        tones = []
        for t in range(ph["tones_len"]):
            rec_off = base + t * 32
            (priority, mode, volume, pan, center_note, center_note_shift,
             center_note_min, center_note_max, vibrate_depth, vibrate_duration,
             portamento_depth, portamento_duration, under_pitch_bend_min,
             under_pitch_bend_max, reserved0, reserved1,
             adsr0, adsr1, program_field, vag) = \
                struct.unpack_from("<BBBBBBBBBBBBBBBBHHHH", data, rec_off)
            tones.append({"tone": t, "vag": vag, "program_field": program_field,
                          # Byte 0 of the ToneHeader is the priority the SPU voice
                          # allocator compares: F0x8003432c and F0x8003581c both
                          # read it at `*(D0x80082658) + (packed*16 + note)*32`
                          # and store it into the single global D0x80082677 that
                          # F0x80034b9c then reads (exe fns.s:39603-39611,
                          # 41012-41038, 40081-40082). Carried here so the
                          # allocator's input is decoded once, from the disc,
                          # and not guessed anywhere downstream.
                          "priority": priority})
        programs.append(tones)
    off = tone_off + programs_len * 16 * 32

    encoded_vag_lens = struct.unpack_from("<256H", data, off)
    off += 512
    assert off == len(data), (off, len(data))

    return {
        "programs_len": programs_len, "tones_len_header": tones_len,
        "vags_len": vags_len, "encoded_vag_lens": encoded_vag_lens,
        "program_headers": program_headers, "programs": programs,
    }


VAG_LUT = [(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)]

def decode_vag(raw_bytes):
    """Mirrors vab.rs Vag::write_wav's ADPCM decode + loop-flag tracking,
    but ALSO records loop_start/loop_end in OUTPUT SAMPLE units."""
    n_blocks = len(raw_bytes) // 16
    hist = [0, 0]
    out = []
    loop_status = None  # None | ('from', block_idx) | 'done'
    loop_start_sample = None
    loop_end_sample = None
    cur = 0
    while True:
        if cur >= n_blocks:
            break
        block = raw_bytes[cur*16:(cur+1)*16]
        shift_lut = block[0]
        shift = shift_lut & 0xf
        lut_idx = (shift_lut & 0xf0) >> 4
        flags = block[1]
        nibbles = block[2:16]
        if flags in (0, 1, 2, 4, 5):
            next_idx = cur + 1
        elif flags == 3:  # end loop
            if isinstance(loop_status, tuple) and loop_status[0] == 'from':
                next_idx = loop_status[1]
                loop_status = 'done'
                loop_end_sample = len(out)  # position where we jump back FROM
            else:
                raise ValueError("end loop outside loop")
        elif flags == 6:  # start loop
            if loop_status is None:
                loop_status = ('from', cur)
                loop_start_sample = len(out)
                next_idx = cur + 1
            elif loop_status == 'done':
                break
            else:
                raise ValueError("recursive loop")
        elif flags == 7:  # end of stream
            break
        else:
            raise ValueError(f"unknown flag {flags}")

        samples4 = []
        for b in nibbles:
            samples4.append(b & 0xf)
            samples4.append((b & 0xf0) >> 4)
        for s in samples4:
            v = s
            if v & 0x8: v -= 16  # sign extend nibble? no - matches rust: (s as i16) <<12 >>shift, s is 0-15 unsigned nibble
            # replicate rust exactly: out = (nibble as i16) << 12 >> shift, arithmetic shift
            raw = s
            out16 = (raw << 12)
            if out16 >= 0x8000: out16 -= 0x10000  # to signed 16
            out16 = out16 >> shift  # arithmetic shift in python for negative ints is fine (floor), matches Rust's >> for i16? close enough
            k0, k1 = VAG_LUT[lut_idx]
            offset = (hist[0]*k0 + hist[1]*k1) // 64
            val = out16 + offset
            val = max(-32768, min(32767, val))
            hist[1] = hist[0]
            hist[0] = val
            out.append(val)
        cur = next_idx

    return out, loop_start_sample, loop_end_sample


def write_wav(path, samples, sample_rate=44100):
    import wave
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(struct.pack(f"<{len(samples)}h", *samples))


def decode_all_vags(h):
    """Decode every vag referenced by the real (storage-backed) tone table,
    keyed by vag index -> {samples, loop_start_sample, loop_end_sample}."""
    lens = h["encoded_vag_lens"]
    assert lens[0] == 0
    body = open(VB, "rb").read()
    cursor = 0
    out = {}
    for vag_idx in range(h["vags_len"]):
        enc_len = lens[vag_idx + 1]
        byte_len = enc_len << 3
        raw = body[cursor:cursor+byte_len]
        cursor += byte_len
        try:
            samples, loop_start, loop_end = decode_vag(raw)
        except Exception as e:
            out[vag_idx] = {"error": str(e)}
            continue
        out[vag_idx] = {
            "samples": samples,
            "loop_start_sample": loop_start,
            "loop_end_sample": loop_end,
        }
    return out


# Slots referenced by soundtst-common-ids.json that fall past the real
# 198-tone table (see diagnosis above) -- the full range spanned by the 10
# orphan names (198, 199, 201, 203 are the ones actually referenced; 200 and
# 202 are included too since they sit inside the same unresolvable gap).
UNRESOLVABLE_SLOTS = [198, 199, 200, 201, 202, 203]
UNRESOLVABLE_NOTE = (
    "Slot falls past the real 198-tone table (programs 0-47, the only "
    "programs with backing ToneHeader storage in the VAB file). The "
    "header's tones_len=202 field and program_headers entries 48-51 "
    "(tones_len=1 each) have no corresponding tone_headers byte range in "
    "the file -- see the 198-vs-202 diagnosis comment block at the top of "
    "this file. Not resolvable without a different/larger source bank."
)


def emit_tones(h, vag_decodes):
    # ToneHeader.vag is 1-BASED (Sony VagAtr convention -- proven 2026-07-03b:
    # every bank's tone fields span exactly [1, vags_len], never 0, and the
    # user ear-confirmed field 53 == inst/52.wav in-game). vag_decodes and the
    # extracted inst/*.wav files are 0-based, so pair via field-1. The emitted
    # "vag" value stays the RAW 1-based field (research JSONs mirror disk);
    # consumers subtract 1 when opening inst/<n>.wav.
    tones = []
    slot = 0
    for p, tone_list in enumerate(h["programs"]):
        for t in tone_list:
            vag = t["vag"]
            dec = vag_decodes.get(vag - 1)
            loop = None
            if dec and dec.get("loop_start_sample") is not None:
                loop = {"start": dec["loop_start_sample"], "end": dec["loop_end_sample"]}
            tones.append({
                "slot": slot,
                "program": p,
                "tone": t["tone"],
                "vag": vag,
                "priority": t["priority"],
                "loop": loop,
                "status": "ok",
            })
            slot += 1

    for s in UNRESOLVABLE_SLOTS:
        tones.append({
            "slot": s,
            "program": None,
            "tone": None,
            "vag": None,
            "priority": None,
            "loop": None,
            "status": "unresolvable",
            "note": UNRESOLVABLE_NOTE,
        })

    return tones


def recover_missing_wavs(h, vag_decodes):
    """Decode any vag referenced by the real tone table that has no WAV
    already extracted by ddw3-unvab-sep into ~/ddw3/sound/dw2003/common/inst/.
    Writes recovered PCM WAVs to docs/research/audio/recovered/<vag>.wav
    (never into ~/ddw3, per project rules)."""
    referenced_vags = set()
    for tone_list in h["programs"]:
        for t in tone_list:
            referenced_vags.add(t["vag"])

    recovered = []
    for vag in sorted(referenced_vags):
        # vag here is the raw 1-BASED field; extractor files are 0-based.
        # (This resolves the old "slot 183-185 declare vag=111 while
        # vags_len=111" out-of-range oddity: 1-based 111 is simply the LAST
        # vag, inst/110.wav.)
        idx = vag - 1
        src = INST_DIR / f"{idx}.wav"
        if src.exists():
            continue
        dec = vag_decodes.get(idx)
        if dec is None:
            reason = "vag field out of range (> vags_len, no sample data exists)" if idx >= h["vags_len"] else "no decode"
            recovered.append({"vag": vag, "recovered": False, "reason": reason})
            continue
        if "error" in dec:
            recovered.append({"vag": vag, "recovered": False, "reason": dec["error"]})
            continue
        dst = RECOVERED_DIR / f"{idx}.wav"
        write_wav(dst, dec["samples"])
        recovered.append({"vag": vag, "recovered": True, "path": str(dst)})
    return recovered


def main():
    h = read_header(VH)
    vag_decodes = decode_all_vags(h)

    real_tone_count = sum(len(p) for p in h["programs"])
    print(
        f"programs_len={h['programs_len']} tones_len(header)={h['tones_len_header']} "
        f"real_tones_parsed={real_tone_count} vags_len={h['vags_len']}",
        file=sys.stderr,
    )

    tones = emit_tones(h, vag_decodes)
    TONES_FULL_JSON.write_text(json.dumps(tones, indent=1))
    print(f"wrote {TONES_FULL_JSON} ({len(tones)} slots, "
          f"{sum(1 for t in tones if t['status'] == 'ok')} ok, "
          f"{sum(1 for t in tones if t['status'] == 'unresolvable')} unresolvable)",
          file=sys.stderr)

    recovered = recover_missing_wavs(h, vag_decodes)
    if recovered:
        for r in recovered:
            print(f"recover: {r}", file=sys.stderr)
    else:
        print("recover: nothing missing -- all real-table vags already have "
              "extracted WAVs in ~/ddw3/sound/dw2003/common/inst/", file=sys.stderr)

    looped = [t for t in tones if t.get("loop")]
    print(f"{len(tones)} tones total, {len(looped)} with loop points", file=sys.stderr)


if __name__ == "__main__":
    main()
