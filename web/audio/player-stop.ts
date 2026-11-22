/*
 * Everything that STOPS a cue: the stop entry points, the fades, the held and
 * looping cues they release, mute, and the resume on a user gesture.  Installed
 * onto `player`.
 */
import type { AudioEngine } from "../types/audio.js";

// The methods attach themselves to the `player` object the caller hands in,
// so this module needs nothing from createSfxPlayer but the shared context P.
// Split out of web/audio.ts; every call into the rest of the player goes through
// P (the tool rewrote the names when the helpers moved to audio/playback.ts).
export function installStopApi(P: AudioEngine) {
  const { releaseExclusiveByName, stopVoice } = P;

  P.player!.stopEffectLoop = () => {
    const src = P.effectLoopSrc;
    const voice = P.effectLoopVoice;
    const phrase = P.effectLoopPhrase;
    P.effectLoopSrc = null;
    P.effectLoopName = null;
    P.effectLoopVoice = -1;
    P.effectLoopPhrase = null;
    // keyOff is what stops the source — one stop per key-off, as on the SPU.
    if (phrase) phrase.stop();
    else if (voice! >= 0) P.pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
  };

  P.player!.stopSustained = (name) => {
    const src = P.sustainedSrc!.get(name);
    const voice = P.sustainedVoice!.get(name);
    const phrase = P.sustainedPhrase!.get(name);
    P.sustainedSrc!.delete(name);
    P.sustainedVoice!.delete(name);
    P.sustainedPhrase!.delete(name);
    if (phrase) phrase.stop();
    else if (voice !== undefined) P.pool.keyOff(voice);
    else if (src && typeof src.stop === "function") { try { src.stop(); } catch (e) { /* ended */ } }
  };

  P.player!.stopAllSustained = () => { for (const n of [...P.sustainedSrc!.keys()]) P.player!.stopSustained!(n); };
  // Dev accessors for the headless verifiers (Battle Lab is a dev surface, same
  // as window.__r). They report which sustained cue owns a voice right now, which
  // is the only thing that separates "started and stopped on the right frame"
  // from "the wrapper was called and nothing sounded".
  P.player!.debugSustained = () => [...P.sustainedSrc!.keys()];
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

  // F0x800202d4 — stop this sound now, and clear the exclusive-track register
  // if this sound is the one holding it.
  P.player!.stop = (name) => {
    for (const [slotKey, v] of [...P.voices]) if (v.name === name) stopVoice!(slotKey);
    releaseExclusiveByName!(name);
  };

  // F0x8002037c — the second stop entry point in the resident sound API
  // (pointer D0x80055c6c). Identical to the stop above except that it hands
  // F0x800306e0 a fade length of 0x3c frames on NTSC and 0x32 on PAL, i.e.
  // one second either way. Callers that hold a sustained cue (ambience, a
  // looping tech whirl) use this instead of cutting it dead.
  P.player!.stopFade = (name, seconds = 1) => {
    for (const [slotKey, v] of [...P.voices]) {
      if (v.name !== name) continue;
      P.voices!.delete(slotKey);
      // A phrase is ONE fade over every voice it holds, then the key-off, which
      // is what stopping the sound does to all of its notes at once.
      if (v.phrase) {
        const g = v.phrase.gain?.gain;
        try {
          if (g && P.ctx && typeof g.linearRampToValueAtTime === "function") {
            g.setValueAtTime(g.value, P.ctx.currentTime);
            g.linearRampToValueAtTime(0, P.ctx.currentTime + seconds);
          }
        } catch (e) { /* ramp unavailable — the key-off below still runs */ }
        setTimeout(() => v.phrase.stop(), seconds * 1000);
        continue;
      }
      const src = v.src;
      try {
        const g = v.gain?.gain;
        if (g && P.ctx && typeof g.linearRampToValueAtTime === "function") {
          g.setValueAtTime(g.value, P.ctx.currentTime);
          g.linearRampToValueAtTime(0, P.ctx.currentTime + seconds);
        }
      } catch (e) { /* ramp unavailable — fall through to the hard stop */ }
      // The voice stays busy for the whole fade, as it does in the original:
      // F0x800306e0 writes the downward delta and the duration into the voice
      // record and the SPU releases it when the ramp finishes.
      setTimeout(() => {
        if (v.voice !== undefined) P.pool.keyOff(v.voice);
        else { try { src.stop(); } catch (e) { /* ended */ } }
      }, seconds * 1000);
    }
    releaseExclusiveByName!(name);
  };

  // F0x80020204 — stop every slot on all three channels and clear the
  // exclusive-track register. The pool's own voices go with them, including the
  // ones no slot key tracks (a positional cue registers no key, and the battle
  // and sustained paths hold their own references).
  P.player!.stopAll = () => {
    for (const slotKey of [...P.voices!.keys()]) stopVoice!(slotKey);
    P.player!.stopAllSustained!();
    P.player!.stopEffectLoop!();
    for (const side of ["player", "enemy"] as const) {
      if (P.battleTimer![side]) { clearTimeout(P.battleTimer![side]); P.battleTimer![side] = null; }
      if (P.battlePhrase![side]) { P.battlePhrase![side].stop(); P.battlePhrase![side] = null; }
      if (P.battleVoice![side] >= 0) P.pool.keyOff(P.battleVoice![side]);
      P.battleSrc![side] = null; P.battleName![side] = null; P.battleVoice![side] = -1;
    }
    P.pool.stopAll();
    P.register!.clear();
  };

  P.player!.toggleMute = () => {
    P.player!.muted = !P.player!.muted;
    if (P.player!.muted) P.player!.stopAll!();
    return P.player!.muted;
  };

  // call on user gesture; Web Audio contexts start suspended pre-gesture
  P.player!.unlock = () => {
    if (P.ctx && P.ctx.state === "suspended") P.ctx.resume().catch(() => {});
  };

  // What the player is holding right now -- the readers the tests and the sound
  // test screen use to see what a stop would clear.
  P.player!.debugSustained = () => [...P.sustainedSrc!.keys()];
  P.player!.debugEffectLoop = () => P.effectLoopName;
  // How many of the 24 hardware voices are keyed on right now. A 2D phrase
  // holds one per sounding NOTE, so this is the only thing that separates "the
  // cue played its note events" from "the cue played one stream".
  P.player!.debugVoices = () => P.pool.active();
}
