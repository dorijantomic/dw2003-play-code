# web/audio
The Web Audio sound system: bgm plus one-shot and looped sfx, decoded from the game's own archives.
Entry: web/audio.ts (createSfxPlayer) mounts these modules and re-exports createBgmPlayer / createExclusiveRegister.

| file | lines | job | main exports |
|---|---|---|---|
| bgm.ts | 123 | the single exclusive-track register and the bgm player that holds it | createExclusiveRegister, createBgmPlayer |
| playback.ts | 287 | shared player context: WAV decode, phrase table, buffer cache, voices | makePlayback |
| player-play.ts | 339 | every cue start: named one-shot, op10 battle cue, effect loop, bank/area/map | installPlayApi |
| player-stop.ts | 166 | every cue stop: fades, held and looping cues, mute, resume on gesture | installStopApi |
| types.ts | 15 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- why starting one track kills another -> bgm.ts (the exclusive register)
- starting a sound by name / packed id -> player-play.ts
- a sound that will not stop, fade or resume -> player-stop.ts
- sample decode, phrase voices, buffer reuse -> playback.ts
