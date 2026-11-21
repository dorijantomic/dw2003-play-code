import { renderPhraseNote, PHRASE_SAMPLE_RATE as SAMPLE_RATE } from "../vendor/engine.js";
import type { AudioEngine } from "../types/audio.js";
import type { PhraseVoice } from "./types.js";

// moved by tools/rewrite/split-closure.mjs
export function makePlayback(P: AudioEngine) {
function loadPhraseTable() {
    if (!P.phraseTablePromise) {
      P.phraseTablePromise = fetch("sfx-voice/phrases.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((t) => (P.phraseTable = t))
        .catch(() => null);
    }
    return P.phraseTablePromise;
  }
/** One 16-bit mono PCM WAV -> Int16Array. The build writes these itself. */
  function decodePcmWav(bytes) {
    const view = new DataView(bytes);
    const u8 = new Uint8Array(bytes);
    // An ArrayBuffer is not indexable: the chunk id has to be read through a
    // Uint8Array view, or every tag comes back empty and this returns silence.
    const tag = (at: number) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
    let at = 12;
    while (at + 8 <= u8.length) {
      const id = tag(at);
      const size = view.getUint32(at + 4, true);
      if (id === "data") return new Int16Array(bytes.slice(at + 8, at + 8 + size - (size % 2)));
      at += 8 + size + (size % 2);
    }
    return new Int16Array(0);
  }
function phraseSampleFor(vag: string) {
    if (!P.phraseSamples.has(vag)) {
      P.phraseSamples.set(vag, loadPhraseTable()
        .then((t) => (t && t.samples && t.samples[vag]) || null)
        .then((row) => (row ? fetch("sfx-voice/" + row.file).then((r) => r.arrayBuffer())
          .then(decodePcmWav) : null))
        .catch(() => null));
    }
    return P.phraseSamples.get(vag);
  }
/** Web Audio's buffers hold -1..1 floats; a rendered note is 16-bit PCM. */
  function toFloat32(pcm: Int16Array<ArrayBuffer>) {
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
    if (!P.phraseRenders.has(key)) {
      while (P.phraseRenderSamples > P.PHRASE_CACHE_SAMPLES) {
        const oldest = P.phraseRenders.keys().next().value;
        if (oldest === undefined) break;
        P.phraseRenderSamples -= P.phraseRenders.get(oldest).length || 0;
        P.phraseRenders.delete(oldest);
      }
      const pending = Promise.all([phraseSampleFor(note.sample), loadPhraseTable()])
        .then(([pcm, table]) => (pcm && table
          ? toFloat32(renderPhraseNote(pcm, table.samples[note.sample], note)) : null))
        .catch(() => null);
      P.phraseRenders.set(key, pending);
      pending.then((audio) => {
        if (!audio) { P.phraseRenders.delete(key); return; }
        P.phraseRenderSamples += audio.length;
      });
    }
    return P.phraseRenders.get(key);
  }
/**
   * Is this sound a 2D phrase, i.e. does ITS ARCHIVE have a row of note events
   * for it? Asked once per trigger so the first press cannot take the
   * single-source path because the note table had not loaded yet; `run(row)`
   * plays the notes, and `otherwise()` is the single-source path for a sound
   * that is not a phrase. `bank` is null for the common bank.
   */
  function whenPhraseRow(name: string, bank: string | null, run, otherwise: { (): void; (): void; }) {
    if (P.phraseTable) { const row = P.phraseRowFor(name, bank); if (row) run(row); else otherwise(); return; }
    loadPhraseTable().then((t) => {
      const row = t && P.phraseRowFor(name, bank);
      if (row) run(row); else otherwise();
    }).catch(() => otherwise());
  }
function bufferFor(name: string, bank = null) {
    const key = bank ? bank + "/" + name : name;
    if (!P.buffers[key]) {
      const url = bank
        ? "assets/sfx/area/" + bank + "/" + name + ".wav"
        : "assets/sfx/" + name + ".wav";
      P.buffers[key] = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => P.ctx.decodeAudioData(ab))
        .then((buf) => (P.buffers[key] = buf))
        .catch(() => { delete P.buffers[key]; });
    }
    return P.buffers[key];
  }
/**
   * Play one phrase as its note events. Returns a handle that owns every voice
   * the phrase took, so a key-off (the 2D path's own-slot cut, `sfx.stop`,
   * `stopAll`, an op10 object's end) releases the whole phrase at once — which
   * is what F0x80035d38 does, matching on the sound's own fields and not on
   * which of its notes is still ringing. `onIdle` fires when the last note has
   * finished on its own, so a caller holding it by slot key can let go.
   */
  function startPhrase(row, onIdle: { (): void; (): void; }) {
    return Promise.all(row.notes.map((note) => phraseNoteAudio(note)))
      .then((audios) => {
        if (P.player.muted || audios.some((a) => !a)) return null;
        if (P.ctx.state === "suspended") P.ctx.resume().catch(() => {});
        const t0 = P.ctx.currentTime + P.PHRASE_LEAD_S;
        const units = new Set<PhraseVoice>();          // the voices this phrase still holds
        const timers: NodeJS.Timeout[] = [];
        const phraseGain = P.ctx.createGain();
        if (phraseGain.gain) phraseGain.gain.value = 1;
        phraseGain.connect(P.gain);
        let stopped = false;
        const later = (ms: number | undefined, fn) => { if (ms > 0) timers.push(setTimeout(fn, ms)); else fn(); };
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
            const rec = P.pool.records[u.voice];
            if (rec && rec.occupant && rec.occupant.src === u.src) P.pool.keyOff(u.voice);
            else { try { u.src.stop(); } catch (e) { /* ended */ } }
          }
          units.clear();
          try { phraseGain.disconnect(); } catch (e) { /* already gone */ }
          onIdle?.();
        };
        row.notes.forEach((note, i: string | number) => {
          const audio = audios[i];
          const at = t0 + note.start / SAMPLE_RATE;
          const begin = () => {
            if (stopped || P.player.muted) return;
            // A voice with no audio is silent, and Web Audio has no 0-frame
            // buffer: nothing to give a voice, exactly as the SPU playing an
            // empty sample is nothing to hear.
            if (!audio || !audio.length) return;
            // One allocator call per note-on, with that note's own priority.
            const took = P.pool.allocate(note.priority);
            if (!took) return;                       // dropped: the SPU has no voice
            if (took.evicted) took.evicted.release();
            const buf = P.ctx.createBuffer(1, audio.length, SAMPLE_RATE);
            buf.copyToChannel ? buf.copyToChannel(audio, 0) : buf.getChannelData(0).set(audio);
            const src = P.ctx.createBufferSource();
            src.buffer = buf;
            src.connect(phraseGain);
            const unit = { voice: took.index, src };
            units.add(unit);
            src.onended = () => {
              P.pool.finish(took.index, src);
              units.delete(unit);
              if (!units.size) onIdle?.();
            };
            src.start(at);
            // The tie-break reads "sample left" (voice +0x04): this voice's own
            // audio, its note-off plus the tone's release.
            P.pool.setLength(took.index, (audio.length * 1000) / SAMPLE_RATE);
            P.pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
            // This note's note-off frees the pool slot and lets the release ring,
            // which is what F0x80035d38's key-off does to every matching voice:
            // the record goes at once (F0x8003670c / F0x8003674c) and the
            // SPU's envelope finishes the note on its own.
            const offAt = at + note.relStart / SAMPLE_RATE;
            later((offAt - P.ctx.currentTime) * 1000, () => P.pool.noteOff(took.index, src));
          };
          later((note.start / SAMPLE_RATE - P.PHRASE_LEAD_S) * 1000, begin);
        });
        return { stop, gain: phraseGain, units: () => [...units].map((u) => u.src) };
      });
  }
// The (bank, slot) pair the driver keys off, derived from the packed id:
  // archive = bits 18-24, row = bits 8-15 (selects the bank through the
  // channel's +0x4208 row array), slot = bits 0-7. Positional ids get no key
  // because their path never keys anything off.
  function slotKeyFor(name: string, meta, bank: string | null | undefined) {
    if (meta.positional) return null;
    const id = meta.id ? Number(meta.id) : NaN;
    if (Number.isFinite(id)) {
      return `${(id >>> 18) & 0x7f}:${(id >>> 8) & 0xff}:${id & 0xff}`;
    }
    return `${bank ?? "common"}/${name}`;
  }
function stopVoice(slotKey: string | null) {
    const v = P.voices.get(slotKey);
    if (!v) return;
    P.voices.delete(slotKey);
    // A 2D phrase holds one voice per note-on, and the original's key-off for
    // it (F0x80035d38) releases the whole sound, so all of them go together.
    if (v.phrase) { v.phrase.stop(); return; }
    if (v.voice !== undefined) P.pool.keyOff(v.voice);
    else { try { v.src.stop(); } catch (e) { /* already ended */ } }
  }
// `overlap` = skip the per-slot self-cut and do not register the voice.
  // Kept for call sites that fire one sound repeatedly and want every instance
  // to ring out (the Fire-Dungeon trap: three explosions half a second apart
  // out of a sound over a second long). With the corrected model this is only
  // a deliberate override, no longer a workaround for category arbitration.
  function startVoice(name: string, meta, bank: string | null | undefined, sustain = false, overlap = false) {
    const slotKey = overlap ? null : slotKeyFor(name, meta, bank);
    // Bit 30 goes through the ONE exclusive-track register: a different id
    // first stops the register's holder through its own stop entry, and the
    // same id does not retrigger.  The register is shared with the bgm player,
    // so EVOLUTIO's start here ends the battle track there, and W_JINGLE's
    // start here ends whatever track the bgm held.
    if (meta.dedup
      && !P.register.begin(P.exclusiveKeyFor(name, meta, bank), name, () => stopVoice(slotKey))) {
      return;
    }
    // The single-source path: a sound whose archive has no phrase row (so the
    // bank does not ship that block — authentic silence or a flat sample), or
    // one whose note table has not loaded.
    const oneSource = () => {
      Promise.resolve(bufferFor(name, bank)).then((buf) => {
        if (P.player.muted || !(buf instanceof AudioBuffer)) return;
        if (P.ctx.state === "suspended") P.ctx.resume().catch(() => {});
        // Per-slot self-cut: only this same (bank, slot) is keyed off. The
        // original keys off BEFORE it asks for a voice (fns.s:38511,
        // F0x8003340c's first act), so the freed voice is available to this one.
        if (slotKey) stopVoice(slotKey);
        // Then ask the pool. A refusal is a dropped sound, not a quiet one:
        // F0x8003432c returns -1 (fns.s:39637-39642) and the sequencer bails
        // (fns.s:41039-41040), both without a sound.
        const took = P.pool.allocate(P.voicePriority(meta));
        if (!took) return;
        if (took.evicted) took.evicted.release();
        const src = P.ctx.createBufferSource();
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
        const vg = P.ctx.createGain();
        if (vg.gain) vg.gain.value = 1;
        vg.connect(P.gain);
        src.connect(vg);
        src.onended = () => {
          const v = slotKey ? P.voices.get(slotKey) : null;
          if (v && v.src === src) P.voices.delete(slotKey);
          P.pool.finish(took.index, src);
          // The exclusive register is NOT cleared here: in the original only an
          // explicit stop stores zero at D0x80055c34.
        };
        src.start(0);
        P.pool.setLength(took.index, P.lengthMsOf(src, buf));
        P.pool.keyOn(took.index, { src, release: () => { try { src.stop(); } catch (e) { /* ended */ } } });
        if (slotKey) P.voices.set(slotKey, { name, src, gain: vg, bank: bank ?? null, voice: took.index });
      });
    };
    whenPhraseRow(name, bank, (row) => {
      // Per-slot self-cut first, exactly as the single-source path below: the
      // original keys off before it asks for a voice (fns.s:38511), so the freed
      // voice is available to this one. Then the phrase takes one voice per
      // note-on.
      if (slotKey) stopVoice(slotKey);
      startPhrase(row, () => {
        if (slotKey && P.voices.get(slotKey)?.phrase) P.voices.delete(slotKey);
      }).then((phrase) => {
        if (phrase && slotKey) {
          P.voices.set(slotKey, { name, src: null, gain: null, bank: bank ?? null, phrase });
        }
      });
    }, oneSource);
  }
  return { loadPhraseTable, decodePcmWav, phraseSampleFor, toFloat32, phraseNoteAudio, whenPhraseRow, bufferFor, startPhrase, slotKeyFor, stopVoice, startVoice };
}
