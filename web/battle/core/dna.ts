import { dvLevelForExp } from "../progress.js";
import { battleTechWords, dnaClip12Chunks } from "../layout.js";
import {
  listItemIds,
  heldCount,
  itemUsableInBattle,
  tagCandidateIndices,
  battleFormIds,
  DNA_SPECIES_TABLE,
  DNA_PRICES,
  walkerProfileRow,
  DNA_COMBATANT_STRIDE,
  dnaPairing,
  dnaActionRecord,
  dnaRejection,
  RAND_U16,
} from "../../vendor/engine.js";
import { dnaFusedForm, DNA_PARENT_CLIP, restoreWalkerSentence, DNA_RESULT_TABLE } from "../messages.js";
import { battleAilmentByte } from "../../battlecmd-translated.js";
import { dnaResultAttack, resolveAttack } from "../hit-results.js";
import { resolveModelFolder } from "../../battle3d.js";
import { battleRestorePlanFor, applyStatDebuffDispatch } from "../restore.js";
import { enemyMsgName } from "../hud.js";
import { finalizePlayerDamage } from "../../battle.js";
import type { BattleDnaPresentation } from "./types.js";
import type { BattleContext } from "../../types/battle.js";

// moved by tools/rewrite/split-closure.mjs
export function makeDna(B: BattleContext) {
function playerTechs() {
    if (!B.battle) return [];
    const partner = B.battle.player.statsRecord;
    const currentId = B.battle.player.profile.id;
    partner.formLedger ??= Object.entries(partner.dvexpByForm ?? {}).map(([id, dvexp]) => ({
      id: Number(id), formLevel: dvLevelForExp(Number(dvexp) || 0, B.digimonDB?.[id]?.dv_cap ?? 100),
      dvexp: Number(dvexp) || 0, techSlots: [],
    }));
    // Rookie: signature only. A digivolution contributes its six learned slots,
    // then loaded ordinary slots from the other equipped forms are merged in.
    // Keep the flagged halfword with each entry: the price rule reads 0x4000, and
    // the id alone cannot distinguish a native use from a loaned one.
    const flagged = battleTechWords({
      ledger: partner?.formLedger,
      currentId,
      equippedForms: partner?.equippedForms,
      signatureTech: B.battle.player.profile.tech_signature ?? B.battle.player.profile.techs?.[1] ?? 0,
      // While Blast is active the fighter IS the blast form (setLiveBattleForm on
      // the transformation's model frame), and the TECH list marks or appends
      // that form's own signature with 0x8000 (F0x800967A0 :20381-:20400).
      blastSignature: B.battle.blast?.active
        ? (B.battle.player.profile.tech_signature ?? B.battle.player.profile.techs?.[1] ?? 0)
        : 0,
    });
    return flagged
      .map((word) => {
        const skill = B.skillDB[Number(word) & 0x1fff];
        return skill ? { ...skill, techWord: Number(word) & 0xffff } : null;
      })
      .filter(Boolean);
  }
function usableItems() {
    const state = B.getState();
    // The original's in-battle ITEM list is F0x800135E8 over directory 1 (the
    // consumables / disks / booster band) in TABLE ORDER, so two players holding
    // the same items read the same rows top to bottom however they got them.
    return listItemIds(state, 1)
      .map(id => {
        // Import ITEM_BY_ID lazily via window.__itemById if wired
        const item = window.__ITEM_BY_ID?.[id];
        return item ? { ...item, qty: heldCount(state, id) } : null;
      })
      .filter(Boolean)
      // The same effect-record gate as the translated list, not effect labels.
      // F0x800135E8 supplies the carried directory members in table order.
      // FIGHTSTG then reads bit 1 from each member's effect record.
      // This shares admission with the route census over the shipped catalog.
      // Chips and booster packs therefore do not enter the battle list.
      .filter(i => itemUsableInBattle(i.id));
  }
function tagMembers() {
    if (!B.battle) return [];
    const liveRoster = B.battle.playerRecords.map((record) => ({ stats: { hp: record.hp } }));
    return tagCandidateIndices(liveRoster, B.battle.activePlayerIndex)
      .map((index) => ({
        ...B.battle.playerRoster[index],
        stats: {
          ...B.battle.playerRoster[index].stats,
          hp: B.battle.playerRecords[index].hp,
          maxHp: B.battle.playerRecords[index].maxHp,
          mp: B.battle.playerRecords[index].mp,
          maxMp: B.battle.playerRecords[index].maxMp,
        },
        rosterIndex: index,
      }));
  }
function formOptionsFor(rosterIndex: number, bb = B.battle) {
    const member = bb?.playerRoster?.[rosterIndex];
    if (!member) return [];
    // The list starts at the form the member is in NOW, not at its base form:
    // F0x80094478 reads the profile block's own first halfword for the row it
    // greys, and that halfword is the live record's species. The two are the same
    // number for most of a battle and different after a DV or a Tag.
    return battleFormIds(B.liveFormId(bb, rosterIndex), member.stats)
      .map((id) => B.digimonDB[id]).filter(Boolean);
  }
function battleFormLevel(rosterIndex: number, formId, bb = B.battle) {
    const member = bb?.playerRoster?.[rosterIndex];
    const record = member?.stats?.formLedger?.find((r) => Number(r.id) === Number(formId));
    return Number(record?.formLevel ?? (Number(formId) === B.liveFormId(bb, rosterIndex)
      ? member?.stats?.level : 0)) || 0;
  }
/**
   * The bytes the DNA command's rule reads, at their own addresses: the 55
   * profile records at 0x8003EF5C (the pane's species strip starts on the same
   * table) and the 18-byte technique records at 0x80042BDC. These are the two
   * tables web/battledna-translated.js loads for the pane, handed out by
   * `dnaNative.tables()`, so the pane and the command path read one copy of one
   * table rather than two copies of two. `techniques` is left out by the one
   * caller that only asks which profile row a form sits in.
   */
  function dnaTableReader(species, techniques?: any) {
    const ranges = [
      [DNA_SPECIES_TABLE, species],
      ...(techniques ? [[DNA_PRICES, techniques]] : []),
    ];
    const byte = (addr: number) => {
      for (const [base, bytes] of ranges) {
        const at = addr - base;
        if (at >= 0 && at < bytes.length) return bytes[at];
      }
      return 0;
    };
    return {
      read8: (addr: number) => byte(addr) & 0xff,
      read16: (addr: number) => (byte(addr) | (byte(addr + 1) << 8)) & 0xffff,
    };
  }
/**
   * The profile record for one of the walker's own Digimon.
   *
   * The game's profile table is 55 rows of 0x58 bytes and digimon.json's 55
   * profiles are those rows in the same order — read straight out of the two
   * files, every row's halfword at +0x2A equals that profile's `tech_dna_dv`
   * and every row's byte at +0x55 equals its own 1-based index
   * (tests/lane-b/dna-command.test.js checks all 55 both ways).
   *
   * The row is not worked out here. It is asked of the SAME mapping the DNA pane
   * uses on its seed (`ui.walkerProfileRow`, native/pause-status.ts): walker id ->
   * the row's own `value0` halfword -> the row the species getter [0x8005CCA0]
   * would answer for that form id. One rule for both id spaces.
   */
  function dnaProfileRecord(reader: { read8: (addr: number) => number; read16: (addr: number) => number; }, profile) {
    const row = walkerProfileRow(reader, Number(profile?.id ?? 0));
    return row < 0 ? 0 : (DNA_SPECIES_TABLE + DNA_COMBATANT_STRIDE * row) >>> 0;
  }
/**
   * The fused form for one DNA action, from the game's loaded tables.
   *
   * `dnaFusedForm` at module level does the work and carries the decode notes;
   * this hands it the scripts `loadData` fetched and the profile-table bytes the
   * DNA pane already has. The model number the script spawns is the profile
   * table's own row-0 halfword (383 for Kotemon, whose pack folder is m383pken;
   * 468, 469 and 470 for Agunimon, BladeGarurumon and AncientGreymon), so the
   * roster row carrying it is found by reading the same table the pairing rule
   * uses — no name table, no transcription.
   */
  function jogressFused(actionId: number, profiles) {
    return dnaFusedForm(B.jogressDB, profiles, actionId, B.digimonDB);
  }
/**
   * The DNA command's answer, by the original's rule and nothing else.
   *
   * FIGHTSTG_F0x800980e4 :22132-22163 (0x8009832c-0x800983b8) reads the acting
   * member's profile byte +0x3D, the cursor species' own +0x55, and on a match
   * the acting record's halfword +0x2A; the confirm at :22296-22301 (0x800985b4)
   * charges the halfword at 0x80042BDC + 0x12*(that id - 1) off BOTH members.
   * F0x8008f714 (0x8008f760-0x8008f7d4) then runs that same id's own 18-byte
   * record as the action, and its clip byte at +0x10 is 12 for every DNA result
   * — the Jogress director, presentation command 0x3A.
   *
   * Nothing here consults the walker's own DNA evolution table. It used to, twice:
   * `findDnaEvolution` matched the two parents by NAME and LEVEL, and
   * `dnaFusedProfiles` renamed the result from the same transcription (a
   * hand-written Rust file, not the disc). Both are gone; the pair, the price, the
   * attack and the form that appears are four reads of disc data.
   *
   * The fused form is disc data all the way down: the director script names a
   * model id, that id is the profile table's own `+0x00` halfword, and the roster
   * row that carries it holds the name the DNA pane and the name bank use. All ten
   * of the game's fusions are roster Digimon — Paildramon, Phoenixmon,
   * MegaGargomon, Omnimon, Imperialdramon-P, Beelzemon, Diaboromon, Agunimon,
   * BladeGarurumon and AncientGreymon.
   *
   * What the walker still cannot do is DRAW the last three: Agunimon,
   * BladeGarurumon and AncientGreymon are models 468, 469 and 470, and those are
   * the three smdldata keys with no extracted pack folder
   * (docs/research/battle/smdldata-container-2026-08-05.md). The name is right, the
   * mesh is missing; the presentation falls back to the acting form for those three
   * and says nothing different about it.
   */
  function dnaChoiceFor(rosterIndex: string | number, partnerProfile) {
    const b = B.battle;
    const tables = B.dnaNative?.tables?.();
    if (!b || !partnerProfile || !tables) return null;
    const reader = dnaTableReader(tables.profiles, tables.techniques);
    const mine = dnaProfileRecord(reader, b.player.profile);
    const theirs = dnaProfileRecord(reader, partnerProfile);
    const pairing = dnaPairing(reader, mine, theirs);
    if (pairing === null) return null;
    const tech = dnaActionRecord(reader, pairing.resultId);
    // 0x8008f7cc: a record whose clip byte is not 12 is an ordinary action, and
    // then it is not this command's action to run.
    if (!tech || tech.clip !== DNA_PARENT_CLIP) return null;
    const jogress = jogressFused(pairing.resultId, tables.profiles);
    const fused = jogress?.profile ?? null;
    return {
      resultId: pairing.resultId,
      // Both members pay the full price: 0x8009864c and 0x80098680.
      cost: pairing.price,
      tech,
      // The director script's own fused model and the roster row that carries it.
      fusedModel: jogress?.fusedModel ?? null,
      fusedName: fused?.name ?? null,
      // The mesh to put in the result slot. Only a director script can name one;
      // without one the acting form holds the slot, as it always did.
      resultProfile: fused ?? b.player.profile,
      fused,
    };
  }
/**
   * Gather the six combatant fields the native DNA eligibility tests read.
   *
   * `statusBits` is the raw record +0x1c word. The walker models ailments by
   * name rather than as native bits, and which ailment sets bit 0x20 or 0x08 is
   * NOT established — DNA-C009 records that no applier was identified for those
   * bits, which is why only low MP and a dead participant are player-reachable
   * rejections. So we forward real bits when a record carries them and 0
   * otherwise, rather than inventing a bit-to-ailment mapping the evidence does
   * not support.
   */
  function dnaParticipantsFor(b, rosterIndex: string | number) {
    const partner = b.playerRecords?.[rosterIndex];
    return {
      activeMp: Number(b.player?.mp ?? 0),
      partnerMp: Number(partner?.mp ?? 0),
      activeHp: Number(b.player?.hp ?? 0),
      partnerHp: Number(partner?.hp ?? 0),
      activeStatus: Number(b.player?.statusBits ?? battleAilmentByte(b.player)),
      partnerStatus: Number(partner?.statusBits ?? battleAilmentByte(partner)),
    };
  }
function dnaScriptChunks(dna: BattleDnaPresentation) {
    return dnaClip12Chunks(B.dnaResultScript?.fullScript?.segments, dna);
  }
function startDnaChunk(b, dna: BattleDnaPresentation) {
    const c = dna.chunks[dna.chunk];
    if (!c || !B.renderer3d) return;
    if (c.show) B.renderer3d.setPlayerVisible(true);   // seg 4: the original actor returns
    if (dna.chunk === 3) {
      // Seg-2 second half (camera hold → white-out): the ignited orbs leave their
      // parents and dance the captured orbit path until the op7 white-out. The u
      // span = the chunk's op11 waits up to the op7 (310+18+32+56 in the real bin).
      let ticks = 0;
      for (const r of c.ops) {
        if (r.op === 7) break;
        if (r.op === 11) ticks += r.words?.[0] | 0;
      }
      B.renderer3d.dnaOrbsPath?.(B.dnaResultScript.orbPath, ticks || 416);
    }
    B.renderer3d.playPlayerScript({ ops: c.ops }, {
      motionTables: { 29: 29, 30: DNA_RESULT_TABLE },
      rotationBase: c.result ? B.dnaResultScript.resultSlot.rotation[1] : 0,
      // No camera flag here: the record a segment's op5 cuts lives until the next cut, so the
      // segment boundaries carry the shot across on their own (the original's single live
      // camera record, fightstg.s F0x80092244 / F0x800922b4 — nothing clears it).
      // Effect 1004 = the full-screen fusion flash (runtime capture dnau_0300): it covers
      // the swap from the normal arena to the pinned digital void, which then hosts the
      // whole orb-merge / reveal / result-attack sequence (dnau_0400–0650).
      // 1005/1006 = the parent-orb ignition bursts: the persistent orb overlay takes
      // over from the 42-tick effect objects (runtime decode 2026-07-15).
      onEffect: (rec: { type: number; }) => {
        if (rec.type === 1004) B.renderer3d?.dnaPresentationStart?.();
        else if (rec.type === 1005) B.renderer3d?.dnaOrbIgnite?.("A");
        else if (rec.type === 1006) B.renderer3d?.dnaOrbIgnite?.("B");
      },
      // op7 type 0 = the fusion white-out; the orbs end in its flare.
      onOverlay: (rec: { type: number; }) => {
        if (rec.type === 0) {
          B.renderer3d?.dnaOrbsClear?.();
          B.renderer3d?.dnaFusionStart?.();
        }
      },
      // op2 modes 1/2: slot 4 is the ENEMY (hidden for the void sequence, shown again for
      // the result attack's impact); the chunk's own slot controls the on-screen actor.
      onVisibility: (rec) => {
        if (rec.slot === 4) B.renderer3d?.setEnemyVisible?.(rec.visible);
        else if (rec.slot === c.slot) B.renderer3d?.setPlayerVisible(rec.visible);
      },
    });
  }
function applyDnaAction(action: { rosterIndex: string | number; formId: string | number; }) {
    const b = B.battle;
    const partner = b.playerRecords[action.rosterIndex];
    const partnerProfile = B.digimonDB[action.formId];
    const choice = dnaChoiceFor(action.rosterIndex, partnerProfile);
    // Silent rejection, matching the native's shared no-op convergence at
    // 0x80098790: no message, no state change [DNA-C006].
    if (!partner || !choice
        || dnaRejection(dnaParticipantsFor(b, action.rosterIndex), choice.cost)) {
      return false;
    }

    // Action type 6 charges the full result-tech MP cost to both resident
    // combat records. It does not change active roster index or either saved
    // form: the DNA result is a temporary attack actor.
    b.player.mp -= choice.cost;
    partner.mp -= choice.cost;
    b.participantIndices.add(action.rosterIndex);

    // The result technique is the disc's own record: its category, element, accuracy
    // byte (+0x06), family and scalar all come from it. A category-4 record (375, full
    // restore + cure all) is a heal, never a hit, so it never enters the resolver.
    const dnaRecord = B.fightTechDB?.[String(choice.resultId | 0)] ?? null;
    const { restore: dnaIsRestore, skill: dnaSkill } = dnaResultAttack(
      choice.resultId, dnaRecord, choice.tech, B.elementNameForElem1(dnaRecord?.elem1 ?? choice.tech.element));

    const hit = dnaIsRestore ? { hit: false, dmg: 0 }
      : resolveAttack(b.player, b.enemy, dnaSkill, RAND_U16, b.field);

    const originalProfile = b.player.profile;
    b._dnaPresentation = {
      phase: "parents",
      originalProfile,
      resultProfile: choice.resultProfile,
      // The game's own name for the fusion, which the announcement line uses even
      // when the mesh for it is not in web/assets/battle/models.
      fusedName: choice.fusedName,
      partnerName: partnerProfile.name,
      damage: hit.hit ? hit.dmg : 0,
      hit: hit.hit,
      lethal: hit.hit && hit.dmg >= b.enemy.hp,
      committed: false,
      restoreRecord: dnaIsRestore ? dnaRecord : null,
      record: dnaRecord,
      resultId: choice.resultId | 0,
    } as BattleDnaPresentation;
    // The authentic clip-12 frames keep the normal HUD but suppress the
    // separate slot-7 face viewport until the battle presentation returns.
    B.renderer3d?.setFaceCamVisible?.(false);
    // Full clip-12 director script (5 segments, decoded 2026-07-14): battle.js is the
    // "owner" each segment's end signals — it plays each segment as a script and swaps the
    // single on-screen actor at the boundaries. Falls back to the legacy 2-phase flow
    // (parent clip + segment-2 tail) when fullScript is absent from dna_clip12.json.
    // Warm every model the presentation will swap to, so the chunk boundaries
    // don't stall on network fetches mid-show.
    for (const name of [partnerProfile.name, choice.resultProfile.name]) {
      resolveModelFolder(name).then((f) => f && B.renderer3d?.preloadDigimon?.(f)).catch(() => {});
    }
    const chunks = dnaScriptChunks(b._dnaPresentation);
    if (chunks) {
      b._dnaPresentation.mode = "full";
      b._dnaPresentation.chunks = chunks;
      b._dnaPresentation.chunk = 0;
      startDnaChunk(b, b._dnaPresentation);
    } else {
      B.renderer3d?.playPlayerActionClip(DNA_PARENT_CLIP);
    }
    b.message = `${originalProfile.name} + ${partnerProfile.name}\nDNA Digivolve!`;
    return true;
  }
/** A category-4 DNA result (375): the record machine's restore arm on the player's own party, no hit. */
  function commitDnaRestore(b, dna) {
    if (dna.committed) return;
    dna.committed = true;
    const who = b.player.profile.name;
    const name = dna.fusedName ?? dna.resultProfile.name;
    const restore = battleRestorePlanFor(b, 0, dna.restoreRecord, dna.resultId, { name: who });
    if (!restore) return;
    const spec = restore.page
      ? { kind: restore.page.kind, payload: restore.page.payload,
          name: restore.page.name, slots: restore.page.slots }
      : null;
    B.setResultPages(b, [{ text: restoreWalkerSentence(restore, { name }, who), spec }]);
  }
function commitDnaImpact(b, dna) {
    if (!dna?.hit || dna.committed) return;
    dna.committed = true;   // then the disc's special-encounter finalizer, WFIGHTMN 0x800aabf0
    dna.damage = finalizePlayerDamage(b, dna.damage); dna.lethal = dna.damage > 0 && dna.damage >= b.enemy.hp; b.enemy.hp = Math.max(0, b.enemy.hp - dna.damage);
    if (dna.damage > 0) B.noteFinalBossPhaseDamage(b);
    const enemyName = enemyMsgName(b.enemy);
    const debuff = applyStatDebuffDispatch(b, 0, dna.record, { player: b.player.profile.name, enemy: enemyName });   // the post-hit dispatcher runs on a landed hit (434: attack -50%)
    B.setResultPages(b, [
      // The fusion attack runs through the shared damage stage, so its two lines are the
      // box's own `kind 4` page (`esmfight[0x0b]` "{1} damage!") and, when it takes the
      // enemy's last HP, the controller's `kind 2` "Defeated!" page.
      { text: `${enemyName} took ${dna.damage} damage!`,
        spec: B.damageSpec(enemyName, dna.damage, "") },
      debuff?.page ?? null,
      dna.lethal ? { text: `${enemyName} has been defeated!`,
        spec: B.defeatedSpec(enemyName) } : null,
    ]);
  }
  return { playerTechs, usableItems, tagMembers, formOptionsFor, battleFormLevel, dnaTableReader, dnaProfileRecord, jogressFused, dnaChoiceFor, dnaParticipantsFor, dnaScriptChunks, startDnaChunk, applyDnaAction, commitDnaRestore, commitDnaImpact };
}
