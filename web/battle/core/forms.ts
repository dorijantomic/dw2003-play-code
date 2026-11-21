import {
  partyPositionRosterSlot,
  elementValue,
  dnaAnswerAction,
  dnaAnswerForm,
} from "../../vendor/engine.js";
import { ST } from "../messages.js";
import { battleAilmentByte } from "../../battlecmd-translated.js";
import type { BattleContext } from "../../types/battle.js";

import type { BattleState } from "../../types/battle.js";
// moved by tools/rewrite/split-closure.mjs
export function makeForms(B: BattleContext) {
/**
   * The seed the translated Digivolve form list needs (web/battleform-translated.js,
   * engine FightFormSession).
   *
   * Rows: the acting Digimon's current form, then the three equipped forms with a
   * value of 3 or more (F0x80094478 state 0, fightstg.s:18056-1804c). Names and the
   * grey current-form row need nothing else.
   *
   * Page zero's block is the acting Digimon's own battle record: F0x80017174 copies
   * 0x2C bytes from DIGIMON_CUR_STATS+0x1C, whose 19 halfwords are level, tp,
   * cur/max HP, cur/max MP, the six core stats and the seven elemental values
   * (digimon-cur-stats-helpers.md; rust Unknown4Stats). The panel then ADDS the
   * cursor row's own base profile stats (species record +0x02.. six halfwords and
   * +0x0E.. seven) into the six core and seven elemental slots, and prints those
   * thirteen numbers.
   */
  function formListSeed(b: BattleState) {
    const index = b.activePlayerIndex | 0;
    const rec = b.playerRecords?.[index] ?? b.player;
    const panel = formPanelMemberSeed(b, index, rec);
    return {
      activeIndex: index,
      // The screen's self+0x54 is the acting member's ROSTER SLOT, not the party
      // position and not a row of its live form: every table the screen reaches
      // is keyed by it — the profile record at 0x8003EF5C + 0x58*slot (F0x80094504
      // reads its first halfword as the list's first row), the roster record at
      // 0x80049494 + slot*0x3DC that F0x80017174 reads, the equipped triple
      // F0x800176AC resolves and the technique ledger F0x80017A1C searches — and
      // [0x8004B44C] (F0x80016D94) is what answers it for a party position, in
      // the delay slot of the allocator call (fightstg.s:22950-22954). So the
      // list leads with the STARTER species however far the Digimon has
      // digivolved, and the live form only greys its own row.
      slotIndex: partyRosterSlot(b, index),
      currentSpecies: liveFormId(b, index),
      liveSpecies: liveFormId(b, index),
      reservedForm: 0,
      rosterSlots: [0, 1, 2].map((slot) => partyRosterSlot(b, slot)),
      options: panel.options,
      equipped: panel.equipped,
      panelBlock: panel.panelBlock,
      preselected: panel.preselected,
    };
  }
/**
   * THE shared helper both partner screens ask for a party position: the roster
   * slot that position holds, `F0x80016D94` on the walker side
   * (`partyPositionRosterSlot`, engine/dw3/roster.ts). The DNA pane stores it at
   * +0x60 and the Digivolve list at +0x54; the profile rows 0..7 of
   * `0x8003EF5C` are the eight starters, so both screens list the member's own
   * starter species first and its equipped forms after it.
   */
  function partyRosterSlot(b: BattleState, position: number) {
    return partyPositionRosterSlot(b?.playerRoster ?? [], position | 0);
  }
/**
   * One member's carry-over panel data, shared by the Digivolve form list and the
   * DNA pane: the forms it can be asked about, its three equipped ids and its own
   * 22 stat halfwords. F0x800953E4 opens the SAME panel in both screens, so the
   * data is built once here rather than per screen.
   */
  function formPanelMemberSeed(b: BattleState, index: number, rec) {
    const forms = B.formOptionsFor(index, b);
    const elems = B.FORM_ELEMENTS;
    // The panel's own seven numbers are the F0x80017174 scratch's +0x18..+0x24:
    // the roster row's base plus every trained point plus the worn gear's
    // resist. `rec.elemBonuses` already holds the last two (buildPlayerRecord
    // folds the equipment's elemResists in), so the shared helper reads it as
    // the original does.
    const elemValue = (profile, points, key: string) => elementValue(profile, points, key);
    // F0x80017A1C copies the roster's own 0x14-byte technique block for a form:
    // its level byte at +0x02 and its six entry words at +0x08. The walker's form
    // ledger holds the same six words, and battleFormLevel the same level, so the
    // panel's pages one and two list the Digimon's real techniques.
    const ledger = rec?.statsRecord?.formLedger ?? [];
    const techsFor = (formId) => {
      const entry = ledger.find((row) => Number(row?.id) === Number(formId));
      return Array.from({ length: 6 }, (_, i) => (Number(entry?.techSlots?.[i] ?? 0) & 0xffff));
    };
    return {
      options: forms.map((form) => ({
        species: form.id & 0xffff,
        left: [form.str, form.def, form.spt, form.wis, form.spd, form.chr],
        right: elems.map((k) => form.resistances?.[k] ?? 0),
        techs: techsFor(form.id),
        level: B.battleFormLevel(index, form.id, b),
        dvexp: Number(ledger.find((row) => Number(row?.id) === Number(form.id))?.dvexp ?? 0) >>> 0,
      })),
      equipped: (rec?.statsRecord?.equippedForms ?? []).slice(0, 3).map((id) => Number(id)),
      panelBlock: [
        rec?.level | 0, 0, rec?.hp | 0, rec?.maxHp | 0, rec?.mp | 0, rec?.maxMp | 0,
        rec?.str | 0, rec?.def | 0, rec?.spt | 0, rec?.wis | 0, rec?.spd | 0, rec?.chr | 0,
        ...elems.map((k) => elemValue(rec?.savedProfile, rec?.elemBonuses, k)),
        0, 0, 0,
      ],
      preselected: (rec?.profile?.tech_signature ?? 0) & 0xffff,
    };
  }
/**
   * The Digivolve form the screen answered with, committed through the walker's own
   * DV path (web/battle.js applyDvAction): one turn, the form written, the
   * Digivolved scene. The screen itself only reports the choice.
   */
  function confirmDvForm(b: BattleState, speciesId: number) {
    const forms = B.formOptionsFor(b.activePlayerIndex);
    const row = forms.findIndex((form) => (form.id & 0xffff) === (speciesId & 0xffff));
    if (row < 0) { b.state = ST.PLAYER_MENU; return; }
    b.formSel = row;
    b.pendingAction = { type: "dv", formId: forms[row].id };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    b.message = "";
  }
/**
   * The species a party member's LIVE combat record is in, in the walker's own
   * ids. Every translated battle screen is handed this, never the character's
   * `rookieId`: the original's party record at 0x800A4470 + 0x20*slot carries the
   * form the member is in RIGHT NOW (buildPlayerRecord writes record+0x00 from it,
   * and a DV or a Tag replaces only that halfword), and the screens read that
   * record's species — the TAG plate's name, the DNA pane's pairing test and the
   * Digivolve list's greyed "you are already this" row. `rookieId` is the base
   * form, which is the same number for most of a battle and wrong after either of
   * those two.
   */
  function liveFormId(b: BattleState, slot: number) {
    const record = b.playerRecords?.[slot];
    const member = b.playerRoster?.[slot];
    const id = Number(record?.profile?.id ?? member?.id ?? member?.rookieId ?? record?.rookieId ?? 0);
    return Number.isFinite(id) ? id | 0 : 0;
  }
/**
   * The seed the translated DNA pane needs: the acting party slot, the partner
   * the DNA command was raised for, and the three party records the pane's tests
   * read. The result species in the pane's column are NOT the walker's own DNA
   * evolution table: the original's [0x8004B46C] service (F0x800176AC) answers
   * them from the partner's roster record — its three equipped form ids that its
   * own acquired-form ledger holds — and engine/dw3/ui/fight-dna-session.ts runs
   * that port (form-tech-blocks.ts readEquippedForms) over the same records the
   * carry-over preview reads.
   *
   * The ids handed over here are the WALKER's own (digimon.json, 1..55) and the
   * pane reads the GAME's 55-row profile table (species getter [0x8005CCA0], the
   * strip's own species at 0x8003EF5C + 0x58*(self+0x60) and the pairing rule's
   * +0x3D/+0x55). The turn between the two is not made here: FightDnaPane's
   * constructor puts every id it is given through one mapping
   * (`gameFormId`, native/pause-status.ts — the `value0` halfword of the row the
   * walker's id numbers), so a caller cannot hand this pane an id in the wrong
   * space. Real play is checked by tools/verify_dna_realplay.mjs.
   */
  function dnaPaneSeed(b) {
    const choice = b._dnaChoice;
    const active = b.activePlayerIndex | 0;
    const partner = Number(choice?.rosterIndex ?? 0) | 0;
    const members = [0, 1, 2].map((slot) => {
      const member = b.playerRoster?.[slot];
      const record = b.playerRecords?.[slot];
      const stats = member?.stats ?? record?.statsRecord ?? {};
      // The stat carry-over preview F0x800953E4 opens is the same panel the
      // Digivolve form list shows, and it describes the member the player picked,
      // so every member carries its own panel data here.
      const panel = formPanelMemberSeed(b, slot, record);
      return {
        digimonId: liveFormId(b, slot),
        // F0x80016D94: the roster slot this party position holds, which the pane
        // stores at +0x60. The strip it builds starts on that row's own first
        // halfword — the STARTER species, rows 0..7 being the eight starters — so
        // a partner that has already digivolved still leads with its own line.
        rosterSlot: partyRosterSlot(b, slot),
        hp: Number(record?.hp ?? 0) & 0xffff,
        maxHp: Number(record?.maxHp ?? stats.maxHp ?? 0) & 0xffff,
        mp: Number(record?.mp ?? 0) & 0xffff,
        maxMp: Number(record?.maxMp ?? stats.maxMp ?? 0) & 0xffff,
        status: Number(record?.statusBits ?? battleAilmentByte(record)) & 0xff,
        blast: slot === active && !!b.blast?.active,
        panel: {
          slotIndex: partyRosterSlot(b, slot),
          options: panel.options,
          equipped: panel.equipped,
          panelBlock: panel.panelBlock,
        },
        forms: panel.options,
        preselected: panel.preselected,
      };
    });
    return {
      step: "pane",
      activeIndex: active,
      partnerIndex: partner,
      members,
    };
  }
/** Both Tag routes consume the pane's return through the phase's shared decode.
   * fightstg.s:16314-16316 loads -2 in the branch delay slot, before the poll.
   * Cancel restarts the partner picker, without spending a turn or MP.
   */
  function applyDnaAnswer(b: BattleState, answer, kind: string = "command") {
    const action = dnaAnswerAction(kind, answer);
    if (action === "wait") return false;
    if (action === "restart") {
      b._dnaChoice = null;
      b.state = ST.PLAYER_TAG;
      return true;
    }
    // The forced phase has no DNA commit arm (0x80092d08). Preserve its wait;
    // do not substitute a Switch or start another pane after its answer.
    if (action === "nothing") {
      b._dnaBranchBlocked = true;
      return true;
    }
    const choice = b._dnaChoice;
    if (!choice) return false;
    const profiles = B.dnaNative.tables()?.profiles;
    const formId = profiles ? dnaAnswerForm(B.dnaTableReader(profiles), answer) : choice.formId;
    b._dnaChoice = null;
    b.pendingAction = { type: action === "dna" ? "dna" : "tag",
      rosterIndex: choice.rosterIndex, formId };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    b.message = action === "dna" ? "DNA DV!" : "Switch!";
    return true;
  }
  return { formListSeed, partyRosterSlot, formPanelMemberSeed, confirmDvForm, liveFormId, dnaPaneSeed, applyDnaAnswer };
}
