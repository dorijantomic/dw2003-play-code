/*
 * Everything that STARTS a cue and the introspection that goes with it: the named
 * one-shot, the op10 battle cue, the effect pack's loop, the bank/area/map entry
 * points, and the debug readers the tests use.  Installed onto `player`.
 */

import { packedSampleResolver } from "../packed-sound.js";
import type { AudioEngine } from "../types/audio.js";

// The methods attach themselves to the `player` object the caller hands in,
// so this module needs nothing from createSfxPlayer but the shared context P.
// Split out of web/audio.ts; every call into the rest of the player goes through
// P (the tool rewrote the names when the helpers moved to audio/playback.ts).
export function installPlayApi(P: AudioEngine) {
  const { bufferFor, releaseExclusiveByName, startPhrase, startVoice, whenPhraseRow } = P;

  // `name` = lowercased soundtst name, a key in manifest.json (common bank).
  P.player!.play = (name) => {
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(String(name));
    if (P.player!.muted || !P.ctx || !P.manifest) return;
    const meta = P.manifest[name];
    if (meta) startVoice!(name, meta, null);
  };

  P.player!.playBattle = (name, side = "player", durationFrames = 0) => {
    if (P.player!.muted || !P.ctx || !P.manifest) return;
    const meta = P.manifest[name];
    if (!meta) return;
    // Bit 30 on the battle path takes the SAME single register (D0x80055c34 is
    // one global, not a per-side field); its stop entry is this side's voice.
    const exKey = P.exclusiveKeyFor!(name, meta, null);
    if (meta.dedup && !P.register!.begin(exKey, name, () => P.player!.stopBattle!(side))) return;
    const duration = Math.max(0, durationFrames | 0);
    if (duration > 0 && !P.battleGate!.acquire(side)) return;   // timed effect slot busy -> drop
    // An op10 sound whose id is a 2D phrase (the eight *_STEP/*_DOWN thuds are:
    // op10 types 10-17, tech-effects-decode.md) is a SEQUENCE of notes, and the
    // original takes one SPU voice per note-on for it like any other 2D cue.
    const oneBattleSource = () => {
      Promise.resolve(bufferFor!(name, null)).then((buf) => {
        if (P.player!.muted || !(buf instanceof AudioBuffer)) { if (duration > 0) P.battleGate!.release(side); return; }
        if (P.ctx!.state === "suspended") P.ctx!.resume().catch(() => {});
        // An op10 sound is a normal packed-sound play, so it asks the same pool
        // for a voice as any other cue (fns.s:41033). The per-side gate above is
        // a separate rule — fightstg's one effect object per side — and it does
        // not replace this one.
        const took = P.pool.allocate(P.voicePriority!(meta));
        if (!took) { if (duration > 0) P.battleGate!.release(side); return; }
        if (took.evicted) took.evicted.release();
        const src = P.ctx!.createBufferSource();
        src.buffer = buf;
        const rate = meta.battleRate ?? meta.rate;
        if (rate && rate !== 1) src.playbackRate.value = rate;
        // op10's second operand is the sound-object lifetime. Only those timed
        // objects hold context+0xc and key off loop-pointed samples; operand 0 is
        // a direct one-shot call and must not loop forever.
        if (meta.loop && duration > 0) {
          src.loop = true;
          src.loopStart = meta.loop.start;
          src.loopEnd = meta.loop.end;
        }
        src.connect(P.gain);
        let timer: string | number | NodeJS.Timeout | null | undefined = null;
        const clear = () => {
          if (timer) { clearTimeout(timer); timer = null; }
          if (P.battleSrc![side] === src) { P.battleSrc![side] = null; P.battleName![side] = null; P.battleVoice![side] = -1; }
          P.pool.finish(took.index, src);
          if (duration > 0) P.battleGate!.release(side);
        };
        src.onended = clear;
        src.start(0);
        P.pool.setLength(took.index, P.lengthMsOf!(src, buf));
        P.pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        if (duration > 0) {
          P.battleSrc![side] = src;
          P.battleName![side] = name;
          P.battleVoice![side] = took.index;
          timer = setTimeout(() => {
            try { src.stop(); } catch (e) { /* already stopped */ }
            clear();
          }, (duration / 60) * 1000);
        }
      }).catch(() => { if (duration > 0) P.battleGate!.release(side); });
    };
    whenPhraseRow!(name, null, (row) => {
      startPhrase!(row, () => {
        if (P.battlePhrase![side]?.units().length === 0) P.battlePhrase![side] = null;
      }).then((h) => {
        if (!h) { if (duration > 0) P.battleGate!.release(side); return; }
        P.battlePhrase![side] = h;
        if (duration > 0) {
          P.battleName![side] = name;
          P.battleTimer![side] = setTimeout(() => {
            h.stop();
            if (P.battlePhrase![side] === h) P.battlePhrase![side] = null;
            P.battleTimer![side] = null;
            P.battleGate!.release(side);
          }, (duration / 60) * 1000);
        }
      });
    }, oneBattleSource);
  };

  P.player!.playEffectLoop = (name) => {
    if (P.player!.muted || !P.ctx || !P.manifest) return;
    const meta = P.manifest[name];
    if (!meta) return;
    P.player!.stopEffectLoop!();            // one pack at a time, as one +0xe4 handle allows
    P.effectLoopName = name;
    // A 2D phrase on the effect-pack path runs as its note events too.
    const oneEffectLoop = () => {
      Promise.resolve(bufferFor!(name, null)).then((buf) => {
        // A second cast may have started (or stopped us) while the buffer decoded.
        if (P.player!.muted || P.effectLoopName !== name || !(buf instanceof AudioBuffer)) return;
        if (P.ctx!.state === "suspended") P.ctx!.resume().catch(() => {});
        const took = P.pool.allocate(P.voicePriority!(meta));
        if (!took) { P.effectLoopName = null; return; }
        if (took.evicted) took.evicted.release();
        const src = P.ctx!.createBufferSource();
        src.buffer = buf;
        const rate = meta.battleRate ?? meta.rate;
        if (rate && rate !== 1) src.playbackRate.value = rate;
        if (meta.loop) {                  // bit 29 of the packed id = a looping sample
          src.loop = true;
          src.loopStart = meta.loop.start;
          src.loopEnd = meta.loop.end;
        }
        src.connect(P.gain);
        src.onended = () => {
          P.pool.finish(took.index, src);
          if (P.effectLoopSrc === src) { P.effectLoopSrc = null; P.effectLoopName = null; P.effectLoopVoice = -1; }
        };
        src.start(0);
        P.pool.setLength(took.index, P.lengthMsOf!(src, buf));
        P.pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        P.effectLoopSrc = src;
        P.effectLoopVoice = took.index;
      }).catch(() => { if (P.effectLoopName === name) P.effectLoopName = null; });
    };
    whenPhraseRow!(name, null, (row) => {
      startPhrase!(row, () => {
        if (P.effectLoopPhrase?.units().length === 0) P.effectLoopPhrase = null;
      }).then((h) => {
        if (!h || P.player!.muted || P.effectLoopName !== name) { h?.stop(); return; }
        P.effectLoopPhrase = h;
      });
    }, oneEffectLoop);
  };

  P.player!.playSustained = (name) => {
    if (P.player!.muted || !P.ctx || !P.manifest) return;
    const meta = P.manifest[name];
    if (!meta) return;
    P.player!.stopSustained!(name);           // the 2D path's own-slot key-off
    const token = {};
    P.sustainedSrc!.set(name, token);        // claim the slot before the buffer resolves
    // The cue this holds open (EX_AT_LP, bit 31 clear) is a phrase, so it runs
    // as its note events and the stop marker releases every voice it took.
    whenPhraseRow!(name, null, (row) => {
      startPhrase!(row, () => {
        if (P.sustainedPhrase!.get(name)?.units().length === 0) P.sustainedPhrase!.delete(name);
      }).then((h) => {
        if (!h || P.player!.muted || P.sustainedSrc!.get(name) !== token) {
          if (P.sustainedSrc!.get(name) === token) P.sustainedSrc!.delete(name);
          h?.stop();
          return;
        }
        P.sustainedSrc!.set(name, h);
        P.sustainedPhrase!.set(name, h);
      });
    }, () => {
      Promise.resolve(bufferFor!(name, null)).then((buf) => {
        if (P.player!.muted || P.sustainedSrc!.get(name) !== token || !(buf instanceof AudioBuffer)) return;
        if (P.ctx!.state === "suspended") P.ctx!.resume().catch(() => {});
        const took = P.pool.allocate(P.voicePriority!(meta));
        if (!took) { P.sustainedSrc!.delete(name); return; }
        if (took.evicted) took.evicted.release();
        const src = P.ctx!.createBufferSource();
        src.buffer = buf;
        const rate = meta.battleRate ?? meta.rate;
        if (rate && rate !== 1) src.playbackRate.value = rate;
        if (meta.loop) { src.loop = true; src.loopStart = meta.loop.start; src.loopEnd = meta.loop.end; }
        src.connect(P.gain);
        src.onended = () => {
          P.pool.finish(took.index, src);
          if (P.sustainedSrc!.get(name) === src) { P.sustainedSrc!.delete(name); P.sustainedVoice!.delete(name); }
        };
        src.start(0);
        P.pool.setLength(took.index, P.lengthMsOf!(src, buf));
        P.pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        P.sustainedSrc!.set(name, src);
        P.sustainedVoice!.set(name, took.index);
      }).catch(() => { if (P.sustainedSrc!.get(name) === token) P.sustainedSrc!.delete(name); });
    });
  };

  // Tell the player which map is active so area sounds resolve through its
  // bank (previous map's bank kept as the second-channel fallback).
  P.player!.setMap = (mapId) => {
    const bank = P.mapArchives?.[mapId]?.bank ?? null;
    if (bank === P.curBank) return;
    P.prevBank = P.curBank;
    P.curBank = bank;
  };

  // Area sound: resolves through the current map's bank, then the previous
  // map's still-resident bank; silent if neither has it (authentic).
  // `sustain: true` honors the sample's real loop points (ambient loops);
  // the caller then owns the voice lifetime via sfx.stop(name).
  P.player!.playArea = (name, { sustain = false } = {}) => {
    if (P.player!.muted || !P.ctx || !P.areaManifest) return;
    for (const bank of [P.curBank, P.prevBank]) {
      const meta = bank ? P.areaManifest[bank]?.[name] : null;
      if (meta) { startVoice!(name, meta, bank!, sustain); return; }
    }
  };

  // Play a sound named the way the ORIGINAL names it: by packed id. Decoded
  // overlay call sites carry the packed word (`0x800410bd`), not a stem, so a
  // system that extracts its cues straight out of the assembly can hand them
  // over untranslated.
  //
  // The lookup is built from the extracted manifests themselves, which already
  // carry each sound's packed `id` — deliberately NOT from a second catalog. A
  // separate file would be one more fetch that can fail on its own, and if it
  // did, every packed-id caller would go silently mute while every by-name
  // caller kept working: exactly the kind of failure nobody notices until they
  // are staring at an explosion wondering why it makes no noise. Both lists the
  // walker's own extraction writes feed it (the common bank, and the 71 per-map
  // banks a word's archive can address), and area_manifest.json lands after
  // manifest.json, so it is rebuilt when the later one arrives.
  //
  // Returns the sample key it played ("stem", or "bank:stem" for a per-map
  // bank), or null for an id with no extracted sample.
  P.player!.playPacked = (id, { overlap = false } = {}) => {
    if (!P.manifest) return null;
    if (!P.packedResolve || P.packedResolveFrom![0] !== P.manifest || P.packedResolveFrom![1] !== P.areaManifest) {
      P.packedResolve = packedSampleResolver(P.manifest, P.areaManifest!);
      P.packedResolveFrom = [P.manifest, P.areaManifest];
    }
    const hit = P.packedResolve(id);
    if (!hit) return null;
    const key = hit.bank ? `${hit.bank}:${hit.name}` : hit.name;
    // The same trace sfx.play keeps, so audits that listen for a sample name
    // still hear the screens that now play through the packed lookup.
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(String(key));
    const meta = hit.bank ? P.areaManifest?.[hit.bank]?.[hit.name] : P.manifest[hit.name];
    if (meta) startVoice!(hit.name, meta, hit.bank, false, overlap);
    return key;
  };

  // The packed id the exclusive-track register (D0x80055c34) holds, or 0. The
  // inn screen saves it before its jingle and plays it back afterwards.
  P.player!.exclusiveId = () => {
    const id = P.register!.id();
    return id && /^0x[0-9a-f]+$/.test(id) ? Number(id) >>> 0 : 0;
  };

  // Explicit archive trigger for decoded overlay calls that load their own
  // bank instead of using the current field archive (e.g. EVOLUTIO/evo_00
  // during manual DV and Blast presentation).
  P.player!.playBank = (bank, name, { sustain = false } = {}) => {
    // TRIGGER AUDIT HOOK — see uifont.js drawText. Inert unless armed.
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(`${bank}:${name}`);
    if (P.player!.muted || !P.ctx || !P.areaManifest) return;
    const meta = P.areaManifest[bank]?.[name];
    if (meta) startVoice!(name, meta, bank, sustain);
  };

  // One sound from a NAMED bank, with the key-off left to the caller. The
  // sound test holds Circle to hear a sound and releases it to stop (the
  // overlay's play/stop pair D0x80055c48 / D0x80055c50), so `sustain: true`
  // keeps the sample's own loop points alive and the caller stops it through
  // player.stop(name). Returns the key it started ("stem", or "bank:stem" for
  // a per-map bank), or null when this build has no sample for it -- the
  // screen turns that null into "no sample in this build" instead of going
  // silently mute.
  P.player!.playBankSound = (bank, name, { sustain = false } = {}) => {
    const meta = bank ? P.areaManifest?.[bank]?.[name] : P.manifest?.[name];
    if (!meta) return null;
    const key = bank ? `${bank}:${name}` : name;
    // The same trace sfx.play keeps, so audits that listen for a sample name
    // still hear the screens that now play through this entry point.
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(String(key));
    if (!P.player!.muted && P.ctx) startVoice!(name, meta, bank ?? null, sustain);
    return key;
  };

  // Key-off any timed battle voice still alive on this side.
  P.player!.stopBattle = (side = "player") => {
    const src = P.battleSrc![side];
    const voice = P.battleVoice![side];
    const phrase = P.battlePhrase![side];
    if (P.battleTimer![side]) { clearTimeout(P.battleTimer![side]); P.battleTimer![side] = null; }
    if (src) releaseExclusiveByName!(P.battleName![side]!);
    P.battleSrc![side] = null; P.battleName![side] = null; P.battleVoice![side] = -1;
    P.battlePhrase![side] = null;
    if (phrase) phrase.stop();
    else if (voice >= 0) P.pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
    P.battleGate!.release(side);
  };

  P.player!.debugEffectLoop = () => P.effectLoopName;
  // How many of the 24 hardware voices are keyed on right now. A 2D phrase
  // holds one per sounding NOTE, so this is the only thing that separates "the
  // cue played its note events" from "the cue played one stream".
  P.player!.debugVoices = () => P.pool.active();

  // Key-off any timed battle voice still alive on this side.
  P.player!.stopBattle = (side = "player") => {
    const src = P.battleSrc![side];
    const voice = P.battleVoice![side];
    const phrase = P.battlePhrase![side];
    if (P.battleTimer![side]) { clearTimeout(P.battleTimer![side]); P.battleTimer![side] = null; }
    if (src) releaseExclusiveByName!(P.battleName![side]!);
    P.battleSrc![side] = null; P.battleName![side] = null; P.battleVoice![side] = -1;
    P.battlePhrase![side] = null;
    if (phrase) phrase.stop();
    else if (voice >= 0) P.pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
    P.battleGate!.release(side);
  };

  P.player!.debugVoices = () => P.pool.active();

  // Key-off any timed battle voice still alive on this side.
  P.player!.stopBattle = (side = "player") => {
    const src = P.battleSrc![side];
    const voice = P.battleVoice![side];
    const phrase = P.battlePhrase![side];
    if (P.battleTimer![side]) { clearTimeout(P.battleTimer![side]); P.battleTimer![side] = null; }
    if (src) releaseExclusiveByName!(P.battleName![side]!);
    P.battleSrc![side] = null; P.battleName![side] = null; P.battleVoice![side] = -1;
    P.battlePhrase![side] = null;
    if (phrase) phrase.stop();
    else if (voice >= 0) P.pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
    P.battleGate!.release(side);
  };
}
