// The decoded per-stage SCRIPTED STORY BATTLES (the decode frontier).
// Ported verbatim from web/story-engine.js SCRIPTED_BATTLES. Only s200 (Genji →
// Kuwagamon) is decoded + live-verified today (battle-invocation.md). Each descriptor is
// converted into three flag-gated OnTalk rows (PRE / battle / POST) + a StartBattle script.
//
// BULK CANDIDATES: `tools/extract_scripted_battles.py` auto-derives PRE/POST pairs game-wide
// (77 candidates / 51 stages) into `web/assets/data/scripted_battles.json` — every field
// EXCEPT `screenId` (actor, armFlag, pre/postFlagKey, handoff_to). It reproduces s200 exactly
// (test_extract_scripted_battles.py). `screenId` is native-trigger-bound (scene_ctx+0x18,
// fn 0x800927a0): resolve per battle from the candidate's `screenId_pool` or the m2c decompile
// pass, then promote the candidate into a hand-verified entry here. Native-only stages with no
// bytecode events (e.g. s465 gondola Bulbmon) are absent from the catalog and need m2c.
//
// `screenId` is the "script-supplied" battle index (battle-invocation.md Step 2) — validated
// at convert time against field_encounters.json (refuse a screen with no party); never invented.
// `armFlag` is the REAL banked flag the PRE event's on_complete sets (s200: 0x400d). `wonFlag`
// is a SYNTHETIC stored marker (engine bank 0x12) standing in for the real game's ordinal
// advance on victory (the original advances [0x8004b370], not a get_flag bit) — mirrors
// story-engine.js's `genji_defeated`.

export interface ScriptedBattle {
  actor: number | null;       // the talkable NPC (npc_id), or null for player/position-triggered
  playerTriggered?: boolean;  // true → wire on the PRE's enter/position trigger (no npc match)
  screenId: number;    // field_encounters screen → enemy party
  armFlag: number;     // real flag set by PRE on_complete; gates PRE → battle
  wonFlag: number;     // synthetic stored flag (bank 0x12) set on victory; gates battle → POST
  preFlagKey: string;  // PRE event flag_key (esdmg entry): the challenge
  postFlagKey: string; // POST event flag_key: closing lines → handoff
}

export const SCRIPTED_BATTLES: Record<string, ScriptedBattle> = {
  s200: {
    actor: 57,                  // Genji
    // Event 50 is selected by s200's native auto-event gate at ordinal 3 while
    // 0x400d is clear. It also puppets actor 1 (the player), so this opening
    // challenge starts as the player arrives rather than waiting for OnTalk.
    playerTriggered: true,
    screenId: 200,              // → Kuwagamon (enemy id 51)
    armFlag: 0x400d,            // PRE on_complete sets 0x400d=1
    wonFlag: 0x1200,            // synthetic engine win marker (bank 0x12)
    preFlagKey: "0112000b",     // esdmg200 entry 11
    postFlagKey: "0112000c",    // esdmg200 entry 12 → HANDOFF 518 → s220
  },
};

// ⚠️ SUPERSEDED for every battle whose pre-fight hook fires the bank-0x74 launcher
// (2026-08-13). `screenId` is no longer unrecoverable: set_flag(0x74NN) starts the current
// stage's scripted (rate-0) encounter record NN (ARENA-C011), so the extractor now reads the
// party out of the hook that invokes the fight and fills `screenId` in the catalog, which
// wins over this table. The launcher reproduces the one battle verified against the running
// game (s200 -> 200) and it CORRECTED three entries below, which a party guess had got wrong:
//   s300:0x404a  322 -> 190     s310:0x404e  10 -> 191     s311:0x405e  32 -> 198
// s310/s311 host two challengers each; this table pointed both at one screen, so one of the
// two fought the wrong party. The launcher slot tells them apart (0x7401 = record 1).
//
// What remains live below: the candidates whose hook fires no launcher at all. Those were
// disambiguated by matching the candidate's screenId_pool parties (field_encounters.json)
// against the DOCUMENTED main-story boss parties (Grindosaur DW3 "Main Story Bosses" table)
// — an outside source, not a decode. Keyed by "<stage>:0x<armFlag>" because armFlag repeats
// across stages. Entries kept as written: a superseded one is now dead weight rather than a
// wrong answer, and deleting them would hide which values the outside table had produced.
// s741/s746/s800/s815 were omitted here for want of a documented party; s800 and s815 no
// longer need one — the launcher resolves them.
export const SCREEN_OVERRIDES: Record<string, number> = {
  "s300:0x404a": 322, // Vemmon
  "s310:0x404e": 10,  // Game Master: Minotarumon/Gargoylemon/Persiamon
  "s310:0x404f": 10,  // Game Master (second trigger NPC)
  "s311:0x405e": 32,  // Chief Officer: MetalSeadramon/VenomMyotismon/Raidenmon
  "s311:0x4067": 32,  // Chief Officer (second trigger NPC)
  "s325:0x4008": 9,   // Datamon (pool 9/313 identical party)
  "s325:0x4009": 313, // Datamon (second phase/trigger)
  "s326:0x4076": 31,  // BKWayGreymon (pool 31/321 identical party)
  "s406:0x407a": 15,  // BKImperialdramon (pool 15/317 identical party)
  "s420:0x4012": 3,   // Seiryu Leader: Minotarumon/Tyrannomon/Apemon
  "s421:0x40a3": 14,  // Qing Long Chief: Deltamon/Triceramon/Kimeramon
  "s520:0x4002": 4,   // Suzaku Leader: Woodmon/RedVegiemon/ShogunGekomon
  "s521:0x4052": 16,  // Zhu Que Chief: Cherrymon/Scorpiomon/Snimon
  "s537:0x40cb": 11,  // Zanbamon (pool 11/314 identical party)
  "s606:0x407e": 23,  // BKWarGrowlmon (pool 23/319 identical party)
  "s615:0x4039": 8,   // WaruMonzaemon
  "s616:0x4080": 24,  // BKKingNumemon (pool 24/320 identical party)
  "s675:0x401e": 5,   // Byakko Leader (fake): Numemon x2
  "s676:0x405a": 25,  // Bai Hu Chief: Rockmon/Gryphonmon/Ebidramon
  "s735:0x400e": 19,  // Ice Witch: Frigimon/MegaSeadramon/Mammothmon
  "s741:0x4084": 28,  // Fire Master (optional, Fire Dungeon): Lynxmon/Lynxmon/Creepymon
  "s746:0x4086": 29,  // Dark Master (optional, Dark Dungeon): Ghoulmon/Piedmon/Infermon
  "s745:0x4041": 21,  // Dark Knight: SkullSatamon/Devidramon/Vilemon
  "s755:0x4001": 18,  // Genbu Leader: Vikemon/MetalEtemon/Antylamon
  "s756:0x405b": 26,  // Xuen Wu Chief: Boltmon/SkullMammothmon/Puppetmon
  "s820:0x4074": 33,  // Lord Megadeath: Fujinmon/Suijinmon/Raijinmon
};
