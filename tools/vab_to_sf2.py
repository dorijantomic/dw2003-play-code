#!/usr/bin/env python3
"""Build a per-bank SoundFont (.sf2) from the game's own VAB instruments.

Why: build_music rendered with a generic GM soundfont (GeneralUser GS), so
every track played the right notes at the right tempo with the WRONG
instruments/envelopes. This synthesizes each bank's true timbre:

  sample   = the tone's VAG, ADPCM-decoded from mv<bank>/0.vb (loop points
             from the ADPCM flags, same state machine as build_sfx.py)
  root key = ToneAttr center_note; fine tune = center_note_shift (1/128
             semitone units -> cents*100/128), matching the driver's
             pitch = 2^((note-center+shift/128)/12) (F0x80036070)
  key range = center_note_min..center_note_max
  pan/volume = ToneAttr pan (0..127, 64=center) and volume*prog volume
  envelope = SPU ADSR1/ADSR2 registers mapped to SF2 vol-env generators
             (approximate: SF2 can't reproduce SPU envelope shapes exactly,
             but times/levels follow the nocash SPU formulas)
  preset number = the VAB PROGRAM SLOT (SEQ program-change events use slot
             numbers; presets are also duplicated into bank 128 so
             fluidsynth's channel-10 drum lookup resolves to the same
             instrument instead of silence)

Usage:
  uv run python3 tools/vab_to_sf2.py <bank> [outdir]     # one bank
  uv run python3 tools/vab_to_sf2.py --all [outdir]      # every bank
Default outdir: third_party/sf2_banks/ (gitignored, rebuilt on demand).
"""
import os
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import tomllib

SOUND_PACK = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/sound"
SOUND_META = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "sound/dw2003"
DEFAULT_OUT = Path(__file__).parent.parent / "third_party/sf2_banks"
SAMPLE_RATE = 44100

VAG_LUT = [(0, 0), (60, 0), (115, -52), (98, -55), (122, -60)]


def decode_vag_pcm(raw):
    """ADPCM decode (mirrors vab.rs / build_sfx.py), returns samples+loop."""
    n_blocks = len(raw) // 16
    hist = [0, 0]
    out = []
    loop_status = None
    loop_start = loop_end = None
    cur = 0
    while cur < n_blocks:
        block = raw[cur * 16 : (cur + 1) * 16]
        shift = block[0] & 0xF
        lut_idx = (block[0] & 0xF0) >> 4
        flags = block[1]
        if flags in (0, 1, 2, 4, 5):
            nxt = cur + 1
        elif flags == 3:
            if isinstance(loop_status, tuple):
                loop_status = "done"
                loop_end = len(out) + 28
                nxt = cur + 1
            else:
                nxt = cur + 1
        elif flags == 6:
            if loop_status is None:
                loop_status = ("from", cur)
                loop_start = len(out)
            nxt = cur + 1
        else:
            break
        k0, k1 = VAG_LUT[lut_idx] if lut_idx < len(VAG_LUT) else (0, 0)
        for b in block[2:16]:
            for s in (b & 0xF, (b & 0xF0) >> 4):
                v = s << 12
                if v >= 0x8000:
                    v -= 0x10000
                v >>= shift
                val = v + (hist[0] * k0 + hist[1] * k1) // 64
                val = max(-32768, min(32767, val))
                hist[1] = hist[0]
                hist[0] = val
                out.append(val)
        if flags == 3 and loop_status == "done":
            break
        cur = nxt
    return out, loop_start, loop_end


def load_bank(bank):
    """Return (programs_with_slots, vag_pcm list 0-based)."""
    vh = SOUND_PACK / bank / f"mp{bank}" / "0.vh"
    vb = SOUND_PACK / bank / f"mv{bank}" / "0.vb"
    toml_p = SOUND_META / f"{bank}.toml"
    if not (vh.is_file() and vb.is_file() and toml_p.is_file()):
        # ttlbgm swapped layout: mp<bank>/1.vh + 0.seq gotcha
        vh2 = SOUND_PACK / bank / f"mp{bank}" / "1.vh"
        if vh2.is_file():
            vh = vh2
        if not (vh.is_file() and vb.is_file() and toml_p.is_file()):
            return None
    meta = tomllib.loads(toml_p.read_text())
    d = vh.read_bytes()
    ph = [d[32 + i * 16] for i in range(128)]  # tone count per program slot
    slots = [r for r in range(128) if ph[r] > 0]
    programs = meta["programs"]
    # packed order == present-slot order (loader F0x8003086c walks in order)
    prog_slots = list(zip(slots, programs))
    # decode all vags once
    tone_off = 32 + 128 * 16
    lens = struct.unpack_from("<256H", d, tone_off + meta_programs_len(d) * 512)
    body = vb.read_bytes()
    vags = []
    pos = 0
    for i in range(1, 256):
        n = lens[i] << 3
        if n == 0:
            break
        vags.append(decode_vag_pcm(body[pos : pos + n]))
        pos += n
    return prog_slots, vags


def meta_programs_len(d):
    return struct.unpack_from("<H", d, 18)[0]


# ── SPU ADSR -> approximate seconds/levels (nocash PSX SPU spec) ──
def _env_ticks(shift, step_val, target=0x8000, exp=False):
    """Ticks (44.1kHz) for a linear ramp of `step` every 1<<max(0,shift-11)
    cycles; exponential approximated as 4x the linear time."""
    step = step_val << max(0, 11 - shift)
    if step <= 0:
        return 44100 * 10
    cycles = 1 << max(0, shift - 11)
    t = (target // step + 1) * cycles
    return t * 4 if exp else t


def adsr_to_sf2(a1, a2):
    atk_mode = (a1 >> 15) & 1
    atk_shift = (a1 >> 10) & 0x1F
    atk_step = 7 - ((a1 >> 8) & 3)
    dec_shift = (a1 >> 4) & 0xF
    sus_level = ((a1 & 0xF) + 1) * 0x800
    rel_mode = (a2 >> 5) & 1
    rel_shift = a2 & 0x1F
    attack_s = _env_ticks(atk_shift, atk_step, exp=bool(atk_mode)) / SAMPLE_RATE
    decay_s = _env_ticks(dec_shift, 8, target=max(1, 0x8000 - sus_level), exp=True) / SAMPLE_RATE
    release_s = _env_ticks(rel_shift, 8, exp=bool(rel_mode)) / SAMPLE_RATE
    sus_frac = min(1.0, sus_level / 0x8000)
    sus_cb = 0 if sus_frac >= 1.0 else min(1440, int(round(-200 * math.log10(max(sus_frac, 1e-4)))))
    def tc(seconds):  # timecents, clamped to SF2 range
        return max(-12000, min(8000, int(round(1200 * math.log2(max(seconds, 0.001))))))
    return tc(attack_s), tc(decay_s), sus_cb, tc(release_s)


# ── minimal SF2 writer ──
def _chunk(tag, payload):
    if len(payload) & 1:
        payload += b"\0"
    return tag + struct.pack("<I", len(payload)) + payload


def build_sf2(bank, out_path, sample_transform=None):
    """Build one bank, optionally transforming PCM without changing metadata.

    sample_transform(index, samples, loop_start, loop_end) must return exactly
    the same number of mono samples. Root pitch, fine tune, key ranges, ADSR,
    volume, pan, program slots, and loop points always come from the VAB.
    """
    loaded = load_bank(bank)
    if not loaded:
        return False
    prog_slots, vags = loaded
    if sample_transform:
        transformed = []
        for index, (samples, loop_start, loop_end) in enumerate(vags):
            replacement = list(
                sample_transform(index, samples, loop_start, loop_end)
            )
            if len(replacement) != len(samples):
                raise ValueError(
                    f"{bank} vag {index}: transform changed sample count "
                    f"{len(samples)} -> {len(replacement)}"
                )
            replacement = [
                max(-32768, min(32767, int(round(value))))
                for value in replacement
            ]
            transformed.append((replacement, loop_start, loop_end))
        vags = transformed

    # sample pool: emit each vag once (46-sample zero gap per spec)
    smpl = bytearray()
    shdr_pos = []  # (start, end, loopstart, loopend) absolute
    for samples, ls, le in vags:
        start = len(smpl) // 2
        smpl += struct.pack(f"<{len(samples)}h", *samples)
        end = len(smpl) // 2
        smpl += b"\0" * 92
        loop = None
        if ls is not None and le is not None and le > ls:
            loop = (start + ls, start + min(le, len(samples)))
        shdr_pos.append((start, end, loop))

    inst_zones = []  # per instrument: list of tone-zone gen lists
    inst_names = []
    presets = []  # (bank, preset_num, inst_idx)
    for slot, prog in prog_slots:
        zones = []
        pvol = prog.get("volume", 127) / 127.0
        for tone in prog.get("tones", []):
            vag = tone.get("vag", 0)
            if not (1 <= vag <= len(vags)):
                continue
            idx = vag - 1
            start, end, loop = shdr_pos[idx]
            gens = []
            lo, hi = tone.get("center_note_min", 0), tone.get("center_note_max", 127)
            if hi < lo:
                lo, hi = hi, lo
            gens.append((43, lo | (hi << 8)))  # keyRange (must be first)
            a, d_, s_cb, r = adsr_to_sf2(*tone.get("adsr", [0x80FF, 0x5FC0]))
            gens.append((34, a))   # attackVolEnv
            gens.append((36, d_))  # decayVolEnv
            gens.append((37, s_cb))
            gens.append((38, r))   # releaseVolEnv
            pan = tone.get("pan", 64)
            gens.append((17, max(-500, min(500, int((pan - 64) / 63 * 500)))))
            g = max(1e-3, (tone.get("volume", 127) / 127.0) * pvol)
            att_cb = min(1440, int(round(-200 * math.log10(g))))
            if att_cb:
                gens.append((48, att_cb))  # initialAttenuation
            gens.append((58, tone.get("center_note", 60)))  # overridingRootKey
            shift = tone.get("center_note_shift", 0)
            if shift >= 128:
                shift -= 256
            fine = int(round(shift * 100 / 128))
            if fine:
                gens.append((52, fine & 0xFFFF))  # fineTune
            gens.append((54, 1 if loop else 0))  # sampleModes
            gens.append((53, idx))  # sampleID (must be last)
            zones.append(gens)
        if not zones:
            continue
        inst_idx = len(inst_names)
        inst_names.append(f"P{slot:03d}")
        inst_zones.append(zones)
        presets.append((0, slot, inst_idx))
        presets.append((128, slot, inst_idx))  # drum-channel fallback

    # ── pdta sub-chunks ──
    def name20(s):
        b = s.encode()[:19]
        return b + b"\0" * (20 - len(b))

    phdr = b""
    pbag = b""
    pgen = b""
    pmod = b""
    for i, (bk, pnum, inst_idx) in enumerate(presets):
        phdr += name20(f"{bank}-{bk}-{pnum}") + struct.pack("<HHHIII", pnum, bk, i, 0, 0, 0)
        pbag += struct.pack("<HH", len(pgen) // 4, 0)
        pgen += struct.pack("<Hh", 41, inst_idx)  # instrument gen (last+only)
    phdr += name20("EOP") + struct.pack("<HHHIII", 0, 0, len(presets), 0, 0, 0)
    pbag += struct.pack("<HH", len(pgen) // 4, 0)

    inst = b""
    ibag = b""
    igen = b""
    imod = b""
    for i, zones in enumerate(inst_zones):
        inst += name20(inst_names[i]) + struct.pack("<H", ibag_count(ibag))
        for gens in zones:
            ibag += struct.pack("<HH", len(igen) // 4, 0)
            for op, val in gens:
                igen += struct.pack("<HH", op, val & 0xFFFF)
    inst += name20("EOI") + struct.pack("<H", ibag_count(ibag))
    ibag += struct.pack("<HH", len(igen) // 4, 0)

    shdr = b""
    for j, (start, end, loop) in enumerate(shdr_pos):
        ls, le = (loop if loop else (start, end))
        shdr += name20(f"vag{j}") + struct.pack(
            "<IIIIIBbHH", start, end, ls, le, SAMPLE_RATE, 60, 0, 0, 1
        )
    shdr += name20("EOS") + struct.pack("<IIIIIBbHH", 0, 0, 0, 0, 0, 0, 0, 0, 0)

    info = _chunk(b"LIST", b"INFO"
                  + _chunk(b"ifil", struct.pack("<HH", 2, 1))
                  + _chunk(b"isng", b"EMU8000\0")
                  + _chunk(b"INAM", (bank + "\0").encode()))
    sdta = _chunk(b"LIST", b"sdta" + _chunk(b"smpl", bytes(smpl)))
    pdta = _chunk(b"LIST", b"pdta"
                  + _chunk(b"phdr", phdr) + _chunk(b"pbag", pbag)
                  + _chunk(b"pmod", pmod) + _chunk(b"pgen", pgen)
                  + _chunk(b"inst", inst) + _chunk(b"ibag", ibag)
                  + _chunk(b"imod", imod) + _chunk(b"igen", igen)
                  + _chunk(b"shdr", shdr))
    riff = _chunk(b"RIFF", b"sfbk" + info + sdta + pdta)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(riff)
    return True


def ibag_count(ibag):
    return len(ibag) // 4


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    outdir = Path(args[1]) if len(args) > 1 else DEFAULT_OUT
    if "--all" in sys.argv:
        banks = sorted(p.name for p in SOUND_PACK.iterdir() if p.is_dir())
    else:
        banks = [args[0]]
    ok = 0
    for b in banks:
        out = outdir / f"{b}.sf2"
        if build_sf2(b, out):
            print(f"{out}  ({out.stat().st_size//1024}kB)")
            ok += 1
        else:
            print(f"SKIP {b} (missing vh/vb/toml)")
    print(f"{ok}/{len(banks)} banks")


if __name__ == "__main__":
    main()
