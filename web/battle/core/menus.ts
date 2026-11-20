import {
  techniqueMpCost,
  combatantElements,
  confusionGagRoll,
  RAND_U16,
  jokeFlavorPick,
  statusEventLockHeld,
  fleeChance,
  runAwayLine,
} from "../../vendor/engine.js";
import { itemFamily } from "../../itemicons.js";
import { ST, MSG_KIND, MSG } from "../messages.js";
import { currentMenuItems } from "../layout.js";
import { activeSlotOf, effectiveSpd } from "../plans.js";
import { battleAilmentByte } from "../../battlecmd-translated.js";
import { persistPlayerGauge } from "../form-blast.js";
import { releaseBattleLayer } from "../../battle-layer.js";

// moved by tools/rewrite/split-closure.mjs
export function makeMenus(B) {
// ── Input ──

  /**
   * The seed the translated TECH screen needs: the acting slot, its MP, and the
   * member's technique words with their decoded prices. party record +0x1A is
   * the Blast-active flag (3d-battle-complete-model §"Blast"), which is what
   * makes the original skip both the grey test and the MP debit.
   */
  function techListSeed(b) {
    const mpCostDown = b.player.mpCostDown ?? 0;
    return {
      activeIndex: b.activePlayerIndex | 0,
      mp: b.player.mp | 0,
      maxMp: b.player.maxMp | 0,
      noCharge: b.blast?.active ? 1 : 0,
      techniques: B.playerTechs().map((skill) => ({
        word: Number(skill.techWord ?? 0) & 0xffff,
        cost: techniqueMpCost(skill.mp_cost ?? 20, skill.techWord ?? 0, { mpCostDown }),
      })),
    };
  }
/**
   * The seed the translated ITEM screen needs: the carried items, in the order
   * the original's own id table offers them. The walker's `usableItems()` is the
   * same set the original's inventory filter keeps (the four HP charges and the
   * 25 battle disks), so the rows and the page count are unchanged by the port.
   */
  function itemListSeed(b) {
    void b;
    return { items: B.usableItems().map((item) => ({
      id: Number(item.id) | 0,
      qty: Number(item.qty ?? 0) & 0xff,
      // The item RECORD's own byte +9, the icon class the resident F0x80013584
      // indexes the exe's cel table (0x80042BA8) with — read from the SAME module the
      // field ITEM menu and the shop resolve their row icons through (web/itemicons.js),
      // so all three lists share one resolution. This seed used to pass a literal 0, so
      // every battle row resolved through family 0 -> cel 74 and drew a weapon icon for
      // whatever was held (Power Charge's capsule showed as a sword).
      family: Number(itemFamily(item.id) ?? 0) & 0xff,
    })) };
  }
/** The item id the screen answered with, resolved through the same list. */
  function confirmItem(b, id) {
    const item = B.usableItems().find((entry) => entry.id === id);
    if (!item) { b.state = ST.PLAYER_MENU; return; }
    b.itemSel = Math.max(0, B.usableItems().indexOf(item));
    b.pendingAction = { type: "item", item };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    // The item action's own first page is the announcement the disc shows (kind 14,
    // `FIGHTSTG_F0x8008dac0` outer step 0, `fightstg.s:11161`): the Digimon's name and
    // the item's own name out of bank 0x6a. The old sentence stays only as what
    // `peek()` read.
    B.sayOriginal(b, B.itemAnnouncementSpec(b, item), `Used ${item.name}!`);
  }
/** The technique id the screen answered with, resolved through the same list. */
  function confirmTech(b, id) {
    const skill = B.playerTechs().find((entry) => (Number(entry.techWord ?? 0) & 0x1fff) === id);
    if (!skill) { b.state = ST.PLAYER_MENU; return; }
    b.techSel = Math.max(0, B.playerTechs().indexOf(skill));
    b.pendingAction = { type: "tech", skill };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    B.sayOriginal(b, B.techniqueSpec(b, skill), `${b.player.profile.name} uses ${skill.name}!`);
  }
/**
   * The seed the translated TAG screen needs: the acting slot, whether the battle
   * may cancel the list (self+0x58, 0 for the forced TAG after a knockout) and
   * the three party records it scans. A member with no Digimon has species 0 and
   * is skipped by the original's scan; a knocked-out member keeps its row with a
   * grey plate, so its HP is passed through unchanged.
   *
   * The row it opens on is the list's own row word, handed over as the original
   * hands it over: fightstg.s:21258-21260 seeds the shared model's cursor from
   * the cell behind self+0x54 without a clamp, and fightstg.s:21312 writes the
   * confirmed row back into that cell.
   */
  function tagListSeed(b) {
    const members = [0, 1, 2].map((slot) => {
      const member = b.playerRoster?.[slot];
      const record = b.playerRecords?.[slot];
      const stats = member?.stats ?? record?.statsRecord ?? {};
      const formId = B.liveFormId(b, slot);
      return {
        digimonId: formId,
        hp: Number(record?.hp ?? 0) & 0xffff,
        maxHp: Number(record?.maxHp ?? stats.maxHp ?? 0) & 0xffff,
        mp: Number(record?.mp ?? 0) & 0xffff,
        maxMp: Number(record?.maxMp ?? stats.maxMp ?? 0) & 0xffff,
        name: String(member?.name ?? record?.profile?.name ?? ""),
        blast: slot === b.activePlayerIndex && !!b.blast?.active,
        forms: { digimonId: formId, equippedForms: stats.equippedForms ?? [], formLedger: stats.formLedger ?? [] },
      };
    });
    return {
      activeIndex: b.activePlayerIndex | 0,
      interactive: b._forcedTag ? 0 : 1,
      cursorRow: b.tagRow | 0,
      members,
    };
  }
/**
   * The party position the TAG partner list answered with.
   *
   * The disc has NO separate form screen here. Confirming a row answers the
   * chosen party POSITION, and the coordinator then spawns ONE follow-up object
   * -- `fightstg.s:16343` `F0x800988fc` delegates to `F0x80098884`, whose tick
   * `F0x800980E4` is allocated at `:22481` -- the DNA pane. The pane runs its
   * own two sub-states, the species strip (the header names the species under
   * the cursor, L1/R1 move the candidate row, and the shared stat panel is
   * shown) and then the "Switch" / "DNA DV" row list.
   *
   * The walker used to open a hand-drawn form screen (ST.PLAYER_TAG_FORM) between
   * the list and the pane. That screen duplicated the pane's own species
   * sub-state, which is why a screen labelled with one form name appeared before
   * the real pane (playtest bug 12b). It is gone: a confirmed position seats the
   * pane the translated path already draws (ST.PLAYER_DNA_CHOICE) and lets the
   * pane run its own sub-state progression. The seed carries the position;
   * `dnaPaneSeed` resolves the member's roster slot, so the species strip leads
   * with the member's STARTER species (rows 0..7) and lists its equipped forms
   * after it -- the form the player wants is chosen on that strip, not here.
   */
  function confirmTag(b, slot) {
    const position = Number(slot) | 0;
    const member = b.playerRoster?.[position];
    if (!member) { b.state = ST.PLAYER_MENU; return; }
    b.tagTargetIndex = position;
    b.formSel = 0;
    const form = B.formOptionsFor(position)[0] ?? null;
    // Seat the pane. Its species strip is what lets the player move to another
    // form, so this only needs the partner's live form as the fallback the
    // legacy row list and the non-loaded-pane case read.
    const choice = form ? B.dnaChoiceFor(position, form) : null;
    b._dnaChoice = form
      ? (choice
        ? { ...choice, rosterIndex: position, formId: form.id }
        : { rosterIndex: position, formId: form.id, cost: null, switchOnly: true })
      : null;
    b.dnaSel = 0;
    b.state = ST.PLAYER_DNA_CHOICE;
  }
/**
   * Commit the joke the player picked on the confused list (STATUS-C004).
   *
   * The original's owner rolls F0x800A1910 on the Circle press and then writes the
   * result the sequencer maps: 0 is the ordinary Attack, anything else is the gag
   * and the turn is forfeited (fightstg.s:24680-24695, :24718-24773; the sequencer
   * at :16392-16410). The picked row only chooses which of that joke's two lines is
   * printed (:24738-24754). Shared by the ported list and the hand-drawn fallback.
   */
  function confirmJokePick(b, row) {
    const joke = b.confusedMenu?.[row] ?? b.confusedMenu?.[0];
    const magnitude = b.player.ailments.confuse?.power ?? 0;
    // The gag's wind term is the block F0x8009EC94 has just rebuilt
    // (fightstg.s:32129 `jal FIGHTSTG_F0x8009ec94`, then the two halfwords at
    // block +0x1E and +0x12 summed at :32136-32139): the roster row's own value
    // plus the live form's own on top, read through the shared in-battle helper.
    const effectiveWind = combatantElements(b.player).wind;
    const equippedResistance = b.player.statusResists?.confuse;
    const confuseResistance = equippedResistance
      ?? b.player.profile?.status_resist?.confuse
      ?? 0;
    const gag = confusionGagRoll(
      magnitude, effectiveWind, confuseResistance, RAND_U16,
    );
    // F0x8009a734 picks one of the joke's two lines with a single fresh random bit
    // (fightstg.s:24738-24754), and that same bit chooses which esmfight index the
    // message box's second line is given.
    const pick = jokeFlavorPick(joke?.jokeIndex ?? 0, RAND_U16);
    b.confusedMenu = null;
    b.pendingAction = gag
      ? {
        type: "confused", jokeIndex: joke?.jokeIndex ?? 0,
        flavorBit: pick.bit, flavor: pick.text,
      }
      : { type: "fight" };
    b.playerFirst = true;
    b.state = ST.PLAYER_ACT;
    b.timer = 0;
    if (!gag) B.sayOriginal(b, B.attackSpec(b), `${b.player.profile.name} attacks!`);
  }
/**
   * Run the command the selection points at. This is the body of the Circle
   * press on the command list, shared by the legacy key path and the shipped
   * pro/fightstg menu (which hands back its chosen row): the native route must
   * not be able to drift from the walker's own confirm.
   */
  function confirmCommand(b) {
    const items = currentMenuItems(b);
    const sel = (items[b.menuSel] ?? "").toLowerCase();
    if (sel === "fight") {
      b.pendingAction = { type: "fight" };
      b.playerFirst = true;
      b.state = ST.PLAYER_ACT;
      b.timer = 0;
      B.sayOriginal(b, B.attackSpec(b), `${b.player.profile.name} attacks!`);
    } else if (sel === "tech") {
      // The TECH row is ALWAYS enterable, exactly as on the disc. The command-flow
      // phase routes row 1 to branch 3 (`0x800830F4[3] = 0x80092A28`,
      // `pro/fightstg.s:266` and `:16282`) whose first act is
      // `FIGHTSTG_F0x80096e88` (`:20777`): it allocates the 0xD8 TECH screen and
      // returns, with no test of the technique list. The screen's own build
      // `FIGHTSTG_F0x800967A0` (`:20332`) reads the acting form's technique words and,
      // when the count is ZERO, still builds the list widget at `:20577`-`:20591`
      // (config `0x800A3554` row count 1) and arms it — so the player enters, sees an
      // empty list, and cancels. The walker used to refuse here with its own "No
      // techs!" notice, which made the row read as unselectable whenever the acting
      // Digimon's current form carried no learned technique halfwords; a mid-battle
      // Tag or a knocked-out lead is exactly when the acting record becomes such a
      // Digimon (a freshly acquired digivolution has an empty list until its Skill-LV
      // learn gates are met), which is why it showed up after a swap or a death.
      b.state = ST.PLAYER_TECH;
      b.techSel = 0;
    } else if (sel === "dv") {
      const forms = B.formOptionsFor(b.activePlayerIndex);
      if (forms.length < 2) { b.menuNotice = "Cannot digivolve."; return; }
      b.state = ST.PLAYER_DV;
      b.formSel = Math.max(0, forms.findIndex((form) => form.id !== b.player.profile.id));
    } else if (sel === "tag") {
      // The original's list owns the empty case. F0x80097498 walks the three
      // party records at 0x800A4460 + 0x20*i (fightstg.s:21202-:21245) and keeps
      // one whose live form halfword at +0x00 is non-zero (:21211-:21213) and
      // which is not the acting member (:21215-:21217) -- current HP is NOT
      // tested, so a knocked-out partner is still a row -- and at zero candidates
      // (self+0x64, :21246-:21248) it builds one text element (kind 0x1005,
      // :21269-:21275) and later sets it to word 0x14 of bank 0x7F (:21477-:21486), goes to state 2 (:21280-:21284) and draws
      // the message pane cel 0x31 at (11,188) with the text at (20,194) and a
      // blinking hand at (291,208) (:21455-21485). Only Circle is read there and
      // it answers -2, so the walker's hp>0 list must not pre-empt the pane: two
      // dead partners must still show grey rows, and only a one-Digimon party
      // must reach the pane.
      if (B.tagNative.failed()) {
        if (!B.tagMembers().length) { b.menuNotice = "No partner to tag."; return; }
      }
      b.state = ST.PLAYER_TAG;
      b.tagSel = 0;
    } else if (sel === "item") {
      const items2 = B.usableItems();
      if (!items2.length) { b.message = "No items!"; return; }
      b.state = ST.PLAYER_ITEM;
      b.itemSel = 0;
    } else if (sel === "run") {
      // The player's Run is F0x800a1608 side 0 (fightstg): a 0..127 roll under
      //   (base+1)*8 + level advantage + speed advantage (only when faster)
      //   + the Runner Sandal/Shoes bonus, from the fighters' real level and SPD.
      // The routine's FIRST test is the encounter's own byte 0x80042b65 (the screen
      // record's +0x19, `raw_2b58_2b65[13]`): nonzero returns 0, so the Run can never
      // succeed — the flag that refuses a Run in the story/special battles (zero of
      // the 167 screens that carry it appear in any active random-encounter zone).
      // The Runner item folds into that sum (`+0x3c`); Sleep/tech-abort refuse it
      // and Frozen halves the base. Capture Beam (211) stages status event 0x10 on
      // the player's active fighter, the game's own "can't run away" lock; that lock
      // LIVES in the status-event pool, so this gate asks the queue whether its entry
      // is still queued -- the original's own `find` (`pro/wfightmn.s:27062`).
      if (!statusEventLockHeld(b.statusEvents, 0, 0, activeSlotOf(b, 0)) &&
          fleeChance({ selfLevel: b.player.level | 0, otherLevel: b.enemy.level | 0,
            selfSpd: effectiveSpd(b.player), otherSpd: effectiveSpd(b.enemy),
            escapeBonus: b.player.escapeBonus | 0, selfAilment: battleAilmentByte(b.player),
            escapeBlocked: (b.encounterGateBytes?.[13] ?? 0) !== 0 }, RAND_U16)) {
        b.state = ST.RESULT_MSG;
        b._nextState = ST.NONE;
        // The Run command's own arm (`wfightmn.s` file `0x1880`-`0x18d8`) increments the
        // escape base counter, queues the RUN_AWAY event for actor 0 and puts up
        // esmfight[0x41] "Run!" (kind 2, arg 0) BEFORE the event rolls; the runAway arm
        // then prints 0x43 "Run away!" on the success (`wfightmn.s` file `0x2294`-`0x22a0`).
        // Both are Circle-gated pages in this order, and the battle ends when the second
        // has been read (the walker's own exit — flee bypasses endBattle, so the music is
        // restored here).
        B.setResultPages(b, [
          { text: `${b.player.profile.name} runs!`,
            spec: { kind: MSG_KIND.OUTCOME, payload: [MSG.RUN], name: b.player.profile.name } },
          { text: "Got away safely!",
            spec: { kind: MSG_KIND.OUTCOME, payload: [runAwayLine(0)], name: b.player.profile.name } },
        ]);
        b.timer = 0;
        const cb = b.onFlee;
        b._runAwayEnd = () => {
          persistPlayerGauge(b);
          if (B.bgm && b._fieldTrack !== undefined) B.bgm.play(b._fieldTrack);
          releaseBattleLayer();
          B.battle = null; cb?.();
        };
      } else {
        // The disc prints NO second page for a failed Run: the 0x41 "Run!" line the
        // command arm put up is the only one (the runAway arm's failure arm re-queues the
        // event with a delay and shows nothing — claim
        // wfightmn-runaway-recover-clearfield-2026-10-10), and the turn passes on.
        B.sayOriginal(b, {
          kind: MSG_KIND.OUTCOME, payload: [MSG.RUN], name: b.player.profile.name,
        }, `${b.player.profile.name} runs!`);
        B.queueAfterAction(b, "player");
        b.state = ST.RESULT_MSG;
        b.timer = 0;
      }
    }
  }
  return { techListSeed, itemListSeed, confirmItem, confirmTech, tagListSeed, confirmTag, confirmJokePick, confirmCommand };
}
