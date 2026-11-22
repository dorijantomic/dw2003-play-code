// Types for web/audio.ts (the shared player context) and the two install modules.

/** The two sides a battle op10 sound can come from. */
export type BattleSide = "player" | "enemy";

/** One row of assets/sfx/manifest.json: the disc tone record the build decoded. */
export interface SfxRow {
  id?: string;
  slot?: number;
  dedup?: boolean;
  positional?: boolean;
  rate?: number;
  priority?: number;
  loop?: { start: number; end: number };
  /** battle sounds play at this rate so their length fits the animation */
  battleRate?: number;
}

/** One note event of a 2D phrase (phrases.json `notes`): offsets are in source samples. */
export interface PhraseNote {
  start: number;
  relStart: number;
  sample: number;
  rate: number;
  release: { mode: string; seconds: number };
  gain: number;
  priority: number;
}

/** A phrase row of phrases.json: the note events of one packed sound. */
export interface PhraseRow {
  id?: string;
  slot?: number;
  notes: PhraseNote[];
}

/** sfx-voice/phrases.json as the fetch hands it over. */
export interface PhraseTable {
  /** vag id -> its sample bytes (kept untyped: read straight into the phrase render) */
  samples: Record<string | number, any>;
  phrases: Record<string, PhraseRow>;
  banks?: Record<string, Record<string, PhraseRow>>;
}

/** One row of assets/data/map_sound_archives.json. */
export interface MapSoundArchive {
  archive: number;
  bank: string;
  play_id: string;
  alt_play_ids: string[];
  extra_archives: number[];
}

/** What packedSampleResolver() resolves a packed sound id to. */
export interface PackedSample {
  name: string;
  bank: string | null;
}

/** What a sustained slot holds: a claim token, a single source, or the phrase that took it. */
export type SustainedSource = AudioBufferSourceNode | PhraseHandle | { stop?: () => void } | null;

/** What startPhrase() hands back: every voice the phrase took, released together on key-off. */
export interface PhraseHandle {
  stop(): void;
  gain: GainNode;
  units(): AudioBufferSourceNode[];
}

/** A voice in the per-(bank, slot) map: a single source, or a whole phrase. */
export interface SfxVoiceEntry {
  name: string;
  src: AudioBufferSourceNode | null;
  gain: GainNode | null;
  bank: string | null;
  voice?: number;
  phrase?: PhraseHandle;
}

/** The one bit-30 exclusive-track register (web/audio/bgm.ts), shared with the bgm player. */
export interface ExclusiveRegister {
  begin(key: string, name: string, stop: (() => void) | null): boolean;
  releaseName(name: string): void;
  clear(): void;
  stopHeld(): void;
  id(): string | null;
}

export interface AudioEngine {
  /** assets/sfx/area_manifest.json: bank name -> stem -> row */
  areaManifest: Record<string, Record<string, SfxRow>> | null;
  battleGate: { acquire(side: BattleSide): boolean; release(side: BattleSide): void; };
  battleName: { player: string | null; enemy: string | null; };
  battlePhrase: { player: PhraseHandle | null; enemy: PhraseHandle | null; };
  battleSrc: { player: AudioBufferSourceNode | null; enemy: AudioBufferSourceNode | null; };
  battleTimer: { player: ReturnType<typeof setTimeout> | null; enemy: ReturnType<typeof setTimeout> | null; };
  battleVoice: { player: number; enemy: number; };
  bufferFor: (name: string, bank?: string | null) => AudioBuffer | Promise<AudioBuffer | void>;
  buffers: Record<string, AudioBuffer | Promise<AudioBuffer | void>>;
  ctx: AudioContext | null;
  Ctx: typeof AudioContext | null;
  curBank: string | null;
  decodePcmWav: (bytes: ArrayBuffer) => Int16Array;
  effectLoopName: string | null;
  effectLoopPhrase: PhraseHandle | null;
  effectLoopSrc: AudioBufferSourceNode | null;
  effectLoopVoice: number;
  exclusiveKeyFor: (name: string, meta: SfxRow, bank: string | null) => string;
  gain: GainNode | null;
  lengthMsOf: (src: AudioBufferSourceNode, buf: AudioBuffer) => number;
  loadPhraseTable: () => Promise<PhraseTable | null>;
  /** assets/sfx/manifest.json: stem -> row */
  manifest: Record<string, SfxRow> | null;
  /** assets/data/map_sound_archives.json: stage id -> the archive its area sounds come from */
  mapArchives: Record<string, MapSoundArchive> | null;
  /** the packed-id resolver the grind loads (packed-sound.ts); null until it is in */
  packedResolve: ((id: number) => PackedSample | null) | null;
  packedResolveFrom: [Record<string, SfxRow>, Record<string, Record<string, SfxRow>> | null] | null;
  PHRASE_CACHE_SAMPLES: number;
  PHRASE_LEAD_S: number;
  phraseNoteAudio: (note: PhraseNote) => Promise<Float32Array | null>;
  /** a pending render is a promise until it settles; the cache budget peeks `.length` on it */
  phraseRenders: Map<string, any>;
  phraseRenderSamples: number;
  phraseRowFor: (name: string, bank: string | null) => PhraseRow | null;
  phraseSampleFor: (vag: string | number) => Promise<Int16Array | null>;
  phraseSamples: Map<string | number, Promise<Int16Array | null>>;
  /** sfx-voice/phrases.json */
  phraseTable: PhraseTable | null;
  phraseTablePromise: Promise<PhraseTable | null> | null;
  player: SfxPlayerContext;
  /** the engine's SPU voice pool (engine/systems/spu-voice-pool.ts), outside the web program */
  pool: any;
  prevBank: string | null;
  register: ExclusiveRegister;
  releaseExclusiveByName: (name: string) => void;
  slotKeyFor: (name: string, meta: SfxRow, bank: string | null) => string | null;
  startPhrase: (row: PhraseRow, onIdle: (() => void) | null) => Promise<PhraseHandle | null>;
  startVoice: (name: string, meta: SfxRow, bank: string | null, sustain?: boolean, overlap?: boolean) => void;
  stopVoice: (slotKey: string) => void;
  sustainedPhrase: Map<string, PhraseHandle>;
  /** a claim token until the buffer resolves, then the source or the phrase that took the slot */
  sustainedSrc: Map<string, SustainedSource>;
  sustainedVoice: Map<string, number>;
  toFloat32: (pcm: Int16Array) => Float32Array;
  voicePriority: (meta: SfxRow) => number;
  voices: Map<string, SfxVoiceEntry>;
  whenPhraseRow: (name: string, bank: string | null, run: (row: PhraseRow) => void, otherwise: () => void) => void;
}

export interface SfxPlayerContext {
  debugEffectLoop?: () => string | null;
  debugSustained?: () => string[];
  debugVoices?: () => number;
  exclusiveId?: () => number;
  muted: boolean;
  play: (name: string) => void;
  playArea?: (name: string, { sustain }?: { sustain?: boolean; }) => void;
  playBank?: (bank: string, name: string, { sustain }?: { sustain?: boolean; }) => void;
  playBankSound?: (bank: string, name: string, { sustain }?: { sustain?: boolean; }) => string | null;
  playBattle?: (name: string, side?: BattleSide, durationFrames?: number) => void;
  playEffectLoop?: (name: string) => void;
  playPacked: (id: number, { overlap }?: { overlap?: boolean; }) => string | null;
  playSustained?: (name: string) => void;
  setMap?: (mapId: string) => void;
  setVolume?: (level: number) => void;
  stop?: (name: string) => void;
  stopAll?: () => void;
  stopAllSustained?: () => void;
  stopBattle?: (side?: BattleSide) => void;
  stopEffectLoop?: () => void;
  stopFade?: (name: string, seconds?: number) => void;
  stopSustained?: (name: string) => void;
  toggleMute?: () => boolean;
  unlock?: () => void;
}
