import { BASE_GAIN, scaleGain, clampLevel } from "../volume-levels.js";
import type { AudioPlayer, RoutedAudio } from "./types.js";

// Browser autoplay policy: playback may only start after a user gesture,
// so play() failures before first input are expected and retried on gesture.

// ── D0x80055c34: the ONE exclusive-track register ──────────────────────────
// A bit-30 id (a stage track, a battle track, W_JINGLE, GAMEOVER, EVOLUTIO)
// goes through this register, which is a SINGLE global in the original: a
// start first stops whichever id is registered — through that holder's own
// stop entry — and then takes it; a start of the id already registered is not
// retriggered; and only an explicit stop-by-id / stop-all clears it, not a
// natural end (fns.s:17704-17717, 17827-17871, 17771-17825;
// docs/research/audio/sound-system.md; the rule the rig sweep settled in
// .dw3-research/rig-sweep-2026-10-05/audio-lifetime-model.md §6).  The bgm
// player and the sfx player share ONE instance, which is what makes leaving
// the results screen (the field track's start) end W_JINGLE, and what a
// digivolution's EVOLUTIO start does to the battle track.
export function createExclusiveRegister() {
  let held = null; // { key, name, stop }
  return {
    /**
     * A bit-30 start.  `false` when this exact id already holds the register
     * (the original returns without retriggering); otherwise the previous
     * holder is stopped through its owner's stop entry first, then this id
     * takes the register — stop-before-take, as the play body orders it.
     */
    begin(key, name, stop) {
      if (held && held.key === key) return false;
      const previous = held;
      held = null;
      if (previous && previous.stop) previous.stop();
      held = { key, name, stop };
      return true;
    },
    /** F0x800202d4 / F0x8002037c: clear iff the named id is the holder. */
    releaseName(name) { if (held && held.name === name) held = null; },
    /** F0x80020204 (`stopAll`) clears the register outright. */
    clear() { held = null; },
    /**
     * Stop whatever the register holds, through that holder's own stop entry, but
     * do not take the register and do not clear it by name: the tracked id is
     * dropped and its owner keys its voice off. This is the field's stage-entry
     * rule when the new stage has NO play id — fieldstg.s:8278-8281 loads the
     * latch at D0x800519ec+0x4248 and calls the stop callback on it — the one
     * driver-side stop a screen performs that is neither a stop-by-id nor a start.
     * s260 (the cargo tower) is the shipped stage with no music.
     */
    stopHeld() { const h = held; held = null; if (h && h.stop) h.stop(); },
    /** The key the register holds, or null. */
    id() { return held ? held.key : null; },
  };
}

export function createBgmPlayer(register = createExclusiveRegister()) {
  const el: RoutedAudio = new Audio();
  el.loop = true;
  el.volume = BASE_GAIN.music;
  let musicLevel = 1;                       // the OPTIONS music volume (web/volume-levels.js); 1 = the game's own 0.6
  const player = { muted: false, current: null, el } as AudioPlayer;

  // This track's own stop entry, handed to the register: the exclusive
  // replacement stops a registered track through it (and clears `current`,
  // so the same track can start again from the top later — the digivolution
  // replay needs exactly that).
  const stopCurrent = (trackId) => {
    if (player.current === trackId) { player.current = null; el.pause(); }
  };

  player.play = (trackId) => {
    if (trackId === player.current) return;
    if (!trackId) {
      // A stop-by-id: the register clears only when it still holds this track.
      const stopped = player.current;
      player.current = null;
      el.pause();
      if (stopped) register.releaseName(stopped);
      return;
    }
    // Every track this player starts is a bit-30 start: it goes through the
    // ONE register, so a track or jingle another subsystem started is dropped
    // here (wfightmn's W_JINGLE when the field track returns, EVOLUTIO when
    // the battle track replays).
    if (!register.begin(trackId, trackId, () => stopCurrent(trackId))) return;
    player.current = trackId;
    el.src = "assets/music/" + trackId + ".ogg";
    if (!player.muted) el.play().catch(() => {});  // blocked until user gesture
  };

  player.toggleMute = () => {
    player.muted = !player.muted;
    if (player.muted) el.pause();
    else el.play().catch(() => {});
    return player.muted;
  };

  // One-shot cues on their own elements, keyed by stem.  The pad cues
  // (digi_en0..2, login_dl) are NON-exclusive — bit 30 clear, separate slots
  // 0/1/2 on the disc — so they never take the register and never replace a
  // sibling: each stem keeps its own element and rings out beside the others.
  const jingles = new Map(); // stem -> HTMLAudioElement
  player.playJingle = (trackId) => {
    if (player.muted) return;
    let je = jingles.get(trackId);
    if (!je) { je = new Audio(); je.volume = scaleGain(BASE_GAIN.music, musicLevel); jingles.set(trackId, je); }
    je.src = "assets/music/" + trackId + ".ogg";
    je.play().catch(() => {});
  };

  /** OPTIONS music volume, 0..1 (1 = today). Applies to the track and to every jingle element. */
  player.setVolume = (level) => {
    musicLevel = clampLevel(level);
    // once web/fxaudio.js routes the element through its gain node (musicfx on), that gain carries the level: element stays at 1 x 0.6
    el.volume = scaleGain(BASE_GAIN.music, el.routedToGain ? 1 : musicLevel);
    for (const je of jingles.values()) je.volume = scaleGain(BASE_GAIN.music, musicLevel);
  };

  // call on every user gesture; resumes if autoplay was blocked
  player.unlock = () => {
    if (!player.muted && el.src && el.paused) el.play().catch(() => {});
  };

  return player;
}
