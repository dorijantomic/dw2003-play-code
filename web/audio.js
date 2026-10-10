// web/audio.js
import { battleVoiceGate } from "./battle-voice-gate.js";
import { packedSampleResolver } from "./packed-sound.js";
import {
  createSpuVoicePool, renderPhraseNote, PHRASE_SAMPLE_RATE as SAMPLE_RATE,
  SPU_NO_VOICE, SPU_VOICE_COUNT,
} from "./vendor/engine.js";

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
  const el = new Audio();
  el.loop = true;
  el.volume = 0.6;
  const player = { muted: false, current: null };

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
    if (!je) { je = new Audio(); je.volume = 0.6; jingles.set(trackId, je); }
    je.src = "assets/music/" + trackId + ".ogg";
    je.play().catch(() => {});
  };

  // call on every user gesture; resumes if autoplay was blocked
  player.unlock = () => {
    if (!player.muted && el.src && el.paused) el.play().catch(() => {});
  };

  return player;
}

// One-shot / looped SFX via Web Audio (docs/research/audio/sound-system.md):
// assets/sfx/manifest.json (generated by build_sfx.py) carries per-sound
// arbitration category (packed-id bits 18-24), dedup flag (bit 30) and real
// ADPCM loop points. Original arbitration (F0x80020030): at most one sound
// per category -- a new same-category sound stops the one playing. Dedup:
// skip retriggering while the SAME id is already playing in its category.
export function createSfxPlayer(register = createExclusiveRegister()) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = Ctx ? new Ctx() : null;
  const gain = ctx ? ctx.createGain() : null;
  if (gain) { gain.gain.value = 0.7; gain.connect(ctx.destination); }
  let manifest = null;
  const buffers = {}; // name -> AudioBuffer | Promise
  const player = { muted: false };
  const battleGate = battleVoiceGate();

  // ── the resident driver's real arbitration (EXE F0x8002006c and callees) ──
  // The packed id's bits 18-24 are the ARCHIVE id: F0x80020030 uses it only to
  // find which of the 3 channel records currently holds that archive. It is NOT
  // a mixer category, and nothing in the driver stops a sound because another
  // sound shares it. (sound-system.md retracted the "arbitration category"
  // reading on 2026-07-03b; this module still implemented it until now, which
  // made every common-bank cue cut every other one.)
  //
  // What actually arbitrates is two separate mechanisms:
  //
  //  1. Per-slot self-cut, 2D path only. Bit 31 clear -> F0x800335b4 ->
  //     F0x8003340c, whose first act is F0x800375ec(bank | slot<<8): a key-off
  //     of every hardware voice OWNED BY THAT (bank, slot). A sound therefore
  //     cuts its own previous instance and nothing else. Bit 31 SET takes
  //     F0x8003432c instead, which allocates a fresh voice and keys nothing
  //     off -- positional cues overlap freely.
  //
  //  2. The exclusive-track register, D0x80055c34 (= D0x800519ec+0x4248), a
  //     SINGLE global. Bit 30 set means: if the register already holds this
  //     exact id, return without retriggering; if it holds a DIFFERENT id,
  //     call the stop entry point on the old id first, then play and take the
  //     register. Only an explicit stop clears it (F0x800202d4/F0x8002037c
  //     store zero there, F0x80020204 clears it for stop-all) -- a natural
  //     end-of-sample does not.
  const voices = new Map(); // slotKey -> {name, src, gain, bank}
  // The one exclusive-track register (D0x80055c34), shared with the bgm player
  // so a start here ends a track there and vice versa — see
  // createExclusiveRegister above.

  // ── 3. the SPU voice pool, F0x80034b9c ──
  // Both of the original's paths take a voice from the SAME 24 slots: the
  // positional call at fns.s:39631 and the 2D phrase sequencer at fns.s:41033.
  // Web Audio has no such limit — it will happily stack a hundred voices — so
  // before this the walker could play sounds the original has no room for and
  // never had to cut one. The pool decides which voice a new sound takes: a
  // free one, else the lowest-priority voice at or below the request (least
  // sample left, then oldest), else nothing and the sound is DROPPED. The port
  // is engine/systems/spu-voice-pool.ts; the rule is read off the assembly
  // there, field by field.
  const pool = createSpuVoicePool({
    count: SPU_VOICE_COUNT,
    now: () => (ctx ? ctx.currentTime * 1000 : 0),
  });

  // The priority the allocator is handed. It is byte 0 of the disc's own tone
  // record — the same 32-byte record the sound build already reads for volume,
  // centre note and sample (fns.s:39603-39611: the pointer in D0x80082658 plus
  // (packed program * 16 + note) * 32, byte 0), so build_sfx.py carries it on
  // every manifest row. A row without one is a bank the build could not read,
  // and zero is the value the disc gives 752 of the 768 common tones.
  const voicePriority = (meta) => (Number.isFinite(meta?.priority) ? meta.priority : 0);

  // ── 4. the 2D phrases: ONE SPU VOICE PER NOTE-ON ──
  // A bit-31-clear id is a SEQ phrase, not one sample, and the original plays it
  // note by note: F0x8003581c asks F0x80034b9c once per note event (fns.s:41033)
  // with THAT NOTE's tone priority, and a refusal drops that note alone
  // (fns.s:41039-41040 writes -1 and continues the loop).
  //
  // So a phrase is scheduled, not triggered: every note takes its own voice from
  // the SAME pool at its own tick, and the note's note-off frees that slot while
  // the release is still ringing (both branches of the key-off clear the record
  // at once — F0x8003670c / F0x8003674c), so a phrase's tails never hold a slot
  // against the next sound. `web/sfx-voice/phrases.json` is that table
  // (generated by build_sfx.py from the disc's scores), and
  // engine/systems/phrase-notes.ts renders each note from the exact VAG sample
  // it plays — one sample, one pitch, one volume, one envelope, which is what
  // one SPU voice is.
  //
  // THE ARCHIVE IS PART OF THE NAME. A 2D cue is a block of the `.seq` file of
  // the archive its own id names (bits 18-24): F0x8002006c's 2D branch passes
  // `id & 0xff` to F0x800335b4 -> F0x8003340c, which addresses that archive's
  // own per-voice record (D0x800815a0[archive] + slot*0xB0, fns.s:38463-38478),
  // and F0x8002f59c walks that record's cursor through the score every tick
  // (fns.s:34376-34378 -> :34988). The archive's loader takes a free bank slot
  // and registers SIXTEEN phrases per `.seq` file (F0x8003086c, fns.s:35708,
  // called with `li $a2, 0x10` at fns.s:18226). So the table is keyed by archive
  // and then by name — a common-bank cue in `phrases`, every other archive's in
  // `banks` — and a sample is keyed `"<archive>:<VAB field>"`, because a VAB
  // field number means nothing outside the archive it was read from.
  //
  // A sound with no row for ITS archive is not a phrase (a bank whose score has
  // no such block, or a note table that failed to load) and falls through to the
  // single-source path, which is the mix the build has always shipped.

  const PHRASE_LEAD_S = 0.02;      // start the phrase this far ahead, so a note
                                  // at tick 0 can be given a voice before it sounds
  const PHRASE_CACHE_SAMPLES = 8e6;  // 16 MB of Int16 renders, oldest out first
  let phraseTablePromise = null;
  let phraseTable = null;
  const phraseSamples = new Map();  // vag -> Promise<Int16Array>
  const phraseRenders = new Map();  // render key -> Promise<Int16Array>
  let phraseRenderSamples = 0;

  function loadPhraseTable() {
    if (!phraseTablePromise) {
      phraseTablePromise = fetch("sfx-voice/phrases.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => (phraseTable = t))
        .catch(() => null);
    }
    return phraseTablePromise;
  }

  /** One 16-bit mono PCM WAV -> Int16Array. The build writes these itself. */
  function decodePcmWav(bytes) {
    const view = new DataView(bytes);
    const u8 = new Uint8Array(bytes);
    // An ArrayBuffer is not indexable: the chunk id has to be read through a
    // Uint8Array view, or every tag comes back empty and this returns silence.
    const tag = (at) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
    let at = 12;
    while (at + 8 <= u8.length) {
      const id = tag(at);
      const size = view.getUint32(at + 4, true);
      if (id === "data") return new Int16Array(bytes.slice(at + 8, at + 8 + size - (size % 2)));
      at += 8 + size + (size % 2);
    }
    return new Int16Array(0);
  }

  function phraseSampleFor(vag) {
    if (!phraseSamples.has(vag)) {
      phraseSamples.set(vag, loadPhraseTable()
        .then((t) => (t && t.samples && t.samples[vag]) || null)
        .then((row) => (row ? fetch("sfx-voice/" + row.file).then((r) => r.arrayBuffer())
          .then(decodePcmWav) : null))
        .catch(() => null));
    }
    return phraseSamples.get(vag);
  }

  /** Web Audio's buffers hold -1..1 floats; a rendered note is 16-bit PCM. */
  function toFloat32(pcm) {
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
    return out;
  }

  /**
   * The rendered audio of one note, shared by every note that plays it the same
   * way. `gain` is part of the key: two notes on one sample at one pitch and one
   * length can still be struck at different velocities, and jingle04's pad
   * layers differ by nothing else.
   */
  function phraseNoteAudio(note) {
    const key = `${note.sample}|${note.rate}|${note.relStart}|${note.release.mode}`
      + `|${note.release.seconds}|${note.gain}`;
    if (!phraseRenders.has(key)) {
      while (phraseRenderSamples > PHRASE_CACHE_SAMPLES) {
        const oldest = phraseRenders.keys().next().value;
        if (oldest === undefined) break;
        phraseRenderSamples -= phraseRenders.get(oldest).length || 0;
        phraseRenders.delete(oldest);
      }
      const pending = Promise.all([phraseSampleFor(note.sample), loadPhraseTable()])
        .then(([pcm, table]) => (pcm && table
          ? toFloat32(renderPhraseNote(pcm, table.samples[note.sample], note)) : null))
        .catch(() => null);
      phraseRenders.set(key, pending);
      pending.then((audio) => {
        if (!audio) { phraseRenders.delete(key); return; }
        phraseRenderSamples += audio.length;
      });
    }
    return phraseRenders.get(key);
  }

  /**
   * Play one phrase as its note events. Returns a handle that owns every voice
   * the phrase took, so a key-off (the 2D path's own-slot cut, `sfx.stop`,
   * `stopAll`, an op10 object's end) releases the whole phrase at once — which
   * is what F0x80035d38 does, matching on the sound's own fields and not on
   * which of its notes is still ringing. `onIdle` fires when the last note has
   * finished on its own, so a caller holding it by slot key can let go.
   */
  function startPhrase(row, onIdle) {
    return Promise.all(row.notes.map((note) => phraseNoteAudio(note)))
      .then((audios) => {
        if (player.muted || audios.some((a) => !a)) return null;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const t0 = ctx.currentTime + PHRASE_LEAD_S;
        const units = new Set();          // the voices this phrase still holds
        const timers = [];
        const phraseGain = ctx.createGain();
        if (phraseGain.gain) phraseGain.gain.value = 1;
        phraseGain.connect(gain);
        let stopped = false;
        const later = (ms, fn) => { if (ms > 0) timers.push(setTimeout(fn, ms)); else fn(); };
        const stop = () => {
          if (stopped) return;
          stopped = true;
          for (const t of timers) clearTimeout(t);
          // One key-off per voice this phrase still holds, and nothing else. A
          // note whose slot its own note-off already freed holds no record, so
          // the key-off would do nothing to it and its release would ring on
          // after the sound was stopped: cut those sources directly. Deciding by
          // the pool's own record is what keeps this at ONE stop per voice --
          // the original's voice count is audible in the stop log.
          for (const u of [...units]) {
            const rec = pool.records[u.voice];
            if (rec && rec.occupant && rec.occupant.src === u.src) pool.keyOff(u.voice);
            else { try { u.src.stop(); } catch (e) { /* ended */ } }
          }
          units.clear();
          try { phraseGain.disconnect(); } catch (e) { /* already gone */ }
          onIdle?.();
        };
        row.notes.forEach((note, i) => {
          const audio = audios[i];
          const at = t0 + note.start / SAMPLE_RATE;
          const begin = () => {
            if (stopped || player.muted) return;
            // A voice with no audio is silent, and Web Audio has no 0-frame
            // buffer: nothing to give a voice, exactly as the SPU playing an
            // empty sample is nothing to hear.
            if (!audio || !audio.length) return;
            // One allocator call per note-on, with that note's own priority.
            const took = pool.allocate(note.priority);
            if (!took) return;                       // dropped: the SPU has no voice
            if (took.evicted) took.evicted.release();
            const buf = ctx.createBuffer(1, audio.length, SAMPLE_RATE);
            buf.copyToChannel ? buf.copyToChannel(audio, 0) : buf.getChannelData(0).set(audio);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(phraseGain);
            const unit = { voice: took.index, src };
            units.add(unit);
            src.onended = () => {
              pool.finish(took.index, src);
              units.delete(unit);
              if (!units.size) onIdle?.();
            };
            src.start(at);
            // The tie-break reads "sample left" (voice +0x04): this voice's own
            // audio, its note-off plus the tone's release.
            pool.setLength(took.index, (audio.length * 1000) / SAMPLE_RATE);
            pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
            // This note's note-off frees the pool slot and lets the release ring,
            // which is what F0x80035d38's key-off does to every matching voice:
            // the record goes at once (F0x8003670c / F0x8003674c) and the
            // SPU's envelope finishes the note on its own.
            const offAt = at + note.relStart / SAMPLE_RATE;
            later((offAt - ctx.currentTime) * 1000, () => pool.noteOff(took.index, src));
          };
          later((note.start / SAMPLE_RATE - PHRASE_LEAD_S) * 1000, begin);
        });
        return { stop, gain: phraseGain, units: () => [...units].map((u) => u.src) };
      });
  }

  /**
   * Is this sound a 2D phrase, i.e. does ITS ARCHIVE have a row of note events
   * for it? Asked once per trigger so the first press cannot take the
   * single-source path because the note table had not loaded yet; `run(row)`
   * plays the notes, and `otherwise()` is the single-source path for a sound
   * that is not a phrase. `bank` is null for the common bank.
   */
  function whenPhraseRow(name, bank, run, otherwise) {
    if (phraseTable) { const row = phraseRowFor(name, bank); if (row) run(row); else otherwise(); return; }
    loadPhraseTable().then((t) => {
      const row = t && phraseRowFor(name, bank);
      if (row) run(row); else otherwise();
    }).catch(() => otherwise());
  }

  /** How long this source's audio runs, in ms — the pool's tie-break reads it. */
  const lengthMsOf = (src, buf) => (buf.duration * 1000) / (src.playbackRate?.value || 1);

  // The (bank, slot) pair the driver keys off, derived from the packed id:
  // archive = bits 18-24, row = bits 8-15 (selects the bank through the
  // channel's +0x4208 row array), slot = bits 0-7. Positional ids get no key
  // because their path never keys anything off.
  function slotKeyFor(name, meta, bank) {
    if (meta.positional) return null;
    const id = meta.id ? Number(meta.id) : NaN;
    if (Number.isFinite(id)) {
      return `${(id >>> 18) & 0x7f}:${(id >>> 8) & 0xff}:${id & 0xff}`;
    }
    return `${bank ?? "common"}/${name}`;
  }

  // Identity of the exclusive-track register: the packed id when we have one.
  const exclusiveKeyFor = (name, meta, bank) =>
    (meta.id ? String(meta.id).toLowerCase() : `${bank ?? "common"}/${name}`);

  function stopVoice(slotKey) {
    const v = voices.get(slotKey);
    if (!v) return;
    voices.delete(slotKey);
    // A 2D phrase holds one voice per note-on, and the original's key-off for
    // it (F0x80035d38) releases the whole sound, so all of them go together.
    if (v.phrase) { v.phrase.stop(); return; }
    if (v.voice !== undefined) pool.keyOff(v.voice);
    else { try { v.src.stop(); } catch (e) { /* already ended */ } }
  }

  // F0x800202d4 / F0x8002037c: they clear the exclusive register only when it
  // is this very sound that holds it (`bne $v0, $s1` guards the store).
  function releaseExclusiveByName(name) {
    register.releaseName(name);
  }

  // Area (per-map bank) sounds -- sound-system.md 2026-07-03d: each map loads
  // ONE swappable sound archive (map_sound_archives.json); area SFX resolve
  // through the CURRENT map's bank (doors get a per-map timbre; silent where
  // the bank lacks the program -- authentic F0x80037d0c behavior). The two
  // hardware channels hold the current + previous map's archives, so the
  // previous bank is kept as a fallback.
  let areaManifest = null;
  let mapArchives = null;
  let curBank = null;
  let prevBank = null;

  fetch("assets/sfx/manifest.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { manifest = m; })
    .catch(() => { manifest = {}; });
  fetch("assets/sfx/area_manifest.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { areaManifest = m; })
    .catch(() => { areaManifest = {}; });
  fetch("assets/data/map_sound_archives.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => { mapArchives = m; })
    .catch(() => { mapArchives = {}; });
  // The 2D phrase note table, asked for with the other manifests: without it a
  // cue would play as one source on its first press and as its notes after.
  loadPhraseTable();

  function bufferFor(name, bank = null) {
    const key = bank ? bank + "/" + name : name;
    if (!buffers[key]) {
      const url = bank
        ? "assets/sfx/area/" + bank + "/" + name + ".wav"
        : "assets/sfx/" + name + ".wav";
      buffers[key] = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => (buffers[key] = buf))
        .catch(() => { delete buffers[key]; });
    }
    return buffers[key];
  }

  // The note table row for a 2D phrase, or null when this sound is not one.
  // The ARCHIVE the sound was asked for is part of the lookup: a common-bank cue
  // is in `phrases`, and every other archive's are in `banks` under the archive's
  // name. So an area cue is answered by its own archive's score and never by a
  // common-bank cue that happens to share its name, and a VAG field number in a
  // row means nothing outside the archive that row belongs to.
  const phraseRowFor = (name, bank) => (bank
    ? (phraseTable && phraseTable.banks && phraseTable.banks[bank]?.[name]) || null
    : (phraseTable && phraseTable.phrases && phraseTable.phrases[name]) || null);

  // `overlap` = skip the per-slot self-cut and do not register the voice.
  // Kept for call sites that fire one sound repeatedly and want every instance
  // to ring out (the Fire-Dungeon trap: three explosions half a second apart
  // out of a sound over a second long). With the corrected model this is only
  // a deliberate override, no longer a workaround for category arbitration.
  function startVoice(name, meta, bank, sustain = false, overlap = false) {
    const slotKey = overlap ? null : slotKeyFor(name, meta, bank);
    // Bit 30 goes through the ONE exclusive-track register: a different id
    // first stops the register's holder through its own stop entry, and the
    // same id does not retrigger.  The register is shared with the bgm player,
    // so EVOLUTIO's start here ends the battle track there, and W_JINGLE's
    // start here ends whatever track the bgm held.
    if (meta.dedup
      && !register.begin(exclusiveKeyFor(name, meta, bank), name, () => stopVoice(slotKey))) {
      return;
    }
    // The single-source path: a sound whose archive has no phrase row (so the
    // bank does not ship that block — authentic silence or a flat sample), or
    // one whose note table has not loaded.
    const oneSource = () => {
      Promise.resolve(bufferFor(name, bank)).then((buf) => {
        if (player.muted || !(buf instanceof AudioBuffer)) return;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        // Per-slot self-cut: only this same (bank, slot) is keyed off. The
        // original keys off BEFORE it asks for a voice (fns.s:38511,
        // F0x8003340c's first act), so the freed voice is available to this one.
        if (slotKey) stopVoice(slotKey);
        // Then ask the pool. A refusal is a dropped sound, not a quiet one:
        // F0x8003432c returns -1 (fns.s:39637-39642) and the sequencer bails
        // (fns.s:41039-41040), both without a sound.
        const took = pool.allocate(voicePriority(meta));
        if (!took) return;
        if (took.evicted) took.evicted.release();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        // decoded note-vs-center pitch (manifest `rate`; 1.0 on the 2D path)
        if (meta.rate && meta.rate !== 1) src.playbackRate.value = meta.rate;
        // ADPCM loop points make a voice SUSTAIN on the SPU until key-off; a
        // one-shot trigger has no key-off here, so honoring them would loop
        // forever (user-reported: RECOVERY looped like music). Only sustain
        // for callers that manage the voice lifetime (sfx.stop / ambience).
        if (meta.loop && sustain) {
          src.loop = true;
          src.loopStart = meta.loop.start;
          src.loopEnd = meta.loop.end;
        }
        // Own gain node per voice so the fading stop entry point below has
        // something to ramp; the SPU does the same with its per-voice volume.
        const vg = ctx.createGain();
        if (vg.gain) vg.gain.value = 1;
        vg.connect(gain);
        src.connect(vg);
        src.onended = () => {
          const v = slotKey ? voices.get(slotKey) : null;
          if (v && v.src === src) voices.delete(slotKey);
          pool.finish(took.index, src);
          // The exclusive register is NOT cleared here: in the original only an
          // explicit stop stores zero at D0x80055c34.
        };
        src.start(0);
        pool.setLength(took.index, lengthMsOf(src, buf));
        pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        if (slotKey) voices.set(slotKey, { name, src, gain: vg, bank: bank ?? null, voice: took.index });
      });
    };
    whenPhraseRow(name, bank, (row) => {
      // Per-slot self-cut first, exactly as the single-source path below: the
      // original keys off before it asks for a voice (fns.s:38511), so the freed
      // voice is available to this one. Then the phrase takes one voice per
      // note-on.
      if (slotKey) stopVoice(slotKey);
      startPhrase(row, () => {
        if (slotKey && voices.get(slotKey)?.phrase) voices.delete(slotKey);
      }).then((phrase) => {
        if (phrase && slotKey) {
          voices.set(slotKey, { name, src: null, gain: null, bank: bank ?? null, phrase });
        }
      });
    }, oneSource);
  }

  // `name` = lowercased soundtst name, a key in manifest.json (common bank).
  player.play = (name) => {
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(String(name));
    if (player.muted || !ctx || !manifest) return;
    const meta = manifest[name];
    if (meta) startVoice(name, meta, null);
  };

  // Battle op10 sound. The op10 handler's second operand is a sound-object
  // lifetime: 0 = direct one-shot, nonzero = create a timed object in
  // context+0xc. Only timed objects use the per-side drop gate and key-off
  // loop-pointed samples after their authored frame duration.
  //
  // Battle voices are not registered in the per-slot voice map above: op10
  // sounds get their own SPU voices and the walker owns their lifetime through
  // the timed-object gate rather than through a (bank, slot) self-cut. The one
  // piece of shared machinery that DOES apply is the exclusive-track register
  // (bit 30), which is a single global in the original and so is shared here.
  // (This path used to be excluded from the retracted per-archive cut, which
  // silenced sustained tech loops like the Sylph-Storm whirl; that cut no
  // longer exists anywhere in this module.)
  const battleSrc = { player: null, enemy: null };
  const battleName = { player: null, enemy: null };
  const battleVoice = { player: -1, enemy: -1 };
  const battlePhrase = { player: null, enemy: null };
  const battleTimer = { player: null, enemy: null };
  player.playBattle = (name, side = "player", durationFrames = 0) => {
    if (player.muted || !ctx || !manifest) return;
    const meta = manifest[name];
    if (!meta) return;
    // Bit 30 on the battle path takes the SAME single register (D0x80055c34 is
    // one global, not a per-side field); its stop entry is this side's voice.
    const exKey = exclusiveKeyFor(name, meta, null);
    if (meta.dedup && !register.begin(exKey, name, () => player.stopBattle(side))) return;
    const duration = Math.max(0, durationFrames | 0);
    if (duration > 0 && !battleGate.acquire(side)) return;   // timed effect slot busy -> drop
    // An op10 sound whose id is a 2D phrase (the eight *_STEP/*_DOWN thuds are:
    // op10 types 10-17, tech-effects-decode.md) is a SEQUENCE of notes, and the
    // original takes one SPU voice per note-on for it like any other 2D cue.
    const oneBattleSource = () => {
      Promise.resolve(bufferFor(name, null)).then((buf) => {
        if (player.muted || !(buf instanceof AudioBuffer)) { if (duration > 0) battleGate.release(side); return; }
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        // An op10 sound is a normal packed-sound play, so it asks the same pool
        // for a voice as any other cue (fns.s:41033). The per-side gate above is
        // a separate rule — fightstg's one effect object per side — and it does
        // not replace this one.
        const took = pool.allocate(voicePriority(meta));
        if (!took) { if (duration > 0) battleGate.release(side); return; }
        if (took.evicted) took.evicted.release();
        const src = ctx.createBufferSource();
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
        src.connect(gain);
        let timer = null;
        const clear = () => {
          if (timer) { clearTimeout(timer); timer = null; }
          if (battleSrc[side] === src) { battleSrc[side] = null; battleName[side] = null; battleVoice[side] = -1; }
          pool.finish(took.index, src);
          if (duration > 0) battleGate.release(side);
        };
        src.onended = clear;
        src.start(0);
        pool.setLength(took.index, lengthMsOf(src, buf));
        pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        if (duration > 0) {
          battleSrc[side] = src;
          battleName[side] = name;
          battleVoice[side] = took.index;
          timer = setTimeout(() => {
            try { src.stop(); } catch (e) { /* already stopped */ }
            clear();
          }, (duration / 60) * 1000);
        }
      }).catch(() => { if (duration > 0) battleGate.release(side); });
    };
    whenPhraseRow(name, null, (row) => {
      startPhrase(row, () => {
        if (battlePhrase[side]?.units().length === 0) battlePhrase[side] = null;
      }).then((h) => {
        if (!h) { if (duration > 0) battleGate.release(side); return; }
        battlePhrase[side] = h;
        if (duration > 0) {
          battleName[side] = name;
          battleTimer[side] = setTimeout(() => {
            h.stop();
            if (battlePhrase[side] === h) battlePhrase[side] = null;
            battleTimer[side] = null;
            battleGate.release(side);
          }, (duration / 60) * 1000);
        }
      });
    }, oneBattleSource);
  };
  // The special-attack effect pack's own sustained voice. This is NOT an op10:
  // fightstg F0x80086304 builds the pack from SFSTDATA[sigEffect], plays the
  // packed id at 0x800a2498[rec+0x08] (BT_LOOP0..7, one per element), keeps the
  // returned voice handle in the effect object at +0xe4, and on teardown calls
  // the stop-by-(id, handle) entry [0x80055c50] with exactly that pair. So the
  // loop belongs to the pack, not to a side, and it has one owner at a time.
  // Its id has bit 31 set and bit 30 clear -> the positional path, which
  // allocates a fresh voice and keys nothing else off.
  let effectLoopSrc = null;
  let effectLoopName = null;
  let effectLoopVoice = -1;
  let effectLoopPhrase = null;
  player.playEffectLoop = (name) => {
    if (player.muted || !ctx || !manifest) return;
    const meta = manifest[name];
    if (!meta) return;
    player.stopEffectLoop();            // one pack at a time, as one +0xe4 handle allows
    effectLoopName = name;
    // A 2D phrase on the effect-pack path runs as its note events too.
    const oneEffectLoop = () => {
      Promise.resolve(bufferFor(name, null)).then((buf) => {
        // A second cast may have started (or stopped us) while the buffer decoded.
        if (player.muted || effectLoopName !== name || !(buf instanceof AudioBuffer)) return;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const took = pool.allocate(voicePriority(meta));
        if (!took) { effectLoopName = null; return; }
        if (took.evicted) took.evicted.release();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const rate = meta.battleRate ?? meta.rate;
        if (rate && rate !== 1) src.playbackRate.value = rate;
        if (meta.loop) {                  // bit 29 of the packed id = a looping sample
          src.loop = true;
          src.loopStart = meta.loop.start;
          src.loopEnd = meta.loop.end;
        }
        src.connect(gain);
        src.onended = () => {
          pool.finish(took.index, src);
          if (effectLoopSrc === src) { effectLoopSrc = null; effectLoopName = null; effectLoopVoice = -1; }
        };
        src.start(0);
        pool.setLength(took.index, lengthMsOf(src, buf));
        pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        effectLoopSrc = src;
        effectLoopVoice = took.index;
      }).catch(() => { if (effectLoopName === name) effectLoopName = null; });
    };
    whenPhraseRow(name, null, (row) => {
      startPhrase(row, () => {
        if (effectLoopPhrase?.units().length === 0) effectLoopPhrase = null;
      }).then((h) => {
        if (!h || player.muted || effectLoopName !== name) { h?.stop(); return; }
        effectLoopPhrase = h;
      });
    }, oneEffectLoop);
  };
  player.stopEffectLoop = () => {
    const src = effectLoopSrc;
    const voice = effectLoopVoice;
    const phrase = effectLoopPhrase;
    effectLoopSrc = null;
    effectLoopName = null;
    effectLoopVoice = -1;
    effectLoopPhrase = null;
    // keyOff is what stops the source — one stop per key-off, as on the SPU.
    if (phrase) phrase.stop();
    else if (voice >= 0) pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
  };

  // A battle cue held open until an explicit stop marker, rather than by a
  // duration. The decoded case is the signature-attack whirl: action clip 11
  // opens with op10 type 89 (EX_AT_LP, packed 0x20040006 — bit 29 set, so the
  // sample loops) and closes with op10 type 91, which fightstg F0x8009b774
  // turns into a call to the immediate-stop entry [0x80055c68] on that exact
  // id. 0x20040006 has bit 31 clear, so it takes the 2D path, whose self-cut
  // keys off only the previous voice of the same (bank, slot) — i.e. its own
  // earlier instance and nothing else. Keyed by sample name for that reason.
  const sustainedSrc = new Map();
  const sustainedVoice = new Map();
  const sustainedPhrase = new Map();
  player.playSustained = (name) => {
    if (player.muted || !ctx || !manifest) return;
    const meta = manifest[name];
    if (!meta) return;
    player.stopSustained(name);           // the 2D path's own-slot key-off
    const token = {};
    sustainedSrc.set(name, token);        // claim the slot before the buffer resolves
    // The cue this holds open (EX_AT_LP, bit 31 clear) is a phrase, so it runs
    // as its note events and the stop marker releases every voice it took.
    whenPhraseRow(name, null, (row) => {
      startPhrase(row, () => {
        if (sustainedPhrase.get(name)?.units().length === 0) sustainedPhrase.delete(name);
      }).then((h) => {
        if (!h || player.muted || sustainedSrc.get(name) !== token) {
          if (sustainedSrc.get(name) === token) sustainedSrc.delete(name);
          h?.stop();
          return;
        }
        sustainedSrc.set(name, h);
        sustainedPhrase.set(name, h);
      });
    }, () => {
      Promise.resolve(bufferFor(name, null)).then((buf) => {
        if (player.muted || sustainedSrc.get(name) !== token || !(buf instanceof AudioBuffer)) return;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const took = pool.allocate(voicePriority(meta));
        if (!took) { sustainedSrc.delete(name); return; }
        if (took.evicted) took.evicted.release();
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const rate = meta.battleRate ?? meta.rate;
        if (rate && rate !== 1) src.playbackRate.value = rate;
        if (meta.loop) { src.loop = true; src.loopStart = meta.loop.start; src.loopEnd = meta.loop.end; }
        src.connect(gain);
        src.onended = () => {
          pool.finish(took.index, src);
          if (sustainedSrc.get(name) === src) { sustainedSrc.delete(name); sustainedVoice.delete(name); }
        };
        src.start(0);
        pool.setLength(took.index, lengthMsOf(src, buf));
        pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        sustainedSrc.set(name, src);
        sustainedVoice.set(name, took.index);
      }).catch(() => { if (sustainedSrc.get(name) === token) sustainedSrc.delete(name); });
    });
  };
  player.stopSustained = (name) => {
    const src = sustainedSrc.get(name);
    const voice = sustainedVoice.get(name);
    const phrase = sustainedPhrase.get(name);
    sustainedSrc.delete(name);
    sustainedVoice.delete(name);
    sustainedPhrase.delete(name);
    if (phrase) phrase.stop();
    else if (voice !== undefined) pool.keyOff(voice);
    else if (src && typeof src.stop === "function") { try { src.stop(); } catch (e) { /* ended */ } }
  };

  player.stopAllSustained = () => { for (const n of [...sustainedSrc.keys()]) player.stopSustained(n); };
  // Dev accessors for the headless verifiers (Battle Lab is a dev surface, same
  // as window.__r). They report which sustained cue owns a voice right now, which
  // is the only thing that separates "started and stopped on the right frame"
  // from "the wrapper was called and nothing sounded".
  player.debugSustained = () => [...sustainedSrc.keys()];
  player.debugEffectLoop = () => effectLoopName;
  // How many of the 24 hardware voices are keyed on right now. A 2D phrase
  // holds one per sounding NOTE, so this is the only thing that separates "the
  // cue played its note events" from "the cue played one stream".
  player.debugVoices = () => pool.active();

  // Key-off any timed battle voice still alive on this side.
  player.stopBattle = (side = "player") => {
    const src = battleSrc[side];
    const voice = battleVoice[side];
    const phrase = battlePhrase[side];
    if (battleTimer[side]) { clearTimeout(battleTimer[side]); battleTimer[side] = null; }
    if (src) releaseExclusiveByName(battleName[side]);
    battleSrc[side] = null; battleName[side] = null; battleVoice[side] = -1;
    battlePhrase[side] = null;
    if (phrase) phrase.stop();
    else if (voice >= 0) pool.keyOff(voice);
    else if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
    battleGate.release(side);
  };

  // Tell the player which map is active so area sounds resolve through its
  // bank (previous map's bank kept as the second-channel fallback).
  player.setMap = (mapId) => {
    const bank = mapArchives?.[mapId]?.bank ?? null;
    if (bank === curBank) return;
    prevBank = curBank;
    curBank = bank;
  };

  // Area sound: resolves through the current map's bank, then the previous
  // map's still-resident bank; silent if neither has it (authentic).
  // `sustain: true` honors the sample's real loop points (ambient loops);
  // the caller then owns the voice lifetime via sfx.stop(name).
  player.playArea = (name, { sustain = false } = {}) => {
    if (player.muted || !ctx || !areaManifest) return;
    for (const bank of [curBank, prevBank]) {
      const meta = bank ? areaManifest[bank]?.[name] : null;
      if (meta) { startVoice(name, meta, bank, sustain); return; }
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
  let packedResolve = null;
  let packedResolveFrom = null;
  player.playPacked = (id, { overlap = false } = {}) => {
    if (!manifest) return null;
    if (!packedResolve || packedResolveFrom[0] !== manifest || packedResolveFrom[1] !== areaManifest) {
      packedResolve = packedSampleResolver(manifest, areaManifest);
      packedResolveFrom = [manifest, areaManifest];
    }
    const hit = packedResolve(id);
    if (!hit) return null;
    const key = hit.bank ? `${hit.bank}:${hit.name}` : hit.name;
    // The same trace sfx.play keeps, so audits that listen for a sample name
    // still hear the screens that now play through the packed lookup.
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(String(key));
    const meta = hit.bank ? areaManifest?.[hit.bank]?.[hit.name] : manifest[hit.name];
    if (meta) startVoice(hit.name, meta, hit.bank, false, overlap);
    return key;
  };

  // The packed id the exclusive-track register (D0x80055c34) holds, or 0. The
  // inn screen saves it before its jingle and plays it back afterwards.
  player.exclusiveId = () => {
    const id = register.id();
    return id && /^0x[0-9a-f]+$/.test(id) ? Number(id) >>> 0 : 0;
  };

  // Explicit archive trigger for decoded overlay calls that load their own
  // bank instead of using the current field archive (e.g. EVOLUTIO/evo_00
  // during manual DV and Blast presentation).
  player.playBank = (bank, name, { sustain = false } = {}) => {
    // TRIGGER AUDIT HOOK — see uifont.js drawText. Inert unless armed.
    if (globalThis.__sfxTrace) globalThis.__sfxTrace.add(`${bank}:${name}`);
    if (player.muted || !ctx || !areaManifest) return;
    const meta = areaManifest[bank]?.[name];
    if (meta) startVoice(name, meta, bank, sustain);
  };

  // F0x800202d4 — stop this sound now, and clear the exclusive-track register
  // if this sound is the one holding it.
  player.stop = (name) => {
    for (const [slotKey, v] of [...voices]) if (v.name === name) stopVoice(slotKey);
    releaseExclusiveByName(name);
  };

  // F0x8002037c — the second stop entry point in the resident sound API
  // (pointer D0x80055c6c). Identical to the stop above except that it hands
  // F0x800306e0 a fade length of 0x3c frames on NTSC and 0x32 on PAL, i.e.
  // one second either way. Callers that hold a sustained cue (ambience, a
  // looping tech whirl) use this instead of cutting it dead.
  player.stopFade = (name, seconds = 1) => {
    for (const [slotKey, v] of [...voices]) {
      if (v.name !== name) continue;
      voices.delete(slotKey);
      // A phrase is ONE fade over every voice it holds, then the key-off, which
      // is what stopping the sound does to all of its notes at once.
      if (v.phrase) {
        const g = v.phrase.gain?.gain;
        try {
          if (g && ctx && typeof g.linearRampToValueAtTime === "function") {
            g.setValueAtTime(g.value, ctx.currentTime);
            g.linearRampToValueAtTime(0, ctx.currentTime + seconds);
          }
        } catch (e) { /* ramp unavailable — the key-off below still runs */ }
        setTimeout(() => v.phrase.stop(), seconds * 1000);
        continue;
      }
      const src = v.src;
      try {
        const g = v.gain?.gain;
        if (g && ctx && typeof g.linearRampToValueAtTime === "function") {
          g.setValueAtTime(g.value, ctx.currentTime);
          g.linearRampToValueAtTime(0, ctx.currentTime + seconds);
        }
      } catch (e) { /* ramp unavailable — fall through to the hard stop */ }
      // The voice stays busy for the whole fade, as it does in the original:
      // F0x800306e0 writes the downward delta and the duration into the voice
      // record and the SPU releases it when the ramp finishes.
      setTimeout(() => {
        if (v.voice !== undefined) pool.keyOff(v.voice);
        else { try { src.stop(); } catch (e) { /* ended */ } }
      }, seconds * 1000);
    }
    releaseExclusiveByName(name);
  };

  // F0x80020204 — stop every slot on all three channels and clear the
  // exclusive-track register. The pool's own voices go with them, including the
  // ones no slot key tracks (a positional cue registers no key, and the battle
  // and sustained paths hold their own references).
  player.stopAll = () => {
    for (const slotKey of [...voices.keys()]) stopVoice(slotKey);
    player.stopAllSustained();
    player.stopEffectLoop();
    for (const side of ["player", "enemy"]) {
      if (battleTimer[side]) { clearTimeout(battleTimer[side]); battleTimer[side] = null; }
      if (battlePhrase[side]) { battlePhrase[side].stop(); battlePhrase[side] = null; }
      if (battleVoice[side] >= 0) pool.keyOff(battleVoice[side]);
      battleSrc[side] = null; battleName[side] = null; battleVoice[side] = -1;
    }
    pool.stopAll();
    register.clear();
  };

  player.toggleMute = () => {
    player.muted = !player.muted;
    if (player.muted) player.stopAll();
    return player.muted;
  };

  // call on user gesture; Web Audio contexts start suspended pre-gesture
  player.unlock = () => {
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  };

  return player;
}
