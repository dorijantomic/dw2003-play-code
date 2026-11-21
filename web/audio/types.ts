// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

export interface AudioPlayer {
  /** the bgm track now playing, null when stopped */
  current: string | null;
  el: HTMLAudioElement;
  muted: boolean;
  play?: (trackId: string) => void;
  playJingle?: (trackId: string) => void;
  setVolume?: (level: number) => void;
  toggleMute?: () => boolean;
  unlock?: () => void;
}

// One voice a phrase still holds: the pool slot it took and the source it started.
export interface PhraseVoice {
  voice: number;
  src: AudioBufferSourceNode;
}

// A bgm/jingle element plus the gain node web/fxaudio.ts routes it through when musicfx is on.
export interface RoutedAudio extends HTMLAudioElement {
  /** true once fxaudio took the element's level over with a gain node */
  routedToGain?: boolean;
}
